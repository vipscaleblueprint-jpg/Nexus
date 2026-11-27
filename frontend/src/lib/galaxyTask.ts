import { Task } from '@/lib/types';

export interface GalaxyModalInitialData {
  mode?: 'task' | 'subtask';
  clientName?: string;
  parentTaskId?: string;
  parentTaskName?: string;
  taskLink?: string;
  title?: string;
  priority?: string;
  complexity?: string;
  goal?: string;
  prompt?: string;
}

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

/**
 * Dispatches an event to open the Galaxy task modal with optional prefilled data.
 */
export function openGalaxyTaskModal(data?: GalaxyModalInitialData) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('nexus:open-galaxy-task', { detail: data }));
}

/**
 * Opens the Galaxy task modal pre-configured in Subtask mode with parent task data filled in.
 */
export function openGalaxySubtaskForTask(task: Task | any, allLists?: any[]) {
  if (!task) return;

  // 1. Resolve client name
  let clientName = task.list?.name || '';
  if (!clientName && allLists && task.listId) {
    const matchedList = allLists.find((l: any) => (l.list?.id === task.listId || l.id === task.listId));
    clientName = matchedList?.name || matchedList?.list?.name || '';
  }

  // 2. Resolve parent task link
  let taskLink = '';
  const possibleExternal = task.externalId || task.clickupUrl || task.url || task.taskUrl;
  if (possibleExternal && typeof possibleExternal === 'string' && possibleExternal.trim()) {
    const ext = possibleExternal.trim();
    taskLink = ext.startsWith('http') ? ext : `https://app.clickup.com/t/${ext}`;
  } else if (task.description) {
    const cuMatch = task.description.match(/https?:\/\/(?:app\.)?clickup\.com\/t\/[a-zA-Z0-9_-]+/);
    if (cuMatch) {
      taskLink = cuMatch[0];
    }
  }

  if (!taskLink && typeof window !== 'undefined') {
    const origin = window.location.origin;
    taskLink = task.listId ? `${origin}/lists/${task.listId}?task=${task.id}` : `${origin}/tasks/${task.id}`;
  }

  openGalaxyTaskModal({
    mode: 'subtask',
    clientName,
    parentTaskId: task.id,
    parentTaskName: task.title,
    taskLink,
    priority: task.priority || undefined,
  });
}
