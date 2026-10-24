import { Extension, type Editor } from '@tiptap/core';

/**
 * Handles the Enter key when inside a list item (ordered list, bullet list, or task list).
 * - If the list item contains text/data: splits the item to create the next numbered/bulleted item.
 * - If the list item is empty (or whitespace only): lifts the item out of the list (or un-nests if nested),
 *   converting it to a normal paragraph aligned to the left with no bullet or number (matching ClickUp).
 */
export const handleListEnter = (editor: Editor): boolean => {
  if (!editor || editor.isDestroyed) return false;

  const { state } = editor;
  const { selection } = state;
  const { $from } = selection;

  // Search upwards for an enclosing listItem or taskItem
  let itemType: 'listItem' | 'taskItem' | null = null;
  let itemDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'listItem' || name === 'taskItem') {
      itemType = name;
      itemDepth = d;
      break;
    }
  }

  if (!itemType || itemDepth === -1) return false;

  const textBlock = $from.parent;
  // An item is empty if the current textblock has 0 content or only whitespace text
  const isWhitespaceOnly =
    textBlock.isTextblock &&
    textBlock.textContent.trim().length === 0;

  if (isWhitespaceOnly) {
    // If the textblock has whitespace characters (like spaces), remove them
    // so the lifted paragraph will be truly empty.
    if (textBlock.textContent.length > 0) {
      const start = $from.start();
      const end = $from.end();
      if (start < end) {
        editor.commands.deleteRange({ from: start, to: end });
      }
    }

    // Try lifting the list item out of the list (or un-nesting if nested)
    const canLift = editor.can().liftListItem(itemType);
    if (canLift) {
      editor.commands.liftListItem(itemType);

      // Ensure the lifted paragraph doesn't keep any leftover indent attribute
      const newFrom = editor.state.selection.$from;
      if (newFrom.parent.isTextblock && (newFrom.parent.attrs.indent || 0) > 0) {
        try {
          editor.commands.updateAttributes(newFrom.parent.type.name, { indent: 0 });
        } catch (_) {}
      }
      return true;
    }

    // Fallback: if liftListItem couldn't run for any reason, try liftEmptyBlock
    if (editor.can().liftEmptyBlock()) {
      editor.commands.liftEmptyBlock();
      return true;
    }
  } else {
    // Non-empty list item: split it into a new list item
    const canSplit = editor.commands.splitListItem(itemType);
    if (canSplit) {
      return true;
    }
  }

  return false;
};

export const ListKeymap = Extension.create({
  name: 'listKeymap',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => handleListEnter(this.editor as Editor),
    };
  },
});
