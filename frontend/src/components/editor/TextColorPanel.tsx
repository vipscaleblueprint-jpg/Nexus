'use client';

// Shared colour menu for the rich-text editors (docs / task description BlockEditor and CommentEditor):
// text colours, highlights, badges, recently used and "Remove color" — laid out like ClickUp's.
import React, { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Ban } from 'lucide-react';
import { BADGE_LIGHT_COLORS, BADGE_STRONG_COLORS, type BadgeColor } from './extensions/Badge';

type RecentColor =
  | { kind: 'text'; color: string }
  | { kind: 'highlight'; color: string }
  | { kind: 'badge'; color: string; textColor: string };

const RECENT_KEY = 'nexus:recent-text-colors';
const RECENT_MAX = 6;

function readRecent(): RecentColor[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function sameRecent(a: RecentColor, b: RecentColor) {
  return a.kind === b.kind && a.color === b.color && (a as any).textColor === (b as any).textColor;
}

interface TextColorPanelProps {
  editor: Editor;
  /** The editor's text colour palette; 'transparent' is skipped (Remove color covers it) */
  textColors: string[];
  /** The editor's highlight palette; 'transparent' is skipped */
  highlightColors: string[];
  className?: string;
}

const sectionLabel = 'text-xs font-medium text-muted-foreground px-0.5';
const noneSwatch =
  'w-7 h-7 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:bg-accent transition-colors cursor-pointer shrink-0';

export function TextColorPanel({ editor, textColors, highlightColors, className = '' }: TextColorPanelProps) {
  const [recent, setRecent] = useState<RecentColor[]>(readRecent);

  const remember = (entry: RecentColor) => {
    const next = [entry, ...recent.filter((r) => !sameRecent(r, entry))].slice(0, RECENT_MAX);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: recent colours just aren't kept
    }
  };

  const apply = (entry: RecentColor) => {
    const chain = editor.chain().focus();
    if (entry.kind === 'text') chain.setColor(entry.color).run();
    // A highlight replaces a badge (the badge mark would otherwise keep it out)
    else if (entry.kind === 'highlight') chain.unsetBadge().setHighlight({ color: entry.color }).run();
    else chain.setBadge({ color: entry.color, textColor: entry.textColor }).run();
    remember(entry);
  };

  const keepSelection = (e: React.MouseEvent) => e.preventDefault();

  const renderSwatch = (entry: RecentColor, key: string, title?: string) => {
    if (entry.kind === 'text') {
      const active = editor.isActive('textStyle', { color: entry.color });
      return (
        <button
          key={key}
          type="button"
          onMouseDown={keepSelection}
          onClick={() => apply(entry)}
          title={title || entry.color}
          className={`w-7 h-7 rounded-md border flex items-center justify-center font-serif text-[14px] font-semibold hover:scale-110 transition-transform cursor-pointer shrink-0 ${active ? 'border-foreground' : 'border-border'}`}
          style={{ color: entry.color }}
        >
          A
        </button>
      );
    }
    if (entry.kind === 'highlight') {
      const active = editor.isActive('highlight', { color: entry.color });
      return (
        <button
          key={key}
          type="button"
          onMouseDown={keepSelection}
          onClick={() => apply(entry)}
          title={title || entry.color}
          className={`w-7 h-7 rounded-full border hover:scale-110 transition-transform cursor-pointer shrink-0 ${active ? 'ring-2 ring-foreground ring-offset-1 ring-offset-popover border-transparent' : 'border-border'}`}
          style={{ backgroundColor: entry.color }}
        />
      );
    }
    const active = editor.isActive('badge', { color: entry.color });
    return (
      <button
        key={key}
        type="button"
        onMouseDown={keepSelection}
        onClick={() => apply(entry)}
        title={title || entry.color}
        className={`w-7 h-7 rounded-md hover:scale-110 transition-transform cursor-pointer shrink-0 ${active ? 'ring-2 ring-foreground ring-offset-1 ring-offset-popover' : 'border border-black/10'}`}
        style={{ backgroundColor: entry.color }}
      />
    );
  };

  const badgeEntry = (b: BadgeColor): RecentColor => ({ kind: 'badge', color: b.color, textColor: b.textColor });

  return (
    <div
      className={`bg-popover text-popover-foreground border border-border p-3 rounded-xl shadow-2xl w-[300px] flex flex-col gap-3 ${className}`}
      onMouseDown={keepSelection}
    >
      <div className="flex flex-col gap-1.5">
        <span className={sectionLabel}>Text colors</span>
        <div className="flex flex-wrap gap-1.5">
          {textColors.filter((c) => c !== 'transparent').map((c) => renderSwatch({ kind: 'text', color: c }, `text-${c}`))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={sectionLabel}>Text highlights</span>
        <div className="flex flex-wrap gap-1.5">
          {highlightColors.filter((c) => c !== 'transparent').map((c) => renderSwatch({ kind: 'highlight', color: c }, `hl-${c}`))}
          <button
            type="button"
            onMouseDown={keepSelection}
            onClick={() => editor.chain().focus().unsetHighlight().run()}
            title="Remove highlight"
            className={noneSwatch}
          >
            <Ban className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={sectionLabel}>Badges</span>
        <div className="flex flex-wrap gap-1.5">
          {BADGE_STRONG_COLORS.map((b) => renderSwatch(badgeEntry(b), `badge-${b.color}`, `${b.label} badge`))}
          <button
            type="button"
            onMouseDown={keepSelection}
            onClick={() => editor.chain().focus().unsetBadge().run()}
            title="Remove badge"
            className={noneSwatch}
          >
            <Ban className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {BADGE_LIGHT_COLORS.map((b) => renderSwatch(badgeEntry(b), `badge-${b.color}`, `${b.label} badge`))}
        </div>
      </div>

      {recent.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className={sectionLabel}>Recent</span>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((r, i) => renderSwatch(r, `recent-${i}`))}
          </div>
        </div>
      )}

      <button
        type="button"
        onMouseDown={keepSelection}
        onClick={() => editor.chain().focus().unsetColor().unsetHighlight().unsetBadge().run()}
        className="w-full py-1.5 rounded-lg border border-border hover:bg-accent text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
      >
        <Ban className="w-3.5 h-3.5" />
        Remove color
      </button>
    </div>
  );
}
