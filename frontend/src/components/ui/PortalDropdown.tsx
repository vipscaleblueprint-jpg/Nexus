import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

const GAP = 4;
const EDGE = 8;

/** True once the trigger is scrolled out of view of a scrolling ancestor (e.g. a Kanban column). */
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

export function PortalDropdown({ triggerRef, children, onClose }: { triggerRef: React.RefObject<HTMLElement | null>; children: React.ReactNode; onClose: () => void }) {
  const [isMounted, setIsMounted] = useState(false);
  const portalRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsMounted(true);

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const portal = portalRef.current;
      if (!trigger || !portal) return;

      // Following a trigger that scrolled out of its column would leave the menu floating over the header.
      if (isScrolledOutOfView(trigger)) {
        onClose();
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const { offsetHeight: height, offsetWidth: width } = portal;

      // Open below; flip above when it doesn't fit below but does above; otherwise keep it on screen.
      let top = rect.bottom + GAP;
      if (top + height > window.innerHeight - EDGE) {
        const above = rect.top - GAP - height;
        top = above >= EDGE ? above : Math.max(EDGE, window.innerHeight - EDGE - height);
      }
      const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - EDGE - width));

      portal.style.top = `${top}px`;
      portal.style.left = `${left}px`;
    };

    // Initial position
    updatePosition();
    // We need a tiny delay to ensure portal is rendered
    requestAnimationFrame(updatePosition);

    const close = (e: MouseEvent) => {
      const isInsidePortal = (e.target as Element).closest('.portal-dropdown-container');
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node) && !isInsidePortal) {
        onClose();
      }
    };

    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    document.addEventListener('mousedown', close);
    
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('mousedown', close);
    };
  }, [onClose, triggerRef]);

  if (typeof document === 'undefined') return null;
  
  return createPortal(
    <div
      ref={portalRef}
      className="portal-dropdown-container fixed bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl z-[9999] p-1"
      style={{ top: '-9999px', left: '-9999px' }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {isMounted && children}
    </div>,
    document.body
  );
}
