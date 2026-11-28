/**
 * Work days from a user's Shift Schedule (UserShiftTime.schedule), e.g. "M-F 8AM to 5PM, Sat 9AM to 1PM".
 * Used by the Task Map auto-queue and audit auto-assign so people on their day off get no work.
 * Pure (no DB) apart from reading the clock in getManilaClock.
 */

export interface ManilaClock {
  /** 1 = Mon .. 7 = Sun */
  weekday: number;
  /** 0..1439 */
  minuteOfDay: number;
}

const MANILA_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila',
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Read once per run and pass to worksToday for every user (one consistent snapshot). */
export function getManilaClock(date: Date = new Date()): ManilaClock {
  let weekday = 0;
  let hour = 0;
  let minute = 0;
  for (const p of MANILA_PARTS.formatToParts(date)) {
    if (p.type === 'weekday') weekday = WEEKDAYS.indexOf(p.value) + 1;
    else if (p.type === 'hour') hour = parseInt(p.value, 10) % 24;
    else if (p.type === 'minute') minute = parseInt(p.value, 10);
  }
  return { weekday, minuteOfDay: hour * 60 + minute };
}

const DAY_TOKENS: Record<string, number> = {
  m: 1, mon: 1, monday: 1,
  t: 2, tu: 2, tue: 2, tues: 2, tuesday: 2,
  w: 3, wed: 3, wednesday: 3,
  th: 4, thu: 4, thur: 4, thurs: 4, thursday: 4,
  f: 5, fri: 5, friday: 5,
  s: 6, sa: 6, sat: 6, saturday: 6,
  su: 7, sun: 7, sunday: 7,
};

function parseDays(expr: string): number[] | null {
  const days = new Set<number>();
  for (const part of expr.trim().toLowerCase().split('/').map((p) => p.trim()).filter(Boolean)) {
    const bounds = part.split('-').map((b) => b.trim());
    if (bounds.length > 2) return null;
    const start = DAY_TOKENS[bounds[0]];
    const end = DAY_TOKENS[bounds[bounds.length - 1]];
    if (!start || !end) return null;
    for (let d = start, i = 0; i < 7; i++, d = d === 7 ? 1 : d + 1) {
      days.add(d);
      if (d === end) break;
    }
  }
  return days.size ? [...days] : null;
}

function toMinutes(t: string): number | null {
  const m = t.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + (m[2] ? parseInt(m[2], 10) : 0);
}

export interface ScheduleRule {
  /** 1 = Mon .. 7 = Sun (the day the shift starts) */
  days: number[];
  start: number;
  end: number;
}

const SEGMENT_RE = /^([A-Za-z]+(?:[-/][A-Za-z]+)*)\s+(\S+\s*[AaPp][Mm])\s+(?:to|-|–)\s+(\S+\s*[AaPp][Mm])$/i;

/** Parses a Shift Schedule string; null when empty or not in the canonical format. */
export function parseShiftSchedule(schedule?: string | null): ScheduleRule[] | null {
  const segments = (schedule || '').trim().split(/\s*[,;]\s*/).filter(Boolean);
  if (!segments.length) return null;
  const rules: ScheduleRule[] = [];
  for (const seg of segments) {
    const m = seg.match(SEGMENT_RE);
    if (!m) return null;
    const days = parseDays(m[1]);
    const start = toMinutes(m[2]);
    const end = toMinutes(m[3]);
    if (!days || start === null || end === null) return null;
    rules.push({ days, start, end });
  }
  return rules;
}

/**
 * Whether the user works now per their Shift Schedule: today is one of their days, or they're
 * still finishing an overnight shift that started yesterday (e.g. Fri 5PM-2AM at Sat 1AM).
 * No schedule / unparseable schedule = not working.
 */
export function worksToday(schedule: string | null | undefined, clock: ManilaClock): boolean {
  const rules = parseShiftSchedule(schedule);
  if (!rules) return false;
  const yesterday = clock.weekday === 1 ? 7 : clock.weekday - 1;
  return rules.some(
    (r) =>
      r.days.includes(clock.weekday) ||
      (r.end <= r.start && r.days.includes(yesterday) && clock.minuteOfDay < r.end)
  );
}
