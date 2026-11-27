'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Rocket,
  X,
  Loader2,
  ChevronDown,
  Calendar as CalendarIcon,
  Clock,
  Globe,
  Building2,
  Sparkles,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { DayPicker, DateRange } from 'react-day-picker';
import 'react-day-picker/style.css';
import {
  taskMapApi,
  LaunchMeta,
  getManilaDateKey,
  collectClientDashboardLists,
} from '@/api/taskMap';
import type { EnrichedLaunchEntry } from './LaunchMapDayDrawer';
import { useAppStore } from '@/lib/store';
import { toast } from '@/lib/toast';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LaunchDayModalProps {
  /** Pre-selected date key (YYYY-MM-DD), e.g. the day that was clicked */
  initialDate: string;
  /** Existing launches on this day (if any) */
  existingEntries?: EnrichedLaunchEntry[];
  /** Handler to delete/unschedule a launch */
  onDeleteLaunch?: (taskId: string) => Promise<void> | void;
  onClose: () => void;
  onSaved: (
    taskId: string,
    data: {
      launchMeta: LaunchMeta;
      effectiveLaunchDate: string | null;
      targetPeriod?: string | null;
      dueDate: string | null;
    }
  ) => void;
}

const COMMON_TIMEZONES = [
  { label: 'Manila / Singapore (+08:00)', value: 'Asia/Manila' },
  { label: 'Singapore (+08:00)', value: 'Asia/Singapore' },
  { label: 'Kuala Lumpur (+08:00)', value: 'Asia/Kuala_Lumpur' },
  { label: 'Jakarta (+07:00)', value: 'Asia/Jakarta' },
  { label: 'Bangkok (+07:00)', value: 'Asia/Bangkok' },
  { label: 'Tokyo (+09:00)', value: 'Asia/Tokyo' },
  { label: 'Seoul (+09:00)', value: 'Asia/Seoul' },
  { label: 'Mumbai (+05:30)', value: 'Asia/Kolkata' },
  { label: 'Dubai (+04:00)', value: 'Asia/Dubai' },
  { label: 'London (GMT)', value: 'Europe/London' },
  { label: 'Berlin (+01:00)', value: 'Europe/Berlin' },
  { label: 'New York (EST)', value: 'America/New_York' },
  { label: 'Chicago (CST)', value: 'America/Chicago' },
  { label: 'Los Angeles (PST)', value: 'America/Los_Angeles' },
  { label: 'Sydney (+11:00)', value: 'Australia/Sydney' },
  { label: 'Auckland (+13:00)', value: 'Pacific/Auckland' },
];

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const LABEL_TO_JS_WD: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function formatTime12h(time24: string): string {
  if (!time24) return '09:00 PM';
  const trimmed = time24.trim();
  if (/am|pm/i.test(trimmed)) return trimmed;
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [hStr, mStr] = trimmed.split(':');
    let h = parseInt(hStr, 10);
    const m = parseInt(mStr || '0', 10);
    if (!isNaN(h)) {
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
    }
  }
  return trimmed;
}

