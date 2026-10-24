import { getStatusColor } from '../editor/nodes/TaskMentionNode';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Link from '@tiptap/extension-link';
import { openExternalLink, parseNexusTaskLink } from '@/lib/links';
import { useDomLinkPreview } from './LinkHoverPreview';
import { insertNexusTaskMention, cleanPastedHtml, stripMarksFromSlice } from '@/lib/nexusLinkPaste';
import { TaskMention } from '../editor/extensions/TaskMention';
import { Badge, EndBadgeOnNewLine } from '../editor/extensions/Badge';
import { TextColorPanel } from '../editor/TextColorPanel';
import { LiveKanbanBlock } from '../editor/extensions/LiveKanbanBlock';
import { Toggle, ToggleSummary, ToggleContent } from '../editor/extensions/Toggle';
import { Indent } from '../editor/extensions/Indent';
import { ListKeymap, handleListEnter } from '../editor/extensions/ListKeymap';
import { taskSuggestion } from '../editor/suggestions/taskSuggestion';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Palette, X, CheckSquare,
  ListTree, ChevronRight, Heading1, Heading2, Heading3,
  IndentDecrease, IndentIncrease
} from 'lucide-react';
import React, { useEffect, useRef, memo } from 'react';
import { Extension, type Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { BlockGutter } from './BlockGutter';


const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
const SHORTCUT_INDENT = IS_MAC ? '⌘]' : 'Ctrl+]';
const SHORTCUT_OUTDENT = IS_MAC ? '⌘[' : 'Ctrl+[';

/** Typography of the editable area; static previews of a block use it too so they render identically. */
export const BLOCK_EDITOR_CONTENT_CLASS = 'prose dark:prose-invert max-w-none break-words focus:outline-none min-h-[24px] text-sm text-zinc-900 dark:text-zinc-100 cursor-text prose-p:my-0 prose-ul:my-0 prose-ol:my-0 m-0 p-0 [&_p]:whitespace-pre-wrap [&_li]:whitespace-pre-wrap [&_h1]:whitespace-pre-wrap [&_h2]:whitespace-pre-wrap [&_h3]:whitespace-pre-wrap block w-full';

// Moves top-level block `from` into gap `slot` (0 = before the first block, childCount = after the last),
// keeping the cursor where it was inside a moved line.
export const moveTopLevelBlock = (editor: Editor, from: number, slot: number) => {
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

const BlockReorder = Extension.create({
  name: 'blockReorder',
  addKeyboardShortcuts() {
    return {
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
});

interface BlockEditorProps {
  content: string;
  onChange: (content: string) => void;
  onBlur: () => void;
  onFocus?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onSplit?: (contents: string[]) => void;
  autoFocus?: boolean;
  editable?: boolean;
  onEditorReady?: (editor: any) => void;
  /** Shown during the frame(s) before the Tiptap instance exists (it is created after mount). */
  loadingFallback?: React.ReactNode;
  /** Whether to show the left gutter with + and ⠿ drag handle (default: true). */
  enableGutter?: boolean;
  onIndent?: () => void;
  onOutdent?: () => void;
}

export const BlockEditor = React.memo(function BlockEditor(props: BlockEditorProps) {
  const { content, autoFocus, editable = true, enableGutter = true, onEditorReady, loadingFallback } = props;
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  const blurTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const { renderCard } = useDomLinkPreview(editorContainerRef);

  let initialContent: any = content || '';
  if (typeof initialContent === 'string' && initialContent.startsWith('{"type":"doc"')) {
    try {
      initialContent = JSON.parse(initialContent);
    } catch (e) {
      console.warn('Failed to parse Tiptap JSON content', e);
    }
  }

  const editor = useEditor({
    editable,
    immediatelyRender: false,
    parseOptions: {
      preserveWhitespace: 'full',
    },
    extensions: [
      StarterKit.configure({ horizontalRule: false }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Badge,
      EndBadgeOnNewLine,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      TaskMention.configure({
        suggestion: taskSuggestion,
      }),
      // Clicks are handled in editorProps.handleDOMEvents so hrefs without a protocol open correctly
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        HTMLAttributes: {
          class: 'text-blue-600 dark:text-blue-400 underline cursor-pointer hover:text-blue-700 dark:hover:text-blue-300 transition-colors',
        },
      }),
      LiveKanbanBlock,
      Toggle,
      ToggleSummary,
      ToggleContent,
      BlockReorder,
      ListKeymap,
      Indent.configure({
        onIndent: () => {
          if (propsRef.current.onIndent) {
            propsRef.current.onIndent();
            return true;
          }
          return false;
        },
        onOutdent: () => {
          if (propsRef.current.onOutdent) {
            propsRef.current.onOutdent();
            return true;
          }
          return false;
        },
      }),
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      
      // Check if we need to split the block (multiple root elements)
      if (propsRef.current.onSplit) {
        const div = document.createElement('div');
        div.innerHTML = html;
        // Tiptap often wraps everything in <p>. If there are multiple root elements, it was split.
        if (div.children.length > 1) {
          const contents = Array.from(div.children).map(child => child.outerHTML);
          
          // Blur the current editor immediately so user keystrokes don't go into it while we wait for the new block to mount
          // This also allows the useEffect to overwrite its content back to contents[0] safely
          editor.commands.blur();

          // Forcefully revert the content visually in the current editor. We must use setTimeout 
          // because Tiptap ignores setContent if called synchronously inside onUpdate.
          // React's useEffect won't catch this if the text before Enter was the same!
          setTimeout(() => {
            if (!editor.isDestroyed) {
              editor.commands.setContent(contents[0], false);
            }
          }, 0);
          
          propsRef.current.onSplit(contents);
          return;
        }
      }

      // Attribute-only changes that don't reach the HTML (e.g. a mention refreshing its in-memory task
      // snapshot) are not edits — skip them so they aren't broadcast to other viewers or saved.
      if (html === propsRef.current.content) return;

      propsRef.current.onChange(html);
    },
    onBlur: ({ event }) => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
      blurTimeoutRef.current = setTimeout(() => {
        propsRef.current.onBlur();
      }, 150);
    },
    onFocus: () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
      if (propsRef.current.onFocus) propsRef.current.onFocus();
    },
    editorProps: {
      attributes: {
        class: BLOCK_EDITOR_CONTENT_CLASS,
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData('text/plain')?.trim();
        if (text) {
          const nexus = parseNexusTaskLink(text);
          if (nexus) {
            event.preventDefault();
            insertNexusTaskMention(view, nexus);
            return true;
          }
        }
        return false;
      },
      // Sanitize pasted HTML, strip external formatting, and convert Nexus links to task mentions
      transformPastedHTML(html: string) {
        return cleanPastedHtml(html);
      },
      transformPasted(slice, view) {
        return stripMarksFromSlice(slice, view.state.schema);
      },
      handleDOMEvents: {
        click: (view, event) => {
          if (event.button !== 0) return false;
          const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]');
          if (!anchor || !view.dom.contains(anchor) || anchor.closest('[data-node-view-wrapper]')) return false;
          event.preventDefault();
          event.stopPropagation();
          openExternalLink(anchor.getAttribute('href'));
          return true;
        },
      },
      handleKeyDown: (view, event) => {
        if (!editor) return false;
        const isIndentKey = (event.ctrlKey || event.metaKey) && (event.key === ']' || event.code === 'BracketRight');
        const isOutdentKey = (event.ctrlKey || event.metaKey) && (event.key === '[' || event.code === 'BracketLeft');
        if (isIndentKey) {
          event.preventDefault();
          editor.commands.indent();
          return true;
        }
        if (isOutdentKey) {
          event.preventDefault();
          editor.commands.outdent();
          return true;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          if (event.shiftKey) {
            editor.commands.outdent();
          } else {
            editor.commands.indent();
          }
          return true;
        }

        // Intercept Backspace and Delete at boundaries to merge blocks
        if (event.key === 'Backspace') {
          const { selection, doc } = view.state;
          if (selection.empty) {
            const { $from } = selection;
            const isAtStart = $from.parentOffset === 0 && $from.pos === $from.start() && $from.index(0) === 0 && $from.depth === 1;
            if (isAtStart) {
              event.preventDefault();
              event.stopPropagation();
              if (propsRef.current.onKeyDown) propsRef.current.onKeyDown(event as any);
              return true;
            }
          }
        } else if (event.key === 'Delete') {
          const { selection, doc } = view.state;
          if (selection.empty) {
             const { $from } = selection;
             const isAtEnd = $from.parentOffset === $from.parent.content.size && $from.pos === $from.end() && $from.index(0) === doc.childCount - 1 && $from.depth === 1;
             if (isAtEnd) {
                event.preventDefault();
                event.stopPropagation();
                if (propsRef.current.onKeyDown) propsRef.current.onKeyDown(event as any);
                return true;
             }
          }
        } else if (event.key === 'Enter') {
          if (handleListEnter(editor)) {
            event.preventDefault();
            return true;
          }
          if (event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            view.dispatch(view.state.tr.split(view.state.selection.from));
            return true;
          }
        } else if (event.key === 'Escape' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          if (propsRef.current.onKeyDown) {
            propsRef.current.onKeyDown(event as any);
            if (event.defaultPrevented) return true;
          }
        }
        return false;
      },
    },
    onCreate: ({ editor }) => {
      if (onEditorReady) {
        onEditorReady(editor);
      }
    }
  });

  useEffect(() => {
    if (editor && autoFocus && !editor.isFocused) {
      setTimeout(() => {
        editor.commands.focus('end');
      }, 10);
    }
  }, [editor, autoFocus]);

  // Reactively sync the editable prop to the live Tiptap instance.
  // useEditor's `editable` only applies at initialization, so we must
  // call setEditable() when the prop changes (e.g. remote lock/unlock).
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (editor && content !== undefined && content !== null) {
      if (!editor.isFocused) {
        let isJson = false;
        let parsedContent: any = content;

        if (typeof content === 'string' && content.startsWith('{"type":"doc"')) {
          isJson = true;
          try {
            parsedContent = JSON.parse(content);
          } catch (e) { }
        }

        // Defer out of the React render cycle to avoid flushSync warnings
        queueMicrotask(() => {
          if (!editor || editor.isDestroyed) return;
          if (isJson) {
            editor.commands.setContent(parsedContent, false);
          } else {
            if (editor.getHTML() !== content) {
              editor.commands.setContent(content, false);
            }
          }
        });
      }
    }
  }, [editor, content]);

  useEffect(() => {
    if (!editor) return;

    const handleTaskUpdated = (e: any) => {
      const task = e.detail?.task;
      if (!task) return;

      // Socket payloads are often partial: a subtask change re-sends its parent as just { id, listId, subtasks },
      // and moves send scalars only. Only overwrite what the payload carries — filling the gaps with blanks
      // wiped the parent chip's title/status/assignees until the store copy restored them (the flicker).
      const shown: Record<string, string> = {};
      if (task.title !== undefined) shown.label = task.title;
      if (task.status !== undefined) shown.taskStatus = JSON.stringify({ name: task.status, color: getStatusColor(task.status) });
      if (task.assignees !== undefined) shown.taskAssignees = JSON.stringify(task.assignees || []);
      if (task.priority !== undefined) shown.taskPriority = task.priority || '';
      if (task.dueDate !== undefined) shown.taskDueDate = task.dueDate || '';
      if (Object.keys(shown).length === 0) return;

      const { state, view } = editor;
      const { tr } = state;
      let modified = false;

      state.doc.descendants((node, pos) => {
        if (node.type.name === 'mention' && node.attrs.id === task.id) {
          // Updates that change nothing the chip shows (e.g. a comment count) are skipped: rewriting the node
          // re-renders it in every editor on the page.
          if (Object.keys(shown).every((key) => (node.attrs[key] ?? '') === shown[key])) return;
          let frozen = node.attrs.frozenTaskData;
          if (typeof frozen === 'string') {
            try { frozen = JSON.parse(frozen); } catch { frozen = null; }
          }
          tr.setNodeMarkup(pos, null, { ...node.attrs, ...shown, frozenTaskData: { ...(frozen || {}), ...task } });
          modified = true;
        }
      });

      if (modified) {
        view.dispatch(tr);
      }
    };

    const handleTaskDeleted = (e: any) => {
      const id = e.detail?.id;
      if (!id) return;

      const { state, view } = editor;
      const { tr } = state;
      let modified = false;

      const positions: number[] = [];
      const nodeSizes: number[] = [];

      state.doc.descendants((node, pos) => {
        if (node.type.name === 'mention' && node.attrs.id === id) {
          positions.push(pos);
          nodeSizes.push(node.nodeSize);
        }
      });

      for (let i = positions.length - 1; i >= 0; i--) {
        tr.delete(positions[i], positions[i] + nodeSizes[i]);
        modified = true;
      }

      if (modified) {
        view.dispatch(tr);
      }
    };

    window.addEventListener('task:updated', handleTaskUpdated);

    return () => {
      window.removeEventListener('task:updated', handleTaskUpdated);
    };
  }, [editor]);

  if (!editor) {
    if (loadingFallback) return <div className="w-full relative">{loadingFallback}</div>;
    return <div className="flex-1 min-w-0 min-h-6" />;
  }

  const colors = [
    '#ffffff', '#94a3b8',
    '#ef4444', '#f97316',
    '#f59e0b', '#84cc16',
    '#22c55e', '#14b8a6',
    '#06b6d4', '#3b82f6',
    '#6366f1', '#8b5cf6',
    '#d946ef', '#f43f5e',
    'transparent'
  ];

  return (
    <div className="w-full relative group/block-editor" ref={editorContainerRef}>
      {editable && enableGutter && editor && (
        <BlockGutter editor={editor} editorContainerRef={editorContainerRef} />
      )}
      <div className="absolute top-0 left-0 w-0 h-0 overflow-visible pointer-events-none">
        <div className="pointer-events-auto">
          <BubbleMenu editor={editor} tippyOptions={{ duration: 100, maxWidth: 'none', zIndex: 99999, appendTo: typeof document !== 'undefined' ? document.body : undefined, popperOptions: { strategy: 'absolute', modifiers: [{ name: 'preventOverflow', enabled: false }, { name: 'flip', enabled: false }, { name: 'hide', enabled: true }] } }} className="flex items-center w-max max-w-none whitespace-nowrap gap-0.5 bg-card p-1 rounded-lg border border-zinc-700 shadow-2xl z-99999">
            {/* Keep editor focus + text selection while clicking any toolbar button */}
            <div className="contents" onMouseDown={e => e.preventDefault()}>

            {/* Headings */}
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              className={`p-1.5 rounded hover:bg-zinc-800 transition-colors ${editor.isActive('heading', { level: 1 }) ? 'text-[#00a884] bg-[#00a884]/10' : 'text-zinc-300'}`}
              title="Heading 1"
            >
              <Heading1 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`p-1.5 rounded hover:bg-zinc-800 transition-colors ${editor.isActive('heading', { level: 2 }) ? 'text-[#00a884] bg-[#00a884]/10' : 'text-zinc-300'}`}
              title="Heading 2"
            >
              <Heading2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              className={`p-1.5 rounded hover:bg-zinc-800 transition-colors ${editor.isActive('heading', { level: 3 }) ? 'text-[#00a884] bg-[#00a884]/10' : 'text-zinc-300'}`}
              title="Heading 3"
            >
              <Heading3 className="w-3.5 h-3.5" />
            </button>

            <div className="w-px h-4 bg-zinc-700 mx-1" />

            <button
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`p-1.5 rounded hover:bg-zinc-800 transition-colors cursor-pointer ${editor.isActive('bold') ? 'text-[#00a884] bg-[#00a884]/10' : 'text-zinc-300'}`}
              title="Bold"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`p-1.5 rounded hover:bg-zinc-800 transition-colors cursor-pointer ${editor.isActive('italic') ? 'text-[#00a884] bg-[#00a884]/10' : 'text-zinc-300'}`}
              title="Italic"
            >
              <Italic className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className={`p-1.5 rounded hover:bg-zinc-800 transition-colors cursor-pointer ${editor.isActive('underline') ? 'text-[#00a884] bg-[#00a884]/10' : 'text-zinc-300'}`}
              title="Underline"
            >
              <UnderlineIcon className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleStrike().run()}
              className={`p-1.5 rounded hover:bg-zinc-800 transition-colors cursor-pointer ${editor.isActive('strike') ? 'text-[#00a884] bg-[#00a884]/10' : 'text-zinc-300'}`}
              title="Strikethrough"
            >
              <Strikethrough className="w-3.5 h-3.5" />
            </button>

            <div className="w-px h-4 bg-zinc-700 mx-1" />

            <button
              onClick={() => (editor.chain().focus() as any).setToggle().run()}
              className={`p-1.5 rounded hover:bg-zinc-800 transition-colors cursor-pointer ${editor.isActive('toggle') ? 'text-[#00a884] bg-[#00a884]/10' : 'text-zinc-300'}`}
              title="Toggle / Collapsible"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            <div className="w-px h-4 bg-zinc-700 mx-1" />

            <button
              onClick={() => editor.chain().focus().setTextAlign('left').run()}
              className={`p-1.5 rounded hover:bg-zinc-800 transition-colors cursor-pointer ${editor.isActive({ textAlign: 'left' }) ? 'text-[#00a884] bg-[#00a884]/10' : 'text-zinc-300'}`}
              title="Align Left"
            >
              <AlignLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => editor.chain().focus().setTextAlign('center').run()}
              className={`p-1.5 rounded hover:bg-zinc-800 transition-colors cursor-pointer ${editor.isActive({ textAlign: 'center' }) ? 'text-[#00a884] bg-[#00a884]/10' : 'text-zinc-300'}`}
              title="Align Center"
            >
              <AlignCenter className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => editor.chain().focus().setTextAlign('right').run()}
              className={`p-1.5 rounded hover:bg-zinc-800 transition-colors cursor-pointer ${editor.isActive({ textAlign: 'right' }) ? 'text-[#00a884] bg-[#00a884]/10' : 'text-zinc-300'}`}
              title="Align Right"
            >
              <AlignRight className="w-3.5 h-3.5" />
            </button>

            <div className="w-px h-4 bg-zinc-700 mx-1" />

            <button
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`p-1.5 rounded hover:bg-zinc-800 transition-colors cursor-pointer ${editor.isActive('bulletList') ? 'text-[#00a884] bg-[#00a884]/10' : 'text-zinc-300'}`}
              title="Bullet List"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={`p-1.5 rounded hover:bg-zinc-800 transition-colors cursor-pointer ${editor.isActive('orderedList') ? 'text-[#00a884] bg-[#00a884]/10' : 'text-zinc-300'}`}
              title="Numbered List"
            >
              <ListOrdered className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              className={`p-1.5 rounded hover:bg-zinc-800 transition-colors cursor-pointer ${editor.isActive('taskList') ? 'text-[#00a884] bg-[#00a884]/10' : 'text-zinc-300'}`}
              title="Task List"
            >
              <CheckSquare className="w-3.5 h-3.5" />
            </button>

            <div className="w-px h-4 bg-zinc-700 mx-1" />

            <button
              type="button"
              onClick={() => editor.chain().focus().outdent().run()}
              className="p-1.5 rounded hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer text-zinc-300"
              title={`Decrease indent (${SHORTCUT_OUTDENT})`}
            >
              <IndentDecrease className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().indent().run()}
              className="p-1.5 rounded hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer text-zinc-300"
              title={`Increase indent (${SHORTCUT_INDENT})`}
            >
              <IndentIncrease className="w-3.5 h-3.5" />
            </button>

            <div className="w-px h-4 bg-zinc-700 mx-1" />

            {/* Text color / highlight / badge */}
            <div className="relative group/color">
              <button onMouseDown={e => e.preventDefault()} className="p-1.5 rounded hover:bg-zinc-800 transition-colors text-zinc-300 cursor-pointer flex items-center gap-1" title="Text color, highlight & badge">
                <Palette className="w-3.5 h-3.5" />
              </button>

              <div className="absolute bottom-full pb-1 left-1/2 -translate-x-1/2 hidden group-hover/color:block z-99999" onMouseDown={e => e.preventDefault()}>
                <TextColorPanel editor={editor} textColors={colors} highlightColors={colors} />
              </div>
            </div>
            </div>

          </BubbleMenu>
        </div>
      </div>

      <div
        className={`flex-1 min-w-0 cursor-text transition-all ${editable && enableGutter ? 'pl-7' : 'pl-0'}`}
        onMouseDown={(e) => {
          // Only handle clicks on the bare wrapper. Clicks inside the editor are left to the
          // browser/ProseMirror — calling focus() here restores the old selection one frame later
          // and clobbers a drag-highlight that just started.
          if (e.target === e.currentTarget) {
            e.preventDefault();
            editor.commands.focus('end');
          }
        }}
      >
        <style>{`
          .tiptap p, .tiptap li, .tiptap h1, .tiptap h2, .tiptap h3, .tiptap h4, .tiptap h5 {
            white-space: pre-wrap;
          }
        `}</style>
        <EditorContent editor={editor} />
      </div>
      {renderCard()}
    </div>
  );
}, (prev, next) => {
  return prev.content === next.content && prev.editable === next.editable && prev.enableGutter === next.enableGutter;
});


