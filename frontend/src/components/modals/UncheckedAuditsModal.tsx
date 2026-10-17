'use client';

import React from 'react';
import { X, ArrowRight } from 'lucide-react';

interface UncheckedAuditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskTitle: string;
  targetStatus: string;
  uncheckedAudits: string[];
  openSubtasks?: string[];
  onReviewAudits?: () => void;
  reviewButtonText?: string;
}

export function UncheckedAuditsModal({
  isOpen,
  onClose,
  taskTitle,
  targetStatus,
  uncheckedAudits = [],
  openSubtasks = [],
  onReviewAudits,
  reviewButtonText,
}: UncheckedAuditsModalProps) {
  if (!isOpen) return null;

  // In Review only gates on subtasks, so the copy must not claim audits are needed
  const blockedBySubtasksOnly = uncheckedAudits.length === 0 && openSubtasks.length > 0;
  const heading = blockedBySubtasksOnly ? 'Close Subtasks First' : 'Audit Verification Required';
  const buttonText = reviewButtonText || (blockedBySubtasksOnly ? 'Review Subtasks' : 'Review Audits');

  return (
    <div
      className="fixed inset-0 z-[100001] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg bg-[#141518] border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-900/40">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              {heading}
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Moving to <span className="font-semibold text-zinc-200 uppercase">{targetStatus}</span> requires verification
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-4 text-sm max-h-[70vh] overflow-y-auto custom-scrollbar">
          <p className="text-zinc-300 leading-relaxed text-xs">
            Cannot move <span className="font-semibold text-white">"{taskTitle || 'this task'}"</span> to status{' '}
            <span className="font-bold text-[11px] uppercase px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200">
              {targetStatus}
            </span>{' '}
            until the following requirements are fulfilled:
          </p>

          {/* Unchecked Audits */}
          {uncheckedAudits.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg bg-zinc-900/60 border border-zinc-800 border-l-4 border-l-emerald-500 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wide">
                  Audits Required ({uncheckedAudits.length})
                </span>
              </div>
              <div className="flex flex-col gap-1.5 mt-1">
                {uncheckedAudits.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-3 py-2 rounded-md bg-zinc-950/60 border border-zinc-800/80 text-zinc-200 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="font-medium truncate">{item}</span>
                    </div>
                    <span className="text-[10px] uppercase font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 shrink-0 ml-2 tracking-wider">
                      Required
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Open Subtasks */}
          {openSubtasks && openSubtasks.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg bg-zinc-900/60 border border-zinc-800 border-l-4 border-l-amber-500 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wide">
                  Open Subtasks ({openSubtasks.length})
                </span>
                <span className="text-[10px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                  Must be closed
                </span>
              </div>
              <div className="flex flex-col gap-1.5 mt-1">
                {openSubtasks.map((st, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-3 py-2 rounded-md bg-zinc-950/60 border border-zinc-800/80 text-zinc-300 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      <span className="font-medium truncate">{st}</span>
                    </div>
                    <span className="text-[10px] uppercase font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 shrink-0 ml-2 tracking-wider">
                      Open
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3 border-t border-zinc-800 bg-[#0f1012]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            Dismiss
          </button>
          {onReviewAudits && (
            <button
              type="button"
              onClick={() => {
                onReviewAudits();
                onClose();
              }}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow-sm flex items-center gap-2 transition-all cursor-pointer"
            >
              <span>{buttonText}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
