import { Task } from '@/lib/types';

/**
 * Checks whether a task originated from Galaxy AI / VIP Scale webhook.
 * Galaxy tasks are tracked via externalId (ClickUp URL / Galaxy task link)
 * or authored by the system user "VIP Scale".
 */
export function isGalaxyTask(task: Task | any): boolean {
  if (!task) return false;
  if (task.externalId && typeof task.externalId === 'string' && task.externalId.trim().length > 0) {
    return true;
  }
  const creatorName = task.creator?.name || '';
  if (creatorName.toLowerCase().includes('vip scale') || creatorName.toLowerCase().includes('galaxy')) {
    return true;
  }
  return false;
}

/**
 * Resolves the URL for a Galaxy task.
 * If externalId holds the task URL, uses it; otherwise directs to VIP Scale Galaxy Task dashboard.
 */
export function getGalaxyTaskUrl(task?: Task | any): string {
  if (task?.externalId && typeof task.externalId === 'string' && task.externalId.startsWith('http')) {
    return task.externalId;
  }
  return 'https://tools.vipscaleph.com/protected/galaxy-task';
}
