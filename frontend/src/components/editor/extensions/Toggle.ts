import { Node, mergeAttributes } from '@tiptap/core';

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
        tag: 'summary',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['summary', mergeAttributes(HTMLAttributes, { class: 'cursor-pointer font-bold select-none py-1' }), 0];
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
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle-content', class: 'pl-4 border-l border-zinc-200 dark:border-zinc-700 ml-2 mt-1 mb-2' }), 0];
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
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'details',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // We add 'open' by default so they start expanded
    return ['details', mergeAttributes({ open: true }, HTMLAttributes, { class: 'mb-2' }), 0];
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
