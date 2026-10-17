import React from 'react';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Extension, type Editor } from '@tiptap/core';
import { NodeSelection, Plugin, TextSelection } from '@tiptap/pm/state';
import { GapCursor } from '@tiptap/pm/gapcursor';
import { normalizeHref } from '@/lib/links';
import { Badge, EndBadgeOnNewLine } from '@/components/editor/extensions/Badge';
import { TextColorPanel } from '@/components/editor/TextColorPanel';
import { toast } from '@/lib/toast';
import { AtSign, Send, GripVertical, Palette, Highlighter, Bold, Italic, Underline as UnderlineIcon, Strikethrough, AlignLeft, AlignCenter, AlignRight, List, ListOrdered, Link2 } from 'lucide-react';

const colors = [
  '#ef4444', '#f97316', '#eab308', '#3b82f6', '#6366f1', '#d946ef', '#22c55e', '#14b8a6', '#52525b', 'transparent'
];

interface CommentEditorProps {
  value: string;
  onChange: (value: string, text?: string, selectionStart?: number) => void;
  placeholder?: string;
  autoFocus?: boolean;
  id?: string;
  disabled?: boolean;
  onSubmit?: () => void;
  onPasteFiles?: (files: File[]) => void;
  /** When set, images are placed inline at the cursor (like ClickUp) and uploaded in the background. */
  onUploadImage?: (file: File) => Promise<string>;
  /** Copies an image from a link server-side, for pasted images whose host the browser can't read from. */
  onUploadImageUrl?: (url: string) => Promise<string>;
  /** Fires with true while any inline image is still uploading, so the parent can hold submit. */
  onUploadingChange?: (uploading: boolean) => void;
  /** Tool buttons on the left of the toolbar row under the text (use ComposerToolButton). */
  footer?: React.ReactNode;
  /** The send action on the right of the toolbar row (use ComposerSendButton). */
  footerEnd?: React.ReactNode;
  onKeyDown?: (event: KeyboardEvent) => boolean | void;
}

/** An icon button for the comment toolbar. */
export const ComposerToolButton = ({ className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    {...props}
    className={`flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-700/50 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-40 cursor-pointer ${className}`}
  />
);

/** The comment toolbar's send button; quiet while there's nothing to send. */
export const ComposerSendButton = ({ className = '', children = 'Send', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    {...props}
    // on-solid keeps text-white white in light mode (the theme remaps it to dark text elsewhere)
    className={`on-solid flex h-7 items-center gap-1.5 rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 pl-2.5 pr-3 text-[12px] font-medium text-white shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_2px_8px_-2px_rgba(99,102,241,0.6)] transition-all hover:from-indigo-400 hover:to-indigo-500 active:scale-[0.97] disabled:pointer-events-none disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 disabled:shadow-none cursor-pointer ${className}`}
  >
    <Send className="h-3.5 w-3.5" />
    {children}
  </button>
);

export interface CommentEditorRef {
  insertMention: (name: string, matchLength: number, userId: string) => void;
  insertImages: (files: File[]) => void;
}

// The line-move shortcut as the user's keyboard labels it (Option on a Mac)
const ALT_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌥' : 'Alt';
// Theme tokens, so the keys read as keys in both light and dark mode
const KBD_CLASS = 'inline-flex min-w-[18px] items-center justify-center rounded-[5px] border border-border bg-background px-1 font-sans text-[10px] font-medium leading-4 text-foreground/70 shadow-[0_1px_0_var(--border)]';

// Clipboard screenshots arrive unnamed or as "image.png" — give them unique names
const nameClipboardFiles = (files: File[]) => files.map((file, i) => {
  if (file.name && file.name !== 'image.png') return file;
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return new File([file], `pasted-image-${Date.now()}${i ? `-${i}` : ''}.${ext}`, { type: file.type });
});

// Moves top-level block `from` into gap `slot` (0 = before the first block, childCount = after the last),
// keeping the cursor where it was inside a moved line, or selecting a moved image.
const moveTopLevelBlock = (editor: Editor, from: number, slot: number) => {
  const { doc, selection } = editor.state;
  if (from < 0 || from >= doc.childCount || slot < 0 || slot > doc.childCount || slot === from || slot === from + 1) return false;
  const posOf = (index: number) => {
    let pos = 0;
    for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
    return pos;
  };
  const node = doc.child(from);
  const fromPos = posOf(from);
  const tr = editor.state.tr.delete(fromPos, fromPos + node.nodeSize);
  const insertAt = tr.mapping.map(posOf(slot));
  tr.insert(insertAt, node);
  const cursorInside = node.isTextblock && selection.$from.depth >= 1 && selection.$from.index(0) === from;
  tr.setSelection(cursorInside
    ? TextSelection.create(tr.doc, insertAt + 1 + Math.min(selection.from - fromPos - 1, node.content.size))
    : NodeSelection.create(tr.doc, insertAt));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
};

// Comments are edited line by line: Shift+Enter starts a new block (Enter sends) so each line can be
// moved on its own (drag the grip, or Alt+↑/↓), and an image at the very end always has an empty line
// after it to type in. Above a leading image there's no extra line; the gap cursor (click above it or press ↑) types there.
const CommentBlocks = Extension.create({
  name: 'commentBlocks',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      'Shift-Enter': ({ editor }) => editor.commands.first(({ commands }) => [
        () => commands.splitListItem('listItem'),
        () => commands.splitBlock(),
      ]),
      'Alt-ArrowUp': ({ editor }) => {
        const index = editor.state.selection.$from.index(0);
        return moveTopLevelBlock(editor as Editor, index, index - 1);
      },
      'Alt-ArrowDown': ({ editor }) => {
        const index = editor.state.selection.$from.index(0);
        return moveTopLevelBlock(editor as Editor, index, index + 2);
      },
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (_transactions, _oldState, state) => {
        const { doc, schema, tr } = state;
        if (doc.lastChild?.type.name === 'image') tr.insert(doc.content.size, schema.nodes.paragraph.create());
        return tr.docChanged ? tr : null;
      },
    })];
  },
});

