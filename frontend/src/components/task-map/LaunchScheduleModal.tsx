'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Rocket, Search, X, Loader2, Calendar as CalendarIcon, ChevronDown } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import {
  LaunchMapLightItem,
  LaunchMeta,
  taskMapApi,
  getTaskEffectiveLaunchDate,
  getManilaDateKey,
  toCanonicalTaskStatus,
} from '@/api/taskMap';
import { toast } from '@/lib/toast';

function parseDateKeyToDate(ymd?: string | null): Date | undefined {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return undefined;
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d, 12, 0, 0);
}

function formatDateToKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDisplayDate(ymd?: string | null): string {
  if (!ymd) return 'Select launch date...';
  try {
    const d = new Date(`${ymd}T12:00:00+08:00`);
    if (isNaN(d.getTime())) return ymd;
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(d);
  } catch {
    return ymd;
  }
}

interface LaunchScheduleModalProps {
  initialTask: LaunchMapLightItem | null;
  initialDate: string;
  onClose: () => void;
  onSaved: (
    taskId: string,
    data: { launchMeta: LaunchMeta; effectiveLaunchDate: string | null; dueDate: string | null }
  ) => void;
}

export const LaunchScheduleModal: React.FC<LaunchScheduleModalProps> = ({
  initialTask,
  initialDate,
  onClose,
  onSaved,
}) => {
  const [selectedTask, setSelectedTask] = useState<LaunchMapLightItem | null>(initialTask);
  const [taskSearch, setTaskSearch] = useState('');
  const [candidates, setCandidates] = useState<LaunchMapLightItem[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const [dateValue, setDateValue] = useState<string>(
    (initialTask && getTaskEffectiveLaunchDate(initialTask)) || initialDate
  );
  const [isMilestone, setIsMilestone] = useState<boolean>(
    initialTask ? Boolean(initialTask.launchMeta?.isLaunchDate ?? initialTask.isLaunchDate) : true
  );
  const [workstream, setWorkstream] = useState<string>(initialTask?.launchMeta?.workstream || '');
  const [notes, setNotes] = useState<string>(initialTask?.launchMeta?.notes || '');
  const [syncDueDate, setSyncDueDate] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [datePickerOpen, setDatePickerOpen] = useState<boolean>(false);
  const datePickerRef = useRef<HTMLDivElement>(null);

  const selectedCalendarDate = useMemo(() => parseDateKeyToDate(dateValue), [dateValue]);
  const [calendarMonth, setCalendarMonth] = useState<Date>(
    () => parseDateKeyToDate(dateValue) || new Date()
  );

  useEffect(() => {
    if (!datePickerOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setDatePickerOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDatePickerOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [datePickerOpen]);

  // Lazy-load task picker candidates ONLY when no task is selected yet
  useEffect(() => {
    if (selectedTask) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoadingCandidates(true);
      try {
        const res = await taskMapApi.getLaunchCandidates({
          q: taskSearch.trim() || undefined,
          limit: 25,
          signal: controller.signal,
        });
        if (res.success && !controller.signal.aborted) {
          setCandidates(res.candidates || []);
        }
      } catch {
        // Ignore abort errors
      } finally {
        if (!controller.signal.aborted) setLoadingCandidates(false);
      }
    }, taskSearch.trim() ? 220 : 0);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedTask, taskSearch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) {
      toast.error('Please select a task to schedule');
      return;
    }
    if (!dateValue) {
      toast.error('Please pick a Launch Date');
      return;
    }
    setSaving(true);
    try {
      const res = await taskMapApi.updateLaunchMeta(selectedTask.id, {
        launchDate: dateValue,
        isLaunchDate: isMilestone,
        workstream: workstream.trim() || null,
        notes: notes.trim() || null,
        syncDueDate,
      });
      if (res.success) {
        onSaved(selectedTask.id, {
          launchMeta: res.launchMeta,
          effectiveLaunchDate: res.effectiveLaunchDate,
          dueDate: res.dueDate,
        });
        toast.success(
          res.alertSent
            ? 'Launch date saved — PMs & Auditors alerted (IN REVIEW)'
            : 'Launch schedule updated'
        );
        onClose();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save launch date');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl p-5 flex flex-col gap-4 animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
          <div className="flex items-center gap-2.5">
            <div
              className="size-8 rounded-lg border flex items-center justify-center shrink-0"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--accent, #4F46E5) 14%, var(--surface))',
                borderColor: 'color-mix(in srgb, var(--accent, #4F46E5) 35%, var(--border))',
              }}
            >
              <Rocket className="size-4 text-[var(--accent)]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">
                {selectedTask ? 'Schedule Launch Deliverable' : 'Pick Deliverable to Schedule'}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                IN REVIEW tasks automatically alert Project Managers &amp; Auditors
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--hover-subtle)] cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-foreground">Deliverable / Task</label>
          {selectedTask ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{selectedTask.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {selectedTask.list?.name || 'General'} · {toCanonicalTaskStatus(selectedTask.status)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTask(null)}
                className="text-[11px] text-[var(--accent)] hover:underline font-medium shrink-0 cursor-pointer"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="relative">
                <Search className="size-3.5 text-muted-foreground absolute left-2.5 top-2.5 pointer-events-none" />
                <input
                  type="text"
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  placeholder="Search tasks by title or client..."
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-[var(--accent)]"
                  autoFocus
                />
              </div>
              <div className="max-h-44 overflow-y-auto custom-scrollbar border border-[var(--border)] rounded-lg bg-[var(--bg)] divide-y divide-[var(--border)]">
                {loadingCandidates ? (
                  <div className="flex items-center justify-center gap-2 py-5 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Searching tasks...</span>
                  </div>
                ) : candidates.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No matching tasks found
                  </p>
                ) : (
                  candidates.map((t) => {
                    const existingDate = getTaskEffectiveLaunchDate(t);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setSelectedTask(t);
                          if (existingDate) {
                            setDateValue(existingDate);
                            const parsed = parseDateKeyToDate(existingDate);
                            if (parsed) setCalendarMonth(parsed);
                          }
                          if (t.launchMeta?.isLaunchDate !== undefined) {
                            setIsMilestone(Boolean(t.launchMeta.isLaunchDate));
                          }
                          setWorkstream(t.launchMeta?.workstream || '');
                          setNotes(t.launchMeta?.notes || '');
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground truncate">{t.title}</p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {t.list?.name || 'General'} · {toCanonicalTaskStatus(t.status)}
                          </p>
                        </div>
                        {existingDate && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-card border border-border text-muted-foreground shrink-0">
                            {existingDate}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5 relative" ref={datePickerRef}>
            <label className="text-xs font-semibold text-foreground">Launch Date (Manila)</label>
            <button
              type="button"
              onClick={() => {
                if (!datePickerOpen) {
                  const parsed = parseDateKeyToDate(dateValue);
                  if (parsed) setCalendarMonth(parsed);
                }
                setDatePickerOpen((v) => !v);
              }}
              aria-expanded={datePickerOpen}
              aria-haspopup="dialog"
              className={`w-full flex items-center justify-between gap-2 bg-[var(--bg)] border rounded-lg px-3 py-2 text-xs text-foreground transition-colors cursor-pointer ${
                datePickerOpen
                  ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]/40'
                  : 'border-[var(--border)] hover:border-[var(--accent)]/60'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <CalendarIcon className="size-3.5 text-[var(--accent)] shrink-0" />
                <span className="truncate font-medium">{formatDisplayDate(dateValue)}</span>
              </span>
              <ChevronDown
                className={`size-3.5 text-muted-foreground shrink-0 transition-transform ${
                  datePickerOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {datePickerOpen && (
              <div
                role="dialog"
                aria-label="Choose launch date"
                className="launch-rdp absolute left-0 top-full mt-1.5 z-50 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-foreground shadow-2xl p-3"
              >
                <style>{`
                  .launch-rdp .rdp-root {
                    --rdp-accent-color: var(--accent, #4F46E5);
                    --rdp-accent-background-color: color-mix(in srgb, var(--accent, #4F46E5) 18%, var(--surface));
                    --rdp-day-height: 34px;
                    --rdp-day-width: 34px;
                    --rdp-day_button-height: 32px;
                    --rdp-day_button-width: 32px;
                    --rdp-day_button-border-radius: 8px;
                    --rdp-selected-border: 1.5px solid var(--accent, #4F46E5);
                    --rdp-today-color: var(--accent, #4F46E5);
                    --rdp-nav_button-height: 28px;
                    --rdp-nav_button-width: 28px;
                    --rdp-nav-height: 32px;
                    color: var(--text);
                    font-size: 12px;
                  }
                  .launch-rdp .rdp-month_caption {
                    font-size: 13px;
                    font-weight: 700;
                    color: var(--text);
                    padding-left: 4px;
                  }
                  .launch-rdp .rdp-button_previous,
                  .launch-rdp .rdp-button_next {
                    border-radius: 6px;
                    color: var(--text);
                  }
                  .launch-rdp .rdp-button_previous:hover,
                  .launch-rdp .rdp-button_next:hover {
                    background-color: var(--hover-subtle);
                  }
                  .launch-rdp .rdp-chevron {
                    fill: var(--accent, #4F46E5);
                  }
                  .launch-rdp .rdp-weekday {
                    color: var(--muted);
                    font-size: 11px;
                    font-weight: 600;
                    opacity: 1;
                  }
                  .launch-rdp .rdp-day_button {
                    color: var(--text);
                    font-size: 12px;
                    transition: background-color 0.12s ease, color 0.12s ease;
                  }
                  .launch-rdp .rdp-day_button:hover:not(:disabled) {
                    background-color: var(--hover-subtle);
                  }
                  .launch-rdp .rdp-today:not(.rdp-selected) .rdp-day_button {
                    color: var(--accent, #4F46E5);
                    font-weight: 700;
                    border: 1px solid color-mix(in srgb, var(--accent, #4F46E5) 55%, transparent);
                  }
                  .launch-rdp .rdp-selected .rdp-day_button {
                    background-color: var(--accent, #4F46E5);
                    color: var(--on-accent, #ffffff);
                    font-weight: 700;
                    border-color: var(--accent, #4F46E5);
                  }
                  .launch-rdp .rdp-outside .rdp-day_button {
                    color: var(--muted);
                    opacity: 0.45;
                  }
                `}</style>
                <DayPicker
                  mode="single"
                  selected={selectedCalendarDate}
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                  onSelect={(d) => {
                    if (d) {
                      setDateValue(formatDateToKey(d));
                      setDatePickerOpen(false);
                    }
                  }}
                />
                <div className="flex items-center justify-between pt-2 mt-1 border-t border-[var(--border)]">
                  <button
                    type="button"
                    onClick={() => {
                      const todayManila = getManilaDateKey(new Date()) || formatDateToKey(new Date());
                      setDateValue(todayManila);
                      const parsed = parseDateKeyToDate(todayManila);
                      if (parsed) setCalendarMonth(parsed);
                      setDatePickerOpen(false);
                    }}
                    className="text-[11px] font-semibold text-[var(--accent)] hover:underline px-1.5 py-0.5 cursor-pointer"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => setDatePickerOpen(false)}
                    className="text-[11px] font-medium text-muted-foreground hover:text-foreground px-1.5 py-0.5 cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col justify-end">
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] cursor-pointer hover:bg-[var(--hover-subtle)] transition-colors">
              <input
                type="checkbox"
                checked={isMilestone}
                onChange={(e) => setIsMilestone(e.target.checked)}
                className="rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer"
              />
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Rocket className="size-3.5 text-rose-400 [.theme-light_&]:text-rose-600" />
                <span>LAUNCH DATE Milestone</span>
              </div>
            </label>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-foreground">Workstream / Phase (optional)</label>
          <input
            type="text"
            value={workstream}
            onChange={(e) => setWorkstream(e.target.value)}
            placeholder="e.g. Phase 2, Black Friday Ads, Funnel Setup"
            className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-foreground">Notes (optional)</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Blockers, links, or launch-day context..."
            className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-[var(--accent)] resize-none"
          />
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={syncDueDate}
            onChange={(e) => setSyncDueDate(e.target.checked)}
            className="rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer"
          />
          <span>Also sync task due date to this date</span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-[var(--hover-subtle)] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !selectedTask}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 text-[var(--on-accent)] text-xs font-semibold shadow-xs transition-opacity cursor-pointer"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            <span>Save Schedule</span>
          </button>
        </div>
      </form>
    </div>
  );
};
