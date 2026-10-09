'use client';

import { useEffect, useMemo, useRef } from 'react';
import { X, History, RotateCcw, ArrowLeft } from 'lucide-react';
import { blockToText } from './PageStylesPanel';
import { sanitizeHtml } from './docTransfer';

// ── Types ───────────────────────────────────────────────────────────────────

interface DiffBlock {
  id: string;
  type: string;
  content: string;
  depth?: number;
}

export interface VersionUser {
  id: string;
  name?: string;
  avatarUrl?: string;
}

export interface PageVersionRecord {
  id: string;
  content: string;
  createdAt: string;
  userId?: string;
  user?: VersionUser;
}

/** A version that actually changed something, paired with the version it changed. */
export interface VersionEntry {
  version: PageVersionRecord;
  previous: PageVersionRecord | null;
}

export type DiffSegment = { type: 'same' | 'added' | 'removed'; text: string };

export type BlockDiff =
  | { kind: 'same' | 'added' | 'removed'; block: DiffBlock }
  | { kind: 'changed'; block: DiffBlock; segments: DiffSegment[] };

// ── Version list shaping ────────────────────────────────────────────────────

/**
 * The server stores a version on every save (including blur saves with no edits). Versions arrive
 * newest-first; keep only those whose content differs from the next-older one.
 */
export function buildVersionEntries(versions: PageVersionRecord[]): VersionEntry[] {
  const entries: VersionEntry[] = [];
  for (let i = 0; i < versions.length; i++) {
    const older = versions[i + 1] ?? null;
    if (older && older.content === versions[i].content) continue;
    entries.push({ version: versions[i], previous: older });
  }
  return entries;
}

// ── Diffing ─────────────────────────────────────────────────────────────────

