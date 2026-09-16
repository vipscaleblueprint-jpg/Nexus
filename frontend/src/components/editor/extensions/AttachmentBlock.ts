import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { AttachmentBlockNode } from '../nodes/AttachmentBlockNode';

export const AttachmentBlock = Node.create({
  name: 'attachmentBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      url: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-url'),
        renderHTML: (attributes) => ({ 'data-url': attributes.url }),
      },
      fileName: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-filename'),
        renderHTML: (attributes) => ({ 'data-filename': attributes.fileName }),
      },
      fileType: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-filetype'),
        renderHTML: (attributes) => ({ 'data-filetype': attributes.fileType }),
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="attachment-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'attachment-block' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentBlockNode);
  },
});
