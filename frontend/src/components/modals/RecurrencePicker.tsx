import React, { useState, useMemo } from 'react';
import { Task, RecurringConfig, RecurrencePausePreset } from '@/lib/types';
import { Clock, Calendar, Repeat, Sparkles, Check, Trash2, Copy, AlertCircle, PauseCircle, Play } from 'lucide-react';

export const PAUSE_PRESET_OPTIONS: Array<{ value: RecurrencePausePreset; label: string; shortLabel: string }> = [
  { value: '1d', label: 'Pause for 1 day', shortLabel: '1 day' },
  { value: '3d', label: 'Pause for 3 days', shortLabel: '3 days' },
  { value: '1w', label: 'Pause for 1 week', shortLabel: '1 week' },
  { value: '2w', label: 'Pause for 2 weeks', shortLabel: '2 weeks' },
  { value: 'indefinite', label: 'Pause indefinitely', shortLabel: 'Indefinitely' },
];

export function isTaskRecurrencePaused(config?: RecurringConfig | null): boolean {
  if (!config?.paused) return false;
  if (!config.pausedUntil) return true;
  const until = new Date(config.pausedUntil).getTime();
  if (isNaN(until)) return true;
  return Date.now() < until;
}

export function formatPausedLabel(config?: RecurringConfig | null): string {
  if (!isTaskRecurrencePaused(config)) return '';
  if (!config?.pausedUntil) return 'Paused indefinitely';
  const until = new Date(config.pausedUntil);
  if (isNaN(until.getTime())) return 'Paused indefinitely';
  const formatted = until.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `Paused until ${formatted}`;
}

export function formatPausedShortLabel(config?: RecurringConfig | null): string {
  if (!isTaskRecurrencePaused(config)) return '';
  if (!config?.pausedUntil) return 'Paused';
  const until = new Date(config.pausedUntil);
  if (isNaN(until.getTime())) return 'Paused';
  const formatted = until.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `Paused · ${formatted}`;
}

interface RecurrencePickerProps {
  task: Task;
  defaultFrequency?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  onSave: (config: RecurringConfig | null, triggerImmediate: boolean) => Promise<void>;
  onPauseRecurrence?: (preset: RecurrencePausePreset | null) => Promise<void>;
  onDuplicateNow?: () => Promise<void>;
  onClose?: () => void;
}

const PRESET_TIMES = [
  { label: '9:00 AM', value: '09:00', display: '9am' },
  { label: '12:00 PM', value: '12:00', display: '12pm' },
  { label: '2:00 PM', value: '14:00', display: '2pm' },
  { label: '6:00 PM', value: '18:00', display: '6pm' },
  { label: '9:00 PM', value: '21:00', display: '9pm' },
  { label: '9:30 PM', value: '21:30', display: '9:30pm' },
  { label: '11:00 PM', value: '23:00', display: '11pm' },
];

const DAYS_OF_WEEK = [
  { label: 'Mon', value: 1, short: 'M' },
  { label: 'Tue', value: 2, short: 'T' },
  { label: 'Wed', value: 3, short: 'W' },
  { label: 'Thu', value: 4, short: 'Th' },
  { label: 'Fri', value: 5, short: 'F' },
  { label: 'Sat', value: 6, short: 'Sa' },
  { label: 'Sun', value: 0, short: 'Su' },
];

/** Formats time "HH:mm" into "9pm" or "9:30pm" */
export function formatTimeDisplay(timeStr: string): string {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr || '0', 10);
  const m = parseInt(mStr || '0', 10);
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, '0')}${ampm}`;
}

/** Formats date into mm-dd-yyyy */
export function formatDateDisplay(date: Date = new Date()): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${mm}-${dd}-${yyyy}`;
}