/** Longest-common-subsequence alignment; returns matched index pairs in order. */
function lcsPairs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = eq(a[i], b[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { pairs.push([i, j]); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const MAX_WORD_DIFF_CELLS = 1_500_000;

export function diffWords(before: string, after: string): DiffSegment[] {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > MAX_WORD_DIFF_CELLS) {
    return [{ type: 'removed', text: before }, { type: 'added', text: after }];
  }
  const segments: DiffSegment[] = [];
  const push = (type: DiffSegment['type'], text: string) => {
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.text += text;
    else segments.push({ type, text });
  };
  let i = 0;
  let j = 0;
  for (const [pi, pj] of lcsPairs(a, b, (x, y) => x === y)) {
    while (i < pi) push('removed', a[i++]);
    while (j < pj) push('added', b[j++]);
    push('same', a[i]);
    i++; j++;
  }
  while (i < a.length) push('removed', a[i++]);
  while (j < b.length) push('added', b[j++]);
  return segments;
}

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Plain text of a block with entities decoded (DOMParser never executes anything). Cached because
// the text-keyed block alignment compares the same blocks many times.
const plainCache = new Map<string, string>();
const plain = (content: string): string => {
  const cached = plainCache.get(content);
  if (cached !== undefined) return cached;
  let text: string;
  if (!content) text = '';
  else if (content.startsWith('{"type":"doc"')) text = blockToText(content);
  else {
    const spaced = content.replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|h[1-6]|li|div|summary)>/gi, ' ');
    text = new DOMParser().parseFromString(spaced, 'text/html').body.textContent || '';
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (plainCache.size > 2000) plainCache.clear();
  plainCache.set(content, text);
  return text;
};

/**
 * Block-level diff of two versions. Blocks are matched by id (ids survive edits, so an edited
 * block shows as "changed" with a word diff); legacy pages without stable ids fall back to text.
 */
export function diffBlocks(oldBlocks: DiffBlock[], newBlocks: DiffBlock[]): BlockDiff[] {
  const isEmpty = (b: DiffBlock) => !plain(b.content);
  const before = oldBlocks.filter(b => !isEmpty(b));
  const after = newBlocks.filter(b => !isEmpty(b));
  const oldIds = new Set(before.map(b => b.id));
  const byId = after.some(b => oldIds.has(b.id));
  const eq = byId
    ? (x: DiffBlock, y: DiffBlock) => x.id === y.id
    : (x: DiffBlock, y: DiffBlock) => plain(x.content) === plain(y.content);

  const result: BlockDiff[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of lcsPairs(before, after, eq)) {
    while (i < pi) result.push({ kind: 'removed', block: before[i++] });
    while (j < pj) result.push({ kind: 'added', block: after[j++] });
    const o = before[i];
    const n = after[j];
    if (o.content === n.content && o.type === n.type) result.push({ kind: 'same', block: n });
    else {
      const segments = diffWords(plain(o.content), plain(n.content));
      result.push(segments.some(s => s.type !== 'same')
        ? { kind: 'changed', block: n, segments }
        : { kind: 'same', block: n });
    }
    i++; j++;
  }
  while (i < before.length) result.push({ kind: 'removed', block: before[i++] });
  while (j < after.length) result.push({ kind: 'added', block: after[j++] });
  return result;
}

// ── Formatting helpers ──────────────────────────────────────────────────────

export const formatVersionTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Avatar({ user }: { user?: VersionUser }) {
  return (
    <span className="w-5 h-5 rounded-full overflow-hidden shrink-0 bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-[9px]">
      {user?.avatarUrl
        ? <img src={user.avatarUrl} alt={user.name || ''} className="w-full h-full rounded-full object-cover" />
        : (user?.name?.charAt(0).toUpperCase() || '?')}
    </span>
  );
}

// ── Version list panel ──────────────────────────────────────────────────────

interface VersionHistoryPanelProps {
  entries: VersionEntry[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (versionId: string) => void;
  onClose: () => void;
}

export function VersionHistoryPanel({ entries, selectedId, loading, onSelect, onClose }: VersionHistoryPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the selected row in view when stepping through versions with the arrow keys
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const idx = entries.findIndex(en => en.version.id === selectedId);
    const next = e.key === 'ArrowDown' ? Math.min(entries.length - 1, idx + 1) : Math.max(0, idx - 1);
    if (entries[next]) onSelect(entries[next].version.id);
  };

  return (
    <aside className="w-72 shrink-0 h-full bg-card border-l border-zinc-800/60 flex flex-col select-none">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-2 text-zinc-200">
          <History className="w-4 h-4" />
          <h3 className="text-sm font-semibold">Version history</h3>
        </div>
        <button onClick={onClose} className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1 focus:outline-none"
      >
        {entries.length === 0 ? (
          <div className="text-zinc-500 text-xs text-center py-10">{loading ? 'Loading versions…' : 'No version history available'}</div>
        ) : (
          entries.map((entry, i) => {
            const selected = entry.version.id === selectedId;
            return (
              <button
                key={entry.version.id}
                role="option"
                aria-selected={selected}
                onClick={() => onSelect(entry.version.id)}
                className={`w-full text-left flex flex-col gap-1.5 px-3 py-2 rounded-lg transition-colors cursor-pointer ${selected ? 'bg-indigo-500/15' : 'hover:bg-zinc-800/60'}`}
              >
                <span className={`text-xs font-medium ${selected ? 'text-indigo-300' : 'text-zinc-200'}`}>
                  {formatVersionTime(entry.version.createdAt)}
                  {i === 0 && <span className="ml-1.5 text-[10px] text-zinc-500 font-normal">Current version</span>}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <Avatar user={entry.version.user} />
                  {entry.version.user?.name || 'Unknown'}
                </span>
              </button>
            );
          })
        )}
      </div>
      {entries.length > 0 && (
        <div className="px-4 py-2 border-t border-zinc-800/60 text-[10px] text-zinc-500">
          Use ↑ ↓ to step through versions
        </div>
      )}
    </aside>
  );
}

// ── Version preview (replaces the editor while browsing history) ───────────

const INDENT_CLASS = ['', 'ml-6', 'ml-12', 'ml-18', 'ml-24', 'ml-30', 'ml-36'];
const PROSE_CLASS = 'prose dark:prose-invert max-w-none break-words text-sm text-zinc-900 dark:text-zinc-100 prose-p:my-0 prose-ul:my-0 prose-ol:my-0 [&_p]:whitespace-pre-wrap';

function BlockHtml({ content, className = '' }: { content: string; className?: string }) {
  // Stored block HTML is shown read-only, sanitized first (pages can contain imported/remote content)
  const html = useMemo(() => {
    if (!content) return '';
    if (content.startsWith('{"type":"doc"')) return `<p>${escapeText(blockToText(content))}</p>`;
    if (!/^\s*</.test(content)) return `<p>${escapeText(content)}</p>`;
    return sanitizeHtml(content).body.innerHTML;
  }, [content]);
  return <div className={`${PROSE_CLASS} ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

interface VersionPreviewProps {
  entry: VersionEntry;
  diffs: BlockDiff[];
  isCurrent: boolean;
  typographyClass: string;
  onRestore: () => void;
  onExit: () => void;
}

export function VersionPreview({ entry, diffs, isCurrent, typographyClass, onRestore, onExit }: VersionPreviewProps) {
  const changeCount = diffs.filter(d => d.kind !== 'same').length;

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-2 px-3 py-2.5 bg-card border border-zinc-800/60 rounded-xl flex items-center gap-3 flex-wrap shadow-md">
        <Avatar user={entry.version.user} />
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-semibold text-zinc-200 truncate">
            {formatVersionTime(entry.version.createdAt)}{isCurrent ? ' · Current version' : ''}
          </span>
          <span className="text-[11px] text-zinc-400 truncate">
            Edited by {entry.version.user?.name || 'Unknown'}
            {entry.previous ? ` · ${changeCount} change${changeCount === 1 ? '' : 's'} highlighted` : ' · earliest loaded version'}
          </span>
        </div>
        {entry.previous && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">Added</span>
            <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 line-through">Removed</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onExit}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to editing
          </button>
          {!isCurrent && (
            <button
              onClick={onRestore}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-md transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Restore this version
            </button>
          )}
        </div>
      </div>

      <div className={`space-y-1.5 ${typographyClass}`}>
        {diffs.length === 0 && <p className="text-xs text-zinc-500 italic">This version is empty.</p>}
        {diffs.map((d, i) => {
          const indent = INDENT_CLASS[Math.min(d.block.depth || 0, INDENT_CLASS.length - 1)];
          if (d.kind === 'changed') {
            return (
              <div key={`${d.block.id}-${i}`} className={`py-1 px-2 rounded-md border-l-2 border-amber-500/60 ${indent}`}>
                <p className={`${PROSE_CLASS} whitespace-pre-wrap`}>
                  {d.segments.map((s, k) => (
                    s.type === 'same' ? <span key={k}>{s.text}</span>
                      : s.type === 'added' ? <span key={k} className="bg-emerald-500/20 text-emerald-200 rounded-sm">{s.text}</span>
                        : <span key={k} className="bg-red-500/20 text-red-300 line-through rounded-sm">{s.text}</span>
                  ))}
                </p>
              </div>
            );
          }
          const tone = d.kind === 'added'
            ? 'bg-emerald-500/10 border-l-2 border-emerald-500/60'
            : d.kind === 'removed'
              ? 'bg-red-500/10 border-l-2 border-red-500/60 line-through opacity-70'
              : '';
          return (
            <div key={`${d.block.id}-${i}`} className={`py-1 px-2 rounded-md ${tone} ${indent}`}>
              <BlockHtml content={d.block.content} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
