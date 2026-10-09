"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  Loader2,
  RefreshCw,
  AlertTriangle,
  WifiOff,
  CheckCircle2,
  Plus,
  PencilLine,
  Users,
  ChevronDown,
} from "lucide-react";
import { clickUpApi, ClickUpMapping, ClickUpSyncSummary } from "@/api/clickup";

const POLL_MS = 2000;

function relTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ========================================================================= */
/* State                                                                      */
/* ========================================================================= */

export interface PullState {
  summary: ClickUpSyncSummary | null;
  running: boolean;
  starting: boolean;
  /** The watched run vanished before finishing: server restarted or crashed. */
  interrupted: boolean;
  offline: boolean;
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  /** full: re-read every task; nexusListIds: only these lists (default all mapped). */
  pull: (full?: boolean, nexusListIds?: string[]) => Promise<void>;
}

/**
 * Drives "Pull Latest": starts the server-side pull (which retries failed tasks
 * itself), polls its live progress, and flags a run that disappeared. Lives in
 * the always-mounted panel so the modal survives the dropdown closing.
 */
export function useClickUpPull(onFinished: () => void): PullState {
  const [summary, setSummary] = useState<ClickUpSyncSummary | null>(null);
  const [running, setRunning] = useState(false);
  /** startedAt of the run being watched; null when not watching. */
  const [watching, setWatching] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [offline, setOffline] = useState(false);
  const [starting, setStarting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  const poll = useCallback(async () => {
    try {
      const s = await clickUpApi.getSyncStatus();
      setOffline(false);
      setRunning(s.running);
      setSummary(s.summary);
      return s;
    } catch {
      setOffline(true);
      return null;
    }
  }, []);

  // Pick up a pull that is already running (another tab, or before a reload).
  useEffect(() => {
    let cancelled = false;
    clickUpApi
      .getSyncStatus()
      .then((s) => {
        if (cancelled) return;
        setRunning(s.running);
        setSummary(s.summary);
        if (s.running) setWatching(s.summary?.startedAt ?? "unknown");
      })
      .catch(() => {
        if (!cancelled) setOffline(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!watching) return;
    let cancelled = false;
    const id = setInterval(async () => {
      const s = await poll();
      if (cancelled || !s || s.running) return; // offline: keep checking
      const finished = s.summary?.startedAt === watching && !!s.summary?.finishedAt;
      setInterrupted(!finished);
      setWatching(null);
      onFinishedRef.current();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [watching, poll]);

  const pull = useCallback(
    async (full = false, nexusListIds?: string[]) => {
      setStarting(true);
      setInterrupted(false);
      setModalOpen(true);
      try {
        await clickUpApi.syncAll({ full, nexusListIds });
        const s = await poll();
        if (s?.running) setWatching(s.summary?.startedAt ?? "unknown");
      } catch {
        setOffline(true);
      } finally {
        setStarting(false);
      }
    },
    [poll]
  );

  return { summary, running, starting, interrupted, offline, modalOpen, setModalOpen, pull };
}

/* ========================================================================= */
/* Compact section inside the dropdown panel                                  */
/* ========================================================================= */

export function PullSection({ state }: { state: PullState }) {
  const { summary, running, starting, setModalOpen } = state;
  const busy = running || starting;
  const failed = summary?.errors.length ?? 0;
  const done = summary?.listResults.length ?? 0;
  const total = summary?.lists ?? 0;

  return (
    <div className="px-4 py-3 border-t border-zinc-800/60 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 text-[11px] text-zinc-400 truncate">
          {running && summary ? (
            <span className="text-zinc-200">
              Pulling {Math.min(done + 1, total)}/{total}
              {summary.currentList ? ` · ${summary.currentList}` : ""}
            </span>
          ) : summary?.finishedAt ? (
            <>Last pull {relTime(summary.finishedAt)}</>
          ) : (
            <>Changes from mapped lists</>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setModalOpen(true);
            }}
            className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {busy ? "Pulling…" : "Pull…"}
          </button>
        </div>
      </div>
      {!running && failed > 0 && (
        <div className="text-[10px] text-rose-400">{failed} failed on the last pull. Open progress for details.</div>
      )}
    </div>
  );
}

/* ========================================================================= */
/* Progress modal                                                             */
/* ========================================================================= */

export function PullModal({ state }: { state: PullState }) {
  const { summary, running, starting, interrupted, offline, modalOpen, setModalOpen, pull } = state;
  const busy = running || starting;
  const done = summary?.listResults.length ?? 0;
  const total = summary?.lists ?? 0;
  const failed = summary?.errors.length ?? 0;
  const feedRef = useRef<HTMLDivElement>(null);
  const activityCount = summary?.activity.length ?? 0;
  const [clients, setClients] = useState<ClickUpMapping[]>([]);
  /** Chosen clients (Nexus list IDs); empty = all clients. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Client choices come from the mapped lists.
  useEffect(() => {
    if (!modalOpen) return;
    let cancelled = false;
    clickUpApi
      .getMappings()
      .then((res) => {
        if (!cancelled) setClients([...res.mappings].sort((a, b) => a.nexusListName.localeCompare(b.nexusListName)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [modalOpen]);

  const scope = selected.size ? Array.from(selected) : undefined;
  const scopeLabel =
    selected.size === 0
      ? "all clients"
      : selected.size === 1
      ? clients.find((c) => selected.has(c.nexusListId))?.nexusListName ?? "1 client"
      : `${selected.size} clients`;
  const visibleClients = clients.filter((c) => c.nexusListName.toLowerCase().includes(search.trim().toLowerCase()));
  const toggleClient = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const startPull = (full: boolean) => {
    setPickerOpen(false);
    pull(full, scope);
  };

  // Keep the newest activity in view while the pull runs.
  useEffect(() => {
    if (running && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [activityCount, running]);

  return (
    <Dialog.Root open={modalOpen} onOpenChange={setModalOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[9999] backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[10000] w-[min(640px,calc(100vw-32px))] max-h-[85vh] flex flex-col bg-[#0f0f0f] border border-zinc-800/60 rounded-xl shadow-2xl outline-none"
          onPointerDownOutside={(e) => busy && e.preventDefault()}
        >
          {/* header */}
          <div className="px-5 py-4 border-b border-zinc-800/60 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                ) : interrupted || failed > 0 ? (
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                )}
                {busy
                  ? "Pulling from ClickUp"
                  : interrupted
                  ? "Pull stopped before finishing"
                  : failed > 0
                  ? "Pull finished with errors"
                  : summary?.finishedAt
                  ? "Pull complete"
                  : "ClickUp pull"}
              </Dialog.Title>
              <Dialog.Description className="text-[11px] text-zinc-400 mt-0.5 truncate">
                {busy && summary
                  ? `List ${Math.min(done + 1, total)} of ${total}${summary.currentList ? ` · ${summary.currentList}` : ""}`
                  : summary?.finishedAt
                  ? `Finished ${relTime(summary.finishedAt)} · ${summary.lists === 1 ? summary.listResults[0]?.name ?? "1 client" : `${summary.lists} clients`} · ${summary.full ? "Pull All" : "Pull Latest"}`
                  : "Pull Latest fetches only what changed. Pull All re-reads every task. Pick a client to go faster."}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer" title="Close (the pull keeps running)">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-5 py-4 space-y-3 overflow-y-auto">
            {/* one segment per list */}
            {summary && total > 0 && (
              <div className="flex gap-px h-2 rounded overflow-hidden">
                {Array.from({ length: total }, (_, i) => {
                  const r = summary.listResults[i];
                  const cls = r
                    ? r.failed > 0
                      ? "bg-rose-500"
                      : "bg-emerald-500"
                    : i === done && running
                    ? "bg-blue-500 animate-pulse"
                    : "bg-zinc-800";
                  return <span key={i} className={`flex-1 ${cls}`} />;
                })}
              </div>
            )}

            {/* totals */}
            {summary && (
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { label: "Added", value: summary.tasksCreated, cls: "text-emerald-400" },
                  { label: "Updated", value: summary.tasksUpdated, cls: "text-zinc-200" },
                  { label: "Subtasks", value: summary.subtasks, cls: "text-zinc-200" },
                  { label: "Failed", value: failed, cls: failed > 0 ? "text-rose-400" : "text-zinc-200" },
                ].map((s) => (
                  <div key={s.label} className="bg-[#18181b] border border-zinc-800/60 rounded-lg px-2.5 py-2">
                    <div className={`text-base font-semibold ${s.cls}`}>{s.value}</div>
                    <div className="text-[11px] text-zinc-400">{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            {offline && (
              <div className="flex items-start gap-1.5 text-[11px] text-amber-300 bg-amber-500/10 rounded-lg px-2.5 py-2">
                <WifiOff className="w-3.5 h-3.5 mt-px shrink-0" />
                Can&apos;t reach the Nexus server. Still checking…
              </div>
            )}
            {interrupted && !busy && (
              <div className="flex items-start gap-1.5 text-[11px] text-rose-300 bg-rose-500/10 rounded-lg px-2.5 py-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                The server restarted or crashed during the pull. Press Pull again. It continues from the
                changes, and nothing already pulled is duplicated.
              </div>
            )}
            {!busy && failed > 0 && !interrupted && (
              <div className="flex items-start gap-1.5 text-[11px] text-rose-300 bg-rose-500/10 rounded-lg px-2.5 py-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                {failed} task{failed !== 1 ? "s" : ""} still failed after 3 tries. Press Pull again. Lists with
                failures are re-checked automatically.
              </div>
            )}

            {/* live activity */}
            <div>
              <div className="text-[11px] font-semibold text-zinc-400 mb-1">Activity</div>
              <div
                ref={feedRef}
                className="h-48 overflow-y-auto bg-[#18181b] border border-zinc-800/60 rounded-lg divide-y divide-zinc-800/40"
              >
                {activityCount === 0 ? (
                  <div className="h-full flex items-center justify-center text-[11px] text-zinc-500">
                    {busy ? "Checking ClickUp for changes…" : "Nothing was added or updated."}
                  </div>
                ) : (
                  summary!.activity.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]">
                      {a.action === "added" ? (
                        <Plus className="w-3 h-3 shrink-0 text-emerald-400" />
                      ) : (
                        <PencilLine className="w-3 h-3 shrink-0 text-zinc-500" />
                      )}
                      <span className="truncate text-zinc-200">
                        {a.kind === "subtask" && <span className="text-zinc-500">└ </span>}
                        {a.title}
                      </span>
                      <span className="ml-auto shrink-0 text-zinc-500 truncate max-w-[40%]">{a.list}</span>
                      <span className="shrink-0 text-zinc-600 tabular-nums">{clock(a.at)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* per list */}
            {summary && summary.listResults.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-zinc-400 mb-1">Lists</div>
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {summary.listResults.map((r) => (
                    <div key={r.name} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-zinc-400">{r.name}</span>
                      <span className="shrink-0 text-zinc-500">
                        {r.checked === 0 ? (
                          "no changes"
                        ) : (
                          <>
                            {r.checked} changed · +{r.created} · {r.updated} upd
                          </>
                        )}
                        {r.retried > 0 && <span className="text-amber-300"> · {r.retried} retried</span>}
                        {r.failed > 0 && <span className="text-rose-400"> · {r.failed} failed</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary && failed > 0 && (
              <div className="space-y-0.5">
                <div className="text-[11px] font-semibold text-zinc-400">Errors</div>
                {summary.errors.slice(0, 20).map((err, i) => (
                  <div key={i} className="text-[11px] text-rose-400/80 truncate" title={err}>
                    {err}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* client picker (multi-select) */}
          {pickerOpen && !busy && (
            <div className="px-5 pt-3 border-t border-zinc-800/60 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search clients…"
                  className="flex-1 min-w-0 bg-[#18181b] border border-zinc-800 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/20"
                />
                <button
                  onClick={() => setSelected(new Set(visibleClients.map((c) => c.nexusListId)))}
                  className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  All
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  None
                </button>
              </div>
              <div className="max-h-44 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5">
                {visibleClients.map((c) => (
                  <label
                    key={c.nexusListId}
                    className="flex items-center gap-2 px-1.5 py-1 rounded-md text-[11px] text-zinc-200 hover:bg-zinc-800/60 cursor-pointer min-w-0"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.nexusListId)}
                      onChange={() => toggleClient(c.nexusListId)}
                      className="accent-blue-600 shrink-0"
                    />
                    <span className="truncate">{c.nexusListName}</span>
                  </label>
                ))}
                {visibleClients.length === 0 && <div className="text-[11px] text-zinc-500 px-1.5 py-1">No matching clients.</div>}
              </div>
              <p className="text-[11px] text-zinc-500">
                {selected.size === 0 ? "None ticked: every client is pulled." : `${selected.size} selected.`}
              </p>
            </div>
          )}

          {/* footer: scope + mode */}
          <div className="px-5 py-3 border-t border-zinc-800/60 flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={() => setPickerOpen((v) => !v)}
              disabled={busy}
              className="flex items-center gap-1.5 min-w-0 max-w-full sm:max-w-[260px] bg-[#18181b] border border-zinc-800 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 hover:border-zinc-700 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
              title="Choose which clients to pull"
            >
              <Users className="w-3 h-3 shrink-0 text-zinc-400" />
              <span className="truncate">
                {selected.size === 0 ? `All clients (${clients.length})` : scopeLabel}
              </span>
              <ChevronDown className={`w-3 h-3 shrink-0 text-zinc-400 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
            </button>
            <div className="flex items-center gap-2 ml-auto">
              <Dialog.Close asChild>
                <button className="px-3 py-1.5 rounded-lg text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer">
                  {busy ? "Hide (keeps running)" : "Close"}
                </button>
              </Dialog.Close>
              <button
                onClick={() => startPull(true)}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
                title={`Re-read every task for ${scopeLabel}. Slower; use it if something looks missing.`}
              >
                Pull All
              </button>
              <button
                onClick={() => startPull(false)}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
                title={`Only tasks changed in ClickUp since the last pull, for ${scopeLabel}`}
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {busy ? "Pulling…" : interrupted || failed > 0 ? "Pull again" : "Pull Latest"}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
