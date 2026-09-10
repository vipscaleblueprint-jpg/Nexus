import Mention from '@tiptap/extension-mention';
import { ReactNodeViewRenderer, mergeAttributes } from '@tiptap/react';
import { TaskMentionNode } from '../nodes/TaskMentionNode';

export const TaskMention = Mention.extend({
  name: 'mention',
  inline: true,
  group: 'inline',

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
          'data-task-due-date': node.attrs.taskDueDate || ''
        }
      ),
      node.attrs.label || node.attrs.id
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TaskMentionNode);
  },
});
