'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Clock,
  Send,
  RotateCcw,
  CheckCircle2,
  Inbox,
  ExternalLink,
  Loader2,
  MessageSquarePlus,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  taskMapApi,
  PendingCrmFollowUpItem,
  CrmFollowUpResponseAction,
} from '@/api/taskMap';
import { hexToRgba } from './TaskMapCardControls';
import { useAppStore } from '@/lib/store';
import { isCrmUser } from '@/lib/permissions';
import { toast } from '@/lib/toast';

export const CrmFollowUpModal: React.FC = () => {
  const currentUser = useAppStore((s) => s.currentUser);
  const isCrm = isCrmUser(currentUser);
  const router = useRouter();

  const [items, setItems] = useState<PendingCrmFollowUpItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [note, setNote] = useState('');
  const [action, setAction] = useState<CrmFollowUpResponseAction>('FOLLOWED_UP');
  const [submitting, setSubmitting] = useState(false);
  const [auditError, setAuditError] = useState<{
    message: string;
    uncheckedAudits: string[];
    openSubtasks: string[];
  } | null>(null);

  const loadPending = useCallback(async () => {
    if (!isCrm) {
      setItems([]);
      return;
    }
    try {
      const res = await taskMapApi.getPendingCrmFollowUps();
      if (res?.success && Array.isArray(res.items)) {
        setItems(res.items);
        setSelectedIndex((prev) =>
          res.items.length === 0 ? 0 : Math.min(prev, res.items.length - 1)
        );
      }
    } catch {
      // ignore transient background errors
    }
  }, [isCrm]);

  useEffect(() => {
    if (!isCrm) return;
    const timer = setTimeout(() => {
      void loadPending();
    }, 800);
    const interval = setInterval(() => {
      void loadPending();
    }, 5 * 60 * 1000);

    const handleRefresh = () => {
      void loadPending();
    };
    window.addEventListener('crm:follow_up_alert', handleRefresh);
    window.addEventListener('crm:follow_up_responded', handleRefresh);
    window.addEventListener('task_map:updated', handleRefresh);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('crm:follow_up_alert', handleRefresh);
      window.removeEventListener('crm:follow_up_responded', handleRefresh);
      window.removeEventListener('task_map:updated', handleRefresh);
    };
  }, [isCrm, loadPending]);

  if (!isCrm || items.length === 0) return null;

  const activeItem = items[selectedIndex] || items[0];
  if (!activeItem) return null;

  const rule = activeItem.rule;
  const tierHex = rule.hex || '#f97316';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = note.trim();
    if (!trimmed) {
      toast.error('Please enter a follow-up update or response before submitting.');
      return;
    }
    setSubmitting(true);
    setAuditError(null);
    try {
      const res = await taskMapApi.respondCrmFollowUp(activeItem.id, {
        note: trimmed,
        action,
      });
      if (!res?.success) {
        toast.error(res?.error || 'Failed to submit follow-up response');
        return;
      }
      toast.success(`Follow-up response saved for "${activeItem.title}"`);
      setNote('');
      setAction('FOLLOWED_UP');
      setItems((prev) => prev.filter((item) => item.id !== activeItem.id));
      window.dispatchEvent(new CustomEvent('task_map:reload'));
      void loadPending();
    } catch (err: unknown) {
      const errObj = err as {
        message?: string;
        data?: { error?: string; uncheckedAudits?: string[]; openSubtasks?: string[] };
        response?: { data?: { error?: string; uncheckedAudits?: string[]; openSubtasks?: string[] } };
      };
      const data = errObj?.data || errObj?.response?.data;
      if (data?.uncheckedAudits?.length || data?.openSubtasks?.length) {
        setAuditError({
          message: errObj?.message || data?.error || 'Cannot close task yet.',
          uncheckedAudits: data.uncheckedAudits || [],
          openSubtasks: data.openSubtasks || [],
        });
      }
      toast.error(errObj?.message || 'Failed to submit follow-up response');
    } finally {
      setSubmitting(false);
    }
  };

  const actionOptions: Array<{
    key: CrmFollowUpResponseAction;
    label: string;
    description: string;
    icon: React.ReactNode;
  }> = [
    {
      key: 'FOLLOWED_UP',
      label: 'Followed Up (Keep Waiting)',
      description: 'Log update & keep in Sent but Waiting',
      icon: <Send className="size-3.5 text-amber-400 shrink-0" />,
    },
    {
      key: 'REVISIONS',
      label: 'Send to Revisions',
      description: 'Transfer to Task Map for MA delegation',
      icon: <RotateCcw className="size-3.5 text-indigo-400 shrink-0" />,
    },
    {
      key: 'MOVE_TO_POOL',
      label: 'Return to CRM Pool',
      description: 'Move back to CRM Pool (To send)',
      icon: <Inbox className="size-3.5 text-[#22A3AE] shrink-0" />,
    },
    {
      key: 'CLOSED',
      label: 'Mark Closed',
      description: 'Client confirmed / complete task',
      icon: <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crm-followup-modal-title"
    >
      <div className="w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div
          className="px-5 py-4 border-b border-border flex items-start justify-between gap-3"
          style={{ backgroundColor: hexToRgba(tierHex, 0.1) }}
        >
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="size-10 rounded-xl flex items-center justify-center shrink-0 border"
              style={{
                backgroundColor: hexToRgba(tierHex, 0.18),
                borderColor: hexToRgba(tierHex, 0.4),
                color: tierHex,
              }}
            >
              <AlertTriangle className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="crm-followup-modal-title" className="text-sm font-bold text-zinc-100">
                  CRM Follow-Up Response Required
                </h2>
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap"
                  style={{
                    backgroundColor: hexToRgba(tierHex, 0.18),
                    borderColor: hexToRgba(tierHex, 0.45),
                    color: tierHex,
                  }}
                >
                  <Clock className="size-2.5" />
                  {rule.label} · {activeItem.daysPassed}d waiting
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Tasks in <span className="font-semibold text-zinc-200">Sent but Waiting</span> for 4+ days require a follow-up response from CRM.
              </p>
            </div>
          </div>

          {items.length > 1 && (
            <span className="text-[11px] font-bold px-2 py-1 rounded-lg bg-zinc-800 text-zinc-200 border border-zinc-700 shrink-0 whitespace-nowrap">
              {selectedIndex + 1} of {items.length}
            </span>
          )}
        </div>

        {/* Queue switcher pills if multiple */}
        {items.length > 1 && (
          <div className="px-5 py-2.5 border-b border-border bg-zinc-900/40 flex items-center gap-2 overflow-x-auto custom-scrollbar">
            {items.map((item, idx) => {
              const active = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedIndex(idx);
                    setAuditError(null);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors shrink-0 cursor-pointer ${
                    active
                      ? 'bg-zinc-800 text-white border-zinc-600'
                      : 'bg-card text-zinc-400 border-border hover:text-zinc-200'
                  }`}
                >
                  <span
                    className="size-2 rounded-full shrink-0"
                    style={{ backgroundColor: item.rule.hex }}
                  />
                  <span className="max-w-[140px] truncate">{item.title}</span>
                  <span className="text-[10px] opacity-80">{item.daysPassed}d</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto custom-scrollbar">
          {/* Task summary */}
          <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-border space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-[#22A3AE] truncate">
                {activeItem.list?.name || 'General'}
              </span>
              <button
                type="button"
                onClick={() => router.push(`/lists/${activeItem.listId}?task=${activeItem.id}`)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-white transition-colors shrink-0 cursor-pointer"
              >
                <span>Open Task</span>
                <ExternalLink className="size-3" />
              </button>
            </div>
            <h3 className="text-sm font-bold text-zinc-100 leading-snug">
              {activeItem.title}
            </h3>
            <div className="flex items-center gap-3 text-[11px] text-zinc-400 pt-0.5 flex-wrap">
              <span>
                Sent since{' '}
                <strong className="text-zinc-200">
                  {format(new Date(activeItem.waitingSince), 'MMM d, yyyy')}
                </strong>
              </span>
              <span>•</span>
              <span>
                Elapsed: <strong style={{ color: tierHex }}>{activeItem.daysPassed} days</strong>
              </span>
            </div>
            {activeItem.lastResponseNote && (
              <div className="mt-2 pt-2 border-t border-border/70 text-[11px] text-zinc-400">
                <span className="font-semibold text-zinc-300">
                  Last update ({activeItem.lastResponseByName || 'CRM'}):
                </span>{' '}
                {activeItem.lastResponseNote}
              </div>
            )}
          </div>

          {/* Action Selection */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
              Next Step / Action
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {actionOptions.map((opt) => {
                const isSelected = action === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      setAction(opt.key);
                      setAuditError(null);
                    }}
                    className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#22A3AE]/15 border-[#22A3AE]/60 text-zinc-100 shadow-sm'
                        : 'bg-zinc-900/40 border-border text-zinc-300 hover:border-zinc-700'
                    }`}
                  >
                    <div className="mt-0.5">{opt.icon}</div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold">{opt.label}</div>
                      <div className="text-[10px] text-zinc-400 leading-tight mt-0.5">
                        {opt.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {auditError && (
            <div className="p-3 rounded-xl bg-red-950/50 border border-red-700/60 text-xs text-red-200 space-y-1">
              <div className="font-semibold">{auditError.message}</div>
              {auditError.uncheckedAudits.length > 0 && (
                <div>Unchecked audits: {auditError.uncheckedAudits.join(', ')}</div>
              )}
              {auditError.openSubtasks.length > 0 && (
                <div>Open subtasks: {auditError.openSubtasks.join(', ')}</div>
              )}
            </div>
          )}

          {/* Required Response Note */}
          <div>
            <label
              htmlFor="crm-followup-note"
              className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5"
            >
              <MessageSquarePlus className="size-3.5 text-[#22A3AE]" />
              <span>Follow-Up Response Note (Required)</span>
            </label>
            <textarea
              id="crm-followup-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g., Followed up with client on Slack/Email, waiting for feedback on funnel draft..."
              className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-border text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#22A3AE]/50 resize-none"
              required
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-zinc-500">
              Posted as a comment & logged to task activity.
            </span>
            <button
              type="submit"
              disabled={submitting || !note.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#22A3AE] hover:bg-[#1d8e98] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors cursor-pointer shadow-md"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <Send className="size-3.5" />
                  <span>Submit Response</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
