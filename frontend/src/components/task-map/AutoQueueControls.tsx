'use client';

import { useState } from 'react';
import { Loader2, RotateCcw, Scale, X } from 'lucide-react';
import { apiClient } from '@/api/client';
import { toast } from '@/lib/toast';

interface MaDaySummary {
  userId: string;
  userName: string;
  shiftHours: number;
  plannedHours: number;
  newTasks: number;
}

interface DistributeResult {
  success: boolean;
  moved: number;
  newlyQueued: number;
  unchanged: number;
  failed: Array<{ taskId: string; taskTitle: string; error: string }>;
  skippedTasks: Array<{ taskId: string; taskTitle: string; reason: string }>;
  summary: MaDaySummary[];
}

interface ResetResult {
  success: boolean;
  returned: number;
  failed: Array<{ taskId: string; taskTitle: string; error: string }>;
}

// Long timeout: these move many cards one by one through the normal assign flow
const TIMEOUT_MS = 180_000;

type Dialog = { kind: 'distribute'; preview: DistributeResult | null } | { kind: 'reset' } | null;

/**
 * Task Map header controls for PMs/Admins:
 *  - Distribute: evens out unstarted auto-queued tasks + Available tasks across today's MAs (by hours)
 *  - Reset: returns every unstarted auto-queued task to Available tasks
 * Tasks a PM placed by hand and tasks already started are never moved.
 */
export function AutoQueueControls() {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<'preview' | 'distribute' | 'reset' | null>(null);

  const openDistribute = async () => {
    setBusy('preview');
    try {
      const preview = await apiClient<DistributeResult>('/api/task-map/auto-queue/preview', {
        method: 'POST',
        params: { kind: 'distribute' },
        timeoutMs: TIMEOUT_MS,
      });
      setDialog({ kind: 'distribute', preview });
    } catch (err: any) {
      toast.error(err?.message || 'Could not load the distribution preview');
    } finally {
      setBusy(null);
    }
  };

  const runDistribute = async () => {
    setBusy('distribute');
    try {
      const res = await apiClient<DistributeResult>('/api/task-map/auto-queue/distribute', {
        method: 'POST',
        timeoutMs: TIMEOUT_MS,
      });
      setDialog(null);
      const parts = [`${res.moved} moved`, `${res.newlyQueued} queued from Available tasks`];
      if (res.failed.length) parts.push(`${res.failed.length} skipped (changed meanwhile)`);
      toast.success(`Distributed: ${parts.join(', ')}`);
    } catch (err: any) {
      toast.error(err?.message || 'Distribute failed');
    } finally {
      setBusy(null);
    }
  };

  const runReset = async () => {
    setBusy('reset');
    try {
      const res = await apiClient<ResetResult>('/api/task-map/auto-queue/reset', {
        method: 'POST',
        timeoutMs: TIMEOUT_MS,
      });
      setDialog(null);
      toast.success(
        res.returned
          ? `${res.returned} auto-queued task${res.returned === 1 ? '' : 's'} returned to Available tasks`
          : 'No unstarted auto-queued tasks to return'
      );
      if (res.failed.length) toast.error(`${res.failed.length} could not be returned`);
    } catch (err: any) {
      toast.error(err?.message || 'Reset failed');
    } finally {
      setBusy(null);
    }
  };

  const buttonClass =
    'flex items-center gap-1.5 px-3 py-1.5 bg-card border border-zinc-800/80 hover:border-zinc-700 rounded-xl text-xs font-medium text-zinc-300 hover:text-zinc-100 transition-colors shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <>
      <button
        type="button"
        className={buttonClass}
        onClick={openDistribute}
        disabled={busy !== null}
        title="Even out unstarted auto-queued tasks and Available tasks across today's MAs, by estimated hours"
      >
        {busy === 'preview' ? <Loader2 className="size-3.5 animate-spin" /> : <Scale className="size-3.5 text-emerald-400" />}
        <span className="hidden sm:inline">Distribute</span>
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => setDialog({ kind: 'reset' })}
        disabled={busy !== null}
        title="Return every unstarted auto-queued task to Available tasks"
      >
        <RotateCcw className="size-3.5 text-amber-400" />
        <span className="hidden sm:inline">Reset queue</span>
      </button>

      {dialog && (
        <div
          className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 p-4"
          onClick={() => busy === null && setDialog(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-800 bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-sm font-bold text-zinc-100">
                {dialog.kind === 'distribute' ? 'Distribute tasks evenly?' : 'Reset the auto-queue?'}
              </h2>
              <button
                type="button"
                onClick={() => setDialog(null)}
                disabled={busy !== null}
                className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            {dialog.kind === 'distribute' && dialog.preview && (
              <div className="space-y-3 text-xs text-zinc-300">
                <p>
                  <b>{dialog.preview.moved}</b> unstarted task{dialog.preview.moved === 1 ? '' : 's'} will move between MAs
                  and <b>{dialog.preview.newlyQueued}</b> will be queued from Available tasks. Started tasks and tasks a PM
                  placed by hand stay where they are.
                </p>
                {dialog.preview.summary.length > 0 && (
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-800">
                    <table className="w-full text-[11px]">
                      <thead className="bg-zinc-900/60 text-zinc-500">
                        <tr>
                          <th className="px-2.5 py-1.5 text-left font-semibold">MA</th>
                          <th className="px-2.5 py-1.5 text-right font-semibold">Planned / shift</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dialog.preview.summary.map((s) => (
                          <tr key={s.userId} className="border-t border-zinc-800/60">
                            <td className="px-2.5 py-1.5">{s.userName}</td>
                            <td
                              className={`px-2.5 py-1.5 text-right ${s.plannedHours > s.shiftHours ? 'text-amber-400' : ''}`}
                            >
                              {s.plannedHours.toFixed(1)}h / {s.shiftHours.toFixed(1)}h
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {dialog.preview.skippedTasks.length > 0 && (
                  <p className="text-amber-400/90">
                    {dialog.preview.skippedTasks.length} task{dialog.preview.skippedTasks.length === 1 ? '' : 's'} will stay
                    in Available tasks (no one scheduled today has the role).
                  </p>
                )}
              </div>
            )}

            {dialog.kind === 'reset' && (
              <p className="text-xs text-zinc-300">
                Every task the auto-queue placed that hasn&apos;t been started goes back to Available tasks. Tasks a PM
                placed by hand and tasks already in progress are not touched. Use <b>Distribute</b> afterwards to hand
                them out again.
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(null)}
                disabled={busy !== null}
                className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={dialog.kind === 'distribute' ? runDistribute : runReset}
                disabled={
                  busy !== null ||
                  (dialog.kind === 'distribute' && !!dialog.preview && dialog.preview.moved + dialog.preview.newlyQueued === 0)
                }
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  dialog.kind === 'distribute' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-amber-600 hover:bg-amber-500'
                }`}
              >
                {busy && busy !== 'preview' && <Loader2 className="size-3.5 animate-spin" />}
                {dialog.kind === 'distribute' ? 'Distribute' : 'Reset queue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
