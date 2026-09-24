import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';
import { TaskListDropdown } from './TaskListDropdown';
import { tasksApi } from '@/api/tasks';
import { useAppStore } from '@/lib/store';

let cachedTasks: any[] | null = null;
let cachedLists: any[] | null = null;

const STATUS_COLORS: Record<string, string> = {
  'KYC': '#06b6d4',
  'Pin Board': '#06b6d4',
  'Daily': '#a855f7',
  'Weekly': '#a855f7',
  'Monthly': '#a855f7',
  'Pending': '#6366f1',
  'In Progress': '#eab308',
  'Revision': '#6366f1',
  'Waiting': '#f97316',
  'In Review': '#6366f1',
  'Checking': '#6366f1',
  'On-Hold': '#ef4444',
  'Closed': '#10b981',
};
const getStatusColor = (status: string) => STATUS_COLORS[status] || '#3b82f6';

// Frequency badges — derived from status name
const FREQUENCY_LABELS: Record<string, string> = {
  'Daily': 'DAILY',
  'Weekly': 'WEEKLY',
  'Monthly': 'MONTHLY',
};

export const taskSuggestion = {
  char: '@',
  
  items: async ({ query }: { query: string }) => {
    try {
      // Fetch tasks (with caching)
      if (!cachedTasks) {
        const response = await tasksApi.getTasks();
        cachedTasks = response.tasks || [];
      }

      // Use allLists from Zustand store — already fetched and cached by the app at startup
      if (!cachedLists) {
        const storeAllLists = useAppStore.getState().allLists;
        cachedLists = storeAllLists || [];
      }

      const search = (query || '').toLowerCase();

      // ── Task items ────────────────────────────────────────────────────────────
      const taskItems = cachedTasks!
        .filter(task => {
          if (!search) return true;
          return (task.title || '').toLowerCase().includes(search);
        })
        .slice(0, 20)
        .map(task => ({
          ...task,
          type: 'task',
          name: task.title,
          statusColor: getStatusColor(task.status || ''),
          frequencyLabel: FREQUENCY_LABELS[task.status || ''] || null,
          // Board/list info for chip and display
          listName: task.list?.name || '',
          listId: task.listId || task.list?.id || '',
        }));

      // ── Board/list items ──────────────────────────────────────────────────────
      // Each allLists entry = { list: { id, name, color, icon, ... }, spaceName?, folderName? }
      const boardItems = (cachedLists || [])
        .filter((entry: any) => {
          const listName = entry.list?.name || entry.name || '';
          if (!search) return true;
          return listName.toLowerCase().includes(search);
        })
        .slice(0, 10)
        .map((entry: any) => {
          // Support both wrapped { list: {...} } and flat list objects
          const list = entry.list || entry;
          return {
            id: list.id,
            type: 'board',
            name: list.name,
            color: list.color || '#3b82f6',
            icon: list.icon || null,
            spaceName: entry.spaceName || '',
            folderName: entry.folderName || '',
          };
        });

      return { tasks: taskItems, boards: boardItems } as any;
    } catch (error) {
      console.error('Failed to fetch suggestions', error);
      return { tasks: [], boards: [] } as any;
    }
  },

  render: () => {
    let component: ReactRenderer;
    let popup: any;

    return {
      onStart: (props: any) => {
        component = new ReactRenderer(TaskListDropdown, {
          props,
          editor: props.editor,
        });

        if (!props.clientRect) return;

        popup = tippy('body', {
          getReferenceClientRect: props.clientRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        });
      },

      onUpdate(props: any) {
        component.updateProps(props);
        if (!props.clientRect) return;
        if (popup && popup[0] && !popup[0].state.isDestroyed) {
          popup[0].setProps({ getReferenceClientRect: props.clientRect });
        }
      },

      onKeyDown(props: any) {
        if (props.event.key === 'Escape') {
          if (popup && popup[0] && !popup[0].state.isDestroyed) popup[0].hide();
          return true;
        }
        return (component?.ref as any)?.onKeyDown?.(props) || false;
      },

      onExit() {
        if (popup && popup[0] && !popup[0].state.isDestroyed) popup[0].destroy();
        if (component) component.destroy();
        // Reset task cache every 5 minutes; list cache resets immediately (reads from store)
        setTimeout(() => { cachedTasks = null; }, 5 * 60 * 1000);
        cachedLists = null; // Always refresh from store on next open
      },
    };
  },
};
