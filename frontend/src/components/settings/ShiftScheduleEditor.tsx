'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Plus, Trash2, ChevronDown, Check } from 'lucide-react';
import { PortalDropdown } from '@/components/ui/PortalDropdown';
import {
  DAYS_OF_WEEK,
  TIME_OPTIONS,
  ShiftRule,
  createRuleId,
  parseSchedule,
  formatSchedule,
  classifySegment,
} from '@/lib/shiftSchedule';

interface ShiftScheduleEditorProps {
  value: string;
  onChange: (nextValue: string) => void;
  /** Compact layout for modals */
  compact?: boolean;
}

const DEFAULT_RULE = (): ShiftRule => ({
  id: createRuleId(),
  days: [1, 2, 3, 4, 5],
  startTime: '8AM',
  endTime: '5PM',
});

function buildTimeOptions(current: string): string[] {
  if (!current || TIME_OPTIONS.includes(current)) return TIME_OPTIONS;
  return [current, ...TIME_OPTIONS];
}

export function ShiftScheduleEditor({ value, onChange, compact = false }: ShiftScheduleEditorProps) {
  const initialParsed = useMemo(() => parseSchedule(value), []);
  const [rules, setRules] = useState<ShiftRule[]>(() => {
    if (initialParsed && initialParsed.length > 0) return initialParsed;
    if (!value.trim()) return [{ id: createRuleId(), days: [], startTime: '8AM', endTime: '5PM' }];
    return [DEFAULT_RULE()];
  });

  // Track last emitted value so external prop resets (e.g. switching user) re-sync cleanly
  const lastEmittedRef = useRef<string>(value);

  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    const parsed = parseSchedule(value);
    setRules(
      parsed && parsed.length > 0
        ? parsed
        : [{ id: createRuleId(), days: [], startTime: '8AM', endTime: '5PM' }]
    );
  }, [value]);

  const commitRules = (nextRules: ShiftRule[]) => {
    setRules(nextRules);
    const formatted = formatSchedule(nextRules);
    lastEmittedRef.current = formatted;
    onChange(formatted);
  };

  // Map each day (1..7) to the rule id that currently owns it
  const dayOwnerMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of rules) {
      for (const d of r.days) {
        map.set(d, r.id);
      }
    }
    return map;
  }, [rules]);

  const toggleDay = (ruleId: string, dayIndex: number) => {
    const targetRule = rules.find((r) => r.id === ruleId);
    if (!targetRule) return;
    const alreadyInRule = targetRule.days.includes(dayIndex);

    const nextRules = rules.map((r) => {
      if (r.id === ruleId) {
        const nextDays = alreadyInRule
          ? r.days.filter((d) => d !== dayIndex)
          : [...r.days, dayIndex].sort((a, b) => a - b);
        return { ...r, days: nextDays };
      }
      // If assigning this day to targetRule, automatically move it off any other rule
      if (!alreadyInRule && r.days.includes(dayIndex)) {
        return { ...r, days: r.days.filter((d) => d !== dayIndex) };
      }
      return r;
    });

    commitRules(nextRules);
  };

  const updateRuleTime = (ruleId: string, field: 'startTime' | 'endTime', nextTime: string) => {
    const nextRules = rules.map((r) => (r.id === ruleId ? { ...r, [field]: nextTime } : r));
    commitRules(nextRules);
  };

  const addRule = () => {
    if (rules.length >= 7) return;
    // Smart default time for an override row: if first rule is DAY, default to 1PM–9PM; else 8AM–5PM
    const firstSegment = rules[0] ? formatSchedule([rules[0]]) : '';
    const firstKind = firstSegment ? classifySegment(firstSegment) : 'DAY';
    const nextRule: ShiftRule = {
      id: createRuleId(),
      days: [],
      startTime: firstKind === 'DAY' ? '1PM' : '8AM',
      endTime: firstKind === 'DAY' ? '9PM' : '5PM',
    };
    setRules((prev) => [...prev, nextRule]);
  };

  const removeRule = (ruleId: string) => {
    const nextRules = rules.filter((r) => r.id !== ruleId);
    if (nextRules.length === 0) {
      commitRules([{ id: createRuleId(), days: [], startTime: '8AM', endTime: '5PM' }]);
      return;
    }
    commitRules(nextRules);
  };

  return (
    <div className={`space-y-3 ${compact ? '' : 'w-full'}`}>
      <div className="space-y-2">
        {rules.map((rule, idx) => {
          const startOpts = buildTimeOptions(rule.startTime);
          const endOpts = buildTimeOptions(rule.endTime);

          return (
            <div
              key={rule.id}
              className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-zinc-950/90 border border-zinc-800/90"
            >
              {/* Day Pills */}
              <div className="inline-flex items-center gap-1" role="group" aria-label={`Shift ${idx + 1} days`}>
                {DAYS_OF_WEEK.map((day) => {
                  const isSelected = rule.days.includes(day.index);
                  const owner = dayOwnerMap.get(day.index);
                  const ownedByOther = Boolean(owner && owner !== rule.id);

                  return (
                    <button
                      key={day.index}
                      type="button"
                      onClick={() => toggleDay(rule.id, day.index)}
                      title={
                        isSelected
                          ? `${day.full} (selected — click to remove)`
                          : ownedByOther
                          ? `${day.full} (assigned to another shift — click to move here)`
                          : `${day.full} (click to add)`
                      }
                      className={`w-7 h-7 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer select-none ${
                        isSelected
                          ? 'bg-indigo-600 text-white border-indigo-500 shadow-xs'
                          : ownedByOther
                          ? 'bg-zinc-900/40 text-zinc-600 border-dashed border-zinc-700/80 hover:border-indigo-500/50 hover:text-zinc-300'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-zinc-200'
                      }`}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>

              {/* Time Range */}
              <div className="flex items-center gap-1.5 ml-auto sm:ml-1">
                <TimeSelect
                  ariaLabel={`Shift ${idx + 1} start time`}
                  value={rule.startTime}
                  options={startOpts}
                  onChange={(v) => updateRuleTime(rule.id, 'startTime', v)}
                />
                <span className="text-[11px] text-zinc-500">to</span>
                <TimeSelect
                  ariaLabel={`Shift ${idx + 1} end time`}
                  value={rule.endTime}
                  options={endOpts}
                  onChange={(v) => updateRuleTime(rule.id, 'endTime', v)}
                />

                {rules.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRule(rule.id)}
                    title="Remove this shift rule"
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {rule.days.length === 0 && rules.length > 1 && (
                <span className="w-full text-[10px] text-amber-400/90 pl-0.5">
                  Pick the day(s) for this shift — clicking a day moves it here automatically.
                </span>
              )}
            </div>
          );
        })}

        {rules.length < 7 && (
          <button
            type="button"
            onClick={addRule}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-indigo-300 hover:text-indigo-200 bg-indigo-500/10 hover:bg-indigo-500/15 border border-indigo-500/25 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add different day / shift</span>
          </button>
        )}
      </div>
    </div>
  );
}

function TimeSelect({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const selectedRef = useCallback((el: HTMLButtonElement | null) => {
    const list = el?.parentElement;
    if (el && list) list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2;
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`h-7 min-w-[78px] pl-2.5 pr-1.5 flex items-center justify-between gap-1.5 rounded-lg bg-zinc-900 border text-[11px] font-medium text-zinc-100 transition-colors ${
          open ? 'border-indigo-500/60' : 'border-zinc-800 hover:border-zinc-700'
        }`}
      >
        {value}
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <PortalDropdown triggerRef={triggerRef} onClose={close}>
          <div role="listbox" className="relative w-[104px] max-h-60 overflow-y-auto custom-scrollbar">
            {options.map((t) => {
              const selected = t === value;
              return (
                <button
                  key={t}
                  ref={selected ? selectedRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(t);
                    close();
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[11px] font-medium text-left transition-colors ${
                    selected ? 'bg-indigo-500/15 text-indigo-300' : 'text-zinc-300 hover:bg-zinc-700/60 hover:text-zinc-100'
                  }`}
                >
                  {t}
                  {selected && <Check className="w-3 h-3" />}
                </button>
              );
            })}
          </div>
        </PortalDropdown>
      )}
    </>
  );
}
