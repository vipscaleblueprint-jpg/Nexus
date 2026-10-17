import { Extension, Mark } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

// Solid pill behind the text (ClickUp "Badges"), unlike Highlight's plain marker background. Stored as
// <span data-badge="<bg>" style="background-color; color">; shape (radius, padding, weight) comes from
// the [data-badge] rule in globals.css so the stored HTML stays small.

export interface BadgeColor {
  color: string;
  textColor: string;
  label: string;
}

/** Strong badges: saturated background, light text. */
export const BADGE_STRONG_COLORS: BadgeColor[] = [
  { label: 'Red', color: '#c62828', textColor: '#ffffff' },
  { label: 'Orange', color: '#f57c00', textColor: '#ffffff' },
  { label: 'Yellow', color: '#f5b417', textColor: '#1f2937' },
  { label: 'Blue', color: '#1565c0', textColor: '#ffffff' },
  { label: 'Purple', color: '#5b3fd6', textColor: '#ffffff' },
  { label: 'Pink', color: '#e0407b', textColor: '#ffffff' },
  { label: 'Green', color: '#2e8b57', textColor: '#ffffff' },
  { label: 'Gray', color: '#c4c4c4', textColor: '#1f2937' },
];

/** Light badges: pastel background, text in the matching strong colour. */
export const BADGE_LIGHT_COLORS: BadgeColor[] = [
  { label: 'Light red', color: '#fcd9d9', textColor: '#b71c1c' },
  { label: 'Light orange', color: '#fdd9b5', textColor: '#b45309' },
  { label: 'Light yellow', color: '#fdecb5', textColor: '#92400e' },
  { label: 'Light blue', color: '#d3e5fb', textColor: '#1e4fa0' },
  { label: 'Light purple', color: '#dedbfb', textColor: '#4c35b5' },
  { label: 'Light pink', color: '#f9d6e4', textColor: '#b0285c' },
  { label: 'Light green', color: '#d0ecd9', textColor: '#1f6b40' },
  { label: 'Light gray', color: '#e2e2e2', textColor: '#3f3f46' },
];

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    badge: {
      /** Wraps the selection in a badge; drops highlight and text colour there so the badge's own colours show. */
      setBadge: (attributes: { color: string; textColor: string }) => ReturnType;
      unsetBadge: () => ReturnType;
    };
  }
}

export const Badge = Mark.create({
  name: 'badge',

  // A highlight inside a badge would paint over it
  excludes: 'highlight',

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-badge') || element.style.backgroundColor || null,
        rendered: false,
      },
      textColor: {
        default: '#ffffff',
        parseHTML: (element: HTMLElement) => element.style.color || '#ffffff',
        rendered: false,
      },
    };
  },

  parseHTML() {
    // Above TextStyle's span[style] rule, so the badge's inline colour isn't also read as a text colour
    return [{ tag: 'span[data-badge]', priority: 1000 }];
  },

  renderHTML({ mark }) {
    const { color, textColor } = mark.attrs as { color: string | null; textColor: string };
    return [
      'span',
      {
        'data-badge': color || '',
        style: `background-color: ${color || 'transparent'}; color: ${textColor}`,
      },
      0,
    ];
  },

  addCommands() {
    return {
      setBadge:
        (attributes) =>
        ({ commands }) => {
          commands.unsetMark('highlight');
          commands.unsetMark('textStyle', { extendEmptyMarkRange: true });
          return commands.setMark(this.name, attributes);
        },
      unsetBadge:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name, { extendEmptyMarkRange: true }),
    };
  },
});

// Marks that end with their line, like ClickUp: Enter / Shift+Enter carry the cursor's marks onto the
// new line as stored marks, so a badge or highlight would continue there. Other marks (bold, text
// colour, ...) keep carrying over as before.
const LINE_SCOPED_MARKS = ['badge', 'highlight'];

export const EndBadgeOnNewLine = Extension.create({
  name: 'endBadgeOnNewLine',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('endBadgeOnNewLine'),
        appendTransaction(transactions, _oldState, newState) {
          const { selection, storedMarks } = newState;
          if (!storedMarks || !selection.empty || !transactions.some((tr) => tr.docChanged)) return null;

          // A fresh line: an empty block (Enter) or right after a line break at the end (Shift+Enter)
          const $from = selection.$from;
          const onNewLine =
            $from.parent.content.size === 0 ||
            ($from.nodeBefore?.type.name === 'hardBreak' && !$from.nodeAfter);
          if (!onNewLine) return null;

          const kept = storedMarks.filter((mark) => !LINE_SCOPED_MARKS.includes(mark.type.name));
          if (kept.length === storedMarks.length) return null;
          return newState.tr.setStoredMarks(kept);
        },
      }),
    ];
  },
});
