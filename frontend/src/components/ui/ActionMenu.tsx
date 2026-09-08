import { useState, useRef, useEffect } from 'react';
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
  const [coords, setCoords] = useState({ top: 0, right: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    
    const updateCoords = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setCoords({
          top: rect.bottom + window.scrollY,
          right: document.documentElement.clientWidth - rect.right - window.scrollX
        });
      }
    };
    
    updateCoords();
    
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
          className={`absolute mt-1 ${width} bg-zinc-800 border border-zinc-700/80 rounded shadow-xl z-[9999] py-1`}
          style={{ top: coords.top, right: coords.right }}
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
