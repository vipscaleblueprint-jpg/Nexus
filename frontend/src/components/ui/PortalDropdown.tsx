import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

export function PortalDropdown({ triggerRef, children, onClose }: { triggerRef: React.RefObject<HTMLElement | null>; children: React.ReactNode; onClose: () => void }) {
  const [isMounted, setIsMounted] = useState(false);
  const portalRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsMounted(true);

    const updatePosition = () => {
      if (triggerRef.current && portalRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        portalRef.current.style.top = `${rect.bottom + 4}px`;
        portalRef.current.style.left = `${rect.left}px`;
      }
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
