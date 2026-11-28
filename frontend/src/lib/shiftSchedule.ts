export type ShiftKind = 'DAY' | 'MID' | 'NIGHT' | 'UNASSIGNED';

export interface ShiftRule {
  id: string;
  /** Day indices: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun */
  days: number[];
  startTime: string;
  endTime: string;
}

export interface DayOption {
  index: number;
  short: string;
  label: string;
  full: string;
}

export const DAYS_OF_WEEK: DayOption[] = [
  { index: 1, short: 'M', label: 'Mon', full: 'Monday' },
  { index: 2, short: 'T', label: 'Tue', full: 'Tuesday' },
  { index: 3, short: 'W', label: 'Wed', full: 'Wednesday' },
  { index: 4, short: 'Th', label: 'Thu', full: 'Thursday' },
  { index: 5, short: 'F', label: 'Fri', full: 'Friday' },
  { index: 6, short: 'Sa', label: 'Sat', full: 'Saturday' },
  { index: 7, short: 'Su', label: 'Sun', full: 'Sunday' },
];

export const QUICK_SCHEDULES = [
  'M-F 8AM to 5PM',
  'M-F 9AM to 4PM',
  'M-F 11AM to 8PM',
  'M-F 5PM to 2AM',
  'T-S 8AM to 5PM',
  'T-S 11AM to 8PM',
  'T-S 5PM to 2AM',
  'T-F 8AM to 5PM',
];

/** Standard 30-minute time options in canonical format (e.g. "8AM", "8:30AM", "1PM") */
export const TIME_OPTIONS: string[] = (() => {
  const opts: string[] = [];
  for (let h = 0; h < 24; h++) {
    const period = h < 12 ? 'AM' : 'PM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    opts.push(`${hour12}${period}`);
    opts.push(`${hour12}:30${period}`);
  }
  return opts;
})();

const DAY_TOKEN_MAP: Record<string, number> = {
  m: 1,
  mon: 1,
  monday: 1,
  t: 2,
  tu: 2,
  tue: 2,
  tues: 2,
  tuesday: 2,
  w: 3,
  wed: 3,
  wednesday: 3,
  th: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  f: 5,
  fri: 5,
  friday: 5,
  s: 6,
  sa: 6,
  sat: 6,
  saturday: 6,
  su: 7,
  sun: 7,
  sunday: 7,
};

const RANGE_START_SHORT: Record<number, string> = {
  1: 'M',
  2: 'T',
  3: 'W',
  4: 'Th',
  5: 'F',
  6: 'Sa',
  7: 'Su',
};

const SINGLE_DAY_LABEL: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