export function RecurrencePicker({
  task,
  defaultFrequency,
  onSave,
  onPauseRecurrence,
  onDuplicateNow,
  onClose,
}: RecurrencePickerProps) {
  const existingConfig = task.recurringConfig;
  const isPaused = isTaskRecurrencePaused(existingConfig);
  const pausedLabel = formatPausedLabel(existingConfig);
  const [isPausing, setIsPausing] = useState(false);

  // Frequency is based directly on task status for DAILY, WEEKLY, MONTHLY
  const statusUpper = ((task as any).status || '').toUpperCase().trim();
  const isStatusDefined = ['DAILY', 'WEEKLY', 'MONTHLY'].includes(statusUpper);

  const statusBasedFrequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' = useMemo(() => {
    if (statusUpper === 'DAILY') return 'DAILY';
    if (statusUpper === 'WEEKLY') return 'WEEKLY';
    if (statusUpper === 'MONTHLY') return 'MONTHLY';
    if (defaultFrequency) return defaultFrequency;
    if (existingConfig?.frequency) return existingConfig.frequency;
    return 'DAILY';
  }, [statusUpper, defaultFrequency, existingConfig?.frequency]);

  const [customFrequency, setCustomFrequency] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>(statusBasedFrequency);
  const frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' = isStatusDefined ? statusBasedFrequency : customFrequency;
  const [time, setTime] = useState<string>(existingConfig?.time || '21:00'); // default 9:00 PM
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    existingConfig?.daysOfWeek && existingConfig.daysOfWeek.length > 0
      ? existingConfig.daysOfWeek
      : [1, 2, 3, 4, 5] // default Mon to Fri
  );
  const [dayOfMonth, setDayOfMonth] = useState<number>(existingConfig?.dayOfMonth || new Date().getDate());
  const [isSaving, setIsSaving] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);

  const formattedTime = useMemo(() => formatTimeDisplay(time), [time]);
  const formattedDate = useMemo(() => formatDateDisplay(), []);

  // Live preview of the title that will be generated in PENDING (date only)
  const previewTitle = useMemo(() => {
    const clean = (task.title || 'Untitled Task')
      .replace(/\s+\d{2}-\d{2}-\d{4}(?:\s+\d{1,2}(?::\d{2})?(?:am|pm))?$/i, '')
      .trim();
    return `${clean} ${formattedDate}`;
  }, [task.title, formattedDate]);

  const handleToggleDay = (dayVal: number) => {
    setDaysOfWeek((prev) => {
      if (prev.includes(dayVal)) {
        if (prev.length === 1) return prev; // keep at least 1 day
        return prev.filter((d) => d !== dayVal);
      } else {
        return [...prev, dayVal].sort();
      }
    });
  };

  const handleSelectWorkdays = () => {
    setDaysOfWeek([1, 2, 3, 4, 5]);
  };

  const handleSave = async (triggerImmediate: boolean) => {
    try {
      setIsSaving(true);
      const config: RecurringConfig = {
        frequency,
        time,
        daysOfWeek: frequency === 'WEEKLY' ? daysOfWeek : undefined,
        dayOfMonth: frequency === 'MONTHLY' ? dayOfMonth : undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Singapore',
        lastRunAt: triggerImmediate ? new Date().toISOString() : existingConfig?.lastRunAt,
        ...(existingConfig?.paused
          ? {
              paused: existingConfig.paused,
              pausedUntil: existingConfig.pausedUntil ?? null,
              pausedAt: existingConfig.pausedAt ?? null,
              pausePreset: existingConfig.pausePreset ?? null,
            }
          : {}),
      };
      await onSave(config, triggerImmediate);
      if (onClose) onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    try {
      setIsSaving(true);
      await onSave(null, false);
      if (onClose) onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleManualDuplicate = async () => {
    if (!onDuplicateNow) return;
    try {
      setIsDuplicating(true);
      await onDuplicateNow();
      if (onClose) onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsDuplicating(false);
    }
  };

  const handlePauseSelect = async (preset: RecurrencePausePreset | null) => {
    if (!onPauseRecurrence) return;
    try {
      setIsPausing(true);
      await onPauseRecurrence(preset);
      if (onClose) onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsPausing(false);
    }
  };

  return (
    <div className="w-[320px] p-3.5 bg-card border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl text-foreground select-none flex flex-col gap-3 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800/80">
        <div className="flex items-center gap-2">
          <Repeat className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
            Set Recurring Schedule
          </span>
        </div>
        {existingConfig && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              isPaused
                ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
                : 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300'
            }`}
          >
            {isPaused ? 'Paused' : 'Active'}
          </span>
        )}
      </div>

      {/* Dark mode styling for HTML5 time picker indicator & popup */}
      <style>{`
        .recurrence-time-input {
          color-scheme: dark !important;
        }
        .recurrence-time-input::-webkit-calendar-picker-indicator {
          cursor: pointer;
          filter: brightness(0) invert(1);
          opacity: 0.9;
          transition: opacity 0.15s ease-in-out;
        }
        .recurrence-time-input::-webkit-calendar-picker-indicator:hover {
          opacity: 1;
        }
      `}</style>

      {/* Frequency: Based on Task Status */}
      {isStatusDefined ? (
        <div className="flex items-center justify-between px-3 py-1.5 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-500/30 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-600 dark:bg-purple-500"></span>
            </span>
            <span className="text-xs font-bold text-purple-950 dark:text-zinc-100">
              {statusUpper === 'DAILY' ? 'Daily Schedule' : statusUpper === 'WEEKLY' ? 'Weekly Schedule' : 'Monthly Schedule'}
            </span>
          </div>
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-600/30 text-purple-700 dark:text-purple-200 border border-purple-300 dark:border-purple-500/40">
            {statusUpper}
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1 bg-zinc-100 dark:bg-zinc-900/80 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800/60">
          {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setCustomFrequency(f)}
              className={`py-1.5 text-[11px] font-semibold rounded-md transition-all ${
                frequency === f
                  ? 'bg-purple-600 text-[#ffffff] shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/50'
              }`}
            >
              {f === 'DAILY' ? 'Daily' : f === 'WEEKLY' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
      )}

      {frequency === 'WEEKLY' && (
        <div className="flex flex-col gap-2 p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800/50">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
              Days: Mon to Fri
            </label>
            <button
              type="button"
              onClick={handleSelectWorkdays}
              className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:underline transition-colors"
            >
              Select Mon-Fri
            </button>
          </div>
          <div className="flex items-center justify-between gap-1">
            {DAYS_OF_WEEK.map((d) => {
              const isSelected = daysOfWeek.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => handleToggleDay(d.value)}
                  className={`w-7 h-7 text-[11px] font-bold rounded-md transition-all flex items-center justify-center ${
                    isSelected
                      ? 'bg-purple-600 text-[#ffffff] shadow-sm ring-1 ring-purple-400/50'
                      : 'bg-zinc-100 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                  title={d.label}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {frequency === 'MONTHLY' && (
        <div className="flex flex-col gap-2 p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800/50">
          <label className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
            Every Month Date
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Day:</span>
            <input
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val)) setDayOfMonth(Math.max(1, Math.min(31, val)));
              }}
              className="w-16 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700/80 rounded-md px-2 py-1 text-center text-xs text-zinc-900 dark:text-zinc-100 font-bold focus:outline-none focus:border-purple-500 shadow-inner"
            />
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">of every month</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setDayOfMonth(1)}
              className="text-[10px] px-2 py-0.5 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium"
            >
              1st
            </button>
            <button
              type="button"
              onClick={() => setDayOfMonth(15)}
              className="text-[10px] px-2 py-0.5 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium"
            >
              15th
            </button>
            <button
              type="button"
              onClick={() => setDayOfMonth(new Date().getDate())}
              className="text-[10px] px-2 py-0.5 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium"
            >
              Today ({new Date().getDate()})
            </button>
          </div>
        </div>
      )}

      {/* Time Picker & Quick Presets */}
      <div className="flex flex-col gap-1.5 pt-1">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
            Set Time ({formattedTime || 'e.g. 9pm or 9:30pm'})
          </label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            style={{ colorScheme: 'dark' }}
            className="recurrence-time-input bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700/80 rounded px-2.5 py-1 text-xs text-zinc-900 dark:text-zinc-100 font-semibold focus:outline-none focus:border-purple-500 shadow-inner [color-scheme:dark]"
          />
        </div>

        {/* Quick time preset chips */}
        <div className="flex flex-wrap gap-1 mt-1">
          {PRESET_TIMES.map((p) => {
            const isMatch = time === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setTime(p.value)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  isMatch
                    ? 'bg-purple-600 text-[#ffffff] font-bold ring-1 ring-purple-400'
                    : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {p.display}
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Title Preview in PENDING */}
      <div className="p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900/90 border border-purple-200 dark:border-purple-500/20 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-purple-700 dark:text-purple-400 uppercase tracking-wider flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-purple-600 dark:text-purple-400" /> Creates in Pending:
          </span>
        </div>
        <p className="text-[11px] text-zinc-900 dark:text-zinc-100 font-medium break-words leading-tight">
          {previewTitle}
        </p>
      </div>

      {/* Pause Recurrence Section */}
      {onPauseRecurrence && (
        <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800/80">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5">
              <PauseCircle className={`w-3.5 h-3.5 shrink-0 ${isPaused ? 'text-amber-500' : 'text-zinc-500 dark:text-zinc-400'}`} />
              {isPaused ? pausedLabel : 'Pause Recurrence'}
            </span>
            {isPaused && (
              <button
                type="button"
                disabled={isPausing}
                onClick={() => handlePauseSelect(null)}
                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                <Play className="w-2.5 h-2.5 fill-current" />
                Resume
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {PAUSE_PRESET_OPTIONS.map((opt) => {
              const isSelected = isPaused && existingConfig?.pausePreset === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={isPausing}
                  onClick={() => handlePauseSelect(opt.value)}
                  className={`text-[10px] px-2 py-0.5 rounded transition-colors cursor-pointer disabled:opacity-50 ${
                    isSelected
                      ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold ring-1 ring-amber-500/50'
                      : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 hover:bg-amber-500/15 hover:text-amber-700 dark:hover:text-amber-300'
                  }`}
                >
                  {opt.shortLabel}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2 pt-1 border-t border-zinc-200 dark:border-zinc-800/80">
        <button
          type="button"
          disabled={isSaving}
          onClick={() => handleSave(true)}
          className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-[#ffffff] text-xs font-bold rounded-lg shadow-md transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5 text-[#ffffff]" />
          <span className="text-[#ffffff]">{isSaving ? 'Saving...' : 'Save & Duplicate to PENDING'}</span>
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={isSaving}
            onClick={() => handleSave(false)}
            className="flex-1 py-1.5 px-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-[11px] font-medium rounded-lg transition-colors cursor-pointer text-center"
          >
            Save Schedule Only
          </button>

          {existingConfig && (
            <button
              type="button"
              disabled={isSaving}
              onClick={handleClear}
              title="Clear recurrence"
              className="p-1.5 hover:bg-red-500/20 text-zinc-500 hover:text-red-400 rounded-lg transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {existingConfig && onDuplicateNow && (
          <button
            type="button"
            disabled={isDuplicating}
            onClick={handleManualDuplicate}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-purple-700 dark:text-purple-300 text-[11px] font-medium rounded-lg transition-colors cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            <span>{isDuplicating ? 'Duplicating...' : 'Duplicate to Pending Now'}</span>
          </button>
        )}
      </div>
    </div>
  );
}
