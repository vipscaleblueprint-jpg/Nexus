'use client';

import { useState, useEffect } from 'react';
import { toast, ToastItem } from '@/lib/toast';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    return toast.subscribe(setToasts);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none sm:max-w-md">
      {toasts.map((item) => {
        let borderClass = 'border-zinc-800';
        let bgClass = 'bg-zinc-950/90 text-zinc-100';
        let icon = <Info className="w-4 h-4 text-blue-400 shrink-0" />;

        if (item.type === 'success') {
          borderClass = 'border-emerald-500/40 shadow-emerald-950/20';
          icon = <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
        } else if (item.type === 'error') {
          borderClass = 'border-rose-500/40 shadow-rose-950/20';
          icon = <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />;
        } else if (item.type === 'warning') {
          borderClass = 'border-amber-500/40 shadow-amber-950/20';
          icon = <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
        }

        return (
          <div
            key={item.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 ${bgClass} ${borderClass}`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {icon}
              <span className="text-xs font-medium leading-snug break-words">
                {item.message}
              </span>
            </div>
            <button
              onClick={() => toast.remove(item.id)}
              className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors shrink-0"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
