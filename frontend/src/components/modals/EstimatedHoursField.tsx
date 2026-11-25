'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';

/** 0.5 -> "30m", 1 -> "1h", 2.75 -> "2h 45m" */
export function formatEstimatedHours(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

interface EstimatedHoursFieldProps {
  hours: number | null | undefined;
  /** PMs and Admins only (the server enforces the same rule). */
  canEdit: boolean;
  onSave: (hours: number | null) => Promise<void> | void;
}

/**
 * "Est. time" row for the task modal: shows Galaxy's AI estimate (or a PM's correction)
 * and lets PMs/Admins change or clear it. The Task Map uses it to balance work by time.
 */
export function EstimatedHoursField({ hours, canEdit, onSave }: EstimatedHoursFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEdit = () => {
    if (!canEdit) return;
    setDraft(hours != null ? String(hours) : '');
    setError(null);
    setEditing(true);
  };

  const commit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setEditing(false);
      if (hours != null) await onSave(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0 || n > 1000) {
      setError('Enter hours above 0, up to 1000');
      return;
    }
    const rounded = Math.max(0.25, Math.round(n * 4) / 4);
    setEditing(false);
    if (rounded !== hours) await onSave(rounded);
  };

  return (
    <div className="flex items-center gap-3 min-h-[32px]">
      <div className="flex items-center gap-2 w-28 shrink-0">
        <Clock className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
        <span className="text-[12px] text-zinc-500">Est. time</span>
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="number"
            min={0.25}
            max={1000}
            step={0.25}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(draft);
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={() => commit(draft)}
            placeholder="Hours"
            className="h-7 w-20 px-2 rounded-md bg-zinc-800/50 border border-zinc-700 text-[11px] text-zinc-200 outline-none focus:border-indigo-500"
          />
          <span className="text-[11px] text-zinc-500">hours · empty to clear</span>
          {error && <span className="text-[11px] text-red-400">{error}</span>}
        </div>
      ) : (
        <button
          type="button"
          onClick={startEdit}
          disabled={!canEdit}
          title={canEdit ? 'Edit estimated time' : 'Only Project Managers and Admins can edit the estimate'}
          className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] select-none w-fit bg-zinc-800/50 transition-colors ${
            canEdit ? 'cursor-pointer hover:bg-zinc-700/50' : 'cursor-default'
          } ${hours != null ? 'text-zinc-300' : 'text-zinc-500'}`}
        >
          {hours != null ? `~${formatEstimatedHours(hours)}` : canEdit ? 'Set estimate' : 'No estimate'}
        </button>
      )}
    </div>
  );
}
