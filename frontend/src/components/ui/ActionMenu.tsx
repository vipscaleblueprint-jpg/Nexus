import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';

export function ActionMenu({ 
  children, 
  icon,
  width = 'w-32'
}: { 
  children: React.ReactNode; 
  icon?: React.ReactNode;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Fixed to the viewport (never extends the page) and flipped above the button when it won't fit below.
  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const GAP = 4;
    const EDGE = 8;
    let top = rect.bottom + GAP;
    if (top + menuHeight > window.innerHeight - EDGE) {
      const above = rect.top - GAP - menuHeight;
      top = above >= EDGE ? above : Math.max(EDGE, window.innerHeight - EDGE - menuHeight);
    }
    setCoords({ top, right: Math.max(EDGE, document.documentElement.clientWidth - rect.right) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const hide = () => setOpen(false);
    window.addEventListener('click', hide);
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    
    return () => {
      window.removeEventListener('click', hide);
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [open]);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setOpen(false);
    }, 300);
  };

  return (
    <div 
      className="relative flex items-center justify-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700/50 rounded transition-colors cursor-pointer"
      >
        {icon || <Plus className="w-3.5 h-3.5" />}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          className={`fixed ${width} bg-zinc-800 border border-zinc-700/80 rounded shadow-xl z-[9999] py-1`}
          style={coords ? { top: coords.top, right: coords.right } : { top: -9999, right: -9999, visibility: 'hidden' }}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {children}
        </div>,
        document.body
      )}
    </div>
  );
}
