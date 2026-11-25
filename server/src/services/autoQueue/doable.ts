/**
 * Decides which unstarted tasks in a person's column they cannot finish before
 * their shift ends: asks the AI judge when available, and falls back to rules.
 */
import {
  DEFAULT_ESTIMATED_HOURS,
  isBoardItemStarted,
  itemHours,
  orderPoolForQueue,
  type BoardItem,
} from './rules';
import type { DoableAnswer } from './ollamaDoable';

export type JudgeFn = (remainingHours: number, items: BoardItem[]) => Promise<DoableAnswer | null>;

/**
 * Rules fallback: started tasks consume remaining hours first (never returned),
 * then unstarted tasks in pool order (urgent, high, due date, oldest) are kept
 * while the running total <= remainingHours. Returns IDs of the rest.
 */
export function rulesCannotFinish(
  items: BoardItem[],
  remainingHours: number,
  defaultHours = DEFAULT_ESTIMATED_HOURS
): string[] {
  const unstarted = orderPoolForQueue(items.filter((it) => !isBoardItemStarted(it)));
  if (remainingHours <= 0) return unstarted.map((it) => it.id);

  let used = items
    .filter(isBoardItemStarted)
    .reduce((sum, it) => sum + itemHours(it, defaultHours), 0);

  const cannotFinish: string[] = [];
  for (const it of unstarted) {
    const h = itemHours(it, defaultHours);
    if (used + h <= remainingHours) {
      used += h;
    } else {
      cannotFinish.push(it.id);
    }
  }
  return cannotFinish;
}

export async function decideDoable(
  items: BoardItem[],
  remainingHours: number,
  opts: { judge?: JudgeFn; defaultHours: number }
): Promise<{ cannotFinishIds: string[]; method: 'ai' | 'rules'; reason: string }> {
  const unstarted = orderPoolForQueue(items.filter((it) => !isBoardItemStarted(it)));
  if (unstarted.length === 0) {
    return { cannotFinishIds: [], method: 'rules', reason: 'No unstarted tasks' };
  }
  if (remainingHours <= 0) {
    return {
      cannotFinishIds: unstarted.map((it) => it.id),
      method: 'rules',
      reason: 'Shift already ended',
    };
  }

  if (opts.judge) {
    try {
      const answer = await opts.judge(remainingHours, items);
      if (answer) {
        const allowed = new Set(unstarted.map((it) => it.id));
        const seen = new Set<string>();
        const cannotFinishIds = answer.cannotFinishIds.filter((id) => {
          if (!allowed.has(id) || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        return { cannotFinishIds, method: 'ai', reason: answer.reason };
      }
    } catch {
      // Fall back to rules when the AI judge fails
    }
  }

  const cannotFinishIds = rulesCannotFinish(items, remainingHours, opts.defaultHours);
  return {
    cannotFinishIds,
    method: 'rules',
    reason: cannotFinishIds.length
      ? `Exceeds ${remainingHours.toFixed(1)}h remaining in shift`
      : 'Fits in remaining shift hours',
  };
}
