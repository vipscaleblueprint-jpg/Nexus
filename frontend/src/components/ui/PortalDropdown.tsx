import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

export function PortalDropdown({ triggerRef, children, onClose }: { triggerRef: React.RefObject<HTMLElement | null>; children: React.ReactNode; onClose: () => void }) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX });
    }

    const close = (e: MouseEvent) => {
      // Allow clicks inside the portal to not close it
      const isInsidePortal = (e.target as Element).closest('.portal-dropdown-container');
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node) && !isInsidePortal) {
        onClose();
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose, triggerRef]);

  if (!coords || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="portal-dropdown-container fixed bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl z-[9999] p-1"
      style={{ top: coords.top, left: coords.left }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}
