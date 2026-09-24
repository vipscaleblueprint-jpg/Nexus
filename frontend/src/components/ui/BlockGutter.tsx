import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Editor } from '@tiptap/react';
import { Plus, GripVertical, ChevronRight } from 'lucide-react';

interface BlockGutterProps {
  editor: Editor;
  editorContainerRef: React.RefObject<HTMLDivElement | null>;
}

interface GutterState {
  visible: boolean;
  top: number;
  nodePos: number;
}

/**
 * BlockGutter — renders floating +, drag-handle (⠿), and delete controls
 * beside whichever block the cursor is hovering over inside the editor.
 */
export function BlockGutter({ editor, editorContainerRef }: BlockGutterProps) {
  const [gutter, setGutter] = useState<GutterState>({ visible: false, top: 0, nodePos: -1 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dragFromPosRef = useRef<number>(-1);
  const dropTargetPosRef = useRef<number>(-1);

  // ── Helper: find the top-level block DOM element containing `el` ────────────
  const findTopLevelBlock = useCallback((el: Element): Element | null => {
    const editorEl = editorContainerRef.current?.querySelector('.tiptap');
    if (!editorEl) return null;
    let current: Element | null = el;
    while (current && current.parentElement !== editorEl) {
      if (current === editorEl) return null;
      current = current.parentElement;
    }
    if (!current || current === editorEl) return null;
    return current;
  }, [editorContainerRef]);

  // ── Helper: get ProseMirror node position from a DOM block element ──────────
  const getNodePos = useCallback((blockEl: Element): number => {
    try {
      const pmPos = editor.view.posAtDOM(blockEl, 0);
      if (pmPos <= 0) return 0;
      const $pos = editor.state.doc.resolve(pmPos - 1);
      return $pos.before($pos.depth === 0 ? 1 : $pos.depth);
    } catch {
      return -1;
    }
  }, [editor]);

  // ── Show gutter at the position of a block element ──────────────────────────
  const showGutterAt = useCallback((blockEl: Element) => {
    const container = editorContainerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const blockRect = blockEl.getBoundingClientRect();
    const top = blockRect.top - containerRect.top;
    const nodePos = getNodePos(blockEl);
    setGutter({ visible: true, top, nodePos });
  }, [editorContainerRef, getNodePos]);

  // ── Attach mousemove/mouseleave to the editor container via DOM events ──────
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const onMouseMove = (e: MouseEvent) => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      // Sample a point slightly to the right of the current position to hit text
      const el = document.elementFromPoint(e.clientX + 30, e.clientY) as Element | null;
      if (!el) return;
      const block = findTopLevelBlock(el);
      if (!block) {
        // Try directly at cursor
        const el2 = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
        if (!el2) return;
        const block2 = findTopLevelBlock(el2);
        if (!block2) return;
        showGutterAt(block2);
        return;
      }
      showGutterAt(block);
    };

    const onMouseLeave = () => {
      hideTimerRef.current = setTimeout(() => {
        setGutter(g => ({ ...g, visible: false }));
        setMenuOpen(false);
      }, 400);
    };

    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseleave', onMouseLeave);
    return () => {
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [editorContainerRef, findTopLevelBlock, showGutterAt]);

  // ── Close menu on outside click ──────────────────────────────────────────────
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // ── Cleanup timers ───────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const cancelHide = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const handleAddBlock = useCallback(() => {
    if (gutter.nodePos < 0) return;
    const node = editor.state.doc.nodeAt(gutter.nodePos);
    if (!node) return;
    const insertPos = gutter.nodePos + node.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(insertPos, { type: 'paragraph' })
      .setTextSelection(insertPos + 1)
      .run();
  }, [editor, gutter.nodePos]);

  const handleDeleteBlock = useCallback(() => {
    if (gutter.nodePos < 0) return;
    const node = editor.state.doc.nodeAt(gutter.nodePos);
    if (!node) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: gutter.nodePos, to: gutter.nodePos + node.nodeSize })
      .run();
    setGutter(g => ({ ...g, visible: false }));
    setMenuOpen(false);
  }, [editor, gutter.nodePos]);

  const handleConvertToToggle = useCallback(() => {
    if (gutter.nodePos < 0) return;
    setMenuOpen(false);
    // Place cursor in the block first, then convert
    editor
      .chain()
      .focus()
      .setTextSelection(gutter.nodePos + 1)
      .run();
    setTimeout(() => {
      (editor.chain().focus() as any).setToggle().run();
    }, 20);
  }, [editor, gutter.nodePos]);

  // ── Drag-to-reorder ──────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    dragFromPosRef.current = gutter.nodePos;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(gutter.nodePos));
    setIsDragging(true);
  }, [gutter.nodePos]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    dragFromPosRef.current = -1;
    dropTargetPosRef.current = -1;
  }, []);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const el = document.elementFromPoint(e.clientX + 20, e.clientY) as Element | null;
      if (!el) return;
      const block = findTopLevelBlock(el);
      if (!block) return;
      dropTargetPosRef.current = getNodePos(block);
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const fromPos = dragFromPosRef.current;
      const toPos = dropTargetPosRef.current;
      if (fromPos < 0 || toPos < 0 || fromPos === toPos) return;

      const { state } = editor;
      const fromNode = state.doc.nodeAt(fromPos);
      if (!fromNode) return;
      const fromEnd = fromPos + fromNode.nodeSize;

      // Adjust insertion point if moving forward
      let adjustedTo = toPos;
      if (toPos > fromEnd) {
        adjustedTo = toPos - fromNode.nodeSize;
      }

      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          const slice = state.doc.slice(fromPos, fromEnd);
          tr.delete(fromPos, fromEnd);
          const clampedPos = Math.min(Math.max(adjustedTo, 0), tr.doc.content.size);
          tr.insert(clampedPos, slice.content);
          return true;
        })
        .run();
    };

    container.addEventListener('dragover', onDragOver);
    container.addEventListener('drop', onDrop);
    return () => {
      container.removeEventListener('dragover', onDragOver);
      container.removeEventListener('drop', onDrop);
    };
  }, [editor, editorContainerRef, findTopLevelBlock, getNodePos]);

  if (!gutter.visible) return null;

  return (
    <div
      ref={gutterRef}
      className="absolute left-0 flex items-center gap-0.5 z-[50] select-none"
      style={{
        top: gutter.top,
        transform: 'translateX(calc(-100% - 4px))',
        opacity: gutter.visible ? 1 : 0,
        transition: 'opacity 150ms ease',
        pointerEvents: 'auto',
      }}
      onMouseEnter={cancelHide}
      onMouseLeave={() => {
        hideTimerRef.current = setTimeout(() => {
          setGutter(g => ({ ...g, visible: false }));
          setMenuOpen(false);
        }, 400);
      }}
    >
      {/* + Add block below */}
      <button
        className="flex items-center justify-center w-5 h-5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors duration-150 cursor-pointer"
        onClick={handleAddBlock}
        title="Add block below"
        onMouseDown={e => e.preventDefault()}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>

      {/* Drag handle: click = menu, drag = reorder */}
      <div className="relative">
        <div
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpen(v => !v);
          }}
          className={`flex items-center justify-center w-5 h-5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors duration-150 cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-30' : ''}`}
          title="Drag to reorder · Click for options"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>

        {/* Dropdown: only "Toggle list" for now */}
        {menuOpen && (
          <div
            ref={menuRef}
            className="absolute left-full ml-1 top-0 bg-[#1c1c1e] border border-zinc-800 rounded-lg shadow-xl z-[99999] py-1 w-40"
          >
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors flex items-center gap-2"
              onMouseDown={e => e.preventDefault()}
              onClick={handleConvertToToggle}
            >
              <ChevronRight className="w-3 h-3 text-zinc-400" />
              Toggle list
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
