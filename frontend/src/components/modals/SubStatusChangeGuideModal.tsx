'use client';

import React, { useState } from 'react';
import { ArrowRight, Check, Info, Layers, ShieldAlert, X } from 'lucide-react';
import { SubStatusTransitionGuide } from '@/api/taskMap';
import { NexusFullScreenLoader } from '@/components/ui/NexusLogo';

export interface SubStatusChangeGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  guide: SubStatusTransitionGuide | null;
  taskTitle: string;
  clientName?: string;
  currentSubStatuses?: string[];
  currentMainStatus?: string;
}

export function SubStatusChangeGuideModal({
  isOpen,
  onClose,
  onConfirm,
  guide,
  taskTitle,
  clientName,
  currentSubStatuses = [],
  currentMainStatus,
}: SubStatusChangeGuideModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen || !guide) return null;

  const handleConfirm = async () => {
    if (isSubmitting) return;
    try {
      setIsSubmitting(true);
      await onConfirm();
      onClose();
    } catch (err) {
      console.error('Failed to apply sub-status change:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentSubLabel =
    currentSubStatuses.length > 0 ? currentSubStatuses.join(', ') : 'None';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="substatus-guide-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="p-2 rounded-lg border shrink-0"
              style={{
                backgroundColor: `${guide.accentColor}22`,
                borderColor: `${guide.accentColor}55`,
                color: guide.accentColor,
              }}
            >
              <Layers className="size-4 shrink-0" />
            </div>
            <div className="min-w-0">
              <h3 id="substatus-guide-modal-title" className="text-sm font-semibold text-zinc-100 truncate">
                {guide.title}
              </h3>
              <p className="text-[11px] text-zinc-400 truncate mt-0.5" title={clientName ? `${clientName} — ${taskTitle}` : taskTitle}>
                {clientName ? `${clientName} — ${taskTitle}` : taskTitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50 shrink-0"
            title="Cancel"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Transition Pill Preview */}
          <div className="flex items-center gap-2 flex-wrap bg-zinc-950/70 border border-zinc-800 rounded-xl px-3.5 py-2.5">
            <span className="text-[11px] font-medium text-zinc-400 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800">
              {currentSubLabel}
            </span>
            <ArrowRight className="size-3.5 text-zinc-500 shrink-0" />
            <span
              className="text-[11px] font-bold px-2.5 py-0.5 rounded border border-white/10"
              style={{ backgroundColor: guide.accentColor, color: '#ffffff' }}
            >
              {guide.isReverting ? `Clear ${guide.label}` : guide.label}
            </span>
          </div>

          <p className="text-xs text-zinc-200 leading-relaxed">{guide.summary}</p>

          {/* Destination & Status Impact */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Destination
              </span>
              <p className="text-xs font-medium text-zinc-200">{guide.destination}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Main Status
              </span>
              <p className="text-xs font-medium text-zinc-200">
                {guide.mainStatusChange
                  ? `${currentMainStatus || 'Current'} -> ${guide.mainStatusChange}`
                  : `Remains ${currentMainStatus || 'unchanged'}`}
              </p>
            </div>
          </div>

          {/* Guide / Side Effects */}
          {guide.sideEffects.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                {guide.requiresDeliverablesClockOut ? (
                  <ShieldAlert className="size-3 text-amber-400" />
                ) : (
                  <Info className="size-3 text-sky-400" />
                )}
                What This Sub-Status Change Does
              </span>
              <ul className="space-y-1">
                {guide.sideEffects.map((item, idx) => (
                  <li key={idx} className="text-[11px] text-zinc-300 flex items-start gap-2 leading-snug">
                    <span className="text-zinc-500 mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 transition-all shadow-md disabled:opacity-50 cursor-pointer"
            >
              <Check className="size-3.5" />
              <span>{guide.isReverting ? `Confirm Revert` : `Confirm ${guide.label}`}</span>
            </button>
          </div>
        </div>
      </div>
      <NexusFullScreenLoader isOpen={isSubmitting} label="Please wait..." />
    </div>
  );
}
