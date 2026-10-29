import { Extension } from '@tiptap/core';
import { EditorState, Transaction, Plugin } from '@tiptap/pm/state';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface IndentOptions {
  types: string[];
  minLevel: number;
  maxLevel: number;
  indentSize: number;
  onIndent?: () => boolean | void;
  onOutdent?: () => boolean | void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      /** Indent current selection: nests list item or indents list/block */
      indent: () => ReturnType;
      /** Outdent current selection: un-nests list item or outdents list/block */
      outdent: () => ReturnType;
    };
  }
}

const LIST_CONTAINERS = ['bulletList', 'orderedList', 'taskList'];
const LIST_ITEMS = ['listItem', 'taskItem'];

export const Indent = Extension.create<IndentOptions>({
  name: 'indent',

  addOptions() {
    return {
      types: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList'],
      minLevel: 0,
      maxLevel: 6,
      indentSize: 24, // 24px per level
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element: HTMLElement) => {
              const dataIndent = element.getAttribute('data-indent');
              if (dataIndent) {
                const parsed = parseInt(dataIndent, 10);
                if (!isNaN(parsed)) return parsed;
              }
              const ml = element.style.marginLeft;
              if (ml) {
                const px = parseInt(ml, 10);
                if (!isNaN(px)) {
                  return Math.min(this.options.maxLevel, Math.max(0, Math.round(px / this.options.indentSize)));
                }
              }
              return 0;
            },
            renderHTML: (attributes) => {
              const level = attributes.indent || 0;
              if (level <= 0) return {};
              return {
                'data-indent': level,
                style: `margin-left: ${level * this.options.indentSize}px;`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    // Check if the current selection is inside a nested list item (level >= 2)
    const isNestedListItem = (state: EditorState) => {
      const { $from } = state.selection;
      let count = 0;
      for (let d = $from.depth; d > 0; d--) {
        if (LIST_ITEMS.includes($from.node(d).type.name)) {
          count++;
          if (count > 1) return true;
        }
      }
      return false;
    };

    // Check if the current selection is inside any list item
    const isInsideListItem = (state: EditorState) => {
      const { $from } = state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if (LIST_ITEMS.includes($from.node(d).type.name)) {
          return true;
        }
      }
      return false;
    };

    // Find the enclosing list container (e.g. orderedList, bulletList, taskList)
    const getEnclosingList = (state: EditorState): { pos: number; node: ProseMirrorNode } | null => {
      const { $from } = state.selection;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (LIST_CONTAINERS.includes(node.type.name)) {
          return { pos: $from.before(d), node };
        }
      }
      return null;
    };

    // Clean up any rogue indent on paragraph inside li (fixes huge gap between bullet and text)
    const cleanInnerParagraphIndents = (tr: Transaction, listPos: number, listNode: ProseMirrorNode) => {
      listNode.descendants((node, pos) => {
        if (node.isTextblock && node.attrs.indent) {
          tr.setNodeMarkup(listPos + 1 + pos, undefined, {
            ...node.attrs,
            indent: 0,
          });
        }
      });
    };

    const updateBlockIndent = (tr: Transaction, state: EditorState, delta: number, minLevel: number, maxLevel: number, types: string[]) => {
      const { doc, selection } = state;
      const { from, to } = selection;
      let changed = false;

      doc.nodesBetween(from, to, (node, pos) => {
        // Never apply margin-left to paragraphs/headings inside a list item!
        const $pos = doc.resolve(pos);
        let inListItem = false;
        for (let d = $pos.depth; d > 0; d--) {
          if (LIST_ITEMS.includes($pos.node(d).type.name)) {
            inListItem = true;
            break;
          }
        }
        if (inListItem) {
          if (node.attrs.indent) {
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              indent: 0,
            });
            changed = true;
          }
          return false;
        }

        if (types.includes(node.type.name)) {
          const current = (node.attrs.indent as number) || 0;
          const next = Math.min(maxLevel, Math.max(minLevel, current + delta));
          if (next !== current) {
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              indent: next,
            });
            changed = true;
          }
          return false;
        }
      });

      return changed;
    };

    return {
      indent: () => ({ tr, state, dispatch, editor }) => {
        // 1. Inside a list:
        if (isInsideListItem(state)) {
          // If there is a previous list item, nest under it
          if (editor.schema.nodes.listItem && editor.can().sinkListItem('listItem')) {
            return editor.commands.sinkListItem('listItem');
          }
          if (editor.schema.nodes.taskItem && editor.can().sinkListItem('taskItem')) {
            return editor.commands.sinkListItem('taskItem');
          }

          // If cannot sink (e.g. first item in the list): indent the enclosing list container!
          // This moves the whole list (including the bullet or number) together.
          const list = getEnclosingList(state);
          if (list) {
            const current = (list.node.attrs.indent as number) || 0;
            const next = Math.min(this.options.maxLevel, current + 1);
            if (next !== current) {
              tr.setNodeMarkup(list.pos, undefined, {
                ...list.node.attrs,
                indent: next,
              });
              cleanInnerParagraphIndents(tr, list.pos, list.node);
              if (dispatch) dispatch(tr);
              return true;
            }
            return false;
          }
          return false;
        }

        // 2. Custom parent hook (e.g. DocPage block depth)
        if (this.options.onIndent && this.options.onIndent()) {
          return true;
        }

        // 3. Regular block indent
        const changed = updateBlockIndent(tr, state, 1, this.options.minLevel, this.options.maxLevel, this.options.types);
        if (changed && dispatch) {
          dispatch(tr);
          return true;
        }
        return false;
      },

      outdent: () => ({ tr, state, dispatch, editor }) => {
        // 1. Inside a list:
        if (isInsideListItem(state)) {
          // A. If the enclosing list container has indent > 0, decrease its indent first
          const list = getEnclosingList(state);
          if (list) {
            const current = (list.node.attrs.indent as number) || 0;
            if (current > 0) {
              const next = Math.max(0, current - 1);
              tr.setNodeMarkup(list.pos, undefined, {
                ...list.node.attrs,
                indent: next,
              });
              cleanInnerParagraphIndents(tr, list.pos, list.node);
              if (dispatch) dispatch(tr);
              return true;
            }
          }

          // B. If nested (level >= 2), un-nest back to parent list
          if (isNestedListItem(state)) {
            if (editor.schema.nodes.listItem && editor.can().liftListItem('listItem')) {
              return editor.commands.liftListItem('listItem');
            }
            if (editor.schema.nodes.taskItem && editor.can().liftListItem('taskItem')) {
              return editor.commands.liftListItem('taskItem');
            }
          }

          // C. Clean up any rogue indent on paragraph inside li (if present from previous edits)
          let cleaned = false;
          const { doc, selection } = state;
          doc.nodesBetween(selection.from, selection.to, (node, pos) => {
            if (node.isTextblock && node.attrs.indent) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                indent: 0,
              });
              cleaned = true;
            }
          });
          if (cleaned && dispatch) {
            dispatch(tr);
            return true;
          }

          // D. CRITICAL: At root level with indent === 0, NEVER call liftListItem!
          // Doing so would unwrap the list into a paragraph and destroy the bullet/number.
          if (this.options.onOutdent && this.options.onOutdent()) {
            return true;
          }

          return false;
        }

        // 2. Custom parent hook (e.g. DocPage block depth)
        if (this.options.onOutdent && this.options.onOutdent()) {
          return true;
        }

        // 3. Regular block outdent
        const changed = updateBlockIndent(tr, state, -1, this.options.minLevel, this.options.maxLevel, this.options.types);
        if (changed && dispatch) {
          dispatch(tr);
          return true;
        }
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        name: 'indentCleanListItems',
        appendTransaction: (_transactions, _oldState, newState) => {
          let tr: Transaction | null = null;
          const { doc } = newState;

          doc.descendants((node, pos) => {
            if (LIST_ITEMS.includes(node.type.name)) {
              node.descendants((child, childPos) => {
                if (child.isTextblock && child.attrs.indent) {
                  if (!tr) tr = newState.tr;
                  tr.setNodeMarkup(pos + 1 + childPos, undefined, {
                    ...child.attrs,
                    indent: 0,
                  });
                }
              });
            }
          });

          return tr;
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-]': () => this.editor.commands.indent(),
      'Mod-[': () => this.editor.commands.outdent(),
      'Tab': () => this.editor.commands.indent(),
      'Shift-Tab': () => this.editor.commands.outdent(),
      'Backspace': () => {
        const { state } = this.editor;
        if (!state.selection.empty) return false;
        const { $from } = state.selection;
        if ($from.parentOffset !== 0) return false;
        if ($from.parent.isTextblock && ($from.parent.attrs.indent || 0) > 0) {
          return this.editor.commands.outdent();
        }
        return false;
      },
    };
  },
});

