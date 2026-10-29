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
        } catch {}
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

/**
 * Handles the Backspace key when inside an indented block or list item.
 * - If inside a paragraph/heading/block with indent > 0 and cursor is at start: outdents the block
 *   (moves cursor from indented position [Image 1] to margin [Image 3]).
 * - If inside a list container that has indent > 0: outdents the list container.
 * - If inside a nested list item (level >= 2): un-nests back to parent list.
 * - If inside an empty list item (taskItem or listItem): lifts the item out of the list into a paragraph
 *   with indent: 0, instead of deleting the line and jumping backward to previous item [Image 2].
 */
export const handleListBackspace = (editor: Editor): boolean => {
  if (!editor || editor.isDestroyed) return false;

  const { state } = editor;
  const { selection } = state;
  if (!selection.empty) return false;

  const { $from } = selection;

  // Only act when cursor is at the very beginning of the block
  if ($from.parentOffset !== 0) return false;

  const currentBlock = $from.parent;

  // Search upwards for an enclosing listItem or taskItem
  let itemType: 'listItem' | 'taskItem' | null = null;
  let itemDepth = -1;
  let listDepthCount = 0;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'listItem' || name === 'taskItem') {
      if (itemType === null) {
        itemType = name;
        itemDepth = d;
      }
      listDepthCount++;
    }
  }

  // 1. If inside a list item:
  if (itemType && itemDepth !== -1) {
    // If the list item has rogue indent on its inner textblock, clean it
    if (currentBlock.isTextblock && (currentBlock.attrs.indent || 0) > 0) {
      editor.commands.updateAttributes(currentBlock.type.name, { indent: 0 });
      return true;
    }

    // If the enclosing list container itself has indent > 0, outdent the container first
    const listNode = $from.node(itemDepth - 1);
    if (listNode && (listNode.attrs.indent || 0) > 0) {
      return editor.commands.outdent();
    }

    // Nested list item: un-nest back to parent list
    if (listDepthCount > 1) {
      if (editor.can().liftListItem(itemType)) {
        return editor.commands.liftListItem(itemType);
      }
    }

    // Root list item: if empty (or whitespace only), lift out of list into a normal paragraph
    const isWhitespaceOnly =
      currentBlock.isTextblock &&
      currentBlock.textContent.trim().length === 0;

    if (isWhitespaceOnly) {
      if (currentBlock.textContent.length > 0) {
        const start = $from.start();
        const end = $from.end();
        if (start < end) {
          editor.commands.deleteRange({ from: start, to: end });
        }
      }

      if (editor.can().liftListItem(itemType)) {
        editor.commands.liftListItem(itemType);

        // Ensure the lifted paragraph doesn't keep leftover indent attribute
        const newFrom = editor.state.selection.$from;
        if (newFrom.parent.isTextblock && (newFrom.parent.attrs.indent || 0) > 0) {
          try {
            editor.commands.updateAttributes(newFrom.parent.type.name, { indent: 0 });
          } catch {}
        }
        return true;
      }
    }

    return false;
  }

  // 2. If NOT inside a list item, but in an indented textblock (indent > 0):
  if (currentBlock.isTextblock && (currentBlock.attrs.indent || 0) > 0) {
    return editor.commands.outdent();
  }

  return false;
};

export const ListKeymap = Extension.create({
  name: 'listKeymap',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => handleListEnter(this.editor as Editor),
      Backspace: () => handleListBackspace(this.editor as Editor),
    };
  },
});

