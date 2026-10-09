'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X,
  Type,
  UserCircle,
  Users,
  Clock,
  Files,
  ListTree,
  AlignLeft,
  File,
  ChevronRight,
} from 'lucide-react';
import { ActionMenu } from '@/components/ui/ActionMenu';

// ── Types & defaults ────────────────────────────────────────────────────────

export type PageFontStyle = 'system' | 'serif' | 'mono';
export type PageFontSize = 'small' | 'default' | 'large';
export type SubpagesView = 'list' | 'table' | 'hidden';

export interface PageStyles {
  fontStyle: PageFontStyle;
  fontSize: PageFontSize;
  fullWidth: boolean;
  showTitle: boolean;
  showOwners: boolean;
  showContributors: boolean;
  showLastModified: boolean;
  subpagesView: SubpagesView;
  showOutline: boolean;
  focusBlock: boolean;
  focusPage: boolean;
  showStats: boolean;
}

export const DEFAULT_PAGE_STYLES: PageStyles = {
  fontStyle: 'system',
  fontSize: 'default',
  fullWidth: false,
  showTitle: true,
  showOwners: true,
  showContributors: true,
  showLastModified: true,
  subpagesView: 'list',
  showOutline: false,
  focusBlock: false,
  focusPage: false,
  showStats: false,
};

const TYPOGRAPHY_KEYS = ['fontStyle', 'fontSize', 'fullWidth'] as const;

// Classes applied to the block list wrapper. `.ProseMirror` carries its own `text-sm`, so the
// descendant selector is needed to out-rank it.
export const FONT_STYLE_CLASS: Record<PageFontStyle, string> = {
  system: '',
  serif: '[&_.ProseMirror]:font-serif',
  mono: '[&_.ProseMirror]:font-mono',
};

export const FONT_SIZE_CLASS: Record<PageFontSize, string> = {
  small: '[&_.ProseMirror]:text-[13px]',
  default: '',
  large: '[&_.ProseMirror]:text-base',
};

// ── Persistence (browser only — no backend storage) ─────────────────────────
// Per-page settings live under `nexus:pageStyles:page:<id>`. Typography (font, size, width)
// also has a global default that "Apply typography to all pages" writes to.

const STORAGE_PREFIX = 'nexus:pageStyles:';
const PAGE_PREFIX = `${STORAGE_PREFIX}page:`;
const DEFAULT_TYPOGRAPHY_KEY = `${STORAGE_PREFIX}defaultTypography`;

const readJson = (key: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { }
};

const loadPageStyles = (pageId: string | null | undefined): PageStyles => {
  if (typeof window === 'undefined') return DEFAULT_PAGE_STYLES;
  const typography = readJson(DEFAULT_TYPOGRAPHY_KEY);
  const page = pageId ? readJson(`${PAGE_PREFIX}${pageId}`) : {};
  return { ...DEFAULT_PAGE_STYLES, ...typography, ...page } as PageStyles;
};

export function usePageStyles(pageId: string | null | undefined) {
  // Saved settings are read once per page; local edits are kept alongside the page id they
  // belong to, so switching pages falls back to that page's saved settings without an effect.
  const loaded = useMemo(() => loadPageStyles(pageId), [pageId]);
  const [edited, setEdited] = useState<{ pageId: string | null | undefined; styles: PageStyles } | null>(null);
  const styles = edited && edited.pageId === pageId ? edited.styles : loaded;

  const updateStyles = useCallback((patch: Partial<PageStyles>) => {
    setEdited(prev => {
      const base = prev && prev.pageId === pageId ? prev.styles : loaded;
      const next = { ...base, ...patch };
      if (pageId) writeJson(`${PAGE_PREFIX}${pageId}`, next);
      return { pageId, styles: next };
    });
  }, [pageId, loaded]);

  // Make the current typography the default everywhere, and drop per-page typography
  // overrides so every page picks the new default up.
  const applyTypographyToAll = useCallback(() => {
    const typography: Partial<PageStyles> = {};
    TYPOGRAPHY_KEYS.forEach(k => { (typography as Record<string, unknown>)[k] = styles[k]; });
    writeJson(DEFAULT_TYPOGRAPHY_KEY, typography);
    try {
      const pageKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(PAGE_PREFIX)) pageKeys.push(key);
      }
      pageKeys.forEach(key => {
        const saved = readJson(key);
        TYPOGRAPHY_KEYS.forEach(k => { delete saved[k]; });
        writeJson(key, saved);
      });
    } catch { }
  }, [styles]);

  return { styles, updateStyles, applyTypographyToAll };
}

