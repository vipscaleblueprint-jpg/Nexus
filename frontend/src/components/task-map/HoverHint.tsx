'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface HoverHintProps {
  /** Control name shown in small caps, e.g. "Status", "Task Deliverable", "Priority" */
  label: string;
  /** Current value / state line, e.g. "In Progress" */
  value?: React.ReactNode;
  /** Optional hint line, e.g. "Click to change" */
  hint?: string;
  /** Optional accent color (hex) for the label dot */
  accent?: string;
  /** Hover delay before the hint appears (ms) */
  delay?: number;
  children: React.ReactNode;
}

/**
 * Lightweight, fast hover signifier for card controls (status / deliverable / priority).
 * Renders in a portal so it is never clipped by column or card overflow, and hides
 * immediately on press so it never overlaps the control's own dropdown.
 */
export const HoverHint: React.FC<HoverHintProps> = ({ label, value, hint, accent, delay = 150, children }) => {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clear();
    setPos(null);
  }, [clear]);

  const show = useCallback(() => {
    clear();
    timerRef.current = setTimeout(() => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = 180;
      let left = r.left + r.width / 2 - width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      const top = r.top - 8 < 56 ? r.bottom + 8 : r.top - 8;
      setPos({ top, left });
    }, delay);
  }, [clear, delay]);

  useEffect(() => clear, [clear]);

  // Dismiss on scroll so it never floats away from its control
  useEffect(() => {
    if (!pos) return;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [pos, hide]);

  const placeBelow = pos ? wrapRef.current ? pos.top > wrapRef.current.getBoundingClientRect().top : false : false;

  return (
    <span
      ref={wrapRef}
      data-card-control=""
      className="inline-flex items-center"
      onMouseEnter={show}
      onMouseLeave={hide}
      onPointerDown={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: 180,
              zIndex: 1000000,
              transform: placeBelow ? undefined : 'translateY(-100%)',
              pointerEvents: 'none',
            }}
            className="px-2.5 py-1.5 rounded-lg bg-popover border border-zinc-700/80 shadow-2xl text-zinc-200 animate-in fade-in duration-100"
          >
            <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400">
              {accent && <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />}
              {label}
            </div>
            {value != null && value !== '' && (
              <div className="mt-0.5 text-xs font-semibold text-zinc-100 truncate">{value}</div>
            )}
            {hint && <div className="mt-0.5 text-[10px] text-zinc-500">{hint}</div>}
          </div>,
          document.body
        )}
    </span>
  );
};
