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

interface DistributeDecision {
  taskId: string;
  taskTitle: string;
  userId: string;
  userName: string;
  method: 'ai' | 'rules';
  reason: string;
  hours?: number;
  isMove?: boolean;
}

interface DistributeResult {
  success: boolean;
  moved: number;
  newlyQueued: number;
  unchanged: number;
  failed: Array<{ taskId: string; taskTitle: string; error: string }>;
  skippedTasks: Array<{ taskId: string; taskTitle: string; reason: string }>;
  summary: MaDaySummary[];
  decisions?: DistributeDecision[];
}

interface ExcludedUser {
  id: string;
  name: string;
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
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  // People left out of the auto-queue (saved; applies to Distribute and the 5 AM / 1 PM / 5 PM runs)
  const [excluded, setExcluded] = useState<ExcludedUser[]>([]);

  const loadPreview = async () => {
    setBusy('preview');
    try {
      const [preview, ex] = await Promise.all([
        apiClient<DistributeResult>('/api/task-map/auto-queue/preview', {
          method: 'POST',
          params: { kind: 'distribute' },
          timeoutMs: TIMEOUT_MS,
        }),
        apiClient<{ users: ExcludedUser[] }>('/api/task-map/auto-queue/excluded'),
      ]);
      setExcluded(ex.users);
      setSelectedUserId(null);
      setDialog({ kind: 'distribute', preview });
    } catch (err: any) {
      toast.error(err?.message || 'Could not load the distribution preview');
    } finally {
      setBusy(null);
    }
  };

  const openDistribute = () => loadPreview();

  const setUserExcluded = async (user: ExcludedUser, exclude: boolean) => {
    setBusy('preview');
    try {
      await apiClient('/api/task-map/auto-queue/excluded', {
        method: 'PUT',
        body: JSON.stringify({ userId: user.id, excluded: exclude }),
      });
      toast.success(exclude ? `${user.name} won't get auto-queued tasks` : `${user.name} is back in the auto-queue`);
    } catch (err: any) {
      toast.error(err?.message || 'Could not update the auto-queue');
      setBusy(null);
      return;
    }
    await loadPreview();
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
        title="Even out unstarted auto-queued tasks and Available tasks to MAs with enough shift time left today to finish them"
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
            className={`w-full ${dialog.kind === 'distribute' ? 'max-w-2xl' : 'max-w-md'} rounded-2xl border border-zinc-800 bg-card p-5 shadow-2xl`}
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
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-zinc-800">
                    <table className="w-full text-[11px]">
                      <thead className="bg-zinc-900/60 text-zinc-500">
                        <tr>
                          <th className="px-2.5 py-1.5 text-left font-semibold">MA (click to filter)</th>
                          <th className="px-2.5 py-1.5 text-right font-semibold">New</th>
                          <th className="px-2.5 py-1.5 text-right font-semibold">Planned / shift left</th>
                          <th className="px-2.5 py-1.5 text-right font-semibold" />
                        </tr>
                      </thead>
                      <tbody>
                        {dialog.preview.summary.map((s) => {
                          const active = selectedUserId === s.userId;
                          return (
                            <tr
                              key={s.userId}
                              onClick={() => setSelectedUserId(active ? null : s.userId)}
                              className={`border-t border-zinc-800/60 cursor-pointer transition-colors ${
                                active ? 'bg-emerald-500/10 text-emerald-300' : 'hover:bg-zinc-900/40'
                              }`}
                            >
                              <td className="px-2.5 py-1.5 font-medium">{s.userName}</td>
                              <td className="px-2.5 py-1.5 text-right text-zinc-400">{s.newTasks}</td>
                              <td
                                className={`px-2.5 py-1.5 text-right ${s.plannedHours > s.shiftHours ? 'text-amber-400' : ''}`}
                              >
                                {s.plannedHours.toFixed(1)}h / {s.shiftHours.toFixed(1)}h
                              </td>
                              <td className="px-2.5 py-1.5 text-right">
                                <button
                                  type="button"
                                  disabled={busy !== null}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setUserExcluded({ id: s.userId, name: s.userName }, true);
                                  }}
                                  title="Stop giving this person auto-queued tasks (Distribute and the 5 AM / 1 PM / 5 PM runs)"
                                  className="text-zinc-500 hover:text-red-400 cursor-pointer disabled:opacity-50"
                                >
                                  Exclude
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {excluded.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="text-zinc-500">Excluded from auto-queue:</span>
                    {excluded.map((u) => (
                      <span
                        key={u.id}
                        className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-zinc-400"
                      >
                        {u.name}
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => setUserExcluded(u, false)}
                          title="Put back into the auto-queue"
                          className="text-emerald-500 hover:text-emerald-400 cursor-pointer disabled:opacity-50"
                        >
                          Include
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {dialog.preview.decisions && dialog.preview.decisions.length > 0 && (() => {
                  const visible = selectedUserId
                    ? dialog.preview.decisions.filter((d) => d.userId === selectedUserId)
                    : dialog.preview.decisions;
                  const selectedName = selectedUserId
                    ? dialog.preview.summary.find((s) => s.userId === selectedUserId)?.userName
                    : null;
                  return (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-zinc-400">
                        <span>
                          {selectedName ? `Tasks for ${selectedName}` : 'All planned tasks'} ({visible.length})
                        </span>
                        {selectedUserId && (
                          <button
                            type="button"
                            onClick={() => setSelectedUserId(null)}
                            className="text-emerald-400 hover:underline cursor-pointer"
                          >
                            Show all
                          </button>
                        )}
                      </div>
                      <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-800 divide-y divide-zinc-800/60">
                        {visible.map((d) => (
                          <div key={d.taskId} className="px-2.5 py-2 text-[11px] space-y-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-zinc-100 truncate">{d.taskTitle}</span>
                              <span className="shrink-0 text-zinc-400">
                                {d.userName} · {d.hours !== undefined ? `${d.hours}h` : '0.5h'} · {d.isMove ? 'Move' : 'Queue'}
                              </span>
                            </div>
                            <div className="text-[10px] text-zinc-500">
                              [{d.method}] {d.reason}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {dialog.preview.skippedTasks.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-amber-400/90">
                      {dialog.preview.skippedTasks.length} task{dialog.preview.skippedTasks.length === 1 ? '' : 's'} will stay
                      in Available tasks:
                    </p>
                    <div className="max-h-24 overflow-y-auto rounded-lg border border-amber-500/20 bg-amber-500/5 divide-y divide-amber-500/10">
                      {dialog.preview.skippedTasks.map((t) => (
                        <div key={t.taskId} className="px-2.5 py-1.5 text-[11px]">
                          <span className="font-medium text-amber-300">{t.taskTitle}</span>
                          <span className="text-amber-400/80"> — {t.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
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
