"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Link2,
  Clock,
  ChevronDown,
  Settings,
  ExternalLink,
  ArrowRight,
  Loader2,
  Unlink2,
} from "lucide-react";
import { clickUpApi, ClickUpMapping } from "@/api/clickup";

/* ---- small status dot --------------------------------------------------- */
function Dot({ ok }: { ok: boolean | null }) {
  if (ok === null)
    return (
      <span className="w-2 h-2 rounded-full bg-zinc-600 inline-block" />
    );
  return ok ? (
    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
  ) : (
    <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
  );
}

/* ---- relative time helper ----------------------------------------------- */
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ---- status colour pill -------------------------------------------------- */
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/20 text-amber-300",
  "in progress": "bg-blue-500/20 text-blue-300",
  revision: "bg-rose-500/20 text-rose-300",
  closed: "bg-emerald-500/20 text-emerald-300",
  "on-hold": "bg-zinc-500/20 text-zinc-300",
  "in review": "bg-purple-500/20 text-purple-300",
  checking: "bg-teal-500/20 text-teal-300",
  waiting: "bg-orange-500/20 text-orange-300",
};
function statusPill(status: string) {
  const cls =
    STATUS_COLORS[status.toLowerCase()] ?? "bg-indigo-500/20 text-indigo-300";
  return (
    <span
      className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${cls}`}
    >
      {status}
    </span>
  );
}

/* ========================================================================= */
export function ClickUpStatusPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"activity" | "mappings">("activity");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [cuUser, setCuUser] = useState<any>(null);
  const [mappings, setMappings] = useState<ClickUpMapping[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  /* ---------- outside click ---------- */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* ---------- connectivity check on mount ---------- */
  useEffect(() => {
    (async () => {
      try {
        const result = await clickUpApi.getStatus();
        setConnected(result.ok);
        if (result.ok) setCuUser(result.user);
      } catch {
        setConnected(false);
      }
    })();
  }, []);

  /* ---------- fetch panel data when opened ---------- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [mappingsRes, activityRes] = await Promise.allSettled([
        clickUpApi.getMappings(),
        clickUpApi.getRecentActivity(15),
      ]);
      if (mappingsRes.status === "fulfilled") setMappings(mappingsRes.value.mappings);
      if (activityRes.status === "fulfilled") setActivity(activityRes.value.tasks);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchData();
  }, [open, fetchData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  /* ======================================================================= */
  return (
    <div className="relative" ref={panelRef}>
      {/* ---- trigger button ---- */}
      <button
        id="clickup-status-panel-trigger"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer
          ${
            connected === true
              ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300 hover:bg-emerald-900/50"
              : connected === false
              ? "bg-rose-950/30 border-rose-800/40 text-rose-300 hover:bg-rose-900/40"
              : "bg-zinc-900/60 border-zinc-800/60 text-zinc-400 hover:bg-zinc-800"
          }`}
        title="ClickUp Sync Status"
      >
        {/* ClickUp icon (simplified "C" logo feel) */}
        <span className="flex items-center justify-center w-4 h-4 rounded bg-[#7B68EE]/20 shrink-0">
          <Zap className="w-2.5 h-2.5 text-[#7B68EE]" />
        </span>
        <span className="hidden sm:inline">ClickUp</span>
        <Dot ok={connected} />
        <motion.div animate={{ rotate: open ? -180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="w-3 h-3 opacity-60" />
        </motion.div>
      </button>

      {/* ---- panel ---- */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 mt-2 w-[340px] bg-[#111113] border border-zinc-800/80 rounded-xl shadow-2xl z-[200] overflow-hidden"
            id="clickup-status-panel"
          >
            {/* header */}
            <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between bg-zinc-950/60">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#7B68EE]/15 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-[#7B68EE]" />
                </div>
                <div>
                  <div className="text-xs font-bold text-zinc-100">ClickUp Sync</div>
                  <div className="text-[10px] text-zinc-500">
                    {connected === true
                      ? `Connected as ${cuUser?.username || cuUser?.email || "user"}`
                      : connected === false
                      ? "Not connected — check API key"
                      : "Checking…"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {connected === true ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : connected === false ? (
                  <XCircle className="w-4 h-4 text-rose-400" />
                ) : (
                  <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />
                )}
                <button
                  onClick={handleRefresh}
                  className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                  title="Refresh"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* tabs */}
            <div className="flex border-b border-zinc-800/60">
              {(["activity", "mappings"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-2 text-[11px] font-semibold capitalize transition-colors cursor-pointer
                    ${
                      tab === t
                        ? "text-[#7B68EE] border-b-2 border-[#7B68EE] bg-[#7B68EE]/5"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                >
                  {t === "activity" ? "Recent Synced" : "List Mappings"}
                </button>
              ))}
            </div>

            {/* content */}
            <div className="overflow-y-auto max-h-[340px]">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-zinc-500">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : tab === "activity" ? (
                <ActivityTab tasks={activity} />
              ) : (
                <MappingsTab mappings={mappings} onRefresh={fetchData} />
              )}
            </div>

            {/* footer */}
            <div className="px-4 py-2.5 border-t border-zinc-800/60 bg-zinc-950/40 flex items-center justify-between">
              <span className="text-[10px] text-zinc-600">
                {mappings.length} list{mappings.length !== 1 ? "s" : ""} mapped
              </span>
              <a
                href="https://app.clickup.com"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[10px] text-[#7B68EE] hover:text-[#9b8cf0] transition-colors"
              >
                Open ClickUp <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---- Activity Tab -------------------------------------------------------- */
function ActivityTab({ tasks }: { tasks: any[] }) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-zinc-600 gap-2">
        <Link2 className="w-6 h-6" />
        <p className="text-xs">No synced tasks yet</p>
        <p className="text-[10px] text-zinc-700">
          Map a Nexus list to a ClickUp list to start syncing
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-800/40">
      {tasks.map((task) => {
        // Normalise externalId — may be a full URL or bare task ID
        const externalId: string | null = task.externalId ?? null;
        const isUrl = externalId?.startsWith("http") ?? false;
        const taskLink = isUrl
          ? externalId
          : externalId
          ? `https://app.clickup.com/t/${externalId}`
          : null;
        const shortId = externalId
          ? (isUrl ? externalId.split("/").pop() : externalId)?.slice(-6)
          : null;

        return (
          <li key={task.id} className="px-4 py-2.5 hover:bg-zinc-900/40 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-zinc-200 truncate leading-tight">
                  {task.title}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-[10px] text-zinc-500 truncate">
                    {task.list?.name}
                  </span>
                  {statusPill(task.status)}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <div className="flex items-center gap-1 text-[9px] text-zinc-600">
                  <Clock className="w-2.5 h-2.5" />
                  {relTime(task.updatedAt)}
                </div>
                {taskLink && (
                  <a
                    href={taskLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[9px] text-[#7B68EE] hover:text-[#9b8cf0] flex items-center gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    CU-{shortId} <ArrowRight className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---- Mappings Tab -------------------------------------------------------- */
function MappingsTab({
  mappings,
  onRefresh,
}: {
  mappings: ClickUpMapping[];
  onRefresh: () => void;
}) {
  const [removing, setRemoving] = useState<string | null>(null);

  const handleRemove = async (nexusListId: string) => {
    setRemoving(nexusListId);
    try {
      await clickUpApi.deleteMapping(nexusListId);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setRemoving(null);
    }
  };

  if (mappings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-zinc-600 gap-2">
        <Settings className="w-6 h-6" />
        <p className="text-xs">No list mappings configured</p>
        <p className="text-[10px] text-zinc-700 text-center px-4">
          Use the mapping API or the admin settings to link Nexus lists to ClickUp lists.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-800/40">
      {mappings.map((m) => (
        <li key={m.nexusListId} className="px-4 py-2.5 hover:bg-zinc-900/40 transition-colors">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-zinc-200 truncate">
                {m.nexusListName}
              </div>
              <div className="flex items-center gap-1 mt-0.5 text-[10px] text-zinc-500">
                <Link2 className="w-2.5 h-2.5 text-[#7B68EE]" />
                <span className="font-mono">ClickUp #{m.clickUpListId}</span>
              </div>
              {(m.space || m.folder) && (
                <div className="text-[9px] text-zinc-600 mt-0.5 truncate">
                  {[m.space?.name, m.folder?.name].filter(Boolean).join(" › ")}
                </div>
              )}
            </div>
            <button
              onClick={() => handleRemove(m.nexusListId)}
              disabled={removing === m.nexusListId}
              className="p-1 rounded hover:bg-rose-900/30 text-zinc-600 hover:text-rose-400 transition-colors cursor-pointer"
              title="Remove mapping"
            >
              {removing === m.nexusListId ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Unlink2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
