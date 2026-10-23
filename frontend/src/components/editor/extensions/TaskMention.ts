import Mention from '@tiptap/extension-mention';
import { ReactNodeViewRenderer, mergeAttributes } from '@tiptap/react';
import { TaskMentionNode } from '../nodes/TaskMentionNode';

export const TaskMention = Mention.extend({
  name: 'mention',
  inline: true,
  group: 'inline',

  addOptions() {
    return {
      ...this.parent?.(),
      isComment: false,
    };
  },

  renderText({ node }) {
    return node.attrs.label || '';
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      taskStatus: {
        default: null,
        parseHTML: element => element.getAttribute('data-task-status'),
        renderHTML: attributes => {
          if (!attributes.taskStatus) return {};
          return { 'data-task-status': attributes.taskStatus };
        },
      },
      tasks: {
        default: null,
        parseHTML: element => element.getAttribute('data-tasks'),
        renderHTML: attributes => {
          if (!attributes.tasks) return {};
          return { 'data-tasks': attributes.tasks };
        },
      },
      mentionType: {
        default: 'task',
        parseHTML: element => element.getAttribute('data-mention-type'),
        renderHTML: attributes => {
          if (!attributes.mentionType) return {};
          return { 'data-mention-type': attributes.mentionType };
        },
      },
      taskAssignees: {
        default: null,
        parseHTML: element => element.getAttribute('data-task-assignees'),
        renderHTML: attributes => {
          if (!attributes.taskAssignees) return {};
          return { 'data-task-assignees': attributes.taskAssignees };
        },
      },
      taskPriority: {
        default: null,
        parseHTML: element => element.getAttribute('data-task-priority'),
        renderHTML: attributes => {
          if (!attributes.taskPriority) return {};
          return { 'data-task-priority': attributes.taskPriority };
        },
      },
      taskDueDate: {
        default: null,
        parseHTML: element => element.getAttribute('data-task-due-date'),
        renderHTML: attributes => {
          if (!attributes.taskDueDate) return {};
          return { 'data-task-due-date': attributes.taskDueDate };
        },
      },
      taskTeam: {
        default: null,
        parseHTML: element => element.getAttribute('data-task-team'),
        renderHTML: attributes => {
          if (!attributes.taskTeam) return {};
          return { 'data-task-team': attributes.taskTeam };
        },
      },
      taskHasDescription: {
        default: false,
        parseHTML: element => element.getAttribute('data-task-has-description') === 'true',
        renderHTML: attributes => {
          if (!attributes.taskHasDescription) return {};
          return { 'data-task-has-description': 'true' };
        },
      },
      taskListName: {
        default: '',
        parseHTML: element => element.getAttribute('data-task-list-name') || '',
        renderHTML: attributes => {
          if (!attributes.taskListName) return {};
          return { 'data-task-list-name': attributes.taskListName };
        },
      },
      // In-memory snapshot of the full task for the node view. It is deliberately NOT written back to
      // HTML: embedding the whole task (subtasks, comments, checklists) in every mention made saved pages
      // grow without bound. Older content that still carries data-task-data is read once for display.
      frozenTaskData: {
        default: null,
        parseHTML: element => {
          const attr = element.getAttribute('data-task-data');
          if (!attr) return null;
          try { return JSON.parse(attr); } catch(e) { return null; }
        },
        renderHTML: () => ({}),
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="mention"]',
      }
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        { 'data-type': this.name },
        this.options.HTMLAttributes,
        HTMLAttributes,
        {
          class: node.attrs.mentionType === 'status' ? 'kanban-column-mention' : 'task-mention',
          'data-id': node.attrs.id,
          'data-label': node.attrs.label || '',
          'data-mention-type': node.attrs.mentionType || 'task',
          'data-task-status': node.attrs.taskStatus || '',
          'data-tasks': node.attrs.tasks || '',
          'data-task-assignees': node.attrs.taskAssignees || '',
          'data-task-priority': node.attrs.taskPriority || '',
          'data-task-due-date': node.attrs.taskDueDate || '',
          'data-task-team': node.attrs.taskTeam || '',
          'data-task-has-description': node.attrs.taskHasDescription ? 'true' : '',
          'data-task-list-name': node.attrs.taskListName || '',
        }
      ),
      node.attrs.label || node.attrs.id
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TaskMentionNode);
  },
});