// ── Content helpers (stats + outline) ───────────────────────────────────────

interface BlockLike {
  id: string;
  type: string;
  content: string;
}

export const blockToText = (content: string): string => {
  if (!content) return '';
  // Some legacy blocks store raw Tiptap JSON
  if (content.startsWith('{"type":"doc"')) {
    return Array.from(content.matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)).map(m => m[1]).join(' ');
  }
  return content
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|h[1-6]|li|div|summary)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, '_');
};

export interface PageStats {
  words: number;
  characters: number;
  readingTime: string;
}

const WORDS_PER_MINUTE = 200;

export function computePageStats(blocks: BlockLike[]): PageStats {
  let words = 0;
  let characters = 0;
  for (const block of blocks) {
    const text = blockToText(block.content).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    characters += text.length;
    words += text.split(' ').length;
  }
  const totalSeconds = Math.round((words / WORDS_PER_MINUTE) * 60);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return { words, characters, readingTime: m > 0 ? `${m}m ${s}s` : `${s}s` };
}

export interface OutlineItem {
  blockId: string;
  level: number;
  text: string;
}

export function computeOutline(blocks: BlockLike[]): OutlineItem[] {
  const items: OutlineItem[] = [];
  for (const block of blocks) {
    if (block.type === 'heading') {
      const text = blockToText(block.content).trim();
      if (text) items.push({ blockId: block.id, level: 1, text });
      continue;
    }
    for (const m of block.content.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
      const text = blockToText(m[2]).replace(/\s+/g, ' ').trim();
      if (text) items.push({ blockId: block.id, level: Number(m[1]), text });
    }
  }
  return items;
}

// ── UI ──────────────────────────────────────────────────────────────────────

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors cursor-pointer ${checked ? 'bg-indigo-500' : 'bg-zinc-700'}`}
    >
      <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function OptionCard({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center gap-1 rounded-lg py-2.5 text-xs transition-colors cursor-pointer ${active
        ? 'bg-indigo-500/15 text-indigo-300'
        : 'bg-zinc-800/40 text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200'
        }`}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium text-zinc-500 mb-2">{children}</div>;
}

