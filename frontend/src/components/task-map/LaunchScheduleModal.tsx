'use client';

import React, { useState, useEffect, useRef, useMemo, startTransition } from 'react';
import {
  Rocket,
  Search,
  X,
  Loader2,
  Calendar as CalendarIcon,
  ChevronDown,
  Users,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import {
  LaunchMapLightItem,
  LaunchMeta,
  taskMapApi,
  getTaskEffectiveLaunchDate,
  getManilaDateKey,
  mergeTaskAssignees,
  toCanonicalTaskStatus,
} from '@/api/taskMap';
import { STATUS_COLORS } from '@/lib/taskTokens';
import { toast } from '@/lib/toast';
import { LaunchAssigneeChips } from './LaunchTextWithLinks';

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

function htmlToMarkdownText(input?: string | null): string {
  if (!input) return '';
  if (!/<\/?[a-z][\s\S]*>/i.test(input) || typeof DOMParser === 'undefined') return input;
  const doc = new DOMParser().parseFromString(input, 'text/html');
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const kids = Array.from(el.childNodes).map(walk).join('');
    switch (el.tagName.toLowerCase()) {
      case 'h1': case 'h2': case 'h3': case 'h4': return `\n## ${kids.trim()}\n`;
      case 'p': return `${kids}\n`;
      case 'br': return '\n';
      case 'strong': case 'b': return `**${kids}**`;
      case 'a': {
        const href = el.getAttribute('href');
        return href ? `[${kids}](${href})` : kids;
      }
      case 'li': {
        const checked = el.getAttribute('data-checked');
        const box = checked === null ? '- ' : checked === 'true' ? '- [x] ' : '- [ ] ';
        return `${box}${kids.trim()}\n`;
      }
      case 'ul': case 'ol': return `${kids}\n`;
      default: return kids;
    }
  };
  return walk(doc.body).replace(/\n{3,}/g, '\n\n').trim();
}

interface LaunchScheduleModalProps {
  initialTask: LaunchMapLightItem | null;
  initialDate: string;
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

export const LaunchScheduleModal: React.FC<LaunchScheduleModalProps> = ({
  initialTask,
  initialDate,
  onClose,
  onSaved,
}) => {
  const [selectedTask, setSelectedTask] = useState<LaunchMapLightItem | null>(initialTask);
  const [taskSearch, setTaskSearch] = useState('');
  const [includeClosed, setIncludeClosed] = useState(false);
  const [candidates, setCandidates] = useState<LaunchMapLightItem[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const initialExactDate = initialTask ? getTaskEffectiveLaunchDate(initialTask) : null;

  const [dateValue, setDateValue] = useState<string>(initialExactDate || initialDate);
  const [isMilestone, setIsMilestone] = useState<boolean>(true);
  const [workstream, setWorkstream] = useState<string>(initialTask?.launchMeta?.workstream || '');
  const [details, setDetails] = useState<string>(
    htmlToMarkdownText(initialTask?.launchMeta?.details ?? initialTask?.description ?? '')
  );
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
      if (e.key === 'Escape') {
        setDatePickerOpen(false);
      }
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
          includeClosed,
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
  }, [selectedTask, taskSearch, includeClosed]);

  // Assignees are strictly derived from the selected task in Prisma DB
  const taskAssignees = useMemo(() => mergeTaskAssignees(selectedTask), [selectedTask]);

  const handleSelectCandidate = (t: LaunchMapLightItem) => {
    setSelectedTask(t);
    const existingDate = getTaskEffectiveLaunchDate(t);
    if (existingDate) {
      setDateValue(existingDate);
      const parsed = parseDateKeyToDate(existingDate);
      if (parsed) setCalendarMonth(parsed);
    }
    setIsMilestone(true);
    setWorkstream(t.launchMeta?.workstream || '');
    setDetails(htmlToMarkdownText(t.launchMeta?.details ?? t.description ?? ''));
    setNotes(t.launchMeta?.notes || '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) {
      toast.error('Please select a task from Nexus DB');
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
        targetPeriod: null,
        isLaunchDate: isMilestone,
        workstream: workstream.trim() || null,
        details: details.trim() || null,
        notes: notes.trim() || null,
        syncDueDate,
      });

