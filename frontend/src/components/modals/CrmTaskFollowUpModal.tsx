'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { X, Loader2 } from 'lucide-react';
import {
  CrmFollowUpResponseAction,
  CrmWaitingMeta,
  getCrmFollowUpRule,
  taskMapApi,
} from '@/api/taskMap';
import { toast } from '@/lib/toast';

export interface CrmTaskFollowUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: {
    id: string;
    title: string;
    status?: string | null;
    updatedAt?: string | null;
    createdAt?: string | null;
    list?: { id?: string; name?: string | null } | null;
  } | null;
  waitingInfo?: CrmWaitingMeta | null;
  parentCommentId?: string | null;
  onSubmitted?: (result: {
    action: CrmFollowUpResponseAction;
    note: string;
    task?: any;
    comment?: any;
  }) => void;
}

const ACTION_OPTIONS: Array<{
  action: CrmFollowUpResponseAction;
  title: string;
  subtitle: string;
  accentBorder: string;
  accentBg: string;
  accentTitle: string;
}> = [
  {
    action: 'FOLLOWED_UP',
    title: 'Followed Up (Keep Waiting)',
    subtitle: 'Log update, keep in Sent but Waiting & reset waiting count',
    accentBorder: 'border-cyan-500/60',
    accentBg: 'bg-cyan-950/30',
    accentTitle: 'text-cyan-200',
  },
  {
    action: 'REVISIONS',
    title: 'Send to Revisions',
    subtitle: 'Transfer to Task Map for MA delegation',
    accentBorder: 'border-indigo-500/60',
    accentBg: 'bg-indigo-950/30',
    accentTitle: 'text-indigo-200',
  },
  {
    action: 'MOVE_TO_POOL',
    title: 'Return to CRM Pool',
    subtitle: 'Move back to CRM Pool (To send)',
    accentBorder: 'border-amber-500/60',
    accentBg: 'bg-amber-950/30',
    accentTitle: 'text-amber-200',
  },
  {
    action: 'CLOSED',
    title: 'Mark Closed',
    subtitle: 'Client confirmed / complete task',
    accentBorder: 'border-emerald-500/60',
    accentBg: 'bg-emerald-950/30',
    accentTitle: 'text-emerald-200',
  },
];

