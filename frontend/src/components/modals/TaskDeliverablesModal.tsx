'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { X, Clock, FileCheck, Send, ArrowRight, CheckCircle2, Circle, Sparkles, AlertCircle } from 'lucide-react';
import { formatManilaTime } from '@/api/taskMap';
import { NexusFullScreenLoader } from '@/components/ui/NexusLogo';
import { evaluateDeliverableDescription } from '@/lib/deliverablesQuality';

export interface TaskDeliverablesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    taskDeliverablesDescription: string;
    taskUpdateAndDeliverables: string;
    timeOut: string;
  }) => Promise<void> | void;
  taskTitle: string;
  clientName?: string;
  isAdminTask?: boolean;
  targetStatus: 'To Review' | 'Hand-over' | string;
  initialDeliverables?: string;
  initialUpdate?: string;
  userName?: string;
  timeIn?: string;
}

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

function hasFilledUpdateSection(text: string): boolean {
  const lines = (text || '').split(/\r?\n/);
  let currentSection: 'action' | 'resources' | 'todo' | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const sectionMatch = trimmed.match(/^(?:📍|📎|⏭️?|📌)?\s*(Action Done|Resources|Still To Do)\s*:\s*(.*)$/i);
    if (sectionMatch) {
      const label = sectionMatch[1].toLowerCase();
      currentSection = label.includes('action')
        ? 'action'
        : label.includes('resources')
          ? 'resources'
          : 'todo';
      const inlineRemainder = (sectionMatch[2] || '').replace(/^[\s┊➤\-*•]+/, '').trim();
      if (inlineRemainder.length > 0) return true;
      continue;
    }

    if (currentSection) {
      const cleaned = trimmed.replace(/^[\s┊➤\-*•]+/, '').trim();
      if (cleaned.length > 0) return true;
    }
  }

  return false;
}