export function createRuleId(): string {
  return `rule_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Normalizes a time token like "8 am", "08:00AM", "1:30 pm" to canonical "8AM" / "1:30PM".
 */
export function normalizeTimeToken(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const mins = match[2] ? parseInt(match[2], 10) : 0;
  if (hour < 1 || hour > 12 || mins < 0 || mins > 59) return null;
  const period = match[3].toUpperCase();
  return mins === 0 ? `${hour}${period}` : `${hour}:${String(mins).padStart(2, '0')}${period}`;
}

/**
 * Converts a canonical time string like "8AM", "1:30PM", "12AM" into minutes since midnight (0..1439).
 */
export function timeToMinutes(time: string): number | null {
  const match = time.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const mins = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3].toUpperCase();
  if (hour < 1 || hour > 12 || mins < 0 || mins > 59) return null;
  if (period === 'AM') {
    if (hour === 12) hour = 0;
  } else {
    if (hour !== 12) hour += 12;
  }
  return hour * 60 + mins;
}

/**
 * Parses a day expression like "M-F", "T-S", "M-Th", "Fri", "Mon/Wed/Fri" into sorted unique day numbers (1..7).
 */
export function parseDaysExpression(expr: string): number[] | null {
  const cleaned = expr.trim().toLowerCase();
  if (!cleaned) return null;

  const days = new Set<number>();
  const parts = cleaned.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  for (const part of parts) {
    if (part.includes('-')) {
      const bounds = part.split('-').map((b) => b.trim());
      if (bounds.length !== 2) return null;
      const start = DAY_TOKEN_MAP[bounds[0]];
      const end = DAY_TOKEN_MAP[bounds[1]];
      if (!start || !end) return null;

      let cur = start;
      for (let i = 0; i < 7; i++) {
        days.add(cur);
        if (cur === end) break;
        cur = cur === 7 ? 1 : cur + 1;
      }
    } else {
      const d = DAY_TOKEN_MAP[part];
      if (!d) return null;
      days.add(d);
    }
  }

  return Array.from(days).sort((a, b) => a - b);
}

/**
 * Formats a set of day numbers (1..7) into the canonical shorthand.
 * Preserves existing Nexus canonical ranges (M-F, T-S, T-F) and uses clear labels for overrides (M-Th, Fri, Mon/Wed/Fri).
 */
export function formatDaysExpression(days: number[]): string {
  const unique = Array.from(new Set(days.filter((d) => d >= 1 && d <= 7))).sort((a, b) => a - b);
  if (unique.length === 0) return '';
  if (unique.length === 1) return SINGLE_DAY_LABEL[unique[0]];

  // Check if contiguous (e.g. 1..5, 2..6, 1..4)
  let contiguous = true;
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] !== unique[i - 1] + 1) {
      contiguous = false;
      break;
    }
  }

  if (contiguous && unique.length >= 3) {
    const first = unique[0];
    const last = unique[unique.length - 1];
    // Preserve exact legacy canonical strings: M-F, T-S, T-F
    if (first === 2 && last === 6) return 'T-S';
    return `${RANGE_START_SHORT[first]}-${RANGE_START_SHORT[last]}`;
  }

  if (contiguous && unique.length === 2) {
    return `${SINGLE_DAY_LABEL[unique[0]]}-${SINGLE_DAY_LABEL[unique[1]]}`;
  }

  // Non-contiguous days: slash-separated short labels (e.g. Mon/Wed/Fri)
  return unique.map((d) => SINGLE_DAY_LABEL[d]).join('/');
}

/**
 * Parses a full schedule string (single or comma-separated multi-segment) into structured ShiftRules.
 * Returns null if the string is non-empty and cannot be parsed cleanly (freeform fallback).
 */
export function parseSchedule(schedule: string): ShiftRule[] | null {
  const trimmed = (schedule || '').trim();
  if (!trimmed) return [];

  const segments = trimmed
    .split(/\s*[,;]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const rules: ShiftRule[] = [];

  for (const seg of segments) {
    const match = seg.match(
      /^([A-Za-z]+(?:[-/][A-Za-z]+)*)\s+(\d{1,2}(?::\d{2})?\s*[AaPp][Mm])\s+(?:to|-|–)\s+(\d{1,2}(?::\d{2})?\s*[AaPp][Mm])$/i
    );
    if (!match) return null;

    const days = parseDaysExpression(match[1]);
    const startTime = normalizeTimeToken(match[2]);
    const endTime = normalizeTimeToken(match[3]);
    if (!days || days.length === 0 || !startTime || !endTime) return null;

    rules.push({
      id: createRuleId(),
      days,
      startTime,
      endTime,
    });
  }

  return rules;
}

/**
 * Formats structured ShiftRules back into the canonical comma-separated string.
 * Example: [{ days: [1,2,3,4], startTime: '8AM', endTime: '5PM' }, { days: [5], startTime: '1PM', endTime: '9PM' }]
 * -> "M-Th 8AM to 5PM, Fri 1PM to 9PM"
 */
export function formatSchedule(rules: ShiftRule[]): string {
  return rules
    .filter((r) => r.days.length > 0 && r.startTime && r.endTime)
    .map((r) => `${formatDaysExpression(r.days)} ${r.startTime} to ${r.endTime}`)
    .join(', ');
}

/**
 * Splits a schedule string into displayable segment strings.
 */
export function splitScheduleSegments(schedule: string): string[] {
  const trimmed = (schedule || '').trim();
  if (!trimmed) return [];
  return trimmed
    .split(/\s*[,;]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Classifies a single segment by its START time (accurate even when end time is 5PM/8PM/2AM).
 * - Start 4:00 AM .. 10:59 AM -> DAY
 * - Start 11:00 AM .. 4:59 PM -> MID (e.g. 11AM to 8PM, 1PM to 9PM)
 * - Start 5:00 PM .. 3:59 AM  -> NIGHT (e.g. 5PM to 2AM, 9PM to 6AM)
 */
export function classifySegment(segment: string): ShiftKind {
  const trimmed = (segment || '').trim();
  if (!trimmed) return 'UNASSIGNED';

  const parsed = parseSchedule(trimmed);
  if (parsed && parsed.length > 0) {
    const startMins = timeToMinutes(parsed[0].startTime);
    if (startMins !== null) {
      if (startMins >= 17 * 60 || startMins < 4 * 60) return 'NIGHT';
      if (startMins >= 11 * 60) return 'MID';
      return 'DAY';
    }
  }

  // Fallback for non-standard freeform strings
  const s = trimmed.toUpperCase();
  if (s.includes('NIGHT') || s.includes('2AM') || s.includes('6PM') || s.includes('7PM')) return 'NIGHT';
  if (s.includes('MID') || s.includes('11AM') || s.includes('12PM') || s.includes('1PM')) return 'MID';
  return 'DAY';
}

/**
 * Returns all unique ShiftKinds present in a schedule (supports multi-segment schedules).
 */
export function getScheduleShiftKinds(schedule: string): ShiftKind[] {
  const segments = splitScheduleSegments(schedule);
  if (segments.length === 0) return ['UNASSIGNED'];
  const kinds = new Set<ShiftKind>();
  for (const seg of segments) {
    kinds.add(classifySegment(seg));
  }
  return Array.from(kinds);
}

/**
 * Primary shift classification for a schedule (first segment's shift kind).
 */
export function classifyShift(schedule: string): ShiftKind {
  return getScheduleShiftKinds(schedule)[0] ?? 'UNASSIGNED';
}

export function shiftBadgeStyle(segmentOrSchedule: string): string {
  const kind = classifySegment(segmentOrSchedule);
  if (kind === 'NIGHT') return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
  if (kind === 'MID') return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
  if (kind === 'DAY') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  return 'bg-zinc-800/80 text-zinc-500 border-zinc-700/60';
}
