'use client';

import React, { useState, useEffect } from 'react';
import { X, Clock, FileCheck, Send, Loader2, ArrowRight } from 'lucide-react';
import { formatManilaTime } from '@/api/taskMap';
import { NexusLogoLoader } from '@/components/ui/NexusLogo';

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
  timeIn?: string;
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
  timeIn = '',
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
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50 shrink-0"
            title="Cancel and close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content & Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Field 1: Task Deliverables Description */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-zinc-200">
              Task Deliverables Description:
            </label>
            <input
              type="text"
              required
              value={deliverablesDescription}
              onChange={(e) => setDeliverablesDescription(e.target.value)}
              placeholder="e.g. Completed initial design overhaul, resolved audit flags"
              className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Field 2: Task Update and Deliverables */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-zinc-200">
                Task Update and Deliverables:
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
          </div>

          {/* Actions / Loading State */}
          {isSubmitting ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2.5 border-t border-zinc-800 animate-in fade-in duration-150 select-none">
              <NexusLogoLoader size={44} label={isHandover ? "Submitting handover deliverables..." : "Submitting deliverables & clocking out..."} />
              <p className="text-[11px] text-zinc-500">Syncing with task logs and daily sheet...</p>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/60 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!deliverablesDescription.trim() || !updateAndDeliverables.trim()}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                  isHandover
                    ? 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700'
                    : 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700'
                }`}
              >
                <Send className="size-3.5" />
                <span>Submit & Clock Out</span>
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
