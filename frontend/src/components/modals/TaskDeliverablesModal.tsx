'use client';

import React, { useState, useEffect } from 'react';
import { X, Clock, FileCheck, Send, Loader2, ArrowRight } from 'lucide-react';
import { formatManilaTime } from '@/api/taskMap';

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
  targetStatus: 'To Review' | 'Hand-over' | string;
  initialDeliverables?: string;
  initialUpdate?: string;
  userName?: string;
}

export function TaskDeliverablesModal({
  isOpen,
  onClose,
  onSubmit,
  taskTitle,
  clientName,
  targetStatus,
  initialDeliverables = '',
  initialUpdate = '',
  userName,
}: TaskDeliverablesModalProps) {
  const [deliverablesDescription, setDeliverablesDescription] = useState(initialDeliverables || taskTitle || '');
  const [updateAndDeliverables, setUpdateAndDeliverables] = useState(initialUpdate || '');
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
      setUpdateAndDeliverables(initialUpdate || '');
    }
  }, [isOpen, taskTitle, initialDeliverables, initialUpdate]);

  if (!isOpen) return null;

  const isHandover = targetStatus.toLowerCase().replace(/[\s_-]+/g, '') === 'handover';
  const statusBadgeColor = isHandover
    ? 'bg-sky-500/15 border-sky-500/35 text-sky-300'
    : 'bg-indigo-500/15 border-indigo-500/35 text-indigo-300';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

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
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-lg border ${statusBadgeColor}`}>
              <FileCheck className="size-4 shrink-0" />
            </div>
            <div>
              <h3 id="deliverables-modal-title" className="text-sm font-semibold text-zinc-100">
                {isHandover ? 'Hand Over Task & Deliverables' : 'Submit Deliverables (To Review)'}
              </h3>
              <p className="text-[11px] text-zinc-400">
                Syncs deliverables to your MA Daily Schedule spreadsheet and clocks you out.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="Cancel and close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content & Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Target Status & Clock-out Context Banner */}
          <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                {clientName && (
                  <span className="text-[11px] font-bold text-zinc-300 bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700/60 truncate">
                    {clientName}
                  </span>
                )}
                <span className="text-xs font-semibold text-zinc-200 truncate" title={taskTitle}>
                  {taskTitle}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-medium text-zinc-400">Status:</span>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${statusBadgeColor}`}>
                  {targetStatus}
                </span>
              </div>
            </div>

            {/* Time Out Notice */}
            <div className="flex items-center justify-between pt-1 border-t border-zinc-800/50 text-xs">
              <div className="flex items-center gap-1.5 text-zinc-300">
                <Clock className="size-3.5 text-amber-400 shrink-0" />
                <span className="text-[11px] text-zinc-400">
                  {userName ? `${userName}'s ` : ''}Clock-Out Time (Manila):
                </span>
                <span className="font-mono font-semibold text-amber-300">
                  {currentTimeOut}
                </span>
              </div>
              <span className="text-[10px] text-emerald-400 font-medium bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                Auto-Stop Session
              </span>
            </div>
          </div>

          {/* Field 1: Task Deliverables Description (Col K in Spreadsheet) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-zinc-200">
              Task Deliverables Description:
              <span className="text-[11px] font-normal text-zinc-400 ml-1.5">
                (Spreadsheet Column K)
              </span>
            </label>
            <input
              type="text"
              required
              value={deliverablesDescription}
              onChange={(e) => setDeliverablesDescription(e.target.value)}
              placeholder="e.g. Completed initial design overhaul, resolved audit flags"
              className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            />
            <p className="text-[10px] text-zinc-500">
              High-level scope of the deliverables or deliverables label.
            </p>
          </div>

          {/* Field 2: Task Update and Deliverables (Col L in Spreadsheet) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-zinc-200">
                Task Update and Deliverables:
                <span className="text-[11px] font-normal text-zinc-400 ml-1.5">
                  (Spreadsheet Column L)
                </span>
              </label>
              <span className="text-[10px] text-zinc-500">Required</span>
            </div>
            <textarea
              required
              rows={4}
              value={updateAndDeliverables}
              onChange={(e) => setUpdateAndDeliverables(e.target.value)}
              placeholder="Provide a detailed update of what you completed, deliverables links, what was tested, and any handover instructions..."
              className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors resize-y leading-relaxed"
            />
            <p className="text-[10px] text-zinc-500">
              Detailed outcome to record in your schedule spreadsheet and pass to the reviewing PM/Auditor.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/60 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !deliverablesDescription.trim() || !updateAndDeliverables.trim()}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed ${
                isHandover
                  ? 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700'
                  : 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <Send className="size-3.5" />
                  <span>Submit & Clock Out</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
