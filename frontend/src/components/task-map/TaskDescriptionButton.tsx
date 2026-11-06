import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlignLeft, X, FileText } from 'lucide-react';
import { sanitizeHtml } from '@/components/docs/docTransfer';

interface Props {
  description?: string | null;
  taskTitle: string;
}

/** True once the trigger is scrolled out of view of a scrolling ancestor (e.g. a TaskMap column or board). */
function isScrolledOutOfView(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(p);
    if (!/(auto|scroll|hidden|clip)/.test(overflowX + overflowY)) continue;
    const box = p.getBoundingClientRect();
    if (rect.bottom <= box.top || rect.top >= box.bottom || rect.right <= box.left || rect.left >= box.right) return true;
  }
  return false;
}

export const TaskDescriptionButton: React.FC<Props> = ({ description, taskTitle }) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const initialPosRef = useRef<{ top: number; left: number } | null>(null);

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

      let left = rect.left - 20;
      if (left < 10) left = 10;
      if (left + popoverWidth > window.innerWidth - 10) {
        left = Math.max(10, window.innerWidth - popoverWidth - 10);
      }
      return { top, left };
    };

    // Calculate initial coordinates for mount
    const initPos = calcPos(initialRect);
    setCoords(initPos);

    let rafId: number | null = null;

    const handleScrollOrUpdate = (isResize = false) => {
      if (!triggerRef.current) return;
      const curTrigger = triggerRef.current;
      const popover = popoverRef.current;

      // Auto-dismiss if trigger scrolled completely out of view of its container
      if (isScrolledOutOfView(curTrigger)) {
        setIsOpen(false);
        return;
      }

      const curRect = curTrigger.getBoundingClientRect();

      if (initialPosRef.current && !isResize) {
        const deltaY = Math.abs(curRect.top - initialPosRef.current.top);
        const deltaX = Math.abs(curRect.left - initialPosRef.current.left);
        const maxDelta = Math.max(deltaX, deltaY);

        // Limit reached: automatically dismiss when scrolled >= 60px
        if (maxDelta >= 60) {
          setIsOpen(false);
          return;
        }

        // Smooth fade: fully visible 0-20px, linear fade between 20px and 60px
        const opacity = maxDelta <= 20 ? 1 : Math.max(0, 1 - (maxDelta - 20) / 40);
        if (popover) {
          popover.style.opacity = `${opacity}`;
          popover.style.pointerEvents = opacity < 0.2 ? 'none' : 'auto';
        }
      }

      // Reposition directly on DOM node to prevent main-thread layout thrashing and React re-renders
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

  const hasDesc = Boolean(description && description.trim());

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
        className={`p-0.5 rounded hover:bg-zinc-800 transition-colors cursor-pointer shrink-0 ${
          hasDesc ? 'text-zinc-300 hover:text-white' : 'text-zinc-500 hover:text-zinc-400'
        }`}
        title={hasDesc ? 'View task description' : 'No description'}
      >
        <AlignLeft className="size-3.5" />
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
            className="w-72 max-h-72 p-3 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl text-zinc-200 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
              <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-300">
                <FileText className="size-3.5 text-indigo-400" />
                <span>Task Description</span>
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded"
              >
                <X className="size-3" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar text-xs leading-relaxed text-zinc-300 pr-1 max-h-52">
              {hasDesc ? (
                description!.includes('<') && description!.includes('>') ? (
                  <div
                    className="prose prose-invert prose-xs max-w-none break-words"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(description!).body.innerHTML,
                    }}
                  />
                ) : (
                  <p className="whitespace-pre-wrap break-words">{description}</p>
                )
              ) : (
                <p className="italic text-zinc-500 text-center py-4">No description provided for this task.</p>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