export const CrmTaskFollowUpModal: React.FC<CrmTaskFollowUpModalProps> = ({
  isOpen,
  onClose,
  task,
  waitingInfo,
  parentCommentId,
  onSubmitted,
}) => {
  const [selectedAction, setSelectedAction] = useState<CrmFollowUpResponseAction>('FOLLOWED_UP');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedAction('FOLLOWED_UP');
      setNote('');
      setErrorMsg(null);
    }
  }, [isOpen, task?.id]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !task || typeof document === 'undefined') return null;

  const daysPassed =
    waitingInfo?.daysPassed ??
    Math.max(
      0,
      Math.floor(
        (Date.now() - new Date(task.updatedAt || task.createdAt || Date.now()).getTime()) /
          86_400_000
      )
    );
  const rule = waitingInfo?.rule || getCrmFollowUpRule(daysPassed);
  const sentSinceDate = waitingInfo?.waitingSince || task.updatedAt || task.createdAt;
  const sentSinceLabel = sentSinceDate
    ? format(new Date(sentSinceDate), 'MMM d, yyyy')
    : 'Recently';
  const lastFollowUpLabel = waitingInfo?.lastResponseAt
    ? format(new Date(waitingInfo.lastResponseAt), 'MMM d, yyyy · h:mm a')
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = note.trim();
    if (!trimmed) {
      setErrorMsg('Please enter a follow-up response note before submitting.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await taskMapApi.respondCrmFollowUp(task.id, {
        note: trimmed,
        action: selectedAction,
        ...(parentCommentId ? { parentCommentId } : {}),
      });
      if (!res?.success) {
        setErrorMsg(res?.error || 'Failed to submit follow-up response');
        return;
      }
      toast.success('CRM follow-up logged');
      onSubmitted?.({
        action: selectedAction,
        note: trimmed,
        task: res.task,
        comment: res.comment,
      });
      window.dispatchEvent(new CustomEvent('task_map:reload'));
      onClose();
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        'Failed to submit follow-up response';
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-task-followup-title"
        className="w-full max-w-[540px] rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-zinc-800/80 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2
                id="crm-task-followup-title"
                className="text-base font-bold tracking-tight text-zinc-100"
              >
                CRM Follow-Up Response
              </h2>
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border"
                style={{
                  backgroundColor: `${rule.hex}1F`,
                  borderColor: `${rule.hex}66`,
                  color: daysPassed === 0 ? '#a1a1aa' : rule.hex,
                }}
              >
                {rule.label} · {daysPassed}d waiting
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Log a follow-up update to count waiting days from this log instead of the initial waiting status.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Task Summary Card */}
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 px-4 py-3.5">
            {task.list?.name && (
              <div className="text-xs font-medium text-cyan-400 truncate">
                {task.list.name}
              </div>
            )}
            <div className="text-sm font-semibold text-zinc-100 mt-0.5 leading-snug">
              {task.title}
            </div>
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400 mt-2">
              <span>
                Sent since <strong className="text-zinc-200 font-medium">{sentSinceLabel}</strong>
              </span>
              <span className="text-zinc-700">·</span>
              <span>
                Waiting:{' '}
                <strong
                  className="font-semibold"
                  style={{ color: daysPassed === 0 ? '#d4d4d8' : rule.hex }}
                >
                  {daysPassed === 0 ? 'Today (0d)' : daysPassed === 1 ? '1 day' : `${daysPassed} days`}
                </strong>
              </span>
            </div>
            {lastFollowUpLabel && (
              <div className="text-[11px] text-zinc-500 mt-1.5 pt-1.5 border-t border-zinc-800/70">
                Last follow-up logged {lastFollowUpLabel}
                {waitingInfo?.lastResponseByName ? ` by ${waitingInfo.lastResponseByName}` : ''}
              </div>
            )}
          </div>

          {/* Next Step / Action */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2.5">
              Next Step / Action
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {ACTION_OPTIONS.map((opt) => {
                const isSelected = selectedAction === opt.action;
                return (
                  <button
                    key={opt.action}
                    type="button"
                    onClick={() => {
                      setSelectedAction(opt.action);
                      if (errorMsg) setErrorMsg(null);
                    }}
                    disabled={isSubmitting}
                    className={`text-left rounded-xl border px-3.5 py-2.5 transition-all cursor-pointer disabled:opacity-60 ${
                      isSelected
                        ? `${opt.accentBorder} ${opt.accentBg} shadow-sm`
                        : 'border-zinc-800 bg-zinc-900/30 hover:border-zinc-700 hover:bg-zinc-900/60'
                    }`}
                  >
                    <div
                      className={`text-xs font-semibold ${
                        isSelected ? opt.accentTitle : 'text-zinc-200'
                      }`}
                    >
                      {opt.title}
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                      {opt.subtitle}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Follow-Up Response Note */}
          <div>
            <label
              htmlFor="crm-followup-note-input"
              className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2"
            >
              Follow-Up Response Note (Required)
            </label>
            <textarea
              id="crm-followup-note-input"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              rows={3}
              autoFocus
              disabled={isSubmitting}
              placeholder="e.g., Followed up with client on Slack/Email, waiting for feedback on funnel draft..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/30 resize-none transition-colors"
            />
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {errorMsg}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-zinc-500">
              Posted as a comment &amp; logged to task activity.
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/70 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !note.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#22A3AE] hover:bg-[#1d8e98] text-white text-xs font-semibold transition-all cursor-pointer shadow-sm disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isSubmitting ? 'Submitting…' : 'Submit Response'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
