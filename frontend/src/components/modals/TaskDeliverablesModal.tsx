'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Clock, FileCheck, Send, AlertCircle, ChevronDown, Check } from 'lucide-react';
import { formatManilaTime, TASK_MAP_STATUS_COLORS } from '@/api/taskMap';
import { NexusFullScreenLoader } from '@/components/ui/NexusLogo';
import { evaluateDeliverableDescription } from '@/lib/deliverablesQuality';

export interface DeliverableStatusOption {
  label: string;
  color?: string;
}

export interface TaskDeliverablesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    taskDeliverablesDescription: string;
    taskUpdateAndDeliverables: string;
    timeOut: string;
    targetStatus?: string;
  }) => Promise<void> | void;
  taskTitle: string;
  clientName?: string;
  listName?: string;
  folderName?: string;
  isAdminTask?: boolean;
  targetStatus: 'To Review' | 'Hand-over' | string;
  statusOptions?: DeliverableStatusOption[];
  onTargetStatusChange?: (nextStatus: string) => void;
  initialDeliverables?: string;
  initialUpdate?: string;
  userName?: string;
  timeIn?: string;
}

const DEFAULT_DELIVERABLE_STATUS_OPTIONS: DeliverableStatusOption[] = [
  { label: 'To Review', color: TASK_MAP_STATUS_COLORS.TO_REVIEW },
  { label: 'Hand-over Out', color: TASK_MAP_STATUS_COLORS.HAND_OVER },
  { label: 'Hand-over', color: TASK_MAP_STATUS_COLORS.HAND_OVER },
  { label: 'Paused', color: TASK_MAP_STATUS_COLORS.PAUSED },
  { label: 'Ask Client', color: TASK_MAP_STATUS_COLORS.ASK_CLIENT },
  { label: 'Waiting', color: TASK_MAP_STATUS_COLORS.WAITING },
  { label: 'On-hold', color: TASK_MAP_STATUS_COLORS.ON_HOLD },
  { label: 'Revision', color: TASK_MAP_STATUS_COLORS.REVISION },
];

const DEFAULT_UPDATE_TEMPLATE = [
  '📍 Action Done:',
  ' ┊➤ ',
  ' ┊➤ ',
  '',
  '📎 Resources:',
  ' ┊➤ ',
  ' ┊➤ ',
  '',
  '⏭️ Still To Do:',
  ' ┊➤ ',
  ' ┊➤ ',
].join('\n');

