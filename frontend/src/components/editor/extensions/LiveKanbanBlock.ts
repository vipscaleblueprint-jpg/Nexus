import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { LiveKanbanBlockNode } from '../nodes/LiveKanbanBlockNode';

export const LiveKanbanBlock = Node.create({
  name: 'liveKanbanBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      blockType: {
        default: 'statuses',
        parseHTML: (element) => element.getAttribute('data-block-type'),
        renderHTML: (attributes) => ({ 'data-block-type': attributes.blockType }),
      },
      assigneeName: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-assignee-name'),
        renderHTML: (attributes) => ({ 'data-assignee-name': attributes.assigneeName }),
      },
      listId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-list-id'),
        renderHTML: (attributes) => ({ 'data-list-id': attributes.listId }),
      },
      frozenData: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const attr = element.getAttribute('data-frozen-data');
          if (!attr) return null;
          try {
            return JSON.parse(attr);
          } catch (e) {
            return null;
          }
        },
        renderHTML: (attributes: Record<string, any>) => {
          if (!attributes.frozenData) return {};
          return {
            'data-frozen-data': typeof attributes.frozenData === 'object' 
              ? JSON.stringify(attributes.frozenData) 
              : attributes.frozenData,
          };
        }
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="live-kanban-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'live-kanban-block' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LiveKanbanBlockNode);
  },
});