export function TaskDeliverablesModal({
  isOpen,
  onClose,
  onSubmit,
  taskTitle,
  clientName,
  isAdminTask,
  targetStatus,
  initialDeliverables = '',
  initialUpdate = '',
  timeIn = '',
}: TaskDeliverablesModalProps) {
  const [deliverablesDescription, setDeliverablesDescription] = useState(initialDeliverables || taskTitle || '');
  const [updateAndDeliverables, setUpdateAndDeliverables] = useState(initialUpdate || DEFAULT_UPDATE_TEMPLATE);
  const [currentTimeOut, setCurrentTimeOut] = useState(() => formatManilaTime(new Date()));
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Update clock-out time display every 10 seconds while modal is open
  useEffect(() => {
    if (!isOpen) return;
    setCurrentTimeOut(formatManilaTime(new Date()));
    const timer = setInterval(() => {
      setCurrentTimeOut(formatManilaTime(new Date()));
    }, 10000);
    return () => clearInterval(timer);
  }, [isOpen]);

  // Keep description prefilled when task changes
  useEffect(() => {
    if (isOpen) {
      setDeliverablesDescription(initialDeliverables || taskTitle || '');
      setUpdateAndDeliverables(initialUpdate || DEFAULT_UPDATE_TEMPLATE);
    }
  }, [isOpen, taskTitle, initialDeliverables, initialUpdate]);

  const quality = useMemo(
    () =>
      evaluateDeliverableDescription({
        deliverablesDescription,
        taskTitle,
        clientName,
        isAdminTask,
      }),
    [deliverablesDescription, taskTitle, clientName, isAdminTask]
  );

  if (!isOpen) return null;

  const compactTarget = targetStatus.toLowerCase().replace(/[\s_-]+/g, '');
  const isAvailableTask = compactTarget === 'availabletask';
  const isHandover = compactTarget === 'handover';
  const isPaused = compactTarget === 'paused';
  const isToReview = compactTarget === 'toreview' || compactTarget === 'inreview';
  const hasUpdateSectionInput = useMemo(
    () => hasFilledUpdateSection(updateAndDeliverables),
    [updateAndDeliverables]
  );
  const statusBadgeColor = isHandover
    ? 'bg-sky-500/15 border-sky-500/35 text-sky-300'
    : isPaused
      ? 'bg-amber-500/15 border-amber-500/35 text-amber-300'
      : isToReview
        ? 'bg-indigo-500/15 border-indigo-500/35 text-indigo-300'
        : 'bg-zinc-700/30 border-zinc-600/50 text-zinc-200';
  const submitButtonClass = isHandover
    ? 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700'
    : isPaused
      ? 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700'
      : 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700';
  const submitLabel = isPaused
    ? (timeIn ? 'Pause & Time Out' : 'Pause & Store in Queue')
    : isHandover
      ? (timeIn ? 'Hand-over & Clock Out' : 'Submit & Hand-over')
      : isToReview
        ? 'Submit & Clock Out'
        : 'Submit & Time Out';
  const loaderLabel = isPaused
    ? 'Pausing task & timing out...'
    : isHandover
      ? 'Submitting handover deliverables...'
      : 'Submitting deliverables & clocking out...';
  const targetBadgeLabel = isPaused ? 'Paused → Queue' : targetStatus;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !quality.isSubmittable || !hasUpdateSectionInput) return;

    try {
      setIsSubmitting(true);
      const exactTimeOut = formatManilaTime(new Date());
      await onSubmit({
        taskDeliverablesDescription: deliverablesDescription.trim() || taskTitle,
        taskUpdateAndDeliverables: updateAndDeliverables.trim(),
        timeOut: exactTimeOut,
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
        className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deliverables-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`p-2 rounded-lg border shrink-0 ${statusBadgeColor}`}>
              <FileCheck className="size-4 shrink-0" />
            </div>
            <div className="min-w-0">
              <h3 id="deliverables-modal-title" className="text-sm font-semibold text-zinc-100 truncate" title={clientName ? `${clientName} — ${taskTitle}` : taskTitle}>
                {clientName ? `${clientName} — ${taskTitle}` : taskTitle}
              </h3>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <p className="text-[11px] font-mono text-zinc-400 flex items-center gap-1.5">
                  <Clock className="size-3 text-amber-400 shrink-0" />
                  <span>{timeIn ? `${timeIn} - ${currentTimeOut}` : currentTimeOut}</span>
                </p>
                {!isAvailableTask && (
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${statusBadgeColor}`}>
                    <ArrowRight className="size-2.5 shrink-0" />
                    {targetBadgeLabel}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50 shrink-0"
            title="Cancel and close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content & Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Field 1: Task Deliverables Description */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-semibold text-zinc-200">
                Task Deliverables Description:
              </label>
              <div className="flex items-center gap-2">
                {!hasUpdateSectionInput ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-amber-300">
                    <AlertCircle className="size-3 text-amber-400 shrink-0" />
                    <span>Fill at least 1 section (Action Done / Resources / Still To Do)</span>
                  </span>
                ) : quality.isClientTask ? (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300">
                    Client Deliverable Check
                  </span>
                ) : (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400">
                    Internal / Admin
                  </span>
                )}
              </div>
            </div>
            <input
              type="text"
              required
              value={deliverablesDescription}
              onChange={(e) => setDeliverablesDescription(e.target.value)}
              placeholder="e.g. Update thumbnails, titles, and graphics across Module 2 lessons"
              className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            />

            {/* Measurable + Tangible Checker for Task Deliverables Description (Client Tasks) */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex flex-wrap gap-1.5">
                  {quality.checks.map((chk) => (
                    <span
                      key={chk.id}
                      title={chk.hint}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border ${
                        chk.passed
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                      }`}
                    >
                      {chk.passed ? (
                        <CheckCircle2 className="size-3 text-emerald-400 shrink-0" />
                      ) : (
                        <Circle className="size-3 text-zinc-600 shrink-0" />
                      )}
                      <span>{chk.label}</span>
                    </span>
                  ))}
                </div>
              </div>

              {quality.isClientTask && quality.blockReason && (
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] text-amber-300 flex items-start gap-1.5 leading-snug">
                    <AlertCircle className="size-3.5 shrink-0 mt-0.5 text-amber-400" />
                    <span>{quality.blockReason}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setDeliverablesDescription(quality.templateSnippet)}
                    className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-400 hover:text-sky-300 transition-colors shrink-0 cursor-pointer"
                    title="Use example format"
                  >
                    <Sparkles className="size-3" />
                    <span>Example</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Field 2: Task Update and Deliverables */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-semibold text-zinc-200">
                Task Update and Deliverables:
              </label>
              <span className="text-[10px] text-zinc-500">Required</span>
            </div>
            <textarea
              required
              rows={10}
              value={updateAndDeliverables}
              onChange={(e) => setUpdateAndDeliverables(e.target.value)}
              placeholder={DEFAULT_UPDATE_TEMPLATE}
              className="w-full min-h-[210px] px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors resize-y leading-relaxed"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/60 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !deliverablesDescription.trim() || !updateAndDeliverables.trim() || !quality.isSubmittable || !hasUpdateSectionInput}
              title={
                !hasUpdateSectionInput
                  ? 'Fill in at least 1 section (Action Done, Resources, or Still To Do)'
                  : quality.blockReason || undefined
              }
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${submitButtonClass}`}
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
