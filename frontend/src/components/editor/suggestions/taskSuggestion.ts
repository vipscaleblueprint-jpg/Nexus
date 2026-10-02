import { STATUS_COLORS } from '@/components/modals/TaskDetailModal';
import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';
import { TaskListDropdown } from './TaskListDropdown';
import { tasksApi } from '@/api/tasks';
import { useAppStore } from '@/lib/store';

let cachedTasks: any[] | null = null;
let cachedLists: any[] | null = null;


const getStatusColor = (status: string) => {
  const colorStr = STATUS_COLORS[status];
  if (!colorStr) return '#3b82f6';
  const match = colorStr.match(/bg-\[([^\]]+)\]/);
  return match ? match[1] : (colorStr.split(' ')[0] || '#3b82f6');
};

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
      // Use tasksIndex and allLists from Zustand store for instant suggestions
      const storeState = useAppStore.getState();
      const tasksIndex = storeState.tasksIndex || {};
      const allLists = storeState.allLists || [];
      cachedLists = allLists;
      const search = (query || '').toLowerCase();

      const taskItems: any[] = [];

      for (const key in tasksIndex) {
        if (taskItems.length >= 50) break;
        const task = tasksIndex[key];
        
        if (!search || (task.title || '').toLowerCase().includes(search)) {
          taskItems.push({
            ...task,
            type: 'task',
            name: task.title,
            statusColor: getStatusColor(task.status || ''),
            frequencyLabel: FREQUENCY_LABELS[task.status || ''] || null,
            listName: task.list?.name || '',
            listId: task.listId || task.list?.id || '',
          });
        }

        if (task.subtasks && task.subtasks.length > 0) {
          for (const st of task.subtasks) {
            if (taskItems.length >= 50) break;
            if (!search || (st.title || '').toLowerCase().includes(search)) {
              taskItems.push({
                ...st,
                isSubtask: true,
                type: 'task',
                name: `└─ ${st.title}`,
                statusColor: getStatusColor(st.status || ''),
                frequencyLabel: FREQUENCY_LABELS[st.status || ''] || null,
                listName: task.list?.name || '',
                listId: task.listId || task.list?.id || '',
              });
            }
          }
        }
      }

      // ── Board/list items ──────────────────────────────────────────────────────
      // Each allLists entry = { list: { id, name, color, icon, ... }, spaceName?, folderName? }
      const boardItems = (cachedLists || [])
        .filter((entry: any) => {
          const listName = entry.list?.name || entry.name || '';
          if (!search) return true;
          return listName.toLowerCase().includes(search);
        })
        
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


