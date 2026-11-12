/**
 * Task Navigation Helper for Opening Tasks in a New Tab
 * Supports Ctrl/Cmd + RightClick, Ctrl/Cmd + LeftClick, and MiddleClick (auxclick).
 */

export function resolveTaskIdFromElement(el: HTMLElement | null): { taskId?: string; subtaskId?: string } | null {
  if (!el) return null;

  // 1. Direct subtask identifier
  const subtaskEl = el.closest('[data-subtask-id]');
  if (subtaskEl) {
    const subtaskId = subtaskEl.getAttribute('data-subtask-id');
    if (subtaskId) return { subtaskId };
  }

  // 2. Direct task identifier
  const taskEl = el.closest('[data-task-id]');
  if (taskEl) {
    const taskId = taskEl.getAttribute('data-task-id');
    if (taskId) return { taskId };
  }

  // 3. Mention chip identifier
  const mentionEl = el.closest('[data-mention-id]');
  if (mentionEl) {
    const id = mentionEl.getAttribute('data-mention-id');
    if (id) return { taskId: id };
  }

  // 4. Element ID patterns
  const rowEl = el.closest('[id^="task-row-"]');
  if (rowEl) {
    const id = rowEl.id.replace('task-row-', '');
    if (id) return { taskId: id };
  }

  const kanbanCardEl = el.closest('[id^="kanban-card-"]');
  if (kanbanCardEl) {
    const id = kanbanCardEl.id.replace('kanban-card-', '');
    if (id) return { taskId: id };
  }

  // 5. Task links inside documents or comments
  const anchorEl = el.closest('a[href*="/tasks/"]') as HTMLAnchorElement | null;
  if (anchorEl) {
    const match = anchorEl.href.match(/\/tasks\/([a-zA-Z0-9_-]+)/);
    if (match?.[1]) return { taskId: match[1] };
  }

  return null;
}

export function openTaskInNewTab(
  taskId: string,
  options?: {
    fromPath?: string;
    subtaskId?: string | null;
    event?: React.MouseEvent | MouseEvent;
  }
) {
  if (options?.event) {
    try {
      options.event.preventDefault();
      options.event.stopPropagation();
    } catch {}
  }

  const targetId = options?.subtaskId || taskId;
  if (!targetId) return;

  const fromPath =
    options?.fromPath ||
    (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '');
  const targetUrl = `/tasks/${targetId}${fromPath ? `?from=${encodeURIComponent(fromPath)}` : ''}`;

  // 1. Native anchor element dispatch with target="_blank"
  try {
    const a = document.createElement('a');
    a.href = targetUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);

    // Dispatch native click event
    a.click();

    setTimeout(() => {
      try {
        if (a.parentNode) a.parentNode.removeChild(a);
      } catch {}
    }, 200);
  } catch (e) {
    console.warn('[openTaskInNewTab] anchor click failed:', e);
  }

  // 2. window.open fallback
  try {
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  } catch (e) {
    console.warn('[openTaskInNewTab] window.open failed:', e);
  }
}

/**
 * Universal capture-phase listener to catch Ctrl+RightClick, Ctrl+LeftClick,
 * and MiddleClick across any task card, row, or chip in the entire DOM.
 */
export function initGlobalTaskNewTabListeners() {
  if (typeof window === 'undefined') return () => {};

  const handleContextMenu = (e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const target = e.target as HTMLElement | null;
      const found = resolveTaskIdFromElement(target);
      if (found?.subtaskId || found?.taskId) {
        e.preventDefault();
        e.stopPropagation();
        openTaskInNewTab((found.subtaskId || found.taskId)!, { event: e });
      }
    }
  };

  const handleClick = (e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const target = e.target as HTMLElement | null;
      const found = resolveTaskIdFromElement(target);
      if (found?.subtaskId || found?.taskId) {
        e.preventDefault();
        e.stopPropagation();
        openTaskInNewTab((found.subtaskId || found.taskId)!, { event: e });
      }
    }
  };

  const handleAuxClick = (e: MouseEvent) => {
    // Button 1 is middle mouse button
    if (e.button === 1) {
      const target = e.target as HTMLElement | null;
      const found = resolveTaskIdFromElement(target);
      if (found?.subtaskId || found?.taskId) {
        e.preventDefault();
        e.stopPropagation();
        openTaskInNewTab((found.subtaskId || found.taskId)!, { event: e });
      }
    }
  };

  // Attach in capture phase so we intercept before any framework/modal/dnd-kit stops propagation
  window.addEventListener('contextmenu', handleContextMenu, true);
  window.addEventListener('click', handleClick, true);
  window.addEventListener('auxclick', handleAuxClick, true);

  return () => {
    window.removeEventListener('contextmenu', handleContextMenu, true);
    window.removeEventListener('click', handleClick, true);
    window.removeEventListener('auxclick', handleAuxClick, true);
  };
}

