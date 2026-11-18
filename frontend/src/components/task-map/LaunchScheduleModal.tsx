'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Rocket,
  Search,
  X,
  Loader2,
  Calendar as CalendarIcon,
  ChevronDown,
  Users,
  Check,
} from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import {
  LaunchMapLightItem,
  LaunchMeta,
  taskMapApi,
  getTaskEffectiveLaunchDate,
  getTaskLaunchTargetPeriod,
  getManilaDateKey,
  mergeTaskAssignees,
  toCanonicalTaskStatus,
} from '@/api/taskMap';
import { tasksApi } from '@/api/tasks';
import { useAppStore } from '@/lib/store';
import { useCanSetAssignees } from '@/lib/useCanSetAssignees';
import { getAssigneeAvatarColor, isSystemUser } from '@/lib/taskTokens';
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
  const currentUser = useAppStore((s) => s.currentUser);
  const workspaceUsers = useAppStore((s) => s.workspaceUsers);
  const hasLoadedUsers = useAppStore((s) => s.hasLoadedUsers);
  const loadUsers = useAppStore((s) => s.loadUsers);
  const canSetAssignees = useCanSetAssignees();

  useEffect(() => {
    if (!hasLoadedUsers) {
      void loadUsers();
    }
  }, [hasLoadedUsers, loadUsers]);

  const assignableUsers = useMemo(
    () => (workspaceUsers || []).filter((u) => u?.isActive !== false && !isSystemUser(u)),
    [workspaceUsers]
  );

  const [selectedTask, setSelectedTask] = useState<LaunchMapLightItem | null>(initialTask);
  const [taskSearch, setTaskSearch] = useState('');
  const [includeClosed, setIncludeClosed] = useState(false);
  const [candidates, setCandidates] = useState<LaunchMapLightItem[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const initialExactDate = initialTask ? getTaskEffectiveLaunchDate(initialTask) : null;
  const initialTargetPeriod = initialTask ? getTaskLaunchTargetPeriod(initialTask) : null;

  const [dateMode, setDateMode] = useState<'EXACT' | 'PERIOD'>(
    initialTask && !initialExactDate && initialTargetPeriod ? 'PERIOD' : 'EXACT'
  );
  const [dateValue, setDateValue] = useState<string>(initialExactDate || initialDate);
  const [targetPeriod, setTargetPeriod] = useState<string>(initialTargetPeriod || '2027');
  const [isMilestone, setIsMilestone] = useState<boolean>(true);
  const [workstream, setWorkstream] = useState<string>(initialTask?.launchMeta?.workstream || '');
  const [details, setDetails] = useState<string>(
    initialTask?.launchMeta?.details ?? initialTask?.description ?? ''
  );
  const [notes, setNotes] = useState<string>(initialTask?.launchMeta?.notes || '');
  const [syncDueDate, setSyncDueDate] = useState<boolean>(true);

  const initialAssigneeIds = useMemo(
    () => mergeTaskAssignees(initialTask).map((a) => a.id),
    [initialTask]
  );
  const [assigneeIds, setAssigneeIds] = useState<string[]>(initialAssigneeIds);
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const assigneePickerRef = useRef<HTMLDivElement>(null);

  const [saving, setSaving] = useState<boolean>(false);
  const [datePickerOpen, setDatePickerOpen] = useState<boolean>(false);
  const datePickerRef = useRef<HTMLDivElement>(null);

  const selectedCalendarDate = useMemo(() => parseDateKeyToDate(dateValue), [dateValue]);
  const [calendarMonth, setCalendarMonth] = useState<Date>(
    () => parseDateKeyToDate(dateValue) || new Date()
  );

  useEffect(() => {
    if (!datePickerOpen && !assigneePickerOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (datePickerOpen && datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setDatePickerOpen(false);
      }
      if (
        assigneePickerOpen &&
        assigneePickerRef.current &&
        !assigneePickerRef.current.contains(e.target as Node)
      ) {
        setAssigneePickerOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDatePickerOpen(false);
        setAssigneePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [datePickerOpen, assigneePickerOpen]);

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

  const selectedAssigneesList = useMemo(() => {
    const byId = new Map(assignableUsers.map((u) => [u.id, u]));
    const fallbackById = new Map(mergeTaskAssignees(selectedTask).map((a) => [a.id, a]));
    return assigneeIds
      .map((id) => byId.get(id) || fallbackById.get(id))
      .filter(Boolean) as Array<{ id: string; name: string; avatarUrl?: string | null; imageUrl?: string | null }>;
  }, [assigneeIds, assignableUsers, selectedTask]);

  const filteredAssigneeOptions = useMemo(() => {
    const q = assigneeSearch.trim().toLowerCase();
    return q
      ? assignableUsers.filter((u) => (u.name || '').toLowerCase().includes(q))
      : assignableUsers;
  }, [assignableUsers, assigneeSearch]);

  const handleSelectCandidate = (t: LaunchMapLightItem) => {
    setSelectedTask(t);
    const existingDate = getTaskEffectiveLaunchDate(t);
    const existingPeriod = getTaskLaunchTargetPeriod(t);
    if (existingDate) {
      setDateMode('EXACT');
      setDateValue(existingDate);
      const parsed = parseDateKeyToDate(existingDate);
      if (parsed) setCalendarMonth(parsed);
    } else if (existingPeriod) {
      setDateMode('PERIOD');
      setTargetPeriod(existingPeriod);
    }
    setIsMilestone(true);
    setWorkstream(t.launchMeta?.workstream || '');
    setDetails(t.launchMeta?.details ?? t.description ?? '');
    setNotes(t.launchMeta?.notes || '');
    setAssigneeIds(mergeTaskAssignees(t).map((a) => a.id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) {
      toast.error('Please select a task from Nexus DB');
      return;
    }
    if (dateMode === 'EXACT' && !dateValue) {
      toast.error('Please pick a Launch Date');
      return;
    }
    if (dateMode === 'PERIOD' && !targetPeriod.trim()) {
      toast.error('Please enter a target year or period (e.g. 2027 or TBD)');
      return;
    }

    setSaving(true);
    try {
      const originalIds = mergeTaskAssignees(selectedTask).map((a) => a.id).sort();
      const nextIdsSorted = [...assigneeIds].sort();
      const assigneesChanged =
        canSetAssignees &&
        (originalIds.length !== nextIdsSorted.length ||
          originalIds.some((id, idx) => id !== nextIdsSorted[idx]));

      if (assigneesChanged) {
        await tasksApi.updateTask(selectedTask.id, {
          assigneeIds,
          assigneeId: assigneeIds[0] || null,
          currentListId: selectedTask.listId,
          userId: currentUser?.id,
        });
      }

      const res = await taskMapApi.updateLaunchMeta(selectedTask.id, {
        launchDate: dateMode === 'EXACT' ? dateValue : null,
        targetPeriod: dateMode === 'PERIOD' ? targetPeriod.trim() : null,
        isLaunchDate: isMilestone,
        workstream: workstream.trim() || null,
        details: details.trim() || null,
        notes: notes.trim() || null,
        syncDueDate: dateMode === 'EXACT' ? syncDueDate : false,
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
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl max-h-[92vh] overflow-y-auto custom-scrollbar bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl p-5 flex flex-col gap-3.5 animate-in zoom-in-95 duration-150"
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
                {selectedTask ? 'Schedule Launch Deliverable' : 'Pick Task from Nexus DB'}
              </h3>
              <p className="text-[11px] text-[var(--muted)]">
                Only tasks marked with LAUNCH DATE status appear inside Launch Map
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

        {/* Task Picker (based on Task.id from schema.prisma) */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-[var(--text)]">Task</label>
            {!selectedTask && (
              <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeClosed}
                  onChange={(e) => setIncludeClosed(e.target.checked)}
                  className="rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer"
                />
                <span>Include closed</span>
              </label>
            )}
          </div>
          {selectedTask ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--text)] truncate">{selectedTask.title}</p>
                <p className="text-[11px] text-[var(--muted)] truncate">
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
                <Search className="size-3.5 text-[var(--muted)] absolute left-2.5 top-2.5 pointer-events-none" />
                <input
                  type="text"
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  placeholder="Search by title, client, or Task ID..."
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
                  autoFocus
                />
              </div>
              <div className="max-h-44 overflow-y-auto custom-scrollbar border border-[var(--border)] rounded-lg bg-[var(--bg)] divide-y divide-[var(--border)]">
                {loadingCandidates ? (
                  <div className="flex items-center justify-center gap-2 py-5 text-xs text-[var(--muted)]">
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Searching tasks...</span>
                  </div>
                ) : candidates.length === 0 ? (
                  <p className="text-xs text-[var(--muted)] text-center py-4">
                    No matching tasks found
                  </p>
                ) : (
                  candidates.map((t) => {
                    const existingDate = getTaskEffectiveLaunchDate(t);
                    const existingPeriod = getTaskLaunchTargetPeriod(t);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleSelectCandidate(t)}
                        className="w-full text-left px-3 py-2 hover:bg-[var(--hover-subtle)] transition-colors flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-[var(--text)] truncate">{t.title}</p>
                          <p className="text-[10px] text-[var(--muted)] truncate">
                            {t.list?.name || 'General'} · {toCanonicalTaskStatus(t.status)}
                          </p>
                        </div>
                        {(existingDate || existingPeriod) && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] shrink-0">
                            {existingDate || existingPeriod}
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

        {/* Date Mode + Date / Period Picker */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5 relative" ref={datePickerRef}>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[var(--text)]">Date (Manila)</label>
              <div className="flex items-center rounded-md bg-[var(--bg)] border border-[var(--border)] p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setDateMode('EXACT')}
                  className={`px-1.5 py-0.5 rounded cursor-pointer ${
                    dateMode === 'EXACT'
                      ? 'bg-[var(--accent)] text-[var(--on-accent)] font-semibold'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Exact
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDateMode('PERIOD');
                    setDatePickerOpen(false);
                  }}
                  className={`px-1.5 py-0.5 rounded cursor-pointer ${
                    dateMode === 'PERIOD'
                      ? 'bg-[var(--accent)] text-[var(--on-accent)] font-semibold'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Year / TBD
                </button>
              </div>
            </div>

            {dateMode === 'EXACT' ? (
              <>
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
                  className={`w-full flex items-center justify-between gap-2 bg-[var(--bg)] border rounded-lg px-3 py-2 text-xs text-[var(--text)] transition-colors cursor-pointer ${
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
              </>
            ) : (
              <div className="flex flex-col gap-1">
                <input
                  type="text"
                  value={targetPeriod}
                  onChange={(e) => setTargetPeriod(e.target.value)}
                  placeholder="e.g. 2027, Q1 2027, TBD"
                  className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
                />
                <div className="flex items-center gap-1">
                  {['2027', 'Q1 2027', 'TBD'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setTargetPeriod(preset)}
                      className="px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[10px] text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
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
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text)]">
                <Rocket className="size-3.5 text-rose-400 [.theme-light_&]:text-rose-600" />
                <span>LAUNCH DATE Status</span>
              </div>
            </label>
          </div>
        </div>

        {/* Workstream / Phase & Assignees */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--text)]">Workstream / Phase</label>
            <input
              type="text"
              value={workstream}
              onChange={(e) => setWorkstream(e.target.value)}
              placeholder="e.g. Phase 5: Finalize & Launch"
              className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div className="flex flex-col gap-1.5 relative" ref={assigneePickerRef}>
            <label className="text-xs font-semibold text-[var(--text)]">Assignees</label>
            <button
              type="button"
              disabled={!canSetAssignees}
              onClick={() => canSetAssignees && setAssigneePickerOpen((v) => !v)}
              title={
                canSetAssignees
                  ? 'Select task assignees'
                  : 'Only Project Managers, Seniors, and Admins can edit assignees'
              }
              className={`w-full flex items-center justify-between gap-2 bg-[var(--bg)] border rounded-lg px-3 py-2 text-xs text-left transition-colors ${
                !canSetAssignees
                  ? 'border-[var(--border)] text-[var(--muted)] cursor-not-allowed opacity-80'
                  : assigneePickerOpen
                  ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]/40 cursor-pointer'
                  : 'border-[var(--border)] hover:border-[var(--accent)]/60 cursor-pointer'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <Users className="size-3.5 text-[var(--accent)] shrink-0" />
                <span className="truncate text-[var(--text)]">
                  {selectedAssigneesList.length > 0
                    ? selectedAssigneesList.map((u) => u.name).join(', ')
                    : 'Unassigned'}
                </span>
              </span>
              {canSetAssignees && (
                <ChevronDown
                  className={`size-3.5 text-[var(--muted)] shrink-0 transition-transform ${
                    assigneePickerOpen ? 'rotate-180' : ''
                  }`}
                />
              )}
            </button>

            {assigneePickerOpen && canSetAssignees && (
              <div className="absolute right-0 top-full mt-1.5 z-50 w-64 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl p-1.5 flex flex-col gap-1">
                <div className="px-1.5 py-0.5 relative">
                  <Search className="size-3 text-[var(--muted)] absolute left-3.5 top-2.5" />
                  <input
                    type="text"
                    value={assigneeSearch}
                    onChange={(e) => setAssigneeSearch(e.target.value)}
                    placeholder="Search team members..."
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg pl-7 pr-2 py-1 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div className="max-h-44 overflow-y-auto custom-scrollbar flex flex-col gap-0.5">
                  {filteredAssigneeOptions.map((u) => {
                    const checked = assigneeIds.includes(u.id);
                    const avatar = u.avatarUrl || u.imageUrl;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() =>
                          setAssigneeIds((prev) =>
                            prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                          )
                        }
                        className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer ${
                          checked
                            ? 'bg-[var(--accent-tint)] text-[var(--text)] font-semibold'
                            : 'text-[var(--text)] hover:bg-[var(--hover-subtle)]'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          {avatar ? (
                            <img src={avatar} alt={u.name} className="size-4 rounded-full object-cover shrink-0" />
                          ) : (
                            <span
                              className={`size-4 rounded-full ${getAssigneeAvatarColor(
                                u.name
                              )} text-white text-[9px] font-bold flex items-center justify-center shrink-0`}
                            >
                              {(u.name || '?').charAt(0).toUpperCase()}
                            </span>
                          )}
                          <span className="truncate">{u.name}</span>
                        </span>
                        {checked && <Check className="size-3.5 text-[var(--accent)] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-[var(--text)]">Details</label>
          <textarea
            rows={2}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Deliverable details, landing page URLs, Kajabi/ThriveCart links..."
            className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)] resize-y"
          />
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-[var(--text)]">Notes</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Blockers, approval status, dependencies, or launch-day context..."
            className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)] resize-y"
          />
        </div>

        {dateMode === 'EXACT' && (
          <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={syncDueDate}
              onChange={(e) => setSyncDueDate(e.target.checked)}
              className="rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer"
            />
            <span>Also sync task due date to this date</span>
          </label>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--hover-subtle)] cursor-pointer"
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
