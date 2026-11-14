import { useState, useRef, useEffect } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { format } from 'date-fns';

export function DatePickerMenu({ 
  children, 
  onSelect 
}: { 
  children: React.ReactNode; 
  onSelect: (date: Date | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>();

  useEffect(() => {
    if (!open) return;
    const hide = () => setOpen(false);
    window.addEventListener('click', hide);
    return () => window.removeEventListener('click', hide);
  }, [open]);

  return (
    <div className="relative flex items-center justify-center">
      <div
        className="cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        {children}
      </div>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 bg-popover text-popover-foreground border border-border rounded-xl shadow-xl z-50 p-3"
          onClick={(e) => e.stopPropagation()}
        >
          <style>{`
            .rdp { --rdp-cell-size: 32px; --rdp-accent-color: #14b8a6; --rdp-background-color: rgba(20, 184, 166, 0.2); margin: 0; }
            .rdp-day_selected, .rdp-day_selected:focus-visible, .rdp-day_selected:hover { background-color: var(--rdp-accent-color); font-weight: bold; color: white; }
            .rdp-button:hover:not([disabled]):not(.rdp-day_selected) { background-color: var(--hover-subtle); }
            .rdp-day { border-radius: 6px; color: var(--foreground); font-size: 13px; }
            .rdp-caption { color: var(--foreground); }
            .rdp-head_cell { color: var(--muted-foreground); font-weight: 500; font-size: 12px; }
            .rdp-nav_button { color: var(--foreground); }
            .rdp-nav_button:hover { background-color: var(--hover-subtle); }
          `}</style>
          <DayPicker
            mode="single"
            selected={date}
            onSelect={(d) => {
              setDate(d);
              onSelect(d);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
