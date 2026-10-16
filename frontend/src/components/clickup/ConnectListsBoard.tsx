"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AlertTriangle, GripVertical, Link2, Loader2, RefreshCw, Search, Unlink2, X } from "lucide-react";
import { clickUpApi, MappingBoardClickUpList, MappingBoardNexusList } from "@/api/clickup";

/** Lower-case and drop punctuation so "Espinosa |" and "espinosa" compare equal. */
function norm(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Names that share no word longer than 3 letters are probably different clients. */
function namesDiffer(a: string, b: string): boolean {
  const words = new Set(norm(a).split(" ").filter((w) => w.length > 3));
  return !norm(b).split(" ").some((w) => w.length > 3 && words.has(w));
}

function groupBy<T>(items: T[], key: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

interface PendingDrop {
  cu: MappingBoardClickUpList;
  target: MappingBoardNexusList;
  /** Nexus list that holds this ClickUp list now, if any. */
  holder: MappingBoardNexusList | null;
}

export function ConnectListsBoard() {
  const [clickUpLists, setClickUpLists] = useState<MappingBoardClickUpList[]>([]);
  const [nexusLists, setNexusLists] = useState<MappingBoardNexusList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const [dragging, setDragging] = useState<MappingBoardClickUpList | null>(null);
  const [pending, setPending] = useState<PendingDrop | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const board = await clickUpApi.getMappingBoard();
      setClickUpLists(board.clickUpLists);
      setNexusLists(board.nexusLists);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load lists.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const cuById = useMemo(() => new Map(clickUpLists.map((l) => [l.id, l])), [clickUpLists]);
  const holderByCu = useMemo(
    () => new Map(nexusLists.filter((l) => l.clickUpListId).map((l) => [l.clickUpListId!, l])),
    [nexusLists]
  );

  const q = norm(query);
  const shownClickUp = clickUpLists.filter(
    (l) => (!q || norm(l.name).includes(q) || l.id.includes(q)) && (!unmappedOnly || !holderByCu.has(l.id))
  );
  const shownNexus = nexusLists.filter(
    (l) =>
      (!q || norm(l.name).includes(q) || (l.clickUpListId ?? "").includes(q)) && (!unmappedOnly || !l.clickUpListId)
  );

  const connect = async ({ cu, target, holder }: PendingDrop) => {
    setPending(null);
    setBusy(target.id);
    setError(null);
    try {
      await clickUpApi.createMapping(target.id, cu.id, !!holder);
      setNexusLists((prev) =>
        prev.map((l) =>
          l.id === target.id ? { ...l, clickUpListId: cu.id } : l.id === holder?.id ? { ...l, clickUpListId: null } : l
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect lists.");
    } finally {
      setBusy(null);
    }
  };

  const unlink = async (list: MappingBoardNexusList) => {
    if (confirmUnlink !== list.id) {
      setConfirmUnlink(list.id);
      return;
    }
    setConfirmUnlink(null);
    setBusy(list.id);
    setError(null);
    try {
      await clickUpApi.deleteMapping(list.id);
      setNexusLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, clickUpListId: null } : l)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlink.");
    } finally {
      setBusy(null);
    }
  };

  const onDragStart = (e: DragStartEvent) => setDragging(cuById.get(String(e.active.id)) ?? null);

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const cu = cuById.get(String(e.active.id));
    const target = nexusLists.find((l) => l.id === e.over?.id);
    if (!cu || !target || target.clickUpListId === cu.id) return;
    const holder = holderByCu.get(cu.id) ?? null;
    const drop = { cu, target, holder };
    // Anything that would undo an existing connection or pair different names gets a second look.
    if (holder || target.clickUpListId || namesDiffer(cu.name, target.name)) setPending(drop);
    else connect(drop);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 py-10 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading ClickUp and Nexus lists…
      </div>
    );
  }

  const connectedCount = nexusLists.filter((l) => l.clickUpListId).length;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by list name or ClickUp ID"
              className="w-full bg-secondary border border-zinc-800 rounded-lg pl-8 pr-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-[#7B68EE]/50"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
            <input type="checkbox" checked={unmappedOnly} onChange={(e) => setUnmappedOnly(e.target.checked)} />
            Unconnected only
          </label>
          <span className="text-xs text-zinc-500">
            {connectedCount} of {nexusLists.length} Nexus lists connected
          </span>
          <button
            onClick={load}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary border border-zinc-800 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reload
          </button>
        </div>

        <p className="text-[11px] text-zinc-500">
          Drag a ClickUp list onto the Nexus list it belongs to. The connection is stored by ClickUp list ID, so
          renaming either side never breaks it. Pulls and Galaxy tasks follow this connection.
        </p>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-950/30 border border-rose-800/30 text-xs text-rose-300">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {pending && (
          <ConfirmDrop pending={pending} onConfirm={() => connect(pending)} onCancel={() => setPending(null)} cuById={cuById} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* ClickUp side */}
          <section className="bg-card border border-zinc-800/60 rounded-xl overflow-hidden">
            <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
              <span className="text-sm font-bold text-zinc-200">ClickUp lists</span>
              <span className="text-[11px] text-zinc-500">{shownClickUp.length} shown</span>
            </header>
            <div className="max-h-[65vh] overflow-y-auto">
              {groupBy(shownClickUp, (l) => [l.space, l.folder ?? "(no folder)"].join(" › ")).map(([group, items]) => (
                <div key={group}>
                  <div className="sticky top-0 z-10 px-4 py-1.5 bg-secondary/95 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    {group}
                  </div>
                  <div className="p-2 space-y-1">
                    {items.map((l) => (
                      <ClickUpChip key={l.id} list={l} holder={holderByCu.get(l.id) ?? null} />
                    ))}
                  </div>
                </div>
              ))}
              {shownClickUp.length === 0 && <p className="px-4 py-6 text-xs text-zinc-600">No ClickUp lists match.</p>}
            </div>
          </section>

          {/* Nexus side */}
          <section className="bg-card border border-zinc-800/60 rounded-xl overflow-hidden">
            <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
              <span className="text-sm font-bold text-zinc-200">Nexus lists</span>
              <span className="text-[11px] text-zinc-500">{shownNexus.length} shown</span>
            </header>
            <div className="max-h-[65vh] overflow-y-auto">
              {groupBy(shownNexus, (l) => [l.space ?? "(no space)", l.folder ?? "(no folder)"].join(" › ")).map(
                ([group, items]) => (
                  <div key={group}>
                    <div className="sticky top-0 z-10 px-4 py-1.5 bg-secondary/95 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                      {group}
                    </div>
                    <div className="p-2 space-y-1">
                      {items.map((l) => (
                        <NexusTarget
                          key={l.id}
                          list={l}
                          cu={l.clickUpListId ? cuById.get(l.clickUpListId) ?? null : null}
                          busy={busy === l.id}
                          dragging={!!dragging}
                          confirmingUnlink={confirmUnlink === l.id}
                          onUnlink={() => unlink(l)}
                        />
                      ))}
                    </div>
                  </div>
                )
              )}
              {shownNexus.length === 0 && <p className="px-4 py-6 text-xs text-zinc-600">No Nexus lists match.</p>}
            </div>
          </section>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="px-3 py-2 rounded-lg bg-[#7B68EE] text-white text-xs font-semibold shadow-xl shadow-[#7B68EE]/30 cursor-grabbing">
            {dragging.name}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function ClickUpChip({ list, holder }: { list: MappingBoardClickUpList; holder: MappingBoardNexusList | null }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: list.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs cursor-grab active:cursor-grabbing transition-colors ${
        isDragging ? "opacity-40" : ""
      } ${holder ? "bg-secondary/40 border-zinc-800/60" : "bg-secondary border-zinc-700 hover:border-[#7B68EE]/50"}`}
    >
      <GripVertical className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className={`truncate font-medium ${holder ? "text-zinc-400" : "text-zinc-200"}`}>{list.name}</div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-600">
          <span className="font-mono">#{list.id}</span>
          {list.taskCount != null && <span>{list.taskCount} tasks</span>}
        </div>
      </div>
      {holder && (
        <span className="text-[10px] text-emerald-400/80 truncate max-w-[45%]" title={`Connected to ${holder.name}`}>
          → {holder.name}
        </span>
      )}
    </div>
  );
}

function NexusTarget({
  list,
  cu,
  busy,
  dragging,
  confirmingUnlink,
  onUnlink,
}: {
  list: MappingBoardNexusList;
  cu: MappingBoardClickUpList | null;
  busy: boolean;
  dragging: boolean;
  confirmingUnlink: boolean;
  onUnlink: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: list.id });
  const mismatch = cu && namesDiffer(cu.name, list.name);
  return (
    <div
      ref={setNodeRef}
      className={`px-3 py-2 rounded-lg border text-xs transition-colors ${
        isOver
          ? "border-[#7B68EE] bg-[#7B68EE]/10"
          : dragging
          ? "border-dashed border-zinc-700 bg-secondary/40"
          : "border-zinc-800/60 bg-secondary/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-zinc-200 truncate">{list.name}</span>
        <span className="text-[10px] text-zinc-600 shrink-0">{list.taskCount} tasks</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 min-h-[22px]">
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />
        ) : list.clickUpListId ? (
          <>
            <Link2 className="w-3 h-3 text-[#7B68EE] shrink-0" />
            <span className="truncate text-[11px] text-zinc-300">{cu?.name ?? "ClickUp list not found"}</span>
            <span className="font-mono text-[10px] text-zinc-600 shrink-0">#{list.clickUpListId}</span>
            {mismatch && (
              <span className="flex items-center gap-1 text-[10px] text-amber-400 shrink-0" title="The names don't share a word">
                <AlertTriangle className="w-3 h-3" /> check
              </span>
            )}
            <button
              onClick={onUnlink}
              className={`ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                confirmingUnlink
                  ? "bg-rose-600 text-white"
                  : "text-rose-400 hover:bg-rose-950/40"
              }`}
            >
              <Unlink2 className="w-3 h-3" /> {confirmingUnlink ? "Click to confirm" : "Unlink"}
            </button>
          </>
        ) : (
          <span className="text-[11px] text-zinc-600 italic">Not connected. Drop a ClickUp list here.</span>
        )}
      </div>
    </div>
  );
}

