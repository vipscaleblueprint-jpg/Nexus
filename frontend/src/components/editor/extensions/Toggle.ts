import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ToggleNode } from '../nodes/ToggleNode';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggle: {
      setToggle: () => ReturnType;
    };
  }
}

export const ToggleSummary = Node.create({
  name: 'toggleSummary',

  group: 'block',
  content: 'inline*',

  parseHTML() {
    return [
      {
        tag: 'div[data-type="toggle-summary"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle-summary', class: 'font-bold py-0.5' }), 0];
  },
});

export const ToggleContent = Node.create({
  name: 'toggleContent',

  group: 'block',
  content: 'block+',

  parseHTML() {
    return [
      {
        tag: 'div[data-type="toggle-content"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle-content', class: 'mt-1 mb-2' }), 0];
  },
});

export const Toggle = Node.create({
  name: 'toggle',

  group: 'block',
  content: 'toggleSummary toggleContent',

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: element => element.getAttribute('id'),
        renderHTML: attributes => {
          if (!attributes.id) return {};
          return { id: attributes.id };
        },
      },
      open: {
        default: true,
        parseHTML: element => element.getAttribute('data-open') === 'true',
        renderHTML: attributes => {
          return { 'data-open': attributes.open };
        },
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="toggle"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'toggle' }, HTMLAttributes, { class: 'mb-2' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleNode);
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            content: [
              {
                type: 'toggleSummary',
              },
              {
                type: 'toggleContent',
                content: [
                  {
                    type: 'paragraph',
                  },
                ],
              },
            ],
          });
        },
    };
  },
});
