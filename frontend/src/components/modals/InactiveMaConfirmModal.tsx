'use client';

import React, { useState } from 'react';
import { AlertTriangle, Clock, FileSpreadsheet, X, Check } from 'lucide-react';
import { SheetActivityLogRow } from '@/api/taskMap';
import { NexusFullScreenLoader } from '@/components/ui/NexusLogo';

export interface InactiveMaConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  targetUserName: string;
  taskTitle: string;
  reason: string;
  elapsedLabel?: string | null;
  recentRows?: SheetActivityLogRow[];
  source?: 'GOOGLE_SHEET' | 'DAILY_SHEET_LOG' | 'NONE';
}

export function InactiveMaConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  targetUserName,
  taskTitle,
  reason,
  elapsedLabel,
  recentRows = [],
  source,
}: InactiveMaConfirmModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (isSubmitting) return;
    try {
      setIsSubmitting(true);
      await onConfirm();
      onClose();
    } catch (err) {
      console.error('Failed to assign task to inactive MA:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-lg bg-zinc-900 border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inactive-ma-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-amber-950/20">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-lg border bg-amber-500/15 border-amber-500/35 text-amber-300 shrink-0">
              <AlertTriangle className="size-4 shrink-0" />
            </div>
            <div className="min-w-0">
              <h3 id="inactive-ma-modal-title" className="text-sm font-semibold text-zinc-100 truncate">
                {targetUserName} Appears Inactive
              </h3>
              <p className="text-[11px] text-amber-300/90 flex items-center gap-1.5 mt-0.5">
                <Clock className="size-3 shrink-0" />
                <span>{elapsedLabel ? `Last activity was ${elapsedLabel} ago (> 2 hrs)` : 'No recent activity within 2 hours'}</span>
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
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-200 leading-relaxed">
              Would you like to put <span className="font-semibold text-white">&ldquo;{taskTitle}&rdquo;</span> into{' '}
              <span className="font-semibold text-amber-300">{targetUserName}&apos;s</span> column anyway?
            </p>
            <p className="text-[11px] text-zinc-400">{reason}</p>
          </div>

          {recentRows.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/60">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <FileSpreadsheet className="size-3 text-emerald-400" />
                  Last {recentRows.length} Spreadsheet Log{recentRows.length > 1 ? 's' : ''}
                </span>
                {source === 'DAILY_SHEET_LOG' && (
                  <span className="text-[10px] text-zinc-500">From Nexus Sheet Logs</span>
                )}
              </div>
              <div className="divide-y divide-zinc-800/60 max-h-44 overflow-y-auto custom-scrollbar">
                {recentRows.map((row, i) => (
                  <div key={`${row.rowNumber ?? i}-${i}`} className="px-3 py-2 text-[11px] flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-zinc-200 font-medium truncate">
                        {row.client ? `${row.client} — ` : ''}{row.task || 'Untitled row'}
                      </p>
                      <p className="text-[10px] text-zinc-500 truncate">{row.date || 'No date'}</p>
                    </div>
                    <div className="text-right font-mono text-[10px] text-zinc-300 shrink-0">
                      <span>{row.timeIn || '--:--'}</span>
                      <span className="text-zinc-600 mx-1">-</span>
                      <span>{row.timeOut || 'Open'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 active:bg-amber-700 transition-all shadow-md disabled:opacity-50 cursor-pointer"
            >
              <Check className="size-3.5" />
              <span>Yes, Put It In</span>
            </button>
          </div>
        </div>
      </div>
      <NexusFullScreenLoader isOpen={isSubmitting} label="Please wait..." />
    </div>
  );
}
