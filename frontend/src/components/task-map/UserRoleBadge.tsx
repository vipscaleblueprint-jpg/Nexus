'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldCheck, Tag } from 'lucide-react';
import {
  getUserRoleDefinition,
  getRoleBadgeClass,
  ROLE_SHORT_NAMES,
} from '@/api/taskMap';

interface Props {
  user: any;
  className?: string;
}

/** Check if trigger is scrolled out of view */
function isScrolledOutOfView(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(p);
    if (!/(auto|scroll|hidden|clip)/.test(overflowX + overflowY)) continue;
    const box = p.getBoundingClientRect();
    if (
      rect.bottom <= box.top ||
      rect.top >= box.bottom ||
      rect.right <= box.left ||
      rect.left >= box.right
    ) {
      return true;
    }
  }
  return false;
}

export const UserRoleBadge: React.FC<Props> = ({ user, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const initialPosRef = useRef<{ top: number; left: number } | null>(null);

  const roleInfo = getUserRoleDefinition(user);

  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;

    const trigger = triggerRef.current;
    const initialRect = trigger.getBoundingClientRect();
    initialPosRef.current = { top: initialRect.top, left: initialRect.left };

    const popoverWidth = 280;
    const popoverHeight = 220;

    const calcPos = (rect: DOMRect) => {
      let top = rect.bottom + 4;
      if (top + popoverHeight > window.innerHeight - 10) {
        top = Math.max(10, rect.top - popoverHeight - 4);
      }

      let left = rect.left - 10;
      if (left < 10) left = 10;
      if (left + popoverWidth > window.innerWidth - 10) {
        left = Math.max(10, window.innerWidth - popoverWidth - 10);
      }
      return { top, left };
    };

    setCoords(calcPos(initialRect));

    let rafId: number | null = null;

    const handleScrollOrUpdate = (isResize = false) => {
      if (!triggerRef.current) return;
      const curTrigger = triggerRef.current;
      const popover = popoverRef.current;

      if (isScrolledOutOfView(curTrigger)) {
        setIsOpen(false);
        return;
      }

      const curRect = curTrigger.getBoundingClientRect();

      if (initialPosRef.current && !isResize) {
        const deltaY = Math.abs(curRect.top - initialPosRef.current.top);
        const deltaX = Math.abs(curRect.left - initialPosRef.current.left);
        const maxDelta = Math.max(deltaX, deltaY);

        if (maxDelta >= 60) {
          setIsOpen(false);
          return;
        }

        const opacity = maxDelta <= 20 ? 1 : Math.max(0, 1 - (maxDelta - 20) / 40);
        if (popover) {
          popover.style.opacity = `${opacity}`;
          popover.style.pointerEvents = opacity < 0.2 ? 'none' : 'auto';
        }
      }

      const { top, left } = calcPos(curRect);
      if (popover) {
        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;
      }
    };

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        handleScrollOrUpdate(false);
      });
    };

    const onResize = () => {
      handleScrollOrUpdate(true);
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);

    const handleClickOutside = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const displayShort = roleInfo.mainRoleShort || roleInfo.mainRole;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 transition-all cursor-pointer hover:brightness-125 select-none ${roleInfo.badgeClass} ${className}`}
        title={`Main Role: ${roleInfo.mainRole} (Click to view all roles)`}
      >
        {displayShort}
      </button>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              zIndex: 999999,
              transition: 'opacity 75ms ease-out',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="w-72 p-3 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl text-zinc-200 flex flex-col gap-2.5 animate-in fade-in zoom-in-95 duration-100"
          >
            {/* Popover Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
              <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                <ShieldCheck className="size-3.5 text-blue-400" />
                <span className="truncate max-w-[190px]">{user?.name || 'User'} Roles</span>
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded cursor-pointer"
                title="Close"
              >
                <X className="size-3" />
              </button>
            </div>

            {/* Main Role Section */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Main Role
              </span>
              <div className="flex items-center">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold border ${roleInfo.badgeClass}`}
                  title={roleInfo.mainRole}
                >
                  <Tag className="size-3 opacity-70" />
                  <span>{roleInfo.mainRole}</span>
                </span>
              </div>
            </div>

            {/* Secondary Roles Section */}
            <div className="flex flex-col gap-1.5 pt-1 border-t border-zinc-800/80">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                <span>Other Roles</span>
                <span className="text-zinc-500 font-mono text-[9px]">
                  {roleInfo.secondaryRoles.length}
                </span>
              </span>

              {roleInfo.secondaryRoles.length === 0 ? (
                <p className="text-[11px] text-zinc-500 italic py-1">
                  No additional roles assigned.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto custom-scrollbar pr-1">
                  {roleInfo.secondaryRoles.map((role, idx) => {
                    const short = ROLE_SHORT_NAMES[role] || role;
                    const badgeClass = getRoleBadgeClass(short);
                    return (
                      <span
                        key={`${role}-${idx}`}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${badgeClass}`}
                        title={role}
                      >
                        <Tag className="size-2.5 opacity-70" />
                        <span>{role}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