function parseDateKey(ymd?: string | null): Date | undefined {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return undefined;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function dateToKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDisplay(ymd?: string | null): string {
  if (!ymd) return 'Pick date…';
  try {
    const d = new Date(`${ymd}T12:00:00`);
    if (isNaN(d.getTime())) return ymd;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
  } catch {
    return ymd;
  }
}


const RDP_STYLE = `
  .ldm-rdp .rdp-root {
    --rdp-accent-color: #8b5cf6;
    --rdp-accent-background-color: rgba(139, 92, 246, 0.2);
    --rdp-day-height: 32px;
    --rdp-day-width: 32px;
    --rdp-day_button-height: 30px;
    --rdp-day_button-width: 30px;
    --rdp-day_button-border-radius: 6px;
    --rdp-selected-border: 1.5px solid #8b5cf6;
    --rdp-today-color: #a78bfa;
    --rdp-nav_button-height: 26px;
    --rdp-nav_button-width: 26px;
    color: #e4e4e7;
    font-size: 11.5px;
  }
  .ldm-rdp .rdp-month_caption { font-size: 12px; font-weight: 700; color: #f4f4f5; }
  .ldm-rdp .rdp-button_previous, .ldm-rdp .rdp-button_next { border-radius: 5px; color: #a1a1aa; }
  .ldm-rdp .rdp-button_previous:hover, .ldm-rdp .rdp-button_next:hover { background: #27272a; color: #fff; }
  .ldm-rdp .rdp-chevron { fill: #a78bfa; }
  .ldm-rdp .rdp-weekday { color: #71717a; font-size: 10px; font-weight: 600; opacity: 1; }
  .ldm-rdp .rdp-day_button { color: #e4e4e7; font-size: 11px; transition: background 0.1s; }
  .ldm-rdp .rdp-day_button:hover:not(:disabled) { background: #27272a; }
  .ldm-rdp .rdp-today:not(.rdp-selected) .rdp-day_button { color: #a78bfa; font-weight: 700; border: 1px solid rgba(139, 92, 246, 0.5); }
  .ldm-rdp .rdp-selected .rdp-day_button, .ldm-rdp .rdp-range_start .rdp-day_button, .ldm-rdp .rdp-range_end .rdp-day_button { background: #8b5cf6; color: #ffffff; font-weight: 700; border-color: #8b5cf6; }
  .ldm-rdp .rdp-range_middle .rdp-day_button { background: rgba(139, 92, 246, 0.2); color: #c4b5fd; }
  .ldm-rdp .rdp-outside .rdp-day_button { color: #52525b; opacity: 0.4; }
`;

export const LaunchDayModal: React.FC<LaunchDayModalProps> = ({
  initialDate,
  existingEntries = [],
  onDeleteLaunch,
  onClose,
  onSaved,
}) => {
  const spaces = useAppStore((s) => s.spaces);
  const allLists = useAppStore((s) => s.allLists);
  const loadSpaces = useAppStore((s) => s.loadSpaces);

  useEffect(() => {
    if (!spaces || spaces.length === 0) loadSpaces();
  }, [spaces, loadSpaces]);

  // Build client list from database
  const clients = useMemo(() => {
    const result: Array<{ id: string; name: string; timezone?: string }> = [];
    const seen = new Set<string>();
    for (const c of collectClientDashboardLists(spaces, allLists)) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        const listData = allLists?.find((l) => l.id === c.id);
        result.push({
          id: c.id,
          name: c.name,
          timezone:
            (listData as { timezone?: string; rolloverTimezone?: string })?.timezone ||
            (listData as { rolloverTimezone?: string })?.rolloverTimezone,
        });
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [spaces, allLists]);

  const initialDateObj = parseDateKey(initialDate);
  const initialJsWd = initialDateObj ? initialDateObj.getDay() : new Date().getDay();

  const [title, setTitle] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const clientDropRef = useRef<HTMLDivElement>(null);

  // Selected weekdays (mon-sun buttons)
  const [selectedWeekdays, setSelectedWeekdays] = useState<Set<number>>(new Set([initialJsWd]));

  // Date range
  const [startDate, setStartDate] = useState<string>(initialDate);
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState<string>('');

  // End Date Time
  const [endTime, setEndTime] = useState<string>('11:59 PM');

  // DayPicker
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [endDatePickerOpen, setEndDatePickerOpen] = useState(false);
  const datePickerRef = useRef<HTMLDivElement>(null);
  const endDatePickerRef = useRef<HTMLDivElement>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => parseDateKey(initialDate) || new Date());

  // Time
  const [launchTime, setLaunchTime] = useState('09:00 PM');
  const [timezone, setTimezone] = useState('Asia/Manila');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Keep clientSearch synced if selectedClientId is set
  useEffect(() => {
    if (selectedClientId && !clientSearch) {
      const match = clients.find((c) => c.id === selectedClientId);
      if (match) setClientSearch(match.name);
    }
  }, [selectedClientId, clients]);

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    const q = clientSearch.toLowerCase().trim();
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, clientSearch]);

  // Auto-set client timezone if available
  useEffect(() => {
    if (!selectedClientId) return;
    const client = clients.find((c) => c.id === selectedClientId);
    if (client?.timezone) {
      setTimezone(client.timezone);
    }
  }, [selectedClientId, clients]);

  // Click outside to close client dropdown
  useEffect(() => {
    if (!clientDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (clientDropRef.current && !clientDropRef.current.contains(e.target as Node)) {
        setClientDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [clientDropdownOpen]);

  // Click outside date pickers
  useEffect(() => {
    if (!datePickerOpen && !endDatePickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (datePickerOpen && datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setDatePickerOpen(false);
      }
      if (endDatePickerOpen && endDatePickerRef.current && !endDatePickerRef.current.contains(e.target as Node)) {
        setEndDatePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [datePickerOpen, endDatePickerOpen]);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !datePickerOpen && !endDatePickerOpen) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, datePickerOpen, endDatePickerOpen]);

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const startDateObj = parseDateKey(startDate);
  const endDateObj = parseDateKey(endDate);

  const rangeSelection: DateRange | undefined = useMemo(() => {
    if (!hasEndDate) return undefined;
    return { from: startDateObj, to: endDateObj || undefined };
  }, [hasEndDate, startDateObj, endDateObj]);

  const toggleWeekday = useCallback((jsWd: number) => {
    setSelectedWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(jsWd)) {
        if (next.size > 1) next.delete(jsWd);
      } else {
        next.add(jsWd);
      }
      return next;
    });
  }, []);

  const handleDeleteExisting = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDeleteLaunch) return;
    setDeletingId(taskId);
    try {
      await onDeleteLaunch(taskId);
      toast.success('Launch deleted from calendar');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete launch');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Please enter a Launch Title');
      return;
    }
    if (!selectedClientId) {
      toast.error('Please select a client');
      return;
    }
    if (!startDate) {
      toast.error('Please pick a launch date');
      return;
    }

    setSaving(true);
    try {
      const q = title.trim();
      const res = await taskMapApi.getLaunchCandidates({ q, limit: 10 });
      const clientName = selectedClient?.name || '';

      const match =
        (res.candidates || []).find((t) => (t.list?.name || '').toLowerCase() === clientName.toLowerCase()) ||
        res.candidates?.[0];

      if (!match) {
        toast.error(`No task found matching "${q}" for client "${clientName}". Please ensure task exists in Nexus.`);
        setSaving(false);
        return;
      }

      const endMetaStr = hasEndDate && endDate ? ` | End: ${endDate} ${formatTime12h(endTime)}` : '';
      const saveRes = await taskMapApi.updateLaunchMeta(match.id, {
        launchDate: startDate,
        targetPeriod: null,
        isLaunchDate: true,
        workstream: null,
        details: `Scheduled Time: ${formatTime12h(launchTime)}${endMetaStr} (${timezone})`,
        notes: hasEndDate && endDate ? `End Date: ${endDate} ${formatTime12h(endTime)}` : null,
        syncDueDate: true,
      });

      if (saveRes.success) {
        onSaved(match.id, {
          launchMeta: saveRes.launchMeta,
          effectiveLaunchDate: saveRes.effectiveLaunchDate,
          targetPeriod: saveRes.targetPeriod ?? null,
          dueDate: saveRes.dueDate,
        });
        toast.success('Launch scheduled successfully!');
        onClose();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to schedule launch');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <style>{RDP_STYLE}</style>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[430px] bg-[#121216] border border-[#27272e] rounded-2xl shadow-2xl p-4 flex flex-col gap-2.5 text-zinc-100"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-0.5 border-b border-[#22222a]">
          <div className="flex items-center gap-2">
            <Rocket className="size-4 text-purple-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-100">
              SET LAUNCH SCHEDULE
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Existing launches on this day (with DELETE LAUNCH button) */}
        {existingEntries.length > 0 && (
          <div className="p-2.5 rounded-xl bg-[#18181f] border border-[#272733] flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400">
                Existing Launches on this Day ({existingEntries.length})
              </span>
            </div>
            <div className="flex flex-col gap-1 divide-y divide-[#252530]">
              {existingEntries.map((entry) => (
                <div
                  key={entry.task.id}
                  className="pt-1 first:pt-0 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1 flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 font-semibold truncate max-w-[90px]">
                        {entry.clientName}
                      </span>
                      <span className="text-xs font-semibold text-zinc-200 truncate">
                        {entry.task.title}
                      </span>
                    </div>
                  </div>
                  {onDeleteLaunch && (
                    <button
                      type="button"
                      disabled={deletingId === entry.task.id}
                      onClick={(e) => handleDeleteExisting(entry.task.id, e)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                      title="Delete this launch from calendar"
                    >
                      {deletingId === entry.task.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Trash2 className="size-3" />
                      )}
                      <span>Delete</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Launch Title Input */}
        <div className="flex flex-col gap-1">
          <label className="text-[10.5px] font-semibold text-zinc-400">Launch Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Black Friday Campaign Launch"
            autoFocus
            className="bg-[#18181f] border border-[#2a2a35] rounded-xl px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 transition-colors"
          />
        </div>

        {/* Client Dropdown with typing / searching */}
        <div className="flex flex-col gap-1" ref={clientDropRef}>
          <label className="text-[10.5px] font-semibold text-zinc-400">Client</label>
          <div className="relative">
            <div
              className={`w-full h-8 flex items-center gap-2 px-3 rounded-xl border text-xs transition-colors ${
                clientDropdownOpen
                  ? 'border-purple-500 ring-1 ring-purple-500/40 bg-[#18181f]'
                  : 'border-[#2a2a35] bg-[#18181f] hover:border-purple-500/50'
              }`}
            >
              <Building2 className="size-3.5 text-purple-400 shrink-0" />
              <input
                type="text"
                value={clientSearch}
                onFocus={() => setClientDropdownOpen(true)}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setClientDropdownOpen(true);
                  if (!e.target.value) {
                    setSelectedClientId('');
                  }
                }}
                placeholder="Select client from database…"
                className="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-400 focus:outline-none"
              />
              {clientSearch ? (
                <button
                  type="button"
                  onClick={() => {
                    setClientSearch('');
                    setSelectedClientId('');
                  }}
                  className="p-0.5 rounded text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  title="Clear"
                >
                  <X className="size-3" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setClientDropdownOpen((v) => !v)}
                className="p-0.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <ChevronDown
                  className={`size-3 transition-transform ${
                    clientDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </div>

            {clientDropdownOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[#18181f] border border-[#2e2e3d] rounded-xl shadow-2xl max-h-44 overflow-y-auto custom-scrollbar p-1">
                {clients.length === 0 ? (
                  <div className="flex items-center justify-center py-5 text-xs text-zinc-500">
                    <Loader2 className="size-3.5 animate-spin mr-1.5" /> Loading clients…
                  </div>
                ) : filteredClients.length === 0 ? (
                  <div className="py-4 text-center text-xs text-zinc-500">
                    No clients found matching &ldquo;{clientSearch}&rdquo;
                  </div>
                ) : (
                  filteredClients.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedClientId(c.id);
                        setClientSearch(c.name);
                        setClientDropdownOpen(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-2 hover:bg-[#252530] transition-colors cursor-pointer ${
                        c.id === selectedClientId ? 'bg-purple-950/60 text-purple-300 font-semibold' : 'text-zinc-300'
                      }`}
                    >
                      <Building2 className="size-3 shrink-0 text-zinc-500" />
                      <span className="truncate">{c.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* CARD 1: Date & Weekday Selectable Box */}
        <div className="p-2.5 rounded-xl bg-[#18181f] border border-[#272733] flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
              <CalendarIcon className="size-3.5 text-purple-400" />
              <span>Launch Starting Date</span>
            </div>
          </div>

          {/* Date Picker Button */}
          <div className="relative" ref={datePickerRef}>
            <button
              type="button"
              onClick={() => {
                const p = parseDateKey(startDate);
                if (p) setCalendarMonth(p);
                setDatePickerOpen((v) => !v);
              }}
              className="w-full h-8 flex items-center justify-between px-2.5 rounded-lg border border-[#2e2e3d] bg-[#121217] text-xs hover:border-purple-500/50 cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-2">
                <CalendarIcon className="size-3 text-purple-400" />
                <span className="text-zinc-200 font-medium">{formatDisplay(startDate)}</span>
              </span>
              <ChevronDown className="size-3 text-zinc-500" />
            </button>

            {datePickerOpen && (
              <div
                role="dialog"
                className="ldm-rdp absolute left-0 top-full mt-1 z-[80] rounded-xl border border-[#2f2f3d] bg-[#16161c] shadow-2xl p-2.5"
              >
                {!hasEndDate ? (
                  <DayPicker
                    mode="single"
                    selected={parseDateKey(startDate)}
                    month={calendarMonth}
                    onMonthChange={setCalendarMonth}
                    onSelect={(d) => {
                      if (d) {
                        setStartDate(dateToKey(d));
                        setDatePickerOpen(false);
                      }
                    }}
                  />
                ) : (
                  <DayPicker
                    mode="range"
                    selected={rangeSelection}
                    month={calendarMonth}
                    onMonthChange={setCalendarMonth}
                    onSelect={(r) => {
                      if (r?.from) setStartDate(dateToKey(r.from));
                      if (r?.to) setEndDate(dateToKey(r.to));
                    }}
                  />
                )}
                <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-[#272733]">
                  <button
                    type="button"
                    onClick={() => {
                      const today = getManilaDateKey(new Date()) || dateToKey(new Date());
                      setStartDate(today);
                      setDatePickerOpen(false);
                    }}
                    className="text-[10px] font-semibold text-purple-400 hover:underline px-1 cursor-pointer"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => setDatePickerOpen(false)}
                    className="text-[10px] font-medium text-zinc-400 hover:text-zinc-200 px-1 cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Selectable boxes from Mon-Sun */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
              Repeat Days (Mon-Sun)
            </span>
            <div className="flex gap-1">
              {WEEKDAY_LABELS.map((label) => {
                const jsWd = LABEL_TO_JS_WD[label];
                const active = selectedWeekdays.has(jsWd);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleWeekday(jsWd)}
                    className={`flex-1 py-1 rounded-md text-[10px] font-bold border transition-colors cursor-pointer ${
                      active
                        ? 'bg-purple-600 border-purple-500 text-white shadow-xs'
                        : 'bg-[#121217] border-[#2c2c39] text-zinc-400 hover:border-purple-500/40 hover:text-zinc-200'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional End Date Checkbox (Expands dropdown with End Date & End Time) */}
          <div className="pt-1 border-t border-[#272733] flex flex-col gap-1.5">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hasEndDate}
                onChange={(e) => {
                  setHasEndDate(e.target.checked);
                  if (!e.target.checked) setEndDate('');
                }}
                className="size-3.5 rounded border-[#3a3a4c] bg-[#121217] accent-purple-600 cursor-pointer"
              />
              <span className="text-[11px] font-medium text-zinc-300">Set Date Range (Optional End Date & Time)</span>
            </label>

            {hasEndDate && (
              <div className="pl-5 flex flex-col gap-1.5">
                {/* End Date Picker */}
                <div className="relative" ref={endDatePickerRef}>
                  <button
                    type="button"
                    onClick={() => {
                      const p = parseDateKey(endDate || startDate);
                      if (p) setCalendarMonth(p);
                      setEndDatePickerOpen((v) => !v);
                    }}
                    className="w-full h-7 flex items-center justify-between px-2.5 rounded-lg border border-[#2e2e3d] bg-[#121217] text-xs hover:border-purple-500/50 cursor-pointer transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <CalendarIcon className="size-3 text-purple-400" />
                      <span className={endDate ? 'text-zinc-100 font-medium' : 'text-zinc-500'}>
                        {endDate ? formatDisplay(endDate) : 'Select end date…'}
                      </span>
                    </span>
                    <ChevronDown className="size-3 text-zinc-500" />
                  </button>

                  {endDatePickerOpen && (
                    <div
                      role="dialog"
                      className="ldm-rdp absolute left-0 top-full mt-1 z-[80] rounded-xl border border-[#2f2f3d] bg-[#16161c] shadow-2xl p-2.5"
                    >
                      <DayPicker
                        mode="single"
                        selected={parseDateKey(endDate)}
                        month={calendarMonth}
                        onMonthChange={setCalendarMonth}
                        onSelect={(d) => {
                          if (d) {
                            setEndDate(dateToKey(d));
                            setEndDatePickerOpen(false);
                          }
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* End Time Row (Free text input) */}
                <div className="flex flex-col gap-1 p-2 rounded-lg bg-[#121217] border border-[#2a2a38]">
                  <label className="text-[10px] font-semibold text-zinc-400 flex items-center gap-1.5">
                    <Clock className="size-3 text-purple-400" />
                    <span>End Time</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      placeholder="e.g. 11:59 PM"
                      className="w-full h-7 px-2.5 pr-7 rounded-lg bg-[#18181f] border border-[#333344] text-xs font-medium text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 transition-colors"
                    />
                    <Clock className="absolute right-2 top-1/2 -translate-y-1/2 size-3 text-zinc-400 pointer-events-none" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CARD 2: Launch Starting Time (Free text input) */}
        <div className="p-2.5 rounded-xl bg-[#18181f] border border-[#272733] flex flex-col gap-1.5">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
            <Clock className="size-3.5 text-purple-400" />
            <span>Launch Starting Time</span>
          </label>
          <div className="relative">
            <input
              type="text"
              value={launchTime}
              onChange={(e) => setLaunchTime(e.target.value)}
              placeholder="e.g. 09:00 PM"
              className="w-full h-8 px-3 pr-8 rounded-xl bg-[#121217] border border-[#2e2e3d] text-xs font-medium text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 transition-colors"
            />
            <Clock className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-400 pointer-events-none" />
          </div>
        </div>

        {/* Timezone */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-zinc-400 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Globe className="size-3 text-purple-400" />
              Timezone
            </span>
            <span className="text-[9.5px] text-zinc-500 font-mono">
              {selectedClient?.timezone ? `Client: ${selectedClient.timezone}` : 'Default: +8 (Manila)'}
            </span>
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="bg-[#18181f] border border-[#2a2a35] rounded-xl px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:border-purple-500 cursor-pointer"
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value} className="bg-zinc-900 text-zinc-100">
                {tz.label}
              </option>
            ))}
          </select>
        </div>

        {/* CARD 3: CREATES IN LAUNCH MAP: preview */}
        <div className="px-2.5 py-1.5 rounded-lg bg-[#18181f] border border-[#272733] flex items-center gap-2">
          <Sparkles className="size-3 text-purple-400 shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400 shrink-0">
            CREATES:
          </span>
          <p className="text-xs font-semibold text-zinc-200 truncate flex-1">
            {title
              ? `${title} · ${startDate}${hasEndDate && endDate ? ` to ${endDate}` : ''}`
              : `Launch · ${startDate}`}
          </p>
        </div>

        {/* Bottom Action Buttons */}
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 rounded-xl bg-[#1e1e26] hover:bg-[#252530] text-xs font-medium text-zinc-300 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-[2] py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            <span>Save & Schedule Launch</span>
          </button>
        </div>
      </form>
    </div>
  );
};