function ToggleRow({ icon, label, checked, onChange }: { icon?: React.ReactNode; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2 text-xs text-zinc-300">
        {icon && <span className="text-zinc-500">{icon}</span>}
        {label}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

const SUBPAGES_VIEW_LABEL: Record<SubpagesView, string> = { list: 'List', table: 'Table', hidden: 'Hidden' };

interface PageStylesPanelProps {
  styles: PageStyles;
  onChange: (patch: Partial<PageStyles>) => void;
  onApplyTypographyToAll: () => void;
  stats: PageStats;
  onClose: () => void;
}

export function PageStylesPanel({ styles, onChange, onApplyTypographyToAll, stats, onClose }: PageStylesPanelProps) {
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    if (!applied) return;
    const t = setTimeout(() => setApplied(false), 1500);
    return () => clearTimeout(t);
  }, [applied]);

  const iconClass = 'w-3.5 h-3.5';

  return (
    <aside className="w-72 shrink-0 h-full bg-card border-l border-zinc-800/60 flex flex-col select-none">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <h3 className="text-sm font-semibold text-zinc-200">Page Styles</h3>
        <button onClick={onClose} className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Typography */}
        <div className="p-4 space-y-4 border-b border-zinc-800/60">
          <div>
            <SectionLabel>Font style</SectionLabel>
            <div className="flex gap-1.5">
              <OptionCard active={styles.fontStyle === 'system'} onClick={() => onChange({ fontStyle: 'system' })}>
                <span className="text-sm font-semibold font-sans">Aa</span>System
              </OptionCard>
              <OptionCard active={styles.fontStyle === 'serif'} onClick={() => onChange({ fontStyle: 'serif' })}>
                <span className="text-sm font-semibold font-serif">Ss</span>Serif
              </OptionCard>
              <OptionCard active={styles.fontStyle === 'mono'} onClick={() => onChange({ fontStyle: 'mono' })}>
                <span className="text-sm font-semibold font-mono">00</span>Mono
              </OptionCard>
            </div>
          </div>

          <div>
            <SectionLabel>Font size</SectionLabel>
            <div className="flex gap-1.5">
              <OptionCard active={styles.fontSize === 'small'} onClick={() => onChange({ fontSize: 'small' })}>
                <span className="flex items-center gap-1 text-xs font-semibold">Aa<AlignLeft className="w-3 h-3" /></span>Small
              </OptionCard>
              <OptionCard active={styles.fontSize === 'default'} onClick={() => onChange({ fontSize: 'default' })}>
                <span className="flex items-center gap-1 text-sm font-semibold">Aa<AlignLeft className="w-3.5 h-3.5" /></span>Default
              </OptionCard>
              <OptionCard active={styles.fontSize === 'large'} onClick={() => onChange({ fontSize: 'large' })}>
                <span className="flex items-center gap-1 text-base font-semibold">Aa<AlignLeft className="w-4 h-4" /></span>Large
              </OptionCard>
            </div>
          </div>

          <div>
            <SectionLabel>Page width</SectionLabel>
            <div className="flex gap-1.5">
              <OptionCard active={!styles.fullWidth} onClick={() => onChange({ fullWidth: false })}>Default</OptionCard>
              <OptionCard active={styles.fullWidth} onClick={() => onChange({ fullWidth: true })}>Full width</OptionCard>
            </div>
          </div>

          <button
            onClick={() => { onApplyTypographyToAll(); setApplied(true); }}
            className="w-full py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-lg transition-colors cursor-pointer"
          >
            {applied ? 'Applied to all pages' : 'Apply typography to all pages'}
          </button>
        </div>

        {/* Header */}
        <div className="px-4 pt-4 pb-2 border-b border-zinc-800/60">
          <SectionLabel>Header</SectionLabel>
          <ToggleRow icon={<Type className={iconClass} />} label="Page title" checked={styles.showTitle} onChange={v => onChange({ showTitle: v })} />
          <ToggleRow icon={<UserCircle className={iconClass} />} label="Owners" checked={styles.showOwners} onChange={v => onChange({ showOwners: v })} />
          <ToggleRow icon={<Users className={iconClass} />} label="Contributors" checked={styles.showContributors} onChange={v => onChange({ showContributors: v })} />
          <ToggleRow icon={<Clock className={iconClass} />} label="Last modified" checked={styles.showLastModified} onChange={v => onChange({ showLastModified: v })} />
        </div>

        {/* Sections */}
        <div className="px-4 pt-4 pb-2 border-b border-zinc-800/60">
          <SectionLabel>Sections</SectionLabel>
          <div className="flex items-center justify-between py-1.5">
            <div className="flex items-center gap-2 text-xs text-zinc-300">
              <span className="text-zinc-500"><Files className={iconClass} /></span>
              Subpages
            </div>
            <ActionMenu
              width="w-28"
              icon={
                <span className="flex items-center gap-0.5 text-[11px] text-zinc-400">
                  {SUBPAGES_VIEW_LABEL[styles.subpagesView]}
                  <ChevronRight className="w-3 h-3" />
                </span>
              }
            >
              {(Object.keys(SUBPAGES_VIEW_LABEL) as SubpagesView[]).map(view => (
                <button
                  key={view}
                  onClick={() => onChange({ subpagesView: view })}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-700 hover:text-white cursor-pointer ${styles.subpagesView === view ? 'text-indigo-300' : 'text-zinc-300'}`}
                >
                  {SUBPAGES_VIEW_LABEL[view]}
                </button>
              ))}
            </ActionMenu>
          </div>
          <ToggleRow icon={<ListTree className={iconClass} />} label="Page outline" checked={styles.showOutline} onChange={v => onChange({ showOutline: v })} />
        </div>

        {/* Focus mode */}
        <div className="px-4 pt-4 pb-2 border-b border-zinc-800/60">
          <SectionLabel>Focus mode</SectionLabel>
          <ToggleRow icon={<AlignLeft className={iconClass} />} label="Block" checked={styles.focusBlock} onChange={v => onChange({ focusBlock: v })} />
          <ToggleRow icon={<File className={iconClass} />} label="Page" checked={styles.focusPage} onChange={v => onChange({ focusPage: v })} />
        </div>

        {/* Stats */}
        <div className="px-4 pt-4 pb-4">
          <SectionLabel>Stats</SectionLabel>
          <div className="flex items-center justify-between py-1.5 text-xs">
            <span className="text-zinc-300">Word count</span>
            <span className="text-zinc-400 tabular-nums">{stats.words.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between py-1.5 text-xs">
            <span className="text-zinc-300">Characters</span>
            <span className="text-zinc-400 tabular-nums">{stats.characters.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between py-1.5 text-xs">
            <span className="text-zinc-300">Reading time</span>
            <span className="text-zinc-400 tabular-nums">{stats.readingTime}</span>
          </div>
          <ToggleRow label="Show stats on page" checked={styles.showStats} onChange={v => onChange({ showStats: v })} />
        </div>
      </div>
    </aside>
  );
}