function ConfirmDrop({
  pending,
  onConfirm,
  onCancel,
  cuById,
}: {
  pending: PendingDrop;
  onConfirm: () => void;
  onCancel: () => void;
  cuById: Map<string, MappingBoardClickUpList>;
}) {
  const { cu, target, holder } = pending;
  const replaced = target.clickUpListId ? cuById.get(target.clickUpListId)?.name ?? `#${target.clickUpListId}` : null;
  return (
    <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-800/40 text-xs text-zinc-300 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="font-semibold text-amber-300">
            Connect ClickUp “{cu.name}” to Nexus “{target.name}”?
          </div>
          {holder && <div>This ClickUp list is connected to “{holder.name}” now. That connection will be removed.</div>}
          {replaced && <div>“{target.name}” is connected to ClickUp “{replaced}” now. That connection will be replaced.</div>}
          {namesDiffer(cu.name, target.name) && <div>The two names don&apos;t share a word. Make sure it&apos;s the same client.</div>}
        </div>
        <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300 cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="px-3 py-1.5 bg-[#7B68EE] hover:bg-[#6a5ad6] text-white rounded-lg font-semibold cursor-pointer"
        >
          Connect
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-secondary border border-zinc-800 text-zinc-400 rounded-lg font-semibold hover:bg-zinc-800 cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
