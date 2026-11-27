/**
 * Galaxy launch dates. Dates are stored at noon Manila time so the calendar day never
 * shifts across timezones; working days are Monday–Saturday (Sunday is not counted).
 */

const MANILA_OFFSET = '+08:00';

/** Related work must be finished this many working days before launch. */
export const LAUNCH_BUFFER_WORKDAYS = 2;
/** Hands-on hours one person gets through in a working day, for spacing due dates. */
export const WORK_HOURS_PER_DAY = 6;

/** "YYYY-MM-DD" -> Date at noon Manila. Undefined when absent, null when invalid. */
export function parseLaunchDate(value: unknown): Date | null | undefined {
  if (value == null || value === '') return undefined;
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T12:00:00${MANILA_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The Manila calendar day of `date`, as a Date at noon Manila. */
export function manilaNoon(date: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return new Date(`${ymd}T12:00:00${MANILA_OFFSET}`);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isSunday(noonManila: Date): boolean {
  // Noon Manila is 04:00 UTC the same calendar day, so the UTC weekday matches.
  return noonManila.getUTCDay() === 0;
}

/** Steps back `count` working days, not counting Sundays (Sun launch -> Fri for 2 days). */
export function subtractWorkdays(date: Date, count: number): Date {
  let d = manilaNoon(date);
  let left = count;
  while (left > 0) {
    d = new Date(d.getTime() - DAY_MS);
    if (!isSunday(d)) left--;
  }
  return d;
}

/** Last day related work may be due: launch minus the buffer, in working days. */
export function launchWorkDeadline(launchDate: Date): Date {
  return subtractWorkdays(launchDate, LAUNCH_BUFFER_WORKDAYS);
}

export type LaunchPhase = 'mockup' | 'migration' | 'other';

export interface ScheduleItem {
  id: string;
  hours: number;
  phase: LaunchPhase;
}

/**
 * Keyword guess at an item's phase, used when the AI gives none. Matches how the team names
 * them: "--Create Website Mockup" then "--Implement Approved Website Design", "--Build thank
 * you page", "--Develop Landing Page on GoDaddy" or "Migrate Sales Page to ClickFunnels".
 */
export function guessLaunchPhase(title: string): LaunchPhase {
  const t = (title || '').toLowerCase().replace(/mock[\s-]+up/g, 'mockup');
  // "Mock up migration - canva to website" is the migration itself.
  if (/migrat/.test(t)) return 'migration';
  if (/\b(obtain|get|seek|request)\b.*\bapproval\b|\bapproval for\b/.test(t)) return 'other';
  if (/mockup|wireframe/.test(t)) return 'mockup';
  if (/\b(build|implement|develop)\b.*\b(page|site|website|design|funnel)/.test(t)) return 'migration';
  if (/\b(page|site|website|funnel)\b.*\bbuild\b/.test(t)) return 'migration';
  return 'other';
}

/**
 * Work runs in parallel, so every item is due on the deadline, except mockups: they must be
 * done before migration starts, so they are due early enough to leave room for the longest
 * migration (at least one working day). Never earlier than today.
 */
export function scheduleLaunchItems(items: ScheduleItem[], deadline: Date, today: Date = new Date()): Map<string, Date> {
  const floor = manilaNoon(today);
  const clamp = (d: Date) => (d < floor ? floor : d);
  const migrationHours = Math.max(0, ...items.filter((i) => i.phase === 'migration').map((i) => i.hours));
  const hasMigration = items.some((i) => i.phase === 'migration');
  const mockupDue = hasMigration
    ? subtractWorkdays(deadline, Math.max(1, Math.ceil(migrationHours / WORK_HOURS_PER_DAY)))
    : deadline;

  const due = new Map<string, Date>();
  for (const item of items) due.set(item.id, clamp(item.phase === 'mockup' ? mockupDue : deadline));
  return due;
}