      if (res.success) {
        onSaved(selectedTask.id, {
          launchMeta: res.launchMeta,
          effectiveLaunchDate: res.effectiveLaunchDate,
          targetPeriod: res.targetPeriod ?? null,
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
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[92vh] overflow-y-auto custom-scrollbar bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl p-5 flex flex-col gap-3.5"
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
              <h3 className="text-sm font-bold text-[var(--text)]">
                {selectedTask ? 'Launch Journal Entry' : 'Schedule Deliverable on Launch Map'}
              </h3>
              <p className="text-[11px] text-[var(--muted)]">
                {selectedTask
                  ? 'Step 2 of 2: Configure target milestone date and deliverable details'
                  : 'Step 1 of 2: Search and select a task from Nexus DB'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover-subtle)] cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* STEP 1: Task Selection (Shown when no task is selected) */}
        {!selectedTask ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[var(--text)]">Search Tasks in Nexus DB</label>
                <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeClosed}
                    onChange={(e) => setIncludeClosed(e.target.checked)}
                    className="rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer"
                  />
                  <span>Include closed tasks</span>
                </label>
              </div>

              <div className="relative">
                <Search className="size-3.5 text-[var(--muted)] absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="text"
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  placeholder="Search by title, client, or Task ID..."
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-xl pl-9 pr-8 py-2 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
                  autoFocus
                />
                {taskSearch && (
                  <button
                    type="button"
                    onClick={() => setTaskSearch('')}
                    className="absolute right-2.5 top-2.5 text-[var(--muted)] hover:text-[var(--text)] p-0.5 rounded cursor-pointer"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Candidate List with expanded breathing room */}
            <div className="max-h-[340px] min-h-[180px] overflow-y-auto custom-scrollbar border border-[var(--border)] rounded-xl bg-[var(--bg)] divide-y divide-[var(--border)]">
              {loadingCandidates ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-xs text-[var(--muted)]">
                  <Loader2 className="size-5 animate-spin text-[var(--accent)]" />
                  <span>Searching Nexus DB...</span>
                </div>
              ) : candidates.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-1.5 text-xs text-[var(--muted)]">
                  <Search className="size-5 text-[var(--muted)]/50 mb-1" />
                  <p className="font-semibold text-[var(--text)]">No matching tasks found</p>
                  <p className="text-[11px]">Try adjusting your search terms or check &quot;Include closed tasks&quot;.</p>
                </div>
              ) : (
                candidates.map((t) => {
                  const existingDate = getTaskEffectiveLaunchDate(t);
                  const statusStr = toCanonicalTaskStatus(t.status);
                  const statusColor = STATUS_COLORS[statusStr] || 'bg-zinc-700 text-zinc-100';
                  const clientName = t.list?.folder?.name || t.list?.name || 'General';

                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => startTransition(() => handleSelectCandidate(t))}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-[var(--hover-subtle)] transition-colors flex items-center justify-between gap-3 group cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] truncate max-w-[160px]">
                            {clientName}
                          </span>
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${statusColor}`}>
                            {statusStr}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-[var(--text)] group-hover:text-[var(--accent)] transition-colors truncate">
                          {t.title}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {existingDate ? (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 [.theme-light_&]:bg-emerald-50 [.theme-light_&]:text-emerald-700">
                            {existingDate}
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium text-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity">
                            Select →
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Helper Banner */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[11px] text-[var(--muted)]">
              <Sparkles className="size-3.5 text-[var(--accent)] shrink-0" />
              <span>Select a deliverable above to configure its target launch date, workstream, and journal notes.</span>
            </div>

            {/* Step 1 Footer */}
            <div className="flex items-center justify-end pt-2 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover-subtle)] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {/* Selected Task Anchor Card (Top of hierarchy) */}
            <div className="p-3.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] truncate max-w-[200px]">
                    {selectedTask.list?.folder?.name || selectedTask.list?.name || 'General'}
                  </span>
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      STATUS_COLORS[toCanonicalTaskStatus(selectedTask.status)] || 'bg-zinc-700 text-zinc-100'
                    }`}
                  >
                    {toCanonicalTaskStatus(selectedTask.status)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTask(null)}
                  className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline font-semibold shrink-0 cursor-pointer"
                  title="Choose a different task from Nexus DB"
                >
                  <RefreshCw className="size-3" />
                  <span>Change Task</span>
                </button>
              </div>

              <div>
                <h4 className="text-xs sm:text-sm font-bold text-[var(--text)] leading-snug break-words">
                  {selectedTask.title}
                </h4>
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-[var(--border)]/60 text-[11px]">
                <span className="text-[var(--muted)] font-medium flex items-center gap-1 shrink-0">
                  <Users className="size-3 text-[var(--accent)]" />
                  <span>Assignees:</span>
                </span>
                <div className="min-w-0 flex-1">
                  <LaunchAssigneeChips assignees={taskAssignees} maxVisible={6} />
                </div>
              </div>
            </div>

            {/* Section 1: Launch Schedule & Milestone (When & Status) */}
            <div className="p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-5 rounded-md bg-[var(--accent)]/15 text-[var(--accent)] flex items-center justify-center font-bold text-[10px]">
                    1
                  </div>
                  <span className="text-xs font-bold text-[var(--text)]">Launch Schedule & Milestone</span>
                </div>
                <span className="text-[10px] text-[var(--muted)] font-medium">Calendar Anchor</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Date Picker Button */}
                <div className="flex flex-col gap-1.5 relative" ref={datePickerRef}>
                  <label className="text-[11px] font-semibold text-[var(--muted)]">Target Launch Date (Manila)</label>

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
                    className={`w-full h-[54px] flex items-center justify-between gap-2 bg-[var(--bg)] border rounded-xl px-3 py-2 text-xs text-[var(--text)] transition-colors cursor-pointer ${
                      datePickerOpen
                        ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]/40'
                        : 'border-[var(--border)] hover:border-[var(--accent)]/60'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <CalendarIcon className="size-3.5 text-[var(--accent)] shrink-0" />
                      <span className="truncate font-semibold">{formatDisplayDate(dateValue)}</span>
                    </span>
                    <ChevronDown
                      className={`size-3.5 text-[var(--muted)] shrink-0 transition-transform ${
                        datePickerOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {datePickerOpen && (
                    <div
                      role="dialog"
                      aria-label="Choose launch date"
                      className="launch-rdp absolute left-0 top-full mt-1.5 z-50 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-2xl p-3"
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
                          className="text-[11px] font-medium text-[var(--muted)] hover:text-[var(--text)] px-1.5 py-0.5 cursor-pointer"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Milestone Checkbox Card */}
                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2.5 px-3 h-[54px] rounded-xl bg-[var(--bg)] border border-[var(--border)] cursor-pointer hover:border-[var(--accent)]/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={isMilestone}
                      onChange={(e) => setIsMilestone(e.target.checked)}
                      className="size-4 rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer shrink-0"
                    />
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--text)]">
                        <Rocket className="size-3.5 text-rose-400 [.theme-light_&]:text-rose-600" />
                        <span>LAUNCH DATE Status</span>
                      </div>
                      <span className="text-[10px] text-[var(--muted)] truncate">
                        Active deliverable on Calendar & Journal
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              <label className="flex items-center gap-2 text-[11px] text-[var(--muted)] cursor-pointer pt-0.5">
                <input
                  type="checkbox"
                  checked={syncDueDate}
                  onChange={(e) => setSyncDueDate(e.target.checked)}
                  className="rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer"
                />
                <span>Also synchronize task due date to match target launch date</span>
              </label>
            </div>

            {/* Section 2: Workstream & Journal Log (What & Deliverables) */}
            <div className="p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-5 rounded-md bg-[var(--accent)]/15 text-[var(--accent)] flex items-center justify-center font-bold text-[10px]">
                    2
                  </div>
                  <span className="text-xs font-bold text-[var(--text)]">Deliverables & Journal Log</span>
                </div>
                <span className="text-[10px] text-[var(--muted)] font-medium">Scope & Context</span>
              </div>

              {/* Workstream */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-[var(--muted)]">Workstream / Deliverable Category</label>
                <input
                  type="text"
                  value={workstream}
                  onChange={(e) => setWorkstream(e.target.value)}
                  placeholder="e.g. Phase 5: Finalize & Launch, Sales Funnel, Email Sequence..."
                  className="bg-[var(--bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              {/* Details */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-[var(--muted)]">Deliverables & Live URLs (Details)</label>
                  <span className="text-[10px] text-[var(--muted)]/80">Markdown links [Label](url) supported</span>
                </div>
                <textarea
                  rows={8}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Landing page URLs, Kajabi/ThriveCart links, Figma specs, or deliverable checklists..."
                  className="bg-[var(--bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)] resize-y custom-scrollbar"
                />
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-[var(--muted)]">Journal Notes & Blockers</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Approval status, dependencies, blockers, or launch-day operational context..."
                  className="bg-[var(--bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)] resize-y custom-scrollbar"
                />
              </div>
            </div>

            {/* Step 2 Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => setSelectedTask(null)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover-subtle)] cursor-pointer"
              >
                <RefreshCw className="size-3" />
                <span>Change Task</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover-subtle)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 text-[var(--on-accent)] text-xs font-semibold shadow-xs transition-opacity cursor-pointer"
                >
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
                  <span>Save to Launch Map</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};