const htmlHasText = (html: string) =>
  typeof DOMParser !== 'undefined' && !!new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim();

// Rich text copied from other apps (ClickUp, Slack, Docs...) carries runs of empty paragraphs and
// images we can't load (local file paths, other pages' blobs). Keep one blank line, drop those images.
const cleanPastedHtml = (html: string) => {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('img').forEach(img => {
    if (!/^(https?:|data:image\/)/i.test(img.getAttribute('src') || '')) img.remove();
  });
  const isEmpty = (el: Element) => !el.textContent?.trim() && !el.querySelector('img, video');
  doc.body.querySelectorAll('p, div').forEach(el => {
    if (!el.isConnected || !isEmpty(el)) return;
    const prev = el.previousElementSibling;
    if (!prev || (prev.matches('p, div, br') && isEmpty(prev))) el.remove();
  });
  return doc.body.innerHTML.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>');
};

const fileNameFromSrc = (src: string, type: string) => {
  const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const last = src.startsWith('data:') ? '' : src.split(/[?#]/)[0].split('/').pop() || '';
  try {
    const name = decodeURIComponent(last);
    if (name) return name.includes('.') ? name : `${name}.${ext}`;
  } catch { /* malformed escape, fall through */ }
  return `pasted-image-${Date.now()}.${ext}`;
};

export const CommentEditor = React.forwardRef<CommentEditorRef, CommentEditorProps>(({ value, onChange, placeholder = 'Write a comment...', autoFocus, id = 'default', disabled, onSubmit, onPasteFiles, onUploadImage, onUploadImageUrl, onUploadingChange, footer, footerEnd, onKeyDown }, ref) => {
  const pendingUploads = React.useRef(0);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  // Drag handle beside the hovered line/image: its top within the wrapper and the block's doc position
  const [dragHandle, setDragHandle] = React.useState<{ top: number; pos: number } | null>(null);
  // While dragging: the purple drop line's top within the wrapper
  const [dropLineTop, setDropLineTop] = React.useState<number | null>(null);
  const isDraggingRef = React.useRef(false);
  // Editor handlers are registered once, so they reach the latest functions through refs
  const insertImagesRef = React.useRef<(files: File[], pos?: number) => void>(() => {});
  const rehostImagesRef = React.useRef<(srcs: string[]) => void>(() => {});
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ dropcursor: { color: '#6366f1', width: 2 } }),
      CommentBlocks,
      // base64 images from a paste are accepted only so they can be re-uploaded (see rehostImages)
      Image.configure({ inline: false, allowBase64: !!onUploadImage }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Badge,
      EndBadgeOnNewLine,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        protocols: ['mention'],
        defaultProtocol: 'https',
        HTMLAttributes: {
          class: 'text-blue-400 underline cursor-pointer',
        },
      })
    ],
    content: value,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      const selectionStart = editor.state.selection.from - 1;
      onChange(editor.getHTML(), text, selectionStart);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm prose-invert prose-p:my-0 focus:outline-none min-h-[40px] max-h-[400px] overflow-y-auto custom-scrollbar max-w-full'
      },
      handleKeyDown: (view, event) => {
        if (onKeyDown && onKeyDown(event)) {
          return true;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (onSubmit) onSubmit();
          return true;
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !onUploadImage) return false;
        const images = Array.from(event.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
        if (images.length === 0) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        insertImagesRef.current(images, pos);
        return true;
      },
      transformPastedHTML: cleanPastedHtml,
      // Images in pasted rich text still point at the other app; copy them into our storage
      transformPasted: (slice) => {
        const srcs: string[] = [];
        slice.content.descendants(node => {
          const src = node.type.name === 'image' ? String(node.attrs.src || '') : '';
          if (/^(https?:|data:)/i.test(src)) srcs.push(src);
        });
        if (srcs.length > 0) setTimeout(() => rehostImagesRef.current(srcs), 0);
        return slice;
      }
    }
  });

  const setPending = (delta: number) => {
    const before = pendingUploads.current;
    pendingUploads.current = Math.max(0, before + delta);
    if ((before > 0) !== (pendingUploads.current > 0)) onUploadingChange?.(pendingUploads.current > 0);
  };

  // Points every image with oldSrc at newSrc, or removes them when newSrc is null.
  // Images the user deleted while the upload ran are simply not found.
  const replaceImageSrc = (oldSrc: string, newSrc: string | null) => {
    if (!editor || editor.isDestroyed) return;
    const tr = editor.state.tr;
    const hits: { pos: number; attrs: Record<string, unknown> }[] = [];
    tr.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs.src === oldSrc) hits.push({ pos, attrs: node.attrs });
    });
    if (hits.length === 0) return;
    for (const hit of hits.reverse()) {
      if (newSrc) tr.setNodeMarkup(hit.pos, undefined, { ...hit.attrs, src: newSrc });
      else tr.delete(hit.pos, hit.pos + 1);
    }
    editor.view.dispatch(tr);
  };

  // Swaps every image with this src for a link to it, named after the image
  const replaceImageWithLink = (src: string) => {
    if (!editor || editor.isDestroyed) return;
    const { schema, tr } = editor.state;
    const hits: { pos: number; alt: string }[] = [];
    tr.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs.src === src) hits.push({ pos, alt: String(node.attrs.alt || '') });
    });
    if (hits.length === 0) return;
    for (const hit of hits.reverse()) {
      const label = hit.alt.trim() || fileNameFromSrc(src, 'image/png');
      const link = schema.nodes.paragraph.create(null, schema.text(label, [schema.marks.link.create({ href: src })]));
      tr.replaceWith(hit.pos, hit.pos + 1, link);
    }
    editor.view.dispatch(tr);
  };

  // Re-uploads pasted images so the comment doesn't depend on another app's links (which can
  // expire or need a login). When the browser can't read a host (cross-site block), the server
  // copies it; one neither can reach (it needs the other app's login) becomes a link, since as an
  // image it would only ever show for people signed in there. Base64 images that fail are removed.
  const rehostImages = (srcs: string[]) => {
    if (!onUploadImage) return;
    const unique = Array.from(new Set(srcs));
    let left = unique.length;
    let linked = 0;
    for (const src of unique) {
      setPending(1);
      fetch(src, { signal: AbortSignal.timeout(20000) })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.blob();
        })
        .then(blob => {
          if (!blob.type.startsWith('image/')) throw new Error('Not an image');
          return onUploadImage(new File([blob], fileNameFromSrc(src, blob.type), { type: blob.type }));
        })
        .catch((err: unknown) => {
          if (src.startsWith('data:') || !onUploadImageUrl) throw err;
          return onUploadImageUrl(src);
        })
        .then(url => replaceImageSrc(src, url))
        .catch(() => {
          if (src.startsWith('data:')) replaceImageSrc(src, null);
          else if (onUploadImageUrl) {
            linked++;
            replaceImageWithLink(src);
          }
        })
        .finally(() => {
          setPending(-1);
          if (--left === 0 && linked > 0) {
            toast.warning(
              `${linked === 1 ? '1 pasted image' : `${linked} pasted images`} couldn't be copied from the other app, so ${linked === 1 ? 'it was' : 'they were'} added as a link. Download and attach the image so everyone can see it.`,
              8000,
            );
          }
        });
    }
  };
  rehostImagesRef.current = rehostImages;

  // Shows each image at the cursor straight away from a local preview, then swaps in the uploaded URL
  const insertImages = (files: File[], pos?: number) => {
    if (!editor || !onUploadImage || files.length === 0) return;
    for (const file of files) {
      const previewUrl = URL.createObjectURL(file);
      const chain = editor.chain().focus();
      if (pos !== undefined) chain.setTextSelection(pos);
      chain.insertContent({ type: 'image', attrs: { src: previewUrl, alt: file.name } }).run();
      pos = undefined;
      // Carry on typing on the line below the image
      editor.state.doc.descendants((node, nodePos) => {
        if (node.type.name !== 'image' || node.attrs.src !== previewUrl) return;
        if (editor.state.doc.nodeAt(nodePos + 1)?.isTextblock) editor.commands.setTextSelection(nodePos + 2);
        return false;
      });

      setPending(1);
      onUploadImage(file)
        .then(url => replaceImageSrc(previewUrl, url))
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : `Failed to upload ${file.name}`);
          replaceImageSrc(previewUrl, null);
        })
        .finally(() => {
          setPending(-1);
          URL.revokeObjectURL(previewUrl);
        });
    }
  };
  insertImagesRef.current = insertImages;

  // Pasted images go inline at the cursor when the parent uploads them; other files go to the
  // parent's staged attachments. Runs in the capture phase so it sees the paste before ProseMirror does.
  const handlePasteCapture = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if ((!onPasteFiles && !onUploadImage) || disabled) return;
    const data = event.clipboardData;
    if (!data) return;
    // Rich text from another app: let the editor paste it so text, formatting and images keep their order
    // (some apps also put the images on the clipboard as files, which would otherwise win and drop the text)
    const html = data.getData('text/html');
    if (html && htmlHasText(html)) return;
    let files = Array.from(data.files || []);
    if (files.length === 0) {
      files = Array.from(data.items || [])
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter((f): f is File => !!f);
    }
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const named = nameClipboardFiles(files);
    const images = onUploadImage ? named.filter(f => f.type.startsWith('image/')) : [];
    const others = named.filter(f => !images.includes(f));
    insertImages(images);
    if (others.length > 0) onPasteFiles?.(others);
  };

  // Positioned from the wrapper's own rect (not the viewport) so it stays put inside the
  // transformed task modal, where position:fixed handles end up offset
  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor || disabled || !wrapperRef.current || isDraggingRef.current) return;
    if ((event.target as Element).closest('[data-comment-drag-handle]')) return;
    let next: { top: number; pos: number } | null = null;
    if (editor.state.doc.childCount > 1) {
      const wrapTop = wrapperRef.current.getBoundingClientRect().top;
      editor.state.doc.forEach((_node, offset) => {
        const dom = editor.view.nodeDOM(offset);
        if (next || !(dom instanceof HTMLElement)) return;
        const rect = dom.getBoundingClientRect();
        if (event.clientY >= rect.top - 3 && event.clientY <= rect.bottom + 3) {
          next = { top: rect.top - wrapTop + Math.min(rect.height, 22) / 2 - 9, pos: offset };
        }
      });
    }
    const found = next as { top: number; pos: number } | null;
    if (found?.pos !== dragHandle?.pos || found?.top !== dragHandle?.top) setDragHandle(found);
  };

  // Clicking the box's top padding above a leading image puts the gap cursor there, so typing adds a line above it
  const handleWrapperMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor || disabled || event.target !== event.currentTarget) return;
    if (editor.state.doc.firstChild?.type.name !== 'image') return;
    const firstDom = editor.view.nodeDOM(0);
    if (!(firstDom instanceof HTMLElement) || event.clientY > firstDom.getBoundingClientRect().top) return;
    event.preventDefault();
    editor.view.dispatch(editor.state.tr.setSelection(new GapCursor(editor.state.doc.resolve(0))));
    editor.view.focus();
  };

  // Pointer-driven reordering instead of native drag-and-drop: no full-size ghost covering the
  // drop spot, any height of the box counts (above the first block / below the last), and the
  // box scrolls when the pointer nears its edge.
  const handleGripPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!editor || !dragHandle || event.button !== 0) return;
    event.preventDefault();
    const { view } = editor;
    const from = view.state.doc.resolve(dragHandle.pos).index(0);
    const draggedDom = view.nodeDOM(dragHandle.pos);
    if (draggedDom instanceof HTMLElement) draggedDom.style.opacity = '0.35';
    isDraggingRef.current = true;
    document.body.style.cursor = 'grabbing';
    let slot = from;

    const onMove = (e: PointerEvent) => {
      const wrapper = wrapperRef.current;
      if (!wrapper || editor.isDestroyed) return;
      // Scroll the editor while the pointer is near its top/bottom edge
      const scroller = view.dom as HTMLElement;
      const scrollRect = scroller.getBoundingClientRect();
      if (e.clientY < scrollRect.top + 24) scroller.scrollTop -= 12;
      else if (e.clientY > scrollRect.bottom - 24) scroller.scrollTop += 12;

      const rects: DOMRect[] = [];
      view.state.doc.forEach((_node, offset) => {
        const dom = view.nodeDOM(offset);
        rects.push(dom instanceof HTMLElement ? dom.getBoundingClientRect() : new DOMRect());
      });
      slot = rects.findIndex(r => e.clientY < r.top + r.height / 2);
      if (slot === -1) slot = rects.length;
      const wrapTop = wrapper.getBoundingClientRect().top;
      const lineY = slot < rects.length ? rects[slot].top - 2 : rects[rects.length - 1].bottom + 1;
      setDropLineTop(lineY - wrapTop);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (draggedDom instanceof HTMLElement) draggedDom.style.opacity = '';
      document.body.style.cursor = '';
      isDraggingRef.current = false;
      setDropLineTop(null);
      setDragHandle(null);
      if (!editor.isDestroyed) moveTopLevelBlock(editor, from, slot);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  React.useImperativeHandle(ref, () => ({
    insertMention: (name: string, matchLength: number, userId: string) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      // We insert a link with href mention://userId
      editor.chain().focus().deleteRange({ from: from - matchLength, to: from })
        .insertContent([
          {
            type: 'text',
            text: `@${name}`,
            marks: [{ type: 'link', attrs: { href: `mention://${userId}` } }]
          },
          { type: 'text', text: ' ' }
        ]).run();
    },
    insertImages: (files: File[]) => insertImages(files),
  }));

  React.useEffect(() => {
    if (editor && value === '' && editor.getHTML() !== '<p></p>') {
      editor.commands.setContent('');
    }
  }, [value, editor]);

  // Types "@" at the cursor, which opens the parent's mention list like typing it does
  const insertMentionTrigger = () => {
    if (!editor || disabled) return;
    const { $from } = editor.state.selection;
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
    editor.chain().focus().insertContent(before && !/\s$/.test(before) ? ' @' : '@').run();
  };

  if (!editor) return null;

  return (
    <div
      ref={wrapperRef}
      onPasteCapture={handlePasteCapture}
      onMouseMove={handleMouseMove}
      onMouseDown={handleWrapperMouseDown}
      onMouseLeave={() => { if (!isDraggingRef.current) setDragHandle(null); }}
      onScrollCapture={() => { if (!isDraggingRef.current) setDragHandle(null); }}
      className="group/composer relative w-full rounded-xl border border-zinc-700/50 bg-zinc-900/60 py-3 pr-3 pl-7 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-all duration-200 hover:border-zinc-600/60 focus-within:border-indigo-500/50 focus-within:bg-zinc-900/90 focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.12),0_8px_24px_-12px_rgba(0,0,0,0.6)] custom-scrollbar"
    >
      {dragHandle && dropLineTop === null && (
        <div
          data-comment-drag-handle
          onPointerDown={handleGripPointerDown}
          style={{ top: dragHandle.top - 3, touchAction: 'none' }}
          className="group/grip absolute left-1 z-10 flex h-6 w-5 cursor-grab items-center justify-center rounded text-zinc-500 hover:bg-zinc-700/70 hover:text-zinc-200"
          aria-label={`Drag to move this line, or press ${ALT_KEY}+↑ / ${ALT_KEY}+↓`}
        >
          <GripVertical className="h-4 w-4" />
          {/* Opens to the right, over the hovered line: above it would be clipped by the modal on the first line */}
          <div
            role="tooltip"
            className="pointer-events-none invisible absolute left-full top-1/2 ml-1.5 -translate-y-1/2 whitespace-nowrap rounded-lg border border-zinc-700 bg-popover px-2.5 py-1.5 text-[11px] leading-5 text-zinc-300 opacity-0 shadow-xl transition-opacity delay-0 group-hover/grip:visible group-hover/grip:opacity-100 group-hover/grip:delay-300"
          >
            <div><span className="font-medium text-zinc-100">Drag</span> to move this line</div>
            <div className="flex items-center gap-1">
              <kbd className={KBD_CLASS}>{ALT_KEY}</kbd>+<kbd className={KBD_CLASS}>↑</kbd>/<kbd className={KBD_CLASS}>↓</kbd>
              <span className="ml-0.5">move it up or down</span>
            </div>
          </div>
        </div>
      )}
      {dropLineTop !== null && (
        <div
          style={{ top: dropLineTop }}
          className="pointer-events-none absolute left-6 right-3 z-10 h-0.5 rounded-full bg-indigo-500 shadow-[0_0_6px_rgba(99,102,241,0.8)]"
        />
      )}
      {editor && (
        <div className="absolute top-0 left-0 w-0 h-0 overflow-visible pointer-events-none">
          <div className="pointer-events-auto">
            <BubbleMenu pluginKey={`bubbleMenu-${id}`} editor={editor} tippyOptions={{ duration: 100, zIndex: 999999, placement: 'top' }} shouldShow={({ state }) => !state.selection.empty} className="flex items-center bg-popover border border-[#27272a] p-1 rounded-xl shadow-2xl mb-2 gap-0.5 text-zinc-300">
              {/* Text Color / Highlight Dropdown */}
              <div className="relative group/color">
                <button onMouseDown={e => e.preventDefault()} className="px-2 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors flex items-center gap-1 text-sm font-medium" title="Text color, highlight & badge">
                  <span className="w-5 h-5 flex items-center justify-center font-serif text-[15px] border border-zinc-600 rounded">A</span>
                </button>
                <div className="absolute bottom-full pb-2 left-0 hidden group-hover/color:flex flex-col z-[9999]" onMouseDown={e => e.preventDefault()}>
                  <TextColorPanel editor={editor} textColors={colors} highlightColors={colors} />
                </div>
              </div>

              <div className="w-px h-5 bg-zinc-800 mx-1" />

              <button onClick={() => editor.chain().focus().toggleBold().run()} className={`p-1.5 rounded-lg hover:bg-zinc-800 transition-colors ${editor.isActive('bold') ? 'text-zinc-100 bg-zinc-800' : 'text-zinc-400'}`}>
                <Bold className="w-4 h-4" />
              </button>
              <button onClick={() => editor.chain().focus().toggleItalic().run()} className={`p-1.5 rounded-lg hover:bg-zinc-800 transition-colors ${editor.isActive('italic') ? 'text-zinc-100 bg-zinc-800' : 'text-zinc-400'}`}>
                <Italic className="w-4 h-4" />
              </button>
              <button onClick={() => editor.chain().focus().toggleUnderline().run()} className={`p-1.5 rounded-lg hover:bg-zinc-800 transition-colors ${editor.isActive('underline') ? 'text-zinc-100 bg-zinc-800' : 'text-zinc-400'}`}>
                <UnderlineIcon className="w-4 h-4" />
              </button>
              <button onClick={() => editor.chain().focus().toggleStrike().run()} className={`p-1.5 rounded-lg hover:bg-zinc-800 transition-colors ${editor.isActive('strike') ? 'text-zinc-100 bg-zinc-800' : 'text-zinc-400'}`}>
                <Strikethrough className="w-4 h-4" />
              </button>
              <button 
                onClick={() => {
                  const previousUrl = editor.getAttributes('link').href;
                  const url = window.prompt('URL', previousUrl);
                  
                  if (url === null) return;
                  if (url === '') {
                    editor.chain().focus().extendMarkRange('link').unsetLink().run();
                    return;
                  }
                  
                  editor.chain().focus().extendMarkRange('link').setLink({ href: normalizeHref(url) }).run();
                }}
                className={`p-1.5 rounded-lg hover:bg-zinc-800 transition-colors ${editor.isActive('link') ? 'text-zinc-100 bg-zinc-800' : 'text-zinc-400'}`}
              >
                <Link2 className="w-4 h-4" />
              </button>

              <div className="w-px h-5 bg-zinc-800 mx-1" />

              <button onClick={() => editor.chain().focus().setTextAlign('left').run()} className={`p-1.5 rounded-lg hover:bg-zinc-800 transition-colors ${editor.isActive({ textAlign: 'left' }) ? 'text-zinc-100 bg-zinc-800' : 'text-zinc-400'}`}>
                <AlignLeft className="w-4 h-4" />
              </button>
              <button onClick={() => editor.chain().focus().setTextAlign('center').run()} className={`p-1.5 rounded-lg hover:bg-zinc-800 transition-colors ${editor.isActive({ textAlign: 'center' }) ? 'text-zinc-100 bg-zinc-800' : 'text-zinc-400'}`}>
                <AlignCenter className="w-4 h-4" />
              </button>
            </BubbleMenu>
          </div>
        </div>
      )}
      <style>{`
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #52525b; /* zinc-600 */
          pointer-events: none;
          height: 0;
        }
        .ProseMirror img {
          display: block;
          max-width: 100%;
          max-height: 260px;
          border-radius: 6px;
          margin: 6px 0;
        }
        .ProseMirror img[src^="blob:"] { opacity: 0.55; }
        .ProseMirror > img:first-child { margin-top: 0; }
        .ProseMirror .ProseMirror-gapcursor:after { border-top-color: #e4e4e7; width: 24px; }
        .ProseMirror img.ProseMirror-selectednode { outline: 2px solid #6366f1; outline-offset: 1px; }
      `}</style>
      <div><EditorContent editor={editor} /></div>
      {(footer || footerEnd) && (
        <div className="-mr-1.5 -mb-1.5 mt-2 flex items-center gap-0.5 pt-1.5">
          <ComposerToolButton onClick={insertMentionTrigger} disabled={disabled} title="Mention someone (@)">
            <AtSign className="h-4 w-4" />
          </ComposerToolButton>
          {footer}
          <div className="ml-auto flex items-center gap-2.5">
            {onSubmit && (
              <span className="hidden items-center gap-1 text-[10.5px] text-zinc-500 opacity-0 transition-opacity group-focus-within/composer:opacity-100 sm:flex">
                <kbd className={KBD_CLASS}>⏎</kbd> send
                <span className="mx-0.5 text-zinc-700">·</span>
                <kbd className={KBD_CLASS}>⇧ ⏎</kbd> new line
              </span>
            )}
            {footerEnd}
          </div>
        </div>
      )}
    </div>
  );
});
