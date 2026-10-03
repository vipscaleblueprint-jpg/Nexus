import { STATUS_COLORS } from '@/components/modals/TaskDetailModal';
import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';
import { TaskListDropdown } from './TaskListDropdown';
import { tasksApi } from '@/api/tasks';
import { useAppStore } from '@/lib/store';

let cachedTasks: any[] | null = null;
let cachedLists: any[] | null = null;


const getStatusColor = (status: string) => {
  if (!status) return '#3b82f6';
  const colorStr = STATUS_COLORS[status.toUpperCase()];
  if (!colorStr) return '#3b82f6';
  const match = colorStr.match(/bg-\[([^\]]+)\]/);
  return match ? match[1] : (colorStr.split(' ')[0] || '#3b82f6');
};

// Frequency badges — derived from status name
const FREQUENCY_LABELS: Record<string, string> = {
  'DAILY': 'DAILY',
  'WEEKLY': 'WEEKLY',
  'MONTHLY': 'MONTHLY',
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
            frequencyLabel: FREQUENCY_LABELS[(task.status || '').toUpperCase()] || null,
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
                frequencyLabel: FREQUENCY_LABELS[(st.status || '').toUpperCase()] || null,
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
    let scrollHandler: any;
    let lastProps: any;

    return {
      onStart: (props: any) => {
        lastProps = props;
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
          animation: false,
          popperOptions: {
            modifiers: [
              { name: 'computeStyles', options: { adaptive: false } }
            ]
          }
        });
        
        if (popup && popup[0] && popup[0].popper) {
          popup[0].popper.style.transition = 'none';
        }

        scrollHandler = () => {
          if (popup && popup[0] && !popup[0].state.isDestroyed && lastProps?.clientRect) {
            popup[0].setProps({ getReferenceClientRect: lastProps.clientRect });
            if (popup[0].popper) popup[0].popper.style.transition = 'none';
          }
        };
        window.addEventListener('scroll', scrollHandler, true);
        window.addEventListener('resize', scrollHandler);
      },

      onUpdate(props: any) {
        lastProps = props;
        component.updateProps(props);
        if (!props.clientRect) return;
        if (popup && popup[0] && !popup[0].state.isDestroyed) {
          popup[0].setProps({ getReferenceClientRect: props.clientRect });
          if (popup[0].popper) popup[0].popper.style.transition = 'none';
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
        if (scrollHandler) {
          window.removeEventListener('scroll', scrollHandler, true);
          window.removeEventListener('resize', scrollHandler);
        }
        if (popup && popup[0] && !popup[0].state.isDestroyed) popup[0].destroy();
        if (component) component.destroy();
        setTimeout(() => { cachedTasks = null; }, 5 * 60 * 1000);
        cachedLists = null;
      },
    };
  },
};


