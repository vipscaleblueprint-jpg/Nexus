import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Editor } from '@tiptap/core';
import {
  Plus,
  GripVertical,
  ChevronRight,
  Heading1,
  Heading2,
  Heading3,
  AlignLeft,
  CheckSquare,
  List,
  Trash2,
} from 'lucide-react';
import { moveTopLevelBlock } from './BlockEditor';

interface BlockGutterProps {
  editor: Editor;
  editorContainerRef: React.RefObject<HTMLDivElement | null>;
  disabled?: boolean;
}

interface DragHandleState {
  top: number;
  pos: number;
  isEmpty: boolean;
}

interface MenuState {
  pos: number;
  top: number;
}

const ALT_KEY = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? '⌥' : 'Alt';
const KBD_CLASS = 'inline-flex h-4 items-center rounded border border-zinc-700 bg-zinc-800 px-1 font-mono text-[10px] text-zinc-300';

/**
 * BlockGutter — renders a single adaptive button beside the hovered block:
 * - Empty line: [+] with "Click to add block" tooltip
 * - Content block: [⠿] with "Drag to move / Alt+↑/↓" tooltip matching CommentEditor (Image 2)
 */
export function BlockGutter({ editor, editorContainerRef, disabled = false }: BlockGutterProps) {
  const [dragHandle, setDragHandle] = useState<DragHandleState | null>(null);
  const [dropLineTop, setDropLineTop] = useState<number | null>(null);
  const [menuState, setMenuState] = useState<MenuState | null>(null);

  const isDraggingRef = useRef(false);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close options menu on outside click
  useEffect(() => {
    if (!menuState) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuState(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [menuState]);

  // Track hover over the editor container to position the adaptive button
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container || disabled) return;

    const onMouseMove = (event: MouseEvent) => {
      if (isDraggingRef.current || !editor || editor.isDestroyed) return;

      // Keep handle visible if mouse is over the gutter button or active menu
      if ((event.target as Element)?.closest?.('[data-block-gutter]')) {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        return;
      }

      let next: DragHandleState | null = null;
      if (editor.state.doc.childCount > 0) {
        const wrapTop = container.getBoundingClientRect().top;
        editor.state.doc.forEach((node, offset) => {
          const dom = editor.view.nodeDOM(offset);
          if (next || !(dom instanceof HTMLElement)) return;
          const rect = dom.getBoundingClientRect();
          if (event.clientY >= rect.top - 2 && event.clientY <= rect.bottom + 2) {
            const firstLineHeight = Math.min(rect.height, 24);
            const isEmpty = node.isTextblock && (node.content.size === 0 || node.textContent.trim() === '');
            next = {
              top: rect.top - wrapTop + (firstLineHeight / 2) - 10,
              pos: offset,
              isEmpty,
            };
          }
        });
      }

      if (next) {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        setDragHandle(next);
      }
    };

    const onMouseLeave = () => {
      if (isDraggingRef.current || menuState) return;
      hideTimerRef.current = setTimeout(() => {
        setDragHandle(null);
      }, 350);
    };

    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseleave', onMouseLeave);
    return () => {
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('mouseleave', onMouseLeave);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [editor, editorContainerRef, disabled, menuState]);

  // Action for [+] button on empty block
  const handleAddBlock = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!editor || !dragHandle || disabled) return;

      const node = editor.state.doc.nodeAt(dragHandle.pos);
      if (!node) return;

      // Focus the block and toggle the menu so user can choose what block to insert
      editor.chain().focus().setTextSelection(dragHandle.pos + 1).run();
      setMenuState(prev =>
        prev?.pos === dragHandle.pos ? null : { pos: dragHandle.pos, top: dragHandle.top }
      );
    },
    [editor, dragHandle, disabled]
  );

  // Pointer-driven drag to reorder top-level blocks
  const handleGripPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!editor || !dragHandle || event.button !== 0 || disabled) return;
      event.preventDefault();
      const container = editorContainerRef.current;
      if (!container) return;

      // If only 1 block exists in document, reordering is not possible -> toggle menu on click
      if (editor.state.doc.childCount <= 1) {
        setMenuState(prev =>
          prev?.pos === dragHandle.pos ? null : { pos: dragHandle.pos, top: dragHandle.top }
        );
        return;
      }

      const { view } = editor;
      const from = view.state.doc.resolve(dragHandle.pos).index(0);
      const draggedDom = view.nodeDOM(dragHandle.pos);

      const startX = event.clientX;
      const startY = event.clientY;
      let hasMoved = false;
      let slot = from;

      const onMove = (e: PointerEvent) => {
        if (!hasMoved) {
          if (Math.hypot(e.clientX - startX, e.clientY - startY) > 4) {
            hasMoved = true;
            isDraggingRef.current = true;
            document.body.style.cursor = 'grabbing';
            if (draggedDom instanceof HTMLElement) draggedDom.style.opacity = '0.35';
            setMenuState(null);
          } else {
            return;
          }
        }

        // Auto-scroll nearest scrollable container
        const scroller = view.dom as HTMLElement;
        const scrollParent = scroller.closest('.overflow-y-auto') || scroller;
        const scrollRect = scrollParent.getBoundingClientRect();
        if (e.clientY < scrollRect.top + 30) scrollParent.scrollTop -= 10;
        else if (e.clientY > scrollRect.bottom - 30) scrollParent.scrollTop += 10;

        const rects: DOMRect[] = [];
        view.state.doc.forEach((_node, offset) => {
          const dom = view.nodeDOM(offset);
          rects.push(dom instanceof HTMLElement ? dom.getBoundingClientRect() : new DOMRect());
        });
        slot = rects.findIndex(r => e.clientY < r.top + r.height / 2);
        if (slot === -1) slot = rects.length;

        const wrapTop = container.getBoundingClientRect().top;
        const lineY =
          slot < rects.length ? rects[slot].top - 2 : (rects[rects.length - 1]?.bottom || 0) + 1;
        setDropLineTop(lineY - wrapTop);
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);

        if (hasMoved) {
          if (draggedDom instanceof HTMLElement) draggedDom.style.opacity = '';
          document.body.style.cursor = '';
          isDraggingRef.current = false;
          setDropLineTop(null);
          setDragHandle(null);
          if (!editor.isDestroyed) {
            moveTopLevelBlock(editor, from, slot);
          }
        } else {
          // Plain click — toggle options menu
          setMenuState(prev =>
            prev?.pos === dragHandle.pos ? null : { pos: dragHandle.pos, top: dragHandle.top }
          );
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [editor, dragHandle, editorContainerRef, disabled]
  );

  // Menu action handlers
  const handleSetHeading = (level: 1 | 2 | 3) => {
    if (!menuState || !editor) return;
    editor.chain().focus().setTextSelection(menuState.pos + 1).toggleHeading({ level }).run();
    setMenuState(null);
  };

  const handleSetParagraph = () => {
    if (!menuState || !editor) return;
    editor.chain().focus().setTextSelection(menuState.pos + 1).setParagraph().run();
    setMenuState(null);
  };

  const handleSetTaskList = () => {
    if (!menuState || !editor) return;
    editor.chain().focus().setTextSelection(menuState.pos + 1).toggleTaskList().run();
    setMenuState(null);
  };

  const handleSetBulletList = () => {
    if (!menuState || !editor) return;
    editor.chain().focus().setTextSelection(menuState.pos + 1).toggleBulletList().run();
    setMenuState(null);
  };

  const handleSetToggle = () => {
    if (!menuState || !editor) return;
    const pos = menuState.pos;
    setMenuState(null);
    editor.chain().focus().setTextSelection(pos + 1).run();
    setTimeout(() => {
      if (!editor.isDestroyed) {
        (editor.chain().focus() as any).setToggle().run();
      }
    }, 20);
  };

  const handleDelete = () => {
    if (!menuState || !editor) return;
    const node = editor.state.doc.nodeAt(menuState.pos);
    if (node) {
      editor.chain().focus().deleteRange({ from: menuState.pos, to: menuState.pos + node.nodeSize }).run();
    }
    setMenuState(null);
    setDragHandle(null);
  };

  if (disabled) return null;

  return (
    <>
      {/* Single Adaptive Gutter Button */}
      {dragHandle && !isDraggingRef.current && (
        <div
          data-block-gutter
          style={{ top: dragHandle.top }}
          className="absolute left-1 z-20 flex items-center select-none"
        >
          {dragHandle.isEmpty ? (
            /* Empty Block -> [+] Button */
            <div className="group/btn relative">
              <button
                type="button"
                onClick={handleAddBlock}
                className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700/70 hover:text-zinc-200 transition-colors cursor-pointer"
                title="Click to add block"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          ) : (
            /* Content Block -> [⠿] Button with Image 2 Tooltip */
            <div className="group/grip relative">
              <div
                onPointerDown={handleGripPointerDown}
                className="flex h-6 w-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700/70 hover:text-zinc-200 transition-colors cursor-grab active:cursor-grabbing"
                aria-label={`Drag to move this line, or press ${ALT_KEY}+↑ / ${ALT_KEY}+↓`}
              >
                <GripVertical className="h-4 w-4" />
              </div>

              {/* Tooltip matching Image 2 */}
              {!menuState && (
                <div
                  role="tooltip"
                  className="pointer-events-none invisible absolute left-full top-1/2 ml-1.5 -translate-y-1/2 whitespace-nowrap rounded-lg border border-zinc-700 bg-popover px-2.5 py-1.5 text-[11px] leading-5 text-zinc-300 opacity-0 shadow-xl transition-opacity delay-0 group-hover/grip:visible group-hover/grip:opacity-100 group-hover/grip:delay-300 z-[99999]"
                >
                  <div><span className="font-medium text-zinc-100">Drag</span> to move this line</div>
                  <div className="flex items-center gap-1">
                    <kbd className={KBD_CLASS}>{ALT_KEY}</kbd>+<kbd className={KBD_CLASS}>↑</kbd>/<kbd className={KBD_CLASS}>↓</kbd>
                    <span className="ml-0.5">move it up or down</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Purple Drop Indicator Line */}
      {dropLineTop !== null && (
        <div
          style={{ top: dropLineTop }}
          className="pointer-events-none absolute left-7 right-2 z-30 h-0.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]"
        />
      )}

      {/* Block Options Dropdown Menu */}
      {menuState && (
        <div
          ref={menuRef}
          data-block-gutter
          style={{ top: menuState.top + 24 }}
          className="absolute left-6 z-[99999] w-48 rounded-xl border border-zinc-800 bg-[#0f0f0f] p-1 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Turn into
          </div>
          <button
            type="button"
            onClick={handleSetParagraph}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer text-left"
          >
            <AlignLeft className="h-3.5 w-3.5 text-zinc-400" />
            Paragraph
          </button>
          <button
            type="button"
            onClick={() => handleSetHeading(1)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer text-left"
          >
            <Heading1 className="h-3.5 w-3.5 text-zinc-400" />
            Heading 1
          </button>
          <button
            type="button"
            onClick={() => handleSetHeading(2)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer text-left"
          >
            <Heading2 className="h-3.5 w-3.5 text-zinc-400" />
            Heading 2
          </button>
          <button
            type="button"
            onClick={() => handleSetHeading(3)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer text-left"
          >
            <Heading3 className="h-3.5 w-3.5 text-zinc-400" />
            Heading 3
          </button>
          <button
            type="button"
            onClick={handleSetTaskList}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer text-left"
          >
            <CheckSquare className="h-3.5 w-3.5 text-zinc-400" />
            Checklist
          </button>
          <button
            type="button"
            onClick={handleSetBulletList}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer text-left"
          >
            <List className="h-3.5 w-3.5 text-zinc-400" />
            Bullet List
          </button>
          <button
            type="button"
            onClick={handleSetToggle}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer text-left"
          >
            <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
            Toggle List
          </button>

          <div className="my-1 border-t border-zinc-800/80" />

          <button
            type="button"
            onClick={handleDelete}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors cursor-pointer text-left"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Block
          </button>
        </div>
      )}
    </>
  );
}
