"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Link2,
  Clock,
  Unlink2,
  Settings,
  ExternalLink,
  ArrowRight,
  Loader2,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  List,
  Globe,
  Plus,
  Wifi,
  WifiOff,
  Activity,
} from "lucide-react";
import { clickUpApi, ClickUpMapping } from "@/api/clickup";

/* ========================================================================= */
/* Helpers                                                                    */
/* ========================================================================= */

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/20",
  "in progress": "bg-blue-500/15 text-blue-300 border-blue-500/20",
  revision: "bg-rose-500/15 text-rose-300 border-rose-500/20",
  closed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
  "on-hold": "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  "in review": "bg-purple-500/15 text-purple-300 border-purple-500/20",
  checking: "bg-teal-500/15 text-teal-300 border-teal-500/20",
  waiting: "bg-orange-500/15 text-orange-300 border-orange-500/20",
};
function statusPill(status: string) {
  const cls =
    STATUS_COLORS[status.toLowerCase()] ??
    "bg-indigo-500/15 text-indigo-300 border-indigo-500/20";
  return (
    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${cls}`}>
      {status}
    </span>
  );
}

/* ========================================================================= */
/* Main Page                                                                  */
/* ========================================================================= */

export default function ClickUpPage() {
  const [tab, setTab] = useState<"status" | "activity" | "mappings" | "browser">("status");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [cuUser, setCuUser] = useState<any>(null);
  const [mappings, setMappings] = useState<ClickUpMapping[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [statusRes, mappingsRes, activityRes] = await Promise.allSettled([
        clickUpApi.getStatus(),
        clickUpApi.getMappings(),
        clickUpApi.getRecentActivity(30),
      ]);
      if (statusRes.status === "fulfilled") {
        setConnected(statusRes.value.ok);
        if (statusRes.value.ok) setCuUser(statusRes.value.user);
      } else {
        setConnected(false);
      }
      if (mappingsRes.status === "fulfilled") setMappings(mappingsRes.value.mappings);
      if (activityRes.status === "fulfilled") setActivity(activityRes.value.tasks);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const TABS = [
    { id: "status", label: "Connection", icon: Wifi },
    { id: "activity", label: "Synced Tasks", icon: Activity },
    { id: "mappings", label: "List Mappings", icon: Link2 },
    { id: "browser", label: "Browse ClickUp", icon: Globe },
  ] as const;

  return (
    <div className="min-h-screen bg-background text-zinc-100 p-6">
      {/* ---- Page Header ---- */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#7B68EE]/15 border border-[#7B68EE]/20 flex items-center justify-center">
            <Zap className="w-6 h-6 text-[#7B68EE]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-100">ClickUp Integration</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              Manage sync between Nexus tasks and ClickUp
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Live connection badge */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${
            connected === true
              ? "bg-emerald-950/40 border-emerald-800/40 text-emerald-300"
              : connected === false
              ? "bg-rose-950/30 border-rose-800/30 text-rose-300"
              : "bg-secondary border-zinc-800 text-zinc-500"
          }`}>
            {connected === true ? (
              <><CheckCircle2 className="w-3.5 h-3.5" /> Connected as {cuUser?.username || "user"}</>
            ) : connected === false ? (
              <><XCircle className="w-3.5 h-3.5" /> Not connected</>
            ) : (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…</>
            )}
          </div>

          <button
            onClick={fetchAll}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary border border-zinc-800 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>

          <a
            href="https://app.clickup.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#7B68EE]/10 border border-[#7B68EE]/20 text-xs text-[#7B68EE] hover:bg-[#7B68EE]/20 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open ClickUp
          </a>
        </div>
      </div>

      {/* ---- Stats Row ---- */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "Lists Mapped", value: mappings.length, icon: Link2, color: "text-[#7B68EE]", bg: "bg-[#7B68EE]/10" },
          { label: "Synced Tasks", value: activity.length, icon: Zap, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "API Status", value: connected === true ? "Online" : connected === false ? "Offline" : "—", icon: connected === true ? Wifi : WifiOff, color: connected === true ? "text-emerald-400" : "text-rose-400", bg: connected === true ? "bg-emerald-500/10" : "bg-rose-500/10" },
        ].map((stat) => (
          <div key={stat.label} className="bg-card border border-zinc-800/60 rounded-xl p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center shrink-0`}>
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>
            <div>
              <div className="text-xl font-bold text-zinc-100">{loading ? "—" : stat.value}</div>
              <div className="text-xs text-zinc-500">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ---- Tabs ---- */}
      <div className="flex gap-1 mb-6 bg-card border border-zinc-800/60 rounded-xl p-1 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              tab === id
                ? "bg-[#7B68EE] text-white shadow-lg shadow-[#7B68EE]/20"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ---- Tab Content ---- */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {tab === "status" && <StatusTab connected={connected} cuUser={cuUser} loading={loading} />}
          {tab === "activity" && <ActivityTab tasks={activity} loading={loading} />}
          {tab === "mappings" && <MappingsTab mappings={mappings} onRefresh={fetchAll} />}
          {tab === "browser" && <BrowserTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ========================================================================= */
/* Status Tab                                                                 */
/* ========================================================================= */

function StatusTab({ connected, cuUser, loading }: { connected: boolean | null; cuUser: any; loading: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Connection card */}
      <div className="bg-card border border-zinc-800/60 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 bg-[#7B68EE] rounded-full" />
          <h2 className="text-sm font-bold text-zinc-200">Connection Details</h2>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-zinc-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Checking…</div>
        ) : connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-emerald-950/30 border border-emerald-800/30 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <div className="text-xs font-bold text-emerald-300">API Connected</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">ClickUp v2 API is reachable and authenticated</div>
              </div>
            </div>
            {cuUser && (
              <div className="space-y-2 text-xs">
                {[
                  ["Username", cuUser.username],
                  ["Email", cuUser.email],
                  ["Timezone", cuUser.timezone],
                  ["User ID", cuUser.id],
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between items-center py-1.5 border-b border-zinc-800/40">
                    <span className="text-zinc-500">{label}</span>
                    <span className="text-zinc-300 font-mono text-[11px]">{val ?? "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 p-3 bg-rose-950/30 border border-rose-800/30 rounded-lg">
            <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <div className="text-xs font-bold text-rose-300">Not Connected</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">Check that <code className="bg-secondary px-1 rounded">Clickup_API_KEY</code> is set in server/.env</div>
            </div>
          </div>
        )}
      </div>

      {/* How sync works */}
      <div className="bg-card border border-zinc-800/60 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 bg-[#7B68EE] rounded-full" />
          <h2 className="text-sm font-bold text-zinc-200">How Sync Works</h2>
        </div>
        <div className="space-y-3">
          {[
            { icon: Plus, label: "Task Created", desc: "If the Nexus list is mapped → creates a matching task in ClickUp and stores the ClickUp task ID." },
            { icon: RefreshCw, label: "Task Updated", desc: "Title, status, priority, or dates changed → pushes updates to the linked ClickUp task." },
            { icon: Zap, label: "Status Moved", desc: "Drag-to-move or status change → syncs status to ClickUp instantly." },
            { icon: Activity, label: "Comment Added", desc: "Top-level comments mirror to ClickUp with the author's name as prefix." },
          ].map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex gap-3">
              <div className="w-7 h-7 rounded-lg bg-[#7B68EE]/10 flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="w-3.5 h-3.5 text-[#7B68EE]" />
              </div>
              <div>
                <div className="text-xs font-semibold text-zinc-300">{label}</div>
                <div className="text-[11px] text-zinc-500 leading-relaxed">{desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 p-3 bg-secondary rounded-lg border border-zinc-800/60 text-[11px] text-zinc-500 leading-relaxed">
          All ClickUp calls are <span className="text-zinc-300 font-semibold">fire-and-forget</span> — they never delay Nexus API responses. A ClickUp outage does not affect Nexus users.
        </div>
      </div>
    </div>
  );
}

/* ========================================================================= */
/* Activity Tab                                                               */
/* ========================================================================= */

function ActivityTab({ tasks, loading }: { tasks: any[]; loading: boolean }) {
  if (loading) return <div className="flex items-center gap-2 text-zinc-500 py-10"><Loader2 className="w-5 h-5 animate-spin" /> Loading…</div>;

  if (tasks.length === 0) {
    return (
      <div className="bg-card border border-zinc-800/60 rounded-xl flex flex-col items-center justify-center py-20 text-center">
        <Link2 className="w-10 h-10 text-zinc-700 mb-3" />
        <p className="text-sm font-semibold text-zinc-500">No synced tasks yet</p>
        <p className="text-xs text-zinc-600 mt-1">Map a Nexus list to a ClickUp list to start syncing tasks.</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-zinc-800/60 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-800/60 flex items-center justify-between">
        <span className="text-sm font-bold text-zinc-200">Recently Synced Tasks</span>
        <span className="text-xs text-zinc-500">{tasks.length} tasks</span>
      </div>
      <div className="divide-y divide-zinc-800/40">
        {tasks.map((task) => {
          const externalId: string | null = task.externalId ?? null;
          const isUrl = externalId?.startsWith("http") ?? false;
          const taskLink = isUrl ? externalId : externalId ? `https://app.clickup.com/t/${externalId}` : null;
          const shortId = externalId ? (isUrl ? externalId.split("/").pop() : externalId)?.slice(-8) : null;

          return (
            <div key={task.id} className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-secondary/40 transition-colors group">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200 truncate">{task.title}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] text-zinc-500">{task.list?.name}</span>
                  <span className="text-zinc-700">·</span>
                  {statusPill(task.status)}
                  {task.priority && (
                    <span className="text-[10px] text-zinc-600 font-mono">{task.priority}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-1 text-[11px] text-zinc-600">
                  <Clock className="w-3 h-3" />
                  {relTime(task.updatedAt)}
                </div>
                {taskLink && (
                  <a
                    href={taskLink}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] text-[#7B68EE] hover:text-[#9b8cf0] transition-colors opacity-0 group-hover:opacity-100"
                  >
                    {shortId} <ArrowRight className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ========================================================================= */
/* Mappings Tab                                                               */
/* ========================================================================= */

function MappingsTab({ mappings, onRefresh }: { mappings: ClickUpMapping[]; onRefresh: () => void }) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [nexusListId, setNexusListId] = useState("");
  const [clickUpListId, setClickUpListId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleRemove = async (id: string) => {
    setRemoving(id);
    try { await clickUpApi.deleteMapping(id); onRefresh(); }
    catch (err: any) { console.error(err); }
    finally { setRemoving(null); }
  };

  const handleSave = async () => {
    if (!nexusListId.trim() || !clickUpListId.trim()) { setSaveError("Both IDs are required."); return; }
    setSaving(true); setSaveError(null);
    try {
      await clickUpApi.createMapping(nexusListId.trim(), clickUpListId.trim());
      setNexusListId(""); setClickUpListId(""); setShowAdd(false);
      onRefresh();
    } catch (err: any) { setSaveError(err.message ?? "Failed to save mapping."); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      {/* Add mapping */}
      <div className="bg-card border border-zinc-800/60 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowAdd(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-semibold text-zinc-200 hover:bg-secondary/50 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2"><Plus className="w-4 h-4 text-[#7B68EE]" /> Add List Mapping</span>
          <motion.div animate={{ rotate: showAdd ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-4 h-4 text-zinc-500" />
          </motion.div>
        </button>
        <AnimatePresence>
          {showAdd && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-t border-zinc-800/60"
            >
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-zinc-400 block mb-1.5">Nexus List ID</label>
                    <input
                      type="text"
                      value={nexusListId}
                      onChange={e => setNexusListId(e.target.value)}
                      placeholder="e.g. 88673873-cd72-426f-..."
                      className="w-full bg-secondary border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-[#7B68EE]/50 font-mono"
                    />
                    <p className="text-[10px] text-zinc-600 mt-1">Copy from the Nexus list URL or DB</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-zinc-400 block mb-1.5">ClickUp List ID</label>
                    <input
                      type="text"
                      value={clickUpListId}
                      onChange={e => setClickUpListId(e.target.value)}
                      placeholder="e.g. 901234567"
                      className="w-full bg-secondary border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-[#7B68EE]/50 font-mono"
                    />
                    <p className="text-[10px] text-zinc-600 mt-1">Use the Browse tab to find list IDs →</p>
                  </div>
                </div>
                {saveError && <p className="text-xs text-rose-400">{saveError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#7B68EE] hover:bg-[#6a5ad6] text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Save Mapping
                  </button>
                  <button
                    onClick={() => setShowAdd(false)}
                    className="px-4 py-2 bg-secondary border border-zinc-800 text-zinc-400 rounded-lg text-xs font-semibold hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mappings list */}
      {mappings.length === 0 ? (
        <div className="bg-card border border-zinc-800/60 rounded-xl flex flex-col items-center justify-center py-16 text-center">
          <Settings className="w-10 h-10 text-zinc-700 mb-3" />
          <p className="text-sm font-semibold text-zinc-500">No mappings yet</p>
          <p className="text-xs text-zinc-600 mt-1">Add a mapping above to start syncing tasks between Nexus and ClickUp.</p>
        </div>
      ) : (
        <div className="bg-card border border-zinc-800/60 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-800/60">
            <span className="text-sm font-bold text-zinc-200">{mappings.length} Active Mapping{mappings.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="divide-y divide-zinc-800/40">
            {mappings.map((m) => (
              <div key={m.nexusListId} className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-secondary/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <List className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span className="text-sm font-semibold text-zinc-200 truncate">{m.nexusListName}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 ml-5">
                    <ArrowRight className="w-3 h-3 text-[#7B68EE]" />
                    <span className="text-[11px] font-mono text-[#7B68EE]">ClickUp #{m.clickUpListId}</span>
                    {(m.space || m.folder) && (
                      <span className="text-[10px] text-zinc-600">
                        — {[m.space?.name, m.folder?.name].filter(Boolean).join(" › ")}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-700 font-mono ml-5 mt-0.5">{m.nexusListId}</div>
                </div>
                <button
                  onClick={() => handleRemove(m.nexusListId)}
                  disabled={removing === m.nexusListId}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/30 hover:bg-rose-900/50 border border-rose-900/30 text-rose-400 text-xs font-semibold transition-colors cursor-pointer"
                >
                  {removing === m.nexusListId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink2 className="w-3.5 h-3.5" />}
                  Unlink
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================================================================= */
/* Browser Tab — explore ClickUp workspace hierarchy                          */
/* ========================================================================= */

function BrowserTab() {
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, any[]>>({});
  const [expanding, setExpanding] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    clickUpApi.getWorkspaces().then(r => setWorkspaces(r.teams ?? [])).finally(() => setLoading(false));
  }, []);

  const toggle = async (type: "workspace" | "space" | "folder", id: string) => {
    if (expanded[id]) { setExpanded(prev => { const n = { ...prev }; delete n[id]; return n; }); return; }
    setExpanding(id);
    try {
      let items: any[] = [];
      if (type === "workspace") {
        const r = await clickUpApi.getSpaces(id);
        items = (r.spaces ?? []).map((s: any) => ({ ...s, _type: "space", _parentId: id }));
      } else if (type === "space") {
        const [foldersRes, listsRes] = await Promise.allSettled([
          clickUpApi.getFolders(id),
          clickUpApi.getFolderlessLists(id),
        ]);
        const folders = foldersRes.status === "fulfilled" ? (foldersRes.value.folders ?? []).map((f: any) => ({ ...f, _type: "folder", _parentId: id })) : [];
        const lists = listsRes.status === "fulfilled" ? (listsRes.value.lists ?? []).map((l: any) => ({ ...l, _type: "list", _parentId: id })) : [];
        items = [...folders, ...lists];
      } else if (type === "folder") {
        const r = await clickUpApi.getFolderLists(id);
        items = (r.lists ?? []).map((l: any) => ({ ...l, _type: "list", _parentId: id }));
      }
      setExpanded(prev => ({ ...prev, [id]: items }));
    } catch (err) { console.error(err); }
    finally { setExpanding(null); }
  };

  const copyId = (id: string) => { navigator.clipboard.writeText(id); };

  const renderItem = (item: any, depth = 0): React.ReactNode => {
    const isExpanded = !!expanded[item.id];
    const isExpanding = expanding === item.id;
    const hasChildren = item._type !== "list";
    const paddingLeft = depth * 16 + 16;

    const iconMap: Record<string, React.ReactNode> = {
      workspace: <Globe className="w-3.5 h-3.5 text-[#7B68EE]" />,
      space: <FolderOpen className="w-3.5 h-3.5 text-amber-400" />,
      folder: <FolderOpen className="w-3.5 h-3.5 text-blue-400" />,
      list: <List className="w-3.5 h-3.5 text-emerald-400" />,
    };

    return (
      <div key={item.id}>
        <div
          className="flex items-center gap-2 py-2 px-4 hover:bg-secondary/50 transition-colors group cursor-pointer"
          style={{ paddingLeft }}
          onClick={() => hasChildren && toggle(item._type, item.id)}
        >
          {hasChildren ? (
            isExpanding ? (
              <Loader2 className="w-3 h-3 text-zinc-500 animate-spin shrink-0" />
            ) : (
              <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
                <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />
              </motion.div>
            )
          ) : (
            <span className="w-3 shrink-0" />
          )}
          {iconMap[item._type]}
          <span className="text-xs text-zinc-300 flex-1 truncate">{item.name}</span>
          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {item._type === "list" && (
              <span className="text-[10px] text-zinc-600 font-mono">{item.task_count ?? 0} tasks</span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); copyId(item.id); }}
              className="text-[10px] font-mono text-zinc-600 hover:text-[#7B68EE] px-1.5 py-0.5 rounded bg-secondary border border-zinc-800 transition-colors"
              title="Copy ID"
            >
              {item.id}
            </button>
          </div>
        </div>
        {isExpanded && expanded[item.id].map((child: any) => renderItem(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="bg-card border border-zinc-800/60 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-800/60 flex items-center justify-between">
        <span className="text-sm font-bold text-zinc-200">ClickUp Workspace Browser</span>
        <span className="text-[11px] text-zinc-500">Click an ID to copy it for mapping</span>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 py-10 px-5 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading workspaces…</div>
      ) : (
        <div className="py-1">
          {workspaces.map(ws => renderItem({ ...ws, _type: "workspace" }))}
        </div>
      )}
    </div>
  );
}
