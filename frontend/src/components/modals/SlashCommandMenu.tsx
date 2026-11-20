'use client';

import React from 'react';
import { createPortal } from 'react-dom';

export interface SlashCommandItem {
  command: string;
  label: string;
  description: string;
  onSelect: () => void;
}

interface SlashCommandMenuProps {
  isOpen: boolean;
  items: SlashCommandItem[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  position: { top?: number; bottom?: number; left: number; width: number } | null;
}

/**
 * Portaled slash-command suggestion menu used by CommentEditor & CommentReplyInput
 * to surface `/crm` (and future slash commands) with a brief purpose explanation.
 */
export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
  isOpen,
  items,
  selectedIndex,
  onSelectIndex,
  position,
}) => {
  if (!isOpen || items.length === 0 || !position || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      style={{
        position: 'fixed',
        ...(position.top !== undefined ? { top: position.top } : {}),
        ...(position.bottom !== undefined ? { bottom: position.bottom } : {}),
        left: position.left,
        width: position.width,
        zIndex: 999999,
      }}
      onMouseDown={(e) => e.preventDefault()}
      className="bg-popover border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
    >
      <div className="px-3 py-1.5 border-b border-border text-[11px] font-semibold text-muted-foreground bg-accent/40 flex items-center justify-between">
        <span>Commands</span>
        <span className="text-[10px] font-normal">Enter / Tab to open</span>
      </div>
      <div className="p-1.5 space-y-1">
        {items.map((item, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <button
              key={item.command}
              type="button"
              onMouseEnter={() => onSelectIndex(idx)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => item.onSelect()}
              className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-cyan-500/15 text-zinc-100 border border-cyan-500/30'
                  : 'text-zinc-200 hover:bg-accent/50 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2">
                <code className="px-1.5 py-0.5 rounded bg-zinc-800 text-cyan-300 text-[11px] font-semibold">
                  {item.command}
                </code>
                <span className="text-xs font-semibold text-zinc-100">{item.label}</span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-1 leading-snug">
                {item.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
};
