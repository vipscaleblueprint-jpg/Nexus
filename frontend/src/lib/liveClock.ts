import { useState, useEffect } from 'react';

type ClockListener = (now: Date) => void;
const listeners = new Set<ClockListener>();
let clockInterval: ReturnType<typeof setInterval> | null = null;
let currentClockTime = new Date();

function startClockIfNeeded() {
  if (!clockInterval && listeners.size > 0) {
    clockInterval = setInterval(() => {
      currentClockTime = new Date();
      listeners.forEach((fn) => fn(currentClockTime));
    }, 10000);
  }
}

function stopClockIfEmpty() {
  if (clockInterval && listeners.size === 0) {
    clearInterval(clockInterval);
    clockInterval = null;
  }
}

/**
 * Shared synchronized live clock for active in-progress task badges.
 *
 * Preserves 100% uniformity across all cards by using a single singleton clock source,
 * while ensuring that ONLY components displaying active counting badges re-render when the
 * clock ticks—completely shielding the main board, column lists, and drag-and-drop hierarchy
 * from unnecessary re-renders.
 */
export function useLiveClock(enabled: boolean = true): Date {
  const [now, setNow] = useState<Date>(() => currentClockTime);

  useEffect(() => {
    if (!enabled) return;
    setNow(currentClockTime);
    listeners.add(setNow);
    startClockIfNeeded();
    return () => {
      listeners.delete(setNow);
      stopClockIfEmpty();
    };
  }, [enabled]);

  return enabled ? now : currentClockTime;
}

export function getCurrentLiveTime(): Date {
  return currentClockTime;
}