export function TaskDeliverablesModal({
  isOpen,
  onClose,
  onSubmit,
  taskTitle,
  clientName,
  listName,
  folderName,
  isAdminTask,
  targetStatus,
  statusOptions,
  onTargetStatusChange,
  initialDeliverables = '',
  initialUpdate = '',
  timeIn = '',
}: TaskDeliverablesModalProps) {
  const syncKey = isOpen ? `${taskTitle}::${initialDeliverables}::${initialUpdate}::${targetStatus}` : '';
  const [prevSyncKey, setPrevSyncKey] = useState(syncKey);
  const [selectedStatus, setSelectedStatus] = useState(targetStatus);
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const [deliverablesDescription, setDeliverablesDescription] = useState(initialDeliverables || taskTitle || '');
  const [updateAndDeliverables, setUpdateAndDeliverables] = useState(initialUpdate || DEFAULT_UPDATE_TEMPLATE);
  const [currentTimeOut, setCurrentTimeOut] = useState(() => formatManilaTime(new Date()));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showQualitySuggestion, setShowQualitySuggestion] = useState(false);

  // Sync prefilled fields and clock-out time when modal opens or switches tasks without cascading effect setState
  if (syncKey !== prevSyncKey) {
    setPrevSyncKey(syncKey);
    if (isOpen) {
      setSelectedStatus(targetStatus);
      setIsStatusMenuOpen(false);
      setDeliverablesDescription(initialDeliverables || taskTitle || '');
      setUpdateAndDeliverables(initialUpdate || DEFAULT_UPDATE_TEMPLATE);
      setCurrentTimeOut(formatManilaTime(new Date()));
      setShowQualitySuggestion(false);
    }
  }

  useEffect(() => {
    if (!isStatusMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setIsStatusMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsStatusMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isStatusMenuOpen]);

  const resolvedStatusOptions = useMemo(() => {
    const base = statusOptions && statusOptions.length > 0 ? [...statusOptions] : [...DEFAULT_DELIVERABLE_STATUS_OPTIONS];
    const current = (selectedStatus || targetStatus || '').trim();
    if (current && !base.some((o) => o.label.toLowerCase() === current.toLowerCase())) {
      base.unshift({ label: current, color: '#71717a' });
    }
    return base;
  }, [statusOptions, selectedStatus, targetStatus]);

  // Update clock-out time display every 10 seconds while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const timer = setInterval(() => {
      setCurrentTimeOut(formatManilaTime(new Date()));
    }, 10000);
    return () => clearInterval(timer);
  }, [isOpen]);

  const quality = useMemo(
    () =>
      evaluateDeliverableDescription({
        deliverablesDescription,
        taskTitle,
        clientName,
        listName,
        folderName,
        isAdminTask,
      }),
    [deliverablesDescription, taskTitle, clientName, listName, folderName, isAdminTask]
  );

  if (!isOpen) return null;

  const effectiveTargetStatus = selectedStatus || targetStatus;
  const compactTarget = effectiveTargetStatus.toLowerCase().replace(/[\s_-]+/g, '');
  const isHandoverOut = compactTarget === 'handoverout';
  const isHandover =
    compactTarget === 'handover' ||
    isHandoverOut ||
    compactTarget === 'handoverin';
  const isPaused = compactTarget === 'paused';
  const isToReview = compactTarget === 'toreview' || compactTarget === 'inreview';
  const activeError = quality.blockReason || null;
  const statusBadgeColor = isHandover
    ? 'bg-sky-500/15 border-sky-500/35 text-sky-300'
    : isPaused
      ? 'bg-amber-500/15 border-amber-500/35 text-amber-300'
      : isToReview
        ? 'bg-indigo-500/15 border-indigo-500/35 text-indigo-300'
        : 'bg-zinc-700/30 border-zinc-600/50 text-zinc-200';
  const activeOptionColor =
    resolvedStatusOptions.find((o) => o.label.toLowerCase() === effectiveTargetStatus.toLowerCase())?.color ||
    (isHandover ? TASK_MAP_STATUS_COLORS.HAND_OVER : isPaused ? TASK_MAP_STATUS_COLORS.PAUSED : isToReview ? TASK_MAP_STATUS_COLORS.TO_REVIEW : '#71717a');
  const submitButtonClass = isHandover
    ? 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700'
    : isPaused
      ? 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700'
      : 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700';
  const submitLabel = 'Clock-out Task';

  const handleSelectStatus = (nextLabel: string) => {
    setSelectedStatus(nextLabel);
    setIsStatusMenuOpen(false);
    onTargetStatusChange?.(nextLabel);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!quality.isSubmittable) {
      setShowQualitySuggestion(true);
      return;
    }

    try {
      setIsSubmitting(true);
      const exactTimeOut = formatManilaTime(new Date());
      await onSubmit({
        taskDeliverablesDescription: deliverablesDescription.trim() || taskTitle,
        taskUpdateAndDeliverables: updateAndDeliverables.trim(),
        timeOut: exactTimeOut,
        targetStatus: effectiveTargetStatus,
      });
      onClose();
    } catch (err) {
      console.error('Failed to submit deliverables:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-visible flex flex-col animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deliverables-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-zinc-800 bg-zinc-950/50 rounded-t-2xl">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`p-2 rounded-lg border shrink-0 ${statusBadgeColor}`}>
              <FileCheck className="size-4 shrink-0" />
            </div>
            <div className="min-w-0">
              <h3 id="deliverables-modal-title" className="text-sm font-semibold text-zinc-100 truncate" title={clientName ? `${clientName} — ${taskTitle}` : taskTitle}>
                {clientName ? `${clientName} — ${taskTitle}` : taskTitle}
              </h3>
              <p className="text-[11px] font-mono text-zinc-400 flex items-center gap-1.5 mt-0.5">
                <Clock className="size-3 text-amber-400 shrink-0" />
                <span>{timeIn ? `${timeIn} - ${currentTimeOut}` : currentTimeOut}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
            title="Cancel and close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content & Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Target Status Switcher */}
          <div ref={statusDropdownRef} className="relative flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-medium text-zinc-400 shrink-0">Move to</span>
            <button
              type="button"
              disabled={isSubmitting}
              aria-haspopup="listbox"
              aria-expanded={isStatusMenuOpen}
              onClick={() => setIsStatusMenuOpen((prev) => !prev)}
              title="Change target status before clocking out"
              className={`inline-flex items-center gap-2 h-8 px-2.5 rounded-lg border text-xs font-medium transition-all cursor-pointer disabled:opacity-50 hover:brightness-110 focus:outline-none focus:ring-1 focus:ring-zinc-500 ${statusBadgeColor}`}
            >
              <span
                className="size-2 rounded-full shrink-0"
                style={{ backgroundColor: activeOptionColor }}
              />
              <span className="truncate max-w-[140px]">{effectiveTargetStatus}</span>
              <ChevronDown
                className={`size-3.5 shrink-0 opacity-75 transition-transform duration-150 ${
                  isStatusMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            {isStatusMenuOpen && (
              <div
                role="listbox"
                aria-label="Target status"
                className="absolute left-0 top-full mt-2 z-50 w-52 rounded-xl bg-zinc-950 border border-zinc-800 shadow-2xl p-1.5 animate-in fade-in zoom-in-95 duration-100"
              >
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Switch target status
                </div>
                <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-0.5">
                  {resolvedStatusOptions.map((opt) => {
                    const isSelected = opt.label.toLowerCase() === effectiveTargetStatus.toLowerCase();
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => handleSelectStatus(opt.label)}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-zinc-800/90 text-zinc-100 font-medium'
                            : 'text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="size-2 rounded-full shrink-0"
                            style={{ backgroundColor: opt.color || '#71717a' }}
                          />
                          <span className="truncate">{opt.label}</span>
                        </span>
                        {isSelected && <Check className="size-3.5 text-sky-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Field 1: Task Deliverables Description */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-semibold text-zinc-200">
                Task Deliverables Description:
              </label>
            </div>
            <input
              type="text"
              required
              value={deliverablesDescription}
              onChange={(e) => setDeliverablesDescription(e.target.value)}
              placeholder="e.g. 5, 3 thumbnails, or Update Module 2 lessons"
              className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            />

            {showQualitySuggestion && activeError && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 flex items-start gap-2">
                <p className="text-[11px] text-amber-300 flex items-start gap-1.5 leading-snug">
                  <AlertCircle className="size-3.5 shrink-0 mt-0.5 text-amber-400" />
                  <span>{activeError}</span>
                </p>
              </div>
            )}
          </div>

          {/* Field 2: Task Update and Deliverables */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-semibold text-zinc-200">
                Task Update and Deliverables:
              </label>
              <span className="text-[10px] text-zinc-500">Optional</span>
            </div>
            <textarea
              rows={10}
              value={updateAndDeliverables}
              onChange={(e) => setUpdateAndDeliverables(e.target.value)}
              placeholder={DEFAULT_UPDATE_TEMPLATE}
              className="w-full min-h-[210px] px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors resize-y leading-relaxed"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-3.5 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-8 px-3.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/60 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !deliverablesDescription.trim()}
              className={`flex items-center gap-1.5 h-8 px-4 rounded-lg text-xs font-semibold text-white transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${submitButtonClass}`}
            >
              <Send className="size-3.5" />
              <span>{submitLabel}</span>
            </button>
          </div>
        </form>
      </div>
      <NexusFullScreenLoader isOpen={isSubmitting} label="Please wait..." />
    </div>
  );
}
