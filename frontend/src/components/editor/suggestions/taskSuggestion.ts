import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';
import { TaskListDropdown } from './TaskListDropdown';
import { tasksApi } from '@/api/tasks';

let cachedTasks: any[] | null = null;

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

export const taskSuggestion = {
  char: '@', // Default trigger character
  
  items: async ({ query }: { query: string }) => {
    try {
      if (!cachedTasks) {
        const response = await tasksApi.getTasks();
        cachedTasks = response.tasks || [];
      }
      
      // Group tasks by status
      const groupedTasks = cachedTasks!.reduce((acc, task) => {
        const status = task.status || 'Pending';
        if (!acc[status]) acc[status] = [];
        acc[status].push(task);
        return acc;
      }, {} as Record<string, any[]>);

      const statusItems = Object.entries(groupedTasks).map(([statusName, tasks]) => ({
        id: `status-${statusName.toLowerCase().replace(/\s+/g, '-')}`,
        type: 'status',
        name: statusName,
        title: statusName,
        status: { name: statusName, color: getStatusColor(statusName) },
        tasks: tasks
      }));
      
      const normalTaskItems = cachedTasks!.map(task => ({
        ...task,
        type: 'task',
        name: task.title,
      }));

      const magicItems = [
        {
          id: 'magic-statuses',
          type: 'liveblock',
          blockType: 'statuses',
          name: 'Live Kanban Statuses',
          title: 'Live Kanban Statuses',
        },
        {
          id: 'magic-newtasks',
          type: 'liveblock',
          blockType: 'newtasks',
          name: 'Live New Tasks',
          title: 'Live New Tasks',
        }
      ];

      const allItems = [...magicItems, ...statusItems, ...normalTaskItems];
      
      return allItems
        .filter(item => {
          const search = (query || '').toLowerCase();
          return (item.name || '').toLowerCase().includes(search);
        })
        .slice(0, 15);
    } catch (error) {
      console.error('Failed to fetch tasks for mention suggestions', error);
      return [];
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

        if (!props.clientRect) {
          return;
        }

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

        if (!props.clientRect) {
          return;
        }

        if (popup && popup[0] && !popup[0].state.isDestroyed) {
          popup[0].setProps({
            getReferenceClientRect: props.clientRect,
          });
        }
      },

      onKeyDown(props: any) {
        if (props.event.key === 'Escape') {
          if (popup && popup[0] && !popup[0].state.isDestroyed) {
            popup[0].hide();
          }
          return true;
        }
        return (component?.ref as any)?.onKeyDown?.(props) || false;
      },

      onExit() {
        if (popup && popup[0] && !popup[0].state.isDestroyed) {
          popup[0].destroy();
        }
        if (component) {
          component.destroy();
        }
      },
    };
  },
};
