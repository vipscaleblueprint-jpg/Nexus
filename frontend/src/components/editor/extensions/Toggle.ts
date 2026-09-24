import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Selection } from '@tiptap/pm/state';
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

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        return this.editor.commands.command(({ tr, state, dispatch }) => {
          const { $from } = state.selection;
          // Only apply this inside toggleSummary
          if ($from.parent.type.name !== 'toggleSummary') {
            return false;
          }

          if (dispatch) {
            // Find the start of the toggleContent, which is immediately after this summary
            const toggleContentPos = $from.after($from.depth);
            // Put the cursor inside the toggleContent's first block (e.g., paragraph)
            const resolvedPos = state.doc.resolve(toggleContentPos + 1);
            const selection = Selection.near(resolvedPos);
            tr.setSelection(selection);
          }
          
          return true; // prevent default behavior (which would add a newline)
        });
      },

      // Shift+Enter inside toggleSummary: insert a soft line break (hardBreak)
      'Shift-Enter': () => {
        return this.editor.commands.command(({ state }) => {
          const { $from } = state.selection;
          if ($from.parent.type.name !== 'toggleSummary') {
            return false;
          }
          return this.editor.chain()
            .focus()
            .insertContent({ type: 'hardBreak' })
            .run();
        });
      },

      Backspace: () => {
        return this.editor.commands.command(({ state, dispatch, commands, tr }) => {
          const { $from, empty } = state.selection;
          // CRITICAL: Only intercept when cursor is COLLAPSED (empty selection).
          // When there IS a selection, let Tiptap/ProseMirror handle it natively
          // so that selecting text inside a toggle and pressing Delete works correctly.
          if (!empty || $from.parent.type.name !== 'toggleSummary') {
            return false;
          }

          // If at the very beginning of the toggle summary
          if ($from.parentOffset === 0) {
            const toggleNode = $from.node($from.depth - 1);
            if (toggleNode && toggleNode.type.name === 'toggle') {
              if (toggleNode.textContent.trim() === '') {
                // Delete if completely empty
                return commands.deleteNode('toggle');
              } else {
                // Unwrap the toggle: extract summary text, replace toggle with a paragraph
                const summaryText = $from.parent.textContent;
                if (dispatch) {
                  const togglePos = $from.before($from.depth - 1);
                  const paragraphContent = summaryText ? state.schema.text(summaryText) : null;
                  tr.replaceWith(togglePos, togglePos + toggleNode.nodeSize, state.schema.nodes.paragraph.create(null, paragraphContent));
                  tr.setSelection(Selection.near(tr.doc.resolve(togglePos + 1)));
                }
                return true;
              }
            }
          }
          return false;
        });
      },
    };
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
