/**
 * Utilities for dynamic browser tab titles and notification badges.
 */

export function formatTabTitle(title?: string | null): string {
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) {
    return 'Nexus — Enterprise Project Management Platform';
  }
  return `${cleanTitle} | Nexus`;
}

/**
 * Resolves a fallback title based on the pathname and optional query params / store cache.
 */
export function resolveRouteTitle(
  pathname: string,
  searchParams?: { get: (key: string) => string | null } | null,
  context?: {
    spaces?: any[];
    allLists?: any[];
    allDocs?: any[];
    tasksIndex?: Record<string, any>;
  }
): string {
  if (!pathname) return 'Nexus';

  if (pathname === '/login') return 'Log In';
  if (pathname === '/activity/priorities') return 'Priorities Journal';
  if (pathname.startsWith('/activity')) return 'Activity';
  if (pathname === '/team') return 'Member Directory';
  if (pathname === '/settings/users') return 'Users & Roles';
  if (pathname.startsWith('/settings')) return 'Account Settings';
  if (pathname.startsWith('/clickup')) return 'ClickUp Integration';
  if (pathname === '/spaces') return 'Spaces';
  if (pathname === '/folders') return 'Folders';
  if (pathname === '/lists') return 'Lists';
  if (pathname === '/docs') return 'Docs';
  if (pathname === '/tasks') return 'Tasks';

  // Dynamic /lists/[id]
  if (pathname.startsWith('/lists/')) {
    const listId = pathname.replace('/lists/', '').split('/')[0];
    if (context?.allLists) {
      const found = context.allLists.find(
        (item: any) => item?.list?.id === listId || item?.id === listId
      );
      if (found) {
        return found.list?.name || found.name || 'List';
      }
    }
    if (context?.spaces) {
      for (const space of context.spaces) {
        const found = space.lists?.find((l: any) => l.id === listId);
        if (found?.name) return found.name;
        if (space.folders) {
          for (const folder of space.folders) {
            const fList = folder.lists?.find((l: any) => l.id === listId);
            if (fList?.name) return fList.name;
          }
        }
      }
    }
    return 'List';
  }

  // Dynamic /docs/[id]
  if (pathname.startsWith('/docs/')) {
    const docId = pathname.replace('/docs/', '').split('/')[0];
    const pageId = searchParams?.get('page');

    if (context?.allDocs) {
      const found = context.allDocs.find(
        (item: any) => item?.doc?.id === docId || item?.id === docId
      );
      const doc = found?.doc || found;
      if (doc) {
        if (pageId && doc.pages) {
          const page = doc.pages.find((p: any) => p.id === pageId);
          if (page?.title) return page.title;
        }
        if (doc.title) return doc.title;
      }
    }
    return 'Doc';
  }

  // Dynamic /tasks/[taskId]
  if (pathname.startsWith('/tasks/')) {
    const taskId = pathname.replace('/tasks/', '').split('/')[0];
    if (context?.tasksIndex && context.tasksIndex[taskId]?.title) {
      return context.tasksIndex[taskId].title;
    }
    return 'Task';
  }

  // Root /
  if (pathname === '/') {
    const filter = searchParams?.get('filter');
    if (filter === 'my') return 'My Tasks';
    if (filter === 'clients') return 'Clients';
    if (filter === 'priorities') return 'Priorities';
    return 'Dashboard';
  }

  return 'Nexus';
}

let cachedBadgeIconUrl: string | null = null;
let isGeneratingBadge = false;

/**
 * Dynamically draws a notification dot on the tab favicon when there are unread notifications.
 */
export function updateFaviconBadge(hasUnread: boolean): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  try {
    let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
    if (!link) {
      link = document.createElement('link');
      link.type = 'image/x-icon';
      link.rel = 'shortcut icon';
      document.head.appendChild(link);
    }

    if (!hasUnread) {
      if (link.getAttribute('data-has-badge') === 'true') {
        link.href = '/favicon.ico';
        link.removeAttribute('data-has-badge');
      }
      return;
    }

    // Already has badge set
    if (link.getAttribute('data-has-badge') === 'true') {
      return;
    }

    // If we have a cached base64 icon with the badge, apply immediately
    if (cachedBadgeIconUrl) {
      link.href = cachedBadgeIconUrl;
      link.setAttribute('data-has-badge', 'true');
      return;
    }

    if (isGeneratingBadge) return;
    isGeneratingBadge = true;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          isGeneratingBadge = false;
          return;
        }

        ctx.drawImage(img, 0, 0, 32, 32);

        // Draw notification badge (red circle with white rim in top-right)
        const badgeX = 24;
        const badgeY = 8;
        const badgeRadius = 5.5;

        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeRadius + 1.5, 0, 2 * Math.PI);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeRadius, 0, 2 * Math.PI);
        ctx.fillStyle = '#EF4444';
        ctx.fill();

        cachedBadgeIconUrl = canvas.toDataURL('image/png');
        if (link) {
          link.href = cachedBadgeIconUrl;
          link.setAttribute('data-has-badge', 'true');
        }
      } catch (err) {
        console.warn('[tabManager] Failed to render favicon badge:', err);
      } finally {
        isGeneratingBadge = false;
      }
    };
    img.onerror = () => {
      isGeneratingBadge = false;
    };
    img.src = '/favicon.ico';
  } catch (err) {
    console.warn('[tabManager] Favicon update error:', err);
  }
}
