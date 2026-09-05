import { useState, useRef, useEffect } from 'react';
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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const hide = () => setOpen(false);
    window.addEventListener('click', hide);
    return () => window.removeEventListener('click', hide);
  }, [open]);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setOpen(false);
    }, 300); // 300ms grace period before closing
  };

  return (
    <div 
      className="relative flex items-center justify-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700/50 rounded transition-colors cursor-pointer"
      >
        {icon || <Plus className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div
          className={`absolute right-0 top-full mt-1 ${width} bg-zinc-800 border border-zinc-700/80 rounded shadow-xl z-50 py-1`}
          onClick={(e) => {
            // close menu when clicking inside
            setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
