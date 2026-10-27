'use client';

import { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { authApi, spacesApi } from '@/api';
import { FormattedRichText, markdownToBlocks, blocksToMarkdown } from './utils';
import { BlockEditor } from '@/components/ui/BlockEditor';
import { tasksApi } from '@/api/tasks';
import { useAppStore } from '@/lib/store';
import { useShallow } from 'zustand/react/shallow';
import { Task } from '@/lib/types';
import { TaskDetailModal } from '@/components/modals/TaskDetailModal';
import { parseNexusTaskLink } from '@/lib/links';
import { getTaskSnapshot } from '@/lib/nexusLinkPaste';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { RenameModal } from '@/components/modals/RenameModal';
import { usersApi } from '@/api/users';
import * as Popover from '@radix-ui/react-popover';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  ChevronRight,
  ChevronDown,
  Plus,
  Pin,
  Trash2,
  Link as LinkIcon,
  Download,
  SlidersHorizontal,
  Type,
  Star,
  GripVertical,
  MoreHorizontal,
  Search,
  X,
  CheckSquare,
  Heading,
  AlignLeft,
  CheckCircle2,
  Lock,
  Unlock,
  AlertCircle,
  Tags,
  Save,
  Edit2,
  Folder,
  Circle,
  Flag,
  Check,
  History,
  CaseSensitive,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { DocSkeleton } from '@/components/ui/Skeleton';
import { getCachedPage, setCachedPage, forgetCachedPage, type CachedPage } from '@/lib/pageContentCache';
import { BlockHtmlPreview } from '@/components/editor/BlockHtmlPreview';

const NO_TASKS: Task[] = [];
const ALT_KEY = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? '⌥' : 'Alt';
const KBD_CLASS = 'inline-flex h-4 items-center rounded border border-zinc-700 bg-zinc-800 px-1 font-mono text-[10px] text-zinc-300';
import {
  PageStylesPanel,
  usePageStyles,
  computePageStats,
  computeOutline,
  FONT_STYLE_CLASS,
  FONT_SIZE_CLASS,
} from '@/components/docs/PageStylesPanel';
import { DocTransferPanel, type ExportScope, type ExportFormat } from '@/components/docs/DocTransferPanel';
import {
  VersionHistoryPanel,
  VersionPreview,
  buildVersionEntries,
  diffBlocks,
  formatVersionTime,
  type PageVersionRecord,
} from '@/components/docs/VersionHistory';
import { ConfirmActionModal } from '@/components/modals/ConfirmActionModal';
import {
  pagesToHtmlDocument,
  pagesToMarkdown,
  printHtmlDocument,
  downloadFile,
  safeFileName,
  fileToPages,
  type ExportPage,
  type ImportKind,
} from '@/components/docs/docTransfer';

// "today at 3:04 PM" / "yesterday at 3:04 PM" / "Oct 2" / "Oct 2, 2025"
const formatLastModified = (iso: string | null | undefined) => {
  if (!iso) return 'today';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'today';
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
};

export interface Assignee {
  type: 'letter' | 'more';
  value: string;
}

export interface DocBlock {
  id: string;
  type: 'heading' | 'task' | 'text' | 'callout' | 'tags' | 'collapsible' | 'subtask';
  content: string;
  status?: 'CLOSED' | 'WAITING' | 'DAILY' | 'IN_PROGRESS';
  isCollapsed?: boolean;
  depth?: number;
  stars?: number;
  assignees?: Assignee[];
  lockedBy?: string | null;
  lockedByName?: string;
}

const isCurrentMonth = (title?: string): boolean => {
  if (!title) return false;
  const now = new Date();
  const currentMonthStr = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(now);
  if (title.trim().toLowerCase() === currentMonthStr.toLowerCase()) return true;

  const d = new Date(title);
  if (!isNaN(d.getTime())) {
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }
  return false;
};

interface SidebarPageItemProps {
  page: any;
  activePageId: string | null;
  onSelect: (page: any) => void;
  onAddSubpage: (parentPageId: string) => void;
  onRename: (pageId: string, title: string) => void;
  onDelete: (pageId: string) => void;
  depth?: number;
  isJournal?: boolean;
}

function SidebarPageItem({
  page,
  activePageId,
  onSelect,
  onAddSubpage,
  onRename,
  onDelete,
  depth = 0,
  isJournal = false,
}: SidebarPageItemProps) {
  const isMonthFolder = isJournal && depth === 0;
  const isCurrent = isMonthFolder ? isCurrentMonth(page.title) : false;

  const containsActive = useMemo(() => {
    if (!activePageId) return false;
    if (page.id === activePageId) return true;
    const checkSub = (subpages?: any[]): boolean => {
      if (!subpages) return false;
      return subpages.some((s: any) => s.id === activePageId || checkSub(s.subpages));
    };
    return checkSub(page.subpages);
  }, [page, activePageId]);

  const [expanded, setExpanded] = useState(() => {
    if (isMonthFolder) {
      return isCurrent || containsActive;
    }
    return true;
  });

  const [sidebarSubpageLimit, setSidebarSubpageLimit] = useState(5);

  useEffect(() => {
    if (containsActive) {
      setExpanded(true);
    }
  }, [containsActive]);

  const hasChildren = page.subpages && page.subpages.length > 0;
  const isActive = activePageId === page.id;

  const sortedSubpages = hasChildren ? [...page.subpages].sort((a, b) => {
    if (isJournal) {
      const timeA = new Date(a.title || '').getTime();
      const timeB = new Date(b.title || '').getTime();
      if (!isNaN(timeA) && !isNaN(timeB)) return timeB - timeA;
    }
    return (a.order || 0) - (b.order || 0);
  }) : [];

  useEffect(() => {
    if (isMonthFolder && activePageId && hasChildren) {
      const idx = sortedSubpages.findIndex((s: any) => s.id === activePageId);
      if (idx >= 0 && idx >= sidebarSubpageLimit) {
        setSidebarSubpageLimit(idx + 5);
      }
    }
  }, [activePageId, isMonthFolder, hasChildren, sortedSubpages, sidebarSubpageLimit]);

  // Every month folder pages its days, the current one included (newest first, so today stays visible)
  const visibleSubpages = isMonthFolder
    ? sortedSubpages.slice(0, sidebarSubpageLimit)
    : sortedSubpages;

  const hasMoreSubpages = isMonthFolder && sortedSubpages.length > sidebarSubpageLimit;

  return (
    <div className="select-none">
      <div
        onClick={() => onSelect(page)}
        className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors group ${isActive
          ? 'bg-accent text-accent-foreground shadow-sm font-semibold'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <div className="flex items-center gap-1.5 truncate">
          <div className="relative w-4 h-4 flex items-center justify-center shrink-0">
            {hasChildren && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(!expanded);
                }}
                className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-pointer hover:bg-zinc-700/50 rounded"
              >
                {expanded ? (
                  <ChevronDown className="w-3 h-3 text-zinc-300" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-zinc-300" />
                )}
              </button>
            )}
            <div className={`absolute inset-0 flex items-center justify-center ${hasChildren ? 'group-hover:opacity-0' : ''} transition-opacity`}>
              {depth > 0 ? (
                <FileText className="w-3.5 h-3.5 text-zinc-400" />
              ) : (
                <Folder className="w-3.5 h-3.5 text-zinc-400" />
              )}
            </div>
          </div>
          <span className="truncate">{page.title || 'Untitled'}</span>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <div onClick={(e) => e.stopPropagation()}>
            <ActionMenu icon={<MoreHorizontal className="w-3.5 h-3.5" />}>
              <div className="flex flex-col py-1">
                <button
                  onClick={() => onRename(page.id, page.title)}
                  className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Rename
                </button>
                <button
                  onClick={() => onDelete(page.id)}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 flex items-center gap-2 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </ActionMenu>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddSubpage(page.id);
            }}
            title="Add subpage"
            className="p-1 hover:bg-zinc-700/60 rounded text-zinc-400 hover:text-white transition-opacity cursor-pointer"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && hasChildren && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="space-y-0.5 mt-0.5 overflow-hidden"
          >
            {visibleSubpages.map((sub: any) => (
              <SidebarPageItem
                key={sub.id}
                page={sub}
                activePageId={activePageId}
                onSelect={onSelect}
                onAddSubpage={onAddSubpage}
                onRename={onRename}
                onDelete={onDelete}
                depth={depth + 1}
                isJournal={isJournal}
              />
            ))}

            {hasMoreSubpages && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSidebarSubpageLimit((prev) => prev + 15);
                }}
                className="w-full text-left py-1 px-2 text-[11px] font-medium text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 rounded flex items-center gap-1.5 transition-colors cursor-pointer group/seemore"
                style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}
              >
                <ChevronDown className="w-3 h-3 text-zinc-500 group-hover/seemore:text-zinc-300 transition-colors" />
                <span>See more ({sortedSubpages.length - sidebarSubpageLimit} left)</span>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const getTaskStatusBadgeColor = (status?: string) => {
  const norm = (status || '').toUpperCase().trim();
  switch (norm) {
    case 'CLOSED':
    case 'DONE':
      return 'bg-[#2FA37A]/20 text-[#2FA37A] border border-[#2FA37A]/30';
    case 'WAITING':
      return 'bg-[#D9534F]/20 text-[#D9534F] border border-[#D9534F]/30';
    case 'DAILY':
    case 'WEEKLY':
    case 'MONTHLY':
      return 'bg-[#2F7BD0]/20 text-[#2F7BD0] border border-[#2F7BD0]/30';
    case 'IN_PROGRESS':
    case 'IN PROGRESS':
      return 'bg-[#D04A7C]/20 text-[#D04A7C] border border-[#D04A7C]/30';
    case 'PENDING':
      return 'bg-[#D29A2A]/20 text-[#D29A2A] border border-[#D29A2A]/30';
    case 'REVISION':
      return 'bg-[#5B6BD6]/20 text-[#5B6BD6] border border-[#5B6BD6]/30';
    case 'IN REVIEW':
    case 'IN_REVIEW':
      return 'bg-[#D97B3A]/20 text-[#D97B3A] border border-[#D97B3A]/30';
    case 'CHECKING':
      return 'bg-[#A35DB8]/20 text-[#A35DB8] border border-[#A35DB8]/30';
    case 'CRM':
      return 'bg-[#22A3AE]/20 text-[#22A3AE] border border-[#22A3AE]/30';
    case 'ON-HOLD':
    case 'ON_HOLD':
      return 'bg-[#8A8F98]/20 text-[#8A8F98] border border-[#8A8F98]/30';
    default:
      return 'bg-zinc-800 text-zinc-400 border border-zinc-700';
  }
};

// ── Lazy block editors
// A journal day can hold hundreds of blocks; mounting a Tiptap editor (plus a React node view per task
// mention) for every one froze the page for seconds after opening it. Each block shows a static preview
// (BlockHtmlPreview) until it comes within MOUNT_MARGIN of the visible area, then mounts its editor; once it scrolls past
// UNMOUNT_MARGIN the editor is released again, so memory stays bounded by what is near the viewport
// instead of growing with every block scrolled past. The gap between the two margins stops blocks near
// the edge from flapping between states.
const MOUNT_MARGIN = '800px 0px';
const UNMOUNT_MARGIN = '2400px 0px';
// Editors mounted per animation frame; a fast scroll would otherwise mount dozens in one long task
const MOUNTS_PER_FRAME = 3;

type VisibilityCallback = (isIntersecting: boolean) => void;
// One IntersectionObserver per (scroll root, margin) shared by every block, instead of one per block
const sharedObservers = new Map<string, { observer: IntersectionObserver; callbacks: Map<Element, VisibilityCallback> }>();
const observerRootIds = new WeakMap<Element, number>();
let nextObserverRootId = 1;

function observeVisibility(el: Element, root: HTMLElement | null, rootMargin: string, callback: VisibilityCallback) {
  let rootId = 0;
  if (root) {
    rootId = observerRootIds.get(root) ?? nextObserverRootId++;
    observerRootIds.set(root, rootId);
  }
  const key = `${rootId}|${rootMargin}`;
  let shared = sharedObservers.get(key);
  if (!shared) {
    const callbacks = new Map<Element, VisibilityCallback>();
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => callbacks.get(entry.target)?.(entry.isIntersecting)),
      { root, rootMargin },
    );
    shared = { observer, callbacks };
    sharedObservers.set(key, shared);
  }
  const { observer, callbacks } = shared;
  callbacks.set(el, callback);
  observer.observe(el);
  return () => {
    observer.unobserve(el);
    callbacks.delete(el);
    if (callbacks.size === 0) {
      observer.disconnect();
      sharedObservers.delete(key);
    }
  };
}

const mountQueue = new Set<() => void>();
let mountFrame: number | null = null;

function runQueuedMounts() {
  mountFrame = null;
  let mounted = 0;
  for (const mount of mountQueue) {
    mountQueue.delete(mount);
    mount();
    if (++mounted >= MOUNTS_PER_FRAME) break;
  }
  if (mountQueue.size > 0) mountFrame = requestAnimationFrame(runQueuedMounts);
}

/** Queues an editor mount; returns a function that cancels it if it hasn't run yet. */
function scheduleMount(mount: () => void) {
  mountQueue.add(mount);
  if (mountFrame === null) mountFrame = requestAnimationFrame(runQueuedMounts);
  return () => { mountQueue.delete(mount); };
}

function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

function LazyBlockEditor({ forceMount, onEditorUnmount, ...editorProps }: React.ComponentProps<typeof BlockEditor> & {
  /** Focused/selected blocks always keep a live editor (keyboard navigation and merges need it). */
  forceMount: boolean;
  /** Called when the editor is released, so callers can drop references to the destroyed instance. */
  onEditorUnmount?: () => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [nearView, setNearView] = useState(false);
  // Last rendered editor height, kept on the placeholder so releasing an editor doesn't shift the scroll
  const [releasedHeight, setReleasedHeight] = useState<number>();
  const mounted = nearView || forceMount;

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return scheduleMount(() => setNearView(true));

    // The doc scrolls inside <main>, so observe relative to that container for the margins to apply
    const root = getScrollParent(el);
    let cancelMount: (() => void) | null = null;
    const stopNear = observeVisibility(el, root, MOUNT_MARGIN, (visible) => {
      if (!visible) {
        cancelMount?.();
        cancelMount = null;
      } else if (!cancelMount) {
        cancelMount = scheduleMount(() => {
          cancelMount = null;
          setNearView(true);
        });
      }
    });
    const stopFar = observeVisibility(el, root, UNMOUNT_MARGIN, (visible) => {
      if (visible) return;
      if (el.offsetHeight > 0) setReleasedHeight(el.offsetHeight);
      setNearView(false);
    });
    return () => {
      cancelMount?.();
      stopNear();
      stopFar();
    };
  }, []);

  const onEditorUnmountRef = useRef(onEditorUnmount);
  useEffect(() => { onEditorUnmountRef.current = onEditorUnmount; });
  useEffect(() => {
    if (!mounted) return;
    return () => onEditorUnmountRef.current?.();
  }, [mounted]);

  // The same static rendering (editor typography + task chips) stands in before the editor mounts and
  // during the frame before Tiptap creates it, so the page looks finished from the start.
  const preview = <BlockHtmlPreview content={editorProps.content} />;
  return (
    <div ref={wrapperRef}>
      {mounted ? (
        <BlockEditor {...editorProps} enableGutter={false} loadingFallback={preview} />
      ) : (
        // A click before the queued mount ran mounts this block right away
        <div style={{ minHeight: releasedHeight }} onPointerDown={() => setNearView(true)}>
          {preview}
        </div>
      )}
    </div>
  );
}

const DocBlockRow = memo(({
  block,
  index,
  isLast,
  isLockedBySomeoneElse,
  isSelected,
  isFirstSelected,
  dragOverBlockIndex,
  dragOverPosition,
  draggedBlockIndex,
  focusedBlockId,
  handleAddBlock,
  handleDragStart,
  handleDragEnd,
  setSelectedBlockIds,
  selectedBlockIds,
  handleUpdateBlockContent,
  handleBlurBlock,
  handleKeyDown,
  handleIndentBlock,
  handleOutdentBlock,
  handleSplitBlock,
  handleFocusBlock,
  editorRegistryRef,
  handleDeleteBlock,
  onDragOverWrapper,
  onDropWrapper,
  onMouseDownCaptureWrapper,
  onMouseMoveWrapper,
  onClickWrapper,
  handleTurnInto,
  handleToggleCollapse,
  groupState = 'none',
}: any) => {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const isBlockEmpty = !block.content || block.content.trim() === '' || block.content === '<p></p>' || block.content === '<p><br></p>' || block.content.replace(/<[^>]*>/g, '').trim() === '';

  return (
    <div
      data-block-id={block.id}
      onDragOver={onDragOverWrapper}
      onDrop={onDropWrapper}
      onDragEnd={handleDragEnd}
      onMouseDownCapture={onMouseDownCaptureWrapper}
      onMouseMove={onMouseMoveWrapper}
      onClick={onClickWrapper}
      className={`flex items-center justify-between py-1 group transition-all relative ${
        block.type === 'callout'
          ? 'bg-red-500/20 border border-red-500/30 py-3 px-4 rounded-md'
          : 'hover:bg-zinc-800/40 pr-2 rounded-md'
      } ${isLockedBySomeoneElse ? 'ring-1 ring-red-500/30 ring-inset' : ''}
      ${dragOverBlockIndex === index && dragOverPosition === 'above' ? 'border-t-2 border-t-[#6b4cff]' : ''}
      ${dragOverBlockIndex === index && dragOverPosition === 'below' ? 'border-b-2 border-b-[#6b4cff]' : ''}
      ${draggedBlockIndex === index ? 'bg-blue-500/10 opacity-50' : ''}`}
      style={{ marginLeft: `${(block.depth || 0) * 1.5}rem` }}
    >
      {/* Left Gutter: single adaptive button (+ if blank, :: if content) */}
      <div className={`absolute left-0 top-1.5 transition-opacity flex items-center z-50 select-none -translate-x-full pr-1 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        {(!isSelected || isFirstSelected) && (
          isBlockEmpty ? (
            <button
              type="button"
              className="flex items-center justify-center w-5 h-6 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors duration-150 cursor-pointer"
              onClick={() => handleAddBlock('text', block.id)}
              title="Click to add block"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          ) : (
            <div className="relative group/grip flex items-center">
              <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
                <Popover.Trigger asChild>
                  <div
                    draggable={true}
                    onDragStart={(e) => {
                      handleDragStart(e, index);
                    }}
                    onDragEnd={() => {
                      handleDragEnd();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const newSel = e.shiftKey ? new Set(selectedBlockIds) : new Set<string>();
                      newSel.has(block.id) ? newSel.delete(block.id) : newSel.add(block.id);
                      setSelectedBlockIds(newSel);
                    }}
                    className="flex items-center justify-center w-5 h-6 rounded text-zinc-500 hover:bg-zinc-700/70 hover:text-zinc-200 transition-colors duration-150 cursor-grab active:cursor-grabbing"
                    aria-label={`Drag to move this line, or press ${ALT_KEY}+↑ / ${ALT_KEY}+↓`}
                  >
                    <GripVertical className="w-4 h-4 pointer-events-none" />
                  </div>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    align="start"
                    side="bottom"
                    className="w-48 p-1 bg-zinc-800 border border-zinc-700/80 rounded-lg shadow-xl z-[9999]"
                  >
                    <div className="px-2 py-1 text-xs text-zinc-400 font-medium">Options</div>
                    <div className="flex flex-col">
                      <div className="flex flex-col gap-1">
                        <Popover.Close asChild>
                          <button 
                            onClick={(e) => { handleTurnInto && handleTurnInto(block.id, 'collapsible'); }}
                            className="w-full text-left px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white rounded flex items-center gap-2 cursor-pointer">
                            <ChevronDown className="w-3.5 h-3.5" />
                            Turn into Collapsible
                          </button>
                        </Popover.Close>
                        <Popover.Close asChild>
                          <button 
                            onClick={(e) => { handleTurnInto && handleTurnInto(block.id, 'subtask'); }}
                            className="w-full text-left px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white rounded flex items-center gap-2 cursor-pointer">
                            <CheckSquare className="w-3.5 h-3.5" />
                            Turn into Subtask L
                          </button>
                        </Popover.Close>
                        <div className="my-1 border-t border-zinc-700/60" />
                        <Popover.Close asChild>
                          <button 
                            onClick={(e) => { handleDeleteBlock && handleDeleteBlock(block.id); }}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors cursor-pointer text-left">
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete Block
                          </button>
                        </Popover.Close>
                      </div>
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>

              {/* Tooltip matching Image 2 */}
              {!popoverOpen && (
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
          )
        )}
      </div>

      {/* Persistent lock indicator */}
      {isLockedBySomeoneElse && (
        <div className="absolute top-0 right-0 flex items-center gap-1 px-1.5 py-0.5 bg-red-950/60 border-l border-b border-red-500/30 rounded-bl-md z-10 pointer-events-none">
          <Lock className="w-2.5 h-2.5 text-red-400" />
          <span className="text-[9px] font-bold tracking-wide text-red-400 uppercase">
            {block.lockedByName || 'User'}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 min-w-0 flex-1 pr-20 relative">
        {block.type === 'callout' && (
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
        )}
        {block.type === 'tags' && (
          <Tags className="w-4 h-4 text-zinc-500 shrink-0" />
        )}
        {/* Subtask L connector — simple fixed SVG that perfectly points to the first line of the inline task node */}
        {block.type === 'subtask' && (
          <svg width="14" height="24" className="shrink-0 mr-1" viewBox="0 0 14 24">
            <path d="M2 0 L2 13 L14 13" stroke="#52525b" strokeWidth="1.5" fill="none" />
          </svg>
        )}
        {/* Collapsible toggle — filled triangle like Notion */}
        {block.type === 'collapsible' && (
          <button
            onClick={(e) => { e.stopPropagation(); handleToggleCollapse && handleToggleCollapse(block.id); }}
            className="flex items-center justify-center w-[22px] h-[22px] bg-secondary/60 hover:bg-secondary rounded-[4px] text-zinc-400 hover:text-zinc-200 transition-colors shrink-0 cursor-pointer self-start mt-0.5"
            title={block.isCollapsed ? 'Expand' : 'Collapse'}
          >
            {block.isCollapsed
              ? <svg width="8" height="10" viewBox="0 0 8 10" fill="currentColor"><polygon points="0,0 8,5 0,10" /></svg>
              : <svg width="10" height="8" viewBox="0 0 10 8" fill="currentColor"><polygon points="0,0 10,0 5,8" /></svg>
            }
          </button>
        )}

        <div key={`editor-${block.id}`} className={`flex-1 min-w-0 relative ${isSelected ? 'is-selected-block' : ''}`}>
          {/* Collapsed state: static single-line header text */}
          {block.type === 'collapsible' && block.isCollapsed ? (
            <div
              className="text-sm text-zinc-200 py-0.5 cursor-pointer truncate select-none"
              onClick={(e) => { e.stopPropagation(); handleToggleCollapse && handleToggleCollapse(block.id); }}
            >
              {(() => {
                let firstLine = block.content;
                if (!firstLine) return <span className="text-zinc-600 italic">Empty toggle</span>;
                // Split by common line break tags to get the true first line
                const parts = firstLine.split(/<br\s*\/?>|<\/?p>|<div[^>]*>|<\/div>/i);
                // Find the first part that actually has text
                let textToShow = "";
                for (const part of parts) {
                  const stripped = part.replace(/<[^>]+>/g, '').trim();
                  if (stripped) {
                    textToShow = stripped;
                    break;
                  }
                }
                return textToShow || <span className="text-zinc-600 italic">Empty toggle</span>;
              })()}
            </div>
          ) : (
            <>
              {isLast && (!block.content || block.content === '<p></p>' || block.content === '<p><br></p>') && (
                <div className="absolute top-0 left-0 text-[#71717a] text-sm pointer-events-none" style={{ userSelect: 'none', WebkitUserSelect: 'none' }}>
                  Write, press 'space' for AI, '/' for commands
                </div>
              )}
              <LazyBlockEditor
                forceMount={isSelected || focusedBlockId === block.id}
                editable={!isLockedBySomeoneElse}
                content={block.content}
                onChange={(newContent) => handleUpdateBlockContent(block.id, newContent)}
                onBlur={() => handleBlurBlock(block.id)}
                onKeyDown={(e) => handleKeyDown(e, block.id, index)}
                onIndent={() => handleIndentBlock && handleIndentBlock(block.id, index)}
                onOutdent={() => handleOutdentBlock && handleOutdentBlock(block.id, index)}
                onSplit={(contents) => handleSplitBlock(block.id, index, contents)}
                onFocus={() => handleFocusBlock(block.id)}
                onEditorReady={(editor) => { editorRegistryRef.current[block.id] = editor; }}
                onEditorUnmount={() => { delete editorRegistryRef.current[block.id]; }}
              />
            </>
          )}
        </div>
      </div>

      {block.assignees && block.assignees.length > 0 && (
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {block.assignees.map((ass: any, idx: number) => (
            <span
              key={idx}
              className="h-4 min-w-4 px-1 rounded-full text-[9px] font-extrabold flex items-center justify-center bg-zinc-700 text-zinc-200 border border-zinc-700/60"
            >
              {ass.value}
            </span>
          ))}
        </div>
      )}

      <div className={`transition-opacity flex items-center gap-1 absolute right-2 bottom-1 bg-background px-1 py-1 rounded-md shadow-sm border border-zinc-800 opacity-0 hover:opacity-100`}>
        {isLockedBySomeoneElse && (
          <div className="px-1.5 py-1 text-red-500 flex items-center gap-1 bg-red-950/40 rounded shadow-sm border border-red-900/50" title={`Locked by ${block.lockedByName || 'another user'}`}>
            <Lock className="w-3 h-3" />
            <span className="text-[10px] font-bold tracking-wide">
              LOCKED BY {block.lockedByName ? block.lockedByName.toUpperCase() : 'USER'}
            </span>
          </div>
        )}
        {!isLockedBySomeoneElse && (
          <button
            onClick={() => handleDeleteBlock(block.id)}
            className="p-1 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
            title="Delete block"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  return (
    prev.block.id === next.block.id &&
    prev.block.content === next.block.content &&
    prev.block.type === next.block.type &&
    prev.block.isCollapsed === next.block.isCollapsed &&
    prev.block.lockedByName === next.block.lockedByName &&
    prev.index === next.index &&
    prev.isLast === next.isLast &&
    prev.isLockedBySomeoneElse === next.isLockedBySomeoneElse &&
    prev.isSelected === next.isSelected &&
    prev.isFirstSelected === next.isFirstSelected &&
    prev.dragOverBlockIndex === next.dragOverBlockIndex &&
    prev.dragOverPosition === next.dragOverPosition &&
    prev.draggedBlockIndex === next.draggedBlockIndex &&
    prev.focusedBlockId === next.focusedBlockId
  );
});

// True when an event comes from the task detail modal (or one of its portaled popovers) rather than
// the doc itself — the page's document-level key/paste/drop handlers must leave those alone.
const isFromTaskModal = (target: EventTarget | null) =>
  target instanceof Element &&
  !!(target.closest('[data-task-detail-modal]') || target.closest('[data-radix-popper-content-wrapper]'));

const PAGES_PANEL_COLLAPSED_KEY = 'nexus-doc-pages-collapsed';

export default function DocPage({ docId }: { docId?: string }) {
  const params = useParams<{ id: string }>();
  const id = docId || params?.id;
  // Select only what the page uses: the whole store re-rendered this page (and every block row) on each task
  // update, e.g. each comment posted from the task modal opened over the journal.
  const { currentUser, setCurrentUser, loadTasks, hydrateTasksFromCache, updateTask, workspaceRoles } = useAppStore(useShallow((s) => ({
    currentUser: s.currentUser,
    setCurrentUser: s.setCurrentUser,
    loadTasks: s.loadTasks,
    hydrateTasksFromCache: s.hydrateTasksFromCache,
    updateTask: s.updateTask,
    workspaceRoles: s.workspaceRoles,
  })));
  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRolePopoverOpen, setIsRolePopoverOpen] = useState(false);

  const docRef = useRef<any>(null);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);


  const [activePage, setActivePage] = useState<any>(null);
  const activePageRef = useRef<any>(null);

  // Pages panel collapsed to a slim rail (ClickUp-style), remembered across docs and reloads
  const [isPagesPanelCollapsed, setIsPagesPanelCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem(PAGES_PANEL_COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const togglePagesPanel = () => {
    setIsPagesPanelCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(PAGES_PANEL_COLLAPSED_KEY, next ? '1' : '0'); } catch { }
      return next;
    });
  };
  useEffect(() => {
    activePageRef.current = activePage;
  }, [activePage]);

  // Mirror the active page into the URL so returning from a task's full view lands on the same page
  const activePageId = activePage?.id;
  useEffect(() => {
    if (typeof window === 'undefined' || !activePageId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('page') === activePageId) return;
    url.searchParams.set('page', activePageId);
    window.history.replaceState(null, '', url.toString());
  }, [activePageId]);

  const mainScrollRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el || !activePageId) return;

    // Restore scroll position for this page if previously saved
    const savedY = sessionStorage.getItem(`nexus_doc_scroll_${activePageId}`);
    if (savedY) {
      const targetY = parseInt(savedY, 10);
      if (!isNaN(targetY)) {
        requestAnimationFrame(() => {
          if (mainScrollRef.current) mainScrollRef.current.scrollTop = targetY;
        });
      }
    }

    const handleScroll = () => {
      if (mainScrollRef.current) {
        sessionStorage.setItem(`nexus_doc_scroll_${activePageId}`, String(mainScrollRef.current.scrollTop));
      }
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
    };
  }, [activePageId]);

  const [pageTitle, setPageTitle] = useState('');
  const pageTitleRef = useRef(pageTitle);
  useEffect(() => { pageTitleRef.current = pageTitle; }, [pageTitle]);

  const setAppPageTitle = useAppStore(state => state.setPageTitle);
  useEffect(() => {
    const title = pageTitle || activePage?.title || doc?.title;
    if (title) {
      setAppPageTitle(title);
    }
  }, [pageTitle, activePage?.title, doc?.title, setAppPageTitle]);
  const [blocks, setBlocks] = useState<DocBlock[]>([]);
  // Stable ref so event-handler closures registered with deps:[] never read stale blocks
  const blocksRef = useRef<DocBlock[]>([]);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  // Every block id this editor has held on the open page. Saves report seen-but-gone ids as deleted, so the
  // server keeps blocks this editor never had (tasks it appended, other users' blocks) instead of wiping them.
  const seenBlockIdsRef = useRef<{ pageId: string | null; ids: Set<string> }>({ pageId: null, ids: new Set() });
  useEffect(() => {
    const pageId = activePage?.id ?? null;
    if (seenBlockIdsRef.current.pageId !== pageId) seenBlockIdsRef.current = { pageId, ids: new Set() };
    blocks.forEach((b) => seenBlockIdsRef.current.ids.add(b.id));
  }, [blocks, activePage?.id]);
  const [savingPage, setSavingPage] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  
  // Custom multi-block selection state
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());
  const isMouseDownRef = useRef(false);
  const dragSelectionStartBlockIndexRef = useRef<number | null>(null);
  // Track whether the last mouseup resolved a cross-block native text selection
  const crossBlockNativeSelectionRef = useRef(false);
  // "min-max" index range of the current drag block-selection (null = still a text highlight).
  // Lets mousemove skip redundant state updates while the pointer moves within the same range.
  const dragSelectRangeKeyRef = useRef<string | null>(null);

  // Drag and drop state
  const [draggedBlockIndex, setDraggedBlockIndex] = useState<number | null>(null);
  const [dragOverBlockIndex, setDragOverBlockIndex] = useState<number | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<'above' | 'below' | null>(null);

  // Registry of all mounted Tiptap editor instances, keyed by block ID.
  // Used to programmatically focus the correct editor after Enter creates a new block.
  const editorRegistryRef = useRef<Record<string, any>>({});
  // Stable refs so deps:[] event handlers never read stale state values
  const selectedBlockIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => { selectedBlockIdsRef.current = selectedBlockIds; }, [selectedBlockIds]);
  const focusedBlockIdRef = useRef<string | null>(null);
  useEffect(() => { focusedBlockIdRef.current = focusedBlockId; }, [focusedBlockId]);
  const [subpageLimit, setSubpageLimit] = useState(10);

  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [pageVersions, setPageVersions] = useState<any[]>([]);

  // ── Right-hand panels opened from the floating tool rail
  type RightPanel = 'styles' | 'transfer' | 'history';
  const [rightPanel, setRightPanel] = useState<RightPanel | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<PageVersionRecord | null>(null);

  const refreshVersions = () => {
    const pageId = activePageRef.current?.id;
    if (!pageId) return;
    setVersionsLoading(true);
    spacesApi.getPageVersions(pageId)
      .then(res => { if (res.versions && activePageRef.current?.id === pageId) setPageVersions(res.versions); })
      .catch(err => console.error('Failed to load versions:', err))
      .finally(() => setVersionsLoading(false));
  };

  const toggleRightPanel = (panel: RightPanel) => {
    if (rightPanel === panel) {
      setRightPanel(null);
      return;
    }
    if (panel === 'history') {
      // History swaps the editor for a read-only preview: drop focus so keystrokes can't land in a hidden editor
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setSelectedVersionId(null);
      refreshVersions();
    }
    setRightPanel(panel);
  };

  // Versions that actually changed content, newest first, each paired with the version before it
  const versionEntries = useMemo(
    () => buildVersionEntries(pageVersions.filter((v) => v.pageId === activePage?.id)),
    [pageVersions, activePage?.id],
  );
  const isBrowsingHistory = rightPanel === 'history' && versionEntries.length > 0;
  const selectedVersionEntry = isBrowsingHistory
    ? (versionEntries.find(e => e.version.id === selectedVersionId) ?? versionEntries[0])
    : null;
  const selectedVersionDiffs = useMemo(() => {
    if (!selectedVersionEntry) return [];
    const after = markdownToBlocks(selectedVersionEntry.version.content);
    if (!selectedVersionEntry.previous) return after.map(block => ({ kind: 'same' as const, block }));
    return diffBlocks(markdownToBlocks(selectedVersionEntry.previous.content), after);
  }, [selectedVersionEntry]);

  // ── Page Styles (saved per browser in localStorage — see PageStylesPanel)
  const { styles: pageStyles, updateStyles: updatePageStyles, applyTypographyToAll } = usePageStyles(activePage?.id);
  const statsVisible = rightPanel === 'styles' || pageStyles.showStats;
  const pageStats = useMemo(() => (statsVisible ? computePageStats(blocks) : null), [blocks, statsVisible]);
  const pageOutline = useMemo(() => (pageStyles.showOutline ? computeOutline(blocks) : []), [blocks, pageStyles.showOutline]);
  // Last successful save in this session, tied to its page; otherwise the page's server timestamp.
  const [lastSave, setLastSave] = useState<{ pageId: string; at: string } | null>(null);
  const lastModifiedAt = lastSave && lastSave.pageId === activePage?.id ? lastSave.at : (activePage?.updatedAt ?? null);
  // Who saved when, without content (owner/contributors). Full versions are fetched only for the History
  // panel and for undo, since a journal day's 50 versions are tens of megabytes.
  const [allPageVersionMeta, setPageVersionMeta] = useState<any[]>([]);
  const pageVersionMeta = useMemo(
    () => allPageVersionMeta.filter((v) => v.pageId === activePage?.id),
    [allPageVersionMeta, activePage?.id],
  );
  // Versions are newest-first (max 50): the oldest loaded one approximates the page owner.
  const pageOwner = pageVersionMeta[pageVersionMeta.length - 1]?.user || currentUser;
  const pageContributors = useMemo(() => {
    const seen = new Map<string, { id: string; name?: string; avatarUrl?: string }>();
    pageVersionMeta.forEach((v) => {
      if (v.user?.id && !seen.has(v.user.id)) seen.set(v.user.id, v.user);
    });
    return Array.from(seen.values());
  }, [pageVersionMeta]);

  // Page whose saved versions (from earlier sessions) have been loaded into the undo stack. They are
  // fetched on the first undo rather than on every page open.
  const undoHistoryPageRef = useRef<string | null>(null);
  /** Per-page undo state; called wherever the open page is switched so undo never crosses pages. */
  const resetUndoForPageSwitch = () => {
    undoHistoryPageRef.current = null;
    setUndoStack([]);
    setRedoStack([]);
  };

  useEffect(() => {
    const pageId = activePage?.id;
    if (!pageId || !currentUser?.id) return;
    spacesApi.getPageVersions(pageId, { includeContent: false }).then(res => {
      if (res.versions && activePageRef.current?.id === pageId) setPageVersionMeta(res.versions);
    }).catch(err => console.error("Failed to load versions:", err));
  }, [activePage?.id, currentUser?.id]);



  // Global hover card state
  const [hoverCardData, setHoverCardData] = useState<any>(null);
  const [hoverCardPos, setHoverCardPos] = useState<{ x: number, y: number } | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Each opened page starts its subpage list on the first 10, current month included
  useEffect(() => {
    setSubpageLimit(10);
  }, [activePage?.id]);

  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const mentionNode = target.closest('span[data-type="mention"]');
      if (mentionNode) {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        const rect = mentionNode.getBoundingClientRect();
        setHoverCardPos({ x: rect.left, y: rect.bottom + 4 });
        setHoverCardData({
          id: mentionNode.getAttribute('data-id'),
          label: mentionNode.getAttribute('data-label'),
          mentionType: mentionNode.getAttribute('data-mention-type') || 'task',
          taskStatus: mentionNode.getAttribute('data-task-status'),
          tasks: mentionNode.getAttribute('data-tasks'),
          taskAssignees: mentionNode.getAttribute('data-task-assignees'),
          taskPriority: mentionNode.getAttribute('data-task-priority'),
          taskDueDate: mentionNode.getAttribute('data-task-due-date'),
        });
      } else {
        const hoverCardElement = document.getElementById('global-task-hover-card');
        if (hoverCardElement && hoverCardElement.contains(target)) {
          // Hovering over the card itself, do not close
          if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
          return;
        }
        if (hoverCardPos) {
          if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
          hoverTimeoutRef.current = setTimeout(() => {
            setHoverCardPos(null);
            setHoverCardData(null);
          }, 150);
        }
      }
    };

    document.addEventListener('mouseover', handleMouseOver);
    return () => document.removeEventListener('mouseover', handleMouseOver);
  }, [hoverCardPos]);

  const [dbTeams, setDbTeams] = useState<any[]>([]);
  const [selectedTaskForModal, setSelectedTaskForModal] = useState<Task | null>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

  // The Priorities journal opens tasks in the full-screen task page instead of the modal
  const router = useRouter();
  const isJournalDocRef = useRef(false);
  isJournalDocRef.current = !!doc?.isDailyRollover;

  // Opens the task modal for a task id OR a subtask id.
  // The modal only works on real Task records: given a subtask it would call /api/tasks/<subtaskId>/…
  // endpoints, which 404 ("Task not found"). Subtask records carry their parent in `taskId`, so a
  // subtask opens its PARENT task with `?subtask=<id>` — the modal reads that on mount and shows the
  // subtask's own detail view (with the correct activity/comments).
  const openTaskDetail = useCallback(async (taskId: string, taskObj?: Task & { taskId?: string }) => {
    const setTaskParams = (id: string | null, subtaskId: string | null) => {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set('task', id);
      else url.searchParams.delete('task');
      if (subtaskId) url.searchParams.set('subtask', subtaskId);
      else url.searchParams.delete('subtask');
      window.history.replaceState(null, '', url.toString());
    };
    const open = (task: Task, subtaskId: string | null) => {
      setTaskParams(task.id, subtaskId);
      setSelectedTaskForModal(task);
      setIsTaskModalOpen(true);
    };
    const hasSubtask = (task?: { subtasks?: { id: string }[] } | null) => !!task?.subtasks?.some(s => s.id === taskId);
    const { tasksIndex: index, tasks: allTasks } = useAppStore.getState();

    try {
      let parentId: string | null = taskObj?.taskId && taskObj.taskId !== taskObj.id ? taskObj.taskId : null;

      if (!parentId) {
        const known = (taskObj?.id === taskId ? taskObj : null) || index[taskId] || allTasks.find(t => t.id === taskId);
        if (known) return open(known, null);
        const res = await tasksApi.getTask(taskId);
        if (!res.task) return;
        if (!res.subtask) return open(res.task, null);
        // The requested id was a subtask: the server answered with its parent task
        if (hasSubtask(res.task)) return open(res.task, taskId);
        parentId = res.task.id;
      }

      const cachedParent = index[parentId];
      const parent = hasSubtask(cachedParent) ? cachedParent : (await tasksApi.getTask(parentId)).task;
      if (parent) open(parent, hasSubtask(parent) ? taskId : null);
    } catch (err) {
      console.error('Could not load task detail:', err);
    }
  }, [router]);

  // Native click handler for mention nodes — works even in read-only BlockEditor
  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const mentionSpan = target.closest('span[data-type="mention"]');
      if (!mentionSpan) return;
      const taskId = mentionSpan.getAttribute('data-id');
      if (!taskId) return;
      e.preventDefault();
      e.stopPropagation();
      openTaskDetail(taskId);
    };
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, [openTaskDetail]);

  useEffect(() => {
    const handleOpenTaskDetail = (e: Event) => {
      const detail = (e as CustomEvent<{ taskId?: string; task?: Task & { taskId?: string } }>).detail;
      if (!detail?.taskId) return;
      openTaskDetail(detail.taskId, detail.task);
    };
    window.addEventListener('open-task-detail', handleOpenTaskDetail);

    return () => {
      window.removeEventListener('open-task-detail', handleOpenTaskDetail);
    };
  }, [openTaskDetail]);

  // Open task modal on initial load if ?task= param is present
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const taskId = url.searchParams.get('task');
    if (taskId && !selectedTaskForModal && !isTaskModalOpen) {
      openTaskDetail(taskId);
    }
  }, [openTaskDetail, selectedTaskForModal, isTaskModalOpen]);

  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  // The task list is only needed while the link picker is open
  const tasks = useAppStore((s) => (isLinkModalOpen ? s.tasks : NO_TASKS));
  const [taskSearchQuery, setTaskSearchQuery] = useState('');

  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [pageToRename, setPageToRename] = useState<{ id: string, title: string } | null>(null);

  const handleRenamePageClick = (pageId: string, title: string) => {
    setPageToRename({ id: pageId, title: title || 'Untitled Page' });
    setIsRenameOpen(true);
  };

  const handleConfirmRename = async (newTitle: string) => {
    if (!pageToRename) return;
    try {
      await spacesApi.updatePage(pageToRename.id, { title: newTitle });

      if (activePage?.id === pageToRename.id) {
        setPageTitle(newTitle);
      }

      await fetchDoc();
    } catch (err) {
      console.error('Failed to rename page:', err);
    } finally {
      setIsRenameOpen(false);
      setPageToRename(null);
    }
  };

  const fetchTeams = async () => {
    try {
      const teamsRes = await usersApi.getTeams();
      if (teamsRes?.teams) {
        setDbTeams(teamsRes.teams);
      }
    } catch (err) {
      console.warn('Failed to load teams:', err);
    }
  };

  // The page tree arrives without content, so a page's content is fetched before switching to it. The
  // switch happens only once it has loaded, so the editor never shows (or saves) one page's blocks under
  // another page. A newer selection wins if requests overlap.
  const pageLoadSeqRef = useRef(0);
  // While a page's content is in flight its frame (title, toolbar) is already shown with skeleton rows.
  // Nothing may be saved meanwhile: the editor holds no blocks yet, and a save would wipe the page.
  const [pageContentState, setPageContentStateValue] = useState<'ready' | 'loading' | 'error'>('ready');
  const pageContentStateRef = useRef<'ready' | 'loading' | 'error'>('ready');
  const setPageContentState = (state: 'ready' | 'loading' | 'error') => {
    pageContentStateRef.current = state;
    setPageContentStateValue(state);
  };
  // When the open page's content arrived; saved versions older than this predate the session's undo stack
  const pageOpenedAtRef = useRef(0);

  // Content of the open page as last loaded or saved, to tell whether it has unsaved edits
  const lastSyncedContentRef = useRef<string | null>(null);
  const lastSyncedTitleRef = useRef<string | null>(null);

  const openPage = async (page: any) => {
    const seq = ++pageLoadSeqRef.current;
    // Edits are saved on blur, which fires after this click; save the page being left now, while it is
    // still the open page, since the blur save would otherwise run against the page being loaded.
    if (activePageRef.current && activePageRef.current.id !== page.id && pageContentStateRef.current === 'ready') {
      const leaving = blocksToMarkdown(blocksRef.current);
      if (leaving !== lastSyncedContentRef.current) handleSavePage(blocksRef.current);
    }
    let content: string | undefined = page.content;
    let cached: CachedPage | undefined;
    if (content === undefined) {
      // A recently opened page (e.g. a journal date) shows from cache at once and is revalidated below
      cached = getCachedPage(page.id);
      if (cached) {
        content = cached.content;
      } else {
        setPageContentState('loading');
        resetUndoForPageSwitch();
        setActivePage({ ...page });
        setPageTitle(page.title || 'Untitled Page');
        setBlocks([]);
        try {
          const res = await spacesApi.getPage(page.id);
          content = res.page?.content ?? '';
          setCachedPage(page.id, content, res.page?.updatedAt);
        } catch (err) {
          console.error('Failed to load page:', err);
          if (seq === pageLoadSeqRef.current) setPageContentState('error');
          return;
        }
      }
    }
    if (seq !== pageLoadSeqRef.current) return;
    if (page.content !== undefined || cached) resetUndoForPageSwitch();
    pageOpenedAtRef.current = Date.now();
    lastSyncedContentRef.current = content;
    lastSyncedTitleRef.current = page.title || 'Untitled Page';
    setActivePage({ ...page, content });
    setPageTitle(page.title || 'Untitled Page');
    setBlocks(markdownToBlocks(content));
    setPageContentState('ready');
    if (cached) revalidateCachedPage(page.id, cached, seq);
  };

  // Asks the server whether a page shown from cache changed since it was cached (cheap: no content unless
  // it did). A changed page — e.g. tasks auto-appended to the journal — replaces the cached blocks when
  // nothing was edited yet; otherwise only the blocks this editor hasn't seen are merged in.
  const revalidateCachedPage = async (pageId: string, cached: CachedPage, seq: number) => {
    try {
      const res = await spacesApi.getPage(pageId, { since: cached.updatedAt });
      if (res.notModified || res.page?.content === undefined) return;
      const fresh = res.page.content;
      setCachedPage(pageId, fresh, res.page.updatedAt);
      if (seq !== pageLoadSeqRef.current || activePageRef.current?.id !== pageId || pageContentStateRef.current !== 'ready') return;
      if (blocksToMarkdown(blocksRef.current) === lastSyncedContentRef.current) {
        lastSyncedContentRef.current = fresh;
        setBlocks(markdownToBlocks(fresh));
      } else {
        mergeUnseenServerBlocks(pageId, fresh);
      }
    } catch (err) {
      console.error('Failed to refresh cached page:', err);
    }
  };

  // Adds blocks from the stored page that this editor has never held (e.g. tasks the server appended under a
  // client / New Tasks), each after its nearest stored predecessor. Local edits and local deletions win.
  const mergeUnseenServerBlocks = (pageId: string, serverContent: string | undefined) => {
    if (!serverContent || activePageRef.current?.id !== pageId || pageContentStateRef.current !== 'ready') return;
    const serverBlocks = markdownToBlocks(serverContent);
    const seen = seenBlockIdsRef.current.pageId === pageId ? seenBlockIdsRef.current.ids : new Set<string>();
    setBlocks((prev) => {
      if (activePageRef.current?.id !== pageId) return prev;
      const localIds = new Set(prev.map((b) => b.id));
      const isUnseen = (b: DocBlock) => !localIds.has(b.id) && !seen.has(b.id);
      if (!serverBlocks.some(isUnseen)) return prev;
      const next = [...prev];
      serverBlocks.forEach((block, i) => {
        if (!isUnseen(block)) return;
        let insertAt = 0;
        for (let j = i - 1; j >= 0; j--) {
          const idx = next.findIndex((b) => b.id === serverBlocks[j].id);
          if (idx !== -1) {
            insertAt = idx + 1;
            break;
          }
        }
        next.splice(insertAt, 0, block);
      });
      return next;
    });
  };

  const fetchDoc = async () => {
    try {
      const docRes = await spacesApi.getDoc(id as string, { includeContent: false });
      setDoc(docRes.doc);
      if (docRes.doc?.pages?.length > 0 && !activePageRef.current) {
        let firstPage = docRes.doc.pages[0];

        // Restore the page (e.g. journal date) the user was on before leaving, via ?page=<id>
        const requestedPageId = typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('page')
          : null;
        const findPage = (pages: any[]): any => {
          for (const p of pages || []) {
            if (p.id === requestedPageId) return p;
            const sub = findPage(p.subpages);
            if (sub) return sub;
          }
          return null;
        };
        const requestedPage = requestedPageId ? findPage(docRes.doc.pages) : null;

        if (requestedPage) {
          firstPage = requestedPage;
        } else if (docRes.doc.isDailyRollover) {
          const allPages: any[] = [];
          const collectPages = (pages: any[]) => {
            for (const p of pages || []) {
              allPages.push(p);
              if (p.subpages?.length) collectPages(p.subpages);
            }
          };
          collectPages(docRes.doc.pages);

          const tz = docRes.doc.rolloverTimezone || 'Asia/Singapore';
          const todayTitle = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          }).format(new Date());

          const todayPage = allPages.find((p) => p.title === todayTitle);
          if (todayPage) {
            firstPage = todayPage;
          } else {
            const dayPages = allPages.filter((p) => p.parentPageId && !isNaN(new Date(p.title || '').getTime()));
            dayPages.sort((a, b) => new Date(b.title || '').getTime() - new Date(a.title || '').getTime());
            firstPage = dayPages[0] || docRes.doc.pages[0];
          }
        }

        // Not awaited: the doc frame renders now and the page's blocks fill in when they arrive
        openPage(firstPage);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load document');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentUser) {
        try {
          const { user } = await authApi.getMe();
          if (!cancelled && user) setCurrentUser(user);
        } catch { }
      }
      hydrateTasksFromCache();
      loadTasks(); // Fetch tasks from store without blocking doc fetch
      fetchTeams(); // Non-blocking so document loads instantly
      await fetchDoc();
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const s = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000', {
      withCredentials: true,
    });

    s.on('connect', () => {
      s.emit('join_doc', id);
    });

    s.on('block_locked', ({ blockId, userId, userName }) => {
      setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, lockedBy: userId, lockedByName: userName } : b));
    });

    s.on('block_unlocked', ({ blockId, userId }) => {
      setBlocks(prev => prev.map(b => b.id === blockId && b.lockedBy === userId ? { ...b, lockedBy: null, lockedByName: undefined } : b));
    });

    s.on('block_content_update', ({ blockId, content }) => {
      setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, content } : b));
    });

    // Refresh the page tree when someone else saves or the server adds a page. Bursts (e.g. several
    // tasks created at once) are coalesced into one request; the tree no longer carries page content.
    // If the open page changed, pull in the blocks this editor hasn't got (e.g. auto-appended tasks).
    let pageUpdatedTimer: ReturnType<typeof setTimeout> | null = null;
    let openPageChanged = false;
    s.on('page_updated', (data?: { pageId?: string }) => {
      if (!data?.pageId || data.pageId === activePageRef.current?.id) openPageChanged = true;
      if (pageUpdatedTimer) clearTimeout(pageUpdatedTimer);
      pageUpdatedTimer = setTimeout(() => {
        pageUpdatedTimer = null;
        fetchDoc();
        const pageId = activePageRef.current?.id;
        if (openPageChanged && pageId) {
          spacesApi.getPage(pageId)
            .then((res) => {
              if (res.notModified || res.page?.content === undefined) return;
              setCachedPage(pageId, res.page.content, res.page.updatedAt);
              if (blocksToMarkdown(blocksRef.current) === lastSyncedContentRef.current) {
                lastSyncedContentRef.current = res.page.content;
                setBlocks(markdownToBlocks(res.page.content));
              } else {
                mergeUnseenServerBlocks(pageId, res.page.content);
              }
            })
            .catch((err) => console.error('Failed to refresh page:', err));
        }
        openPageChanged = false;
      }, 500);
    });

    setSocket(s);

    return () => {
      if (pageUpdatedTimer) clearTimeout(pageUpdatedTimer);
      s.emit('leave_doc', id);
      s.disconnect();
    };
  }, [id]);

  const handleSelectPage = (page: any) => {
    openPage(page);
  };

  const handleCreatePage = async (parentPageId?: string) => {
    try {
      const cleanBlocks: DocBlock[] = [
        { id: `blk-${Date.now()}`, type: 'text', content: '' },
      ];

      const res = await spacesApi.createPage({
        title: 'Untitled Page',
        content: blocksToMarkdown(cleanBlocks),
        docId: id as string,
        parentPageId,
      });

      await fetchDoc();
      pageLoadSeqRef.current++; // cancel any in-flight page load so it can't replace the new page
      resetUndoForPageSwitch();
      lastSyncedContentRef.current = res.page.content ?? null;
      lastSyncedTitleRef.current = res.page.title || 'Untitled Page';
      setActivePage(res.page);
      setPageTitle(res.page.title || 'Untitled Page');
      setBlocks(cleanBlocks);
      setPageContentState('ready');
    } catch (err) {
      console.error('Failed to create page:', err);
    }
  };

  const handleSavePage = async (updatedBlocks = blocksRef.current, skipHistory = false) => {
    // No saves while the open page's content is loading (or failed to load): the editor has no blocks yet
    if (!activePageRef.current || pageContentStateRef.current !== 'ready') return;
    const content = blocksToMarkdown(updatedBlocks);
    const title = pageTitleRef.current;
    // Every click out of a block saves (e.g. opening a task from the journal). With nothing changed that would
    // upload and rewrite the whole page — megabytes for a journal day — and hold up the requests that follow.
    if (content === lastSyncedContentRef.current && title === lastSyncedTitleRef.current) return;
    setSavingPage(true);
    try {

      if (!skipHistory) {
        setUndoStack(prev => {
          if (prev.length === 0 || prev[prev.length - 1] !== content) {
            return [...prev, content].slice(-50); // keep last 50
          }
          return prev;
        });
        setRedoStack([]);
      }

      const savedPageId = activePageRef.current.id;
      const seen = seenBlockIdsRef.current;
      const savedIds = new Set(updatedBlocks.map((b) => b.id));
      const deletedBlockIds = seen.pageId === savedPageId ? [...seen.ids].filter((blockId) => !savedIds.has(blockId)) : undefined;
      const res = await spacesApi.updatePage(savedPageId, {
        title,
        content: content,
        deletedBlockIds,
      });
      // The server kept blocks this editor hadn't seen yet; show them
      if (res?.page?.content && res.page.content !== content) mergeUnseenServerBlocks(savedPageId, res.page.content);
      // The server's copy is now what was sent (or the merged copy it returned)
      setCachedPage(savedPageId, res?.page?.content ?? content, res?.page?.updatedAt);
      if (activePageRef.current?.id === savedPageId) {
        lastSyncedContentRef.current = content;
        lastSyncedTitleRef.current = title;
      }
      setLastSave({ pageId: savedPageId, at: new Date().toISOString() });
      if (socket) {
        // The page that was saved — the open page may have changed while the request was in flight
        socket.emit('page_updated', { docId: id, pageId: savedPageId });
      }
    } catch (err) {
      console.error('Failed to save page:', err);
    } finally {
      setSavingPage(false);
    }
  };

  const handleDeletePage = async (pageId: string) => {
    if (!pageId) return;
    forgetCachedPage(pageId);
    try {
      await spacesApi.deletePage(pageId);
    } catch (err) {
      console.warn('Page already deleted or not found:', err);
    } finally {
      setActivePage(null);
      await fetchDoc();
    }
  };

  const handleAddBlock = (type: DocBlock['type'] = 'text', afterId?: string) => {
    const newBlock: DocBlock = {
      id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      type,
      content: '',
      status: type === 'task' ? 'DAILY' : undefined,
    };

    let updated: DocBlock[];
    if (!afterId) {
      updated = [...blocks, newBlock];
    } else {
      const idx = blocks.findIndex((b) => b.id === afterId);
      if (idx === -1) {
        updated = [...blocks, newBlock];
      } else {
        updated = [...blocks.slice(0, idx + 1), newBlock, ...blocks.slice(idx + 1)];
      }
    }

    setBlocks(updated);
    setFocusedBlockId(newBlock.id);
    handleSavePage(updated);

    // Focus the new block's editor once React renders it into the registry
    setTimeout(() => {
      const newEditor = editorRegistryRef.current[newBlock.id];
      if (newEditor) {
        newEditor.commands.focus('start');
      }
    }, 10);
  };

  const handleSplitBlock = (blockId: string, index: number, contents: string[]) => {
    if (contents.length < 2) return;
    
    const currentBlock = blocksRef.current[index];
    if (!currentBlock) return;
    
    const currentBlockDepth = currentBlock.depth || 0;
    
    // If splitting a collapsible (pressing Enter), automatically indent the new block
    // so the user doesn't have to manually press Tab.
    const newBlockDepth = currentBlock.type === 'collapsible' ? currentBlockDepth + 1 : currentBlockDepth;
    
    const newBlocks: DocBlock[] = contents.slice(1).map(part => ({
      id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      type: 'text',
      content: part,
      depth: newBlockDepth,
    }));
    
    // If we are creating children, ensure the parent is expanded
    let finalBlocksToSave: DocBlock[] = [];
    setBlocks(prevBlocks => {
      const idx = prevBlocks.findIndex(b => b.id === blockId);
      if (idx === -1) return prevBlocks;
      
      const updatedBlocks = [...prevBlocks];
      updatedBlocks[idx] = { 
        ...updatedBlocks[idx], 
        content: contents[0],
        isCollapsed: currentBlock.type === 'collapsible' ? false : updatedBlocks[idx].isCollapsed 
      };
      
      const finalBlocks = [
        ...updatedBlocks.slice(0, idx + 1),
        ...newBlocks,
        ...updatedBlocks.slice(idx + 1)
      ];
      finalBlocksToSave = finalBlocks;
      return finalBlocks;
    });
    
    // Defer saving until state settles
    setTimeout(() => {
      if (finalBlocksToSave.length > 0) handleSavePage(finalBlocksToSave);
    }, 0);
    
    const focusId = newBlocks[0].id;
    setFocusedBlockId(focusId);
    
    // Focus the first newly created block
    setTimeout(() => {
      const newEditor = editorRegistryRef.current[focusId];
      if (newEditor) {
        newEditor.commands.focus('start');
      }
    }, 10);
  };

  const handleIndentBlock = (blockId: string, index?: number) => {
    const currentBlocks = [...blocksRef.current];
    const blockIndex = typeof index === 'number' && index >= 0 && index < currentBlocks.length
      ? index
      : currentBlocks.findIndex(b => b.id === blockId);
    if (blockIndex <= 0) return false;

    const block = currentBlocks[blockIndex];
    const currentDepth = block.depth || 0;
    const prevBlock = currentBlocks[blockIndex - 1];
    const maxDepth = (prevBlock.depth || 0) + 1;
    if (currentDepth < maxDepth) {
      currentBlocks[blockIndex] = { ...block, depth: currentDepth + 1 };
      setBlocks(currentBlocks);
      handleSavePage(currentBlocks);
      return true;
    }
    return false;
  };

  const handleOutdentBlock = (blockId: string, index?: number) => {
    const currentBlocks = [...blocksRef.current];
    const blockIndex = typeof index === 'number' && index >= 0 && index < currentBlocks.length
      ? index
      : currentBlocks.findIndex(b => b.id === blockId);
    if (blockIndex === -1) return false;

    const block = currentBlocks[blockIndex];
    const currentDepth = block.depth || 0;
    if (currentDepth > 0) {
      currentBlocks[blockIndex] = { ...block, depth: currentDepth - 1 };
      setBlocks(currentBlocks);
      handleSavePage(currentBlocks);
      return true;
    }
    return false;
  };

  const handleKeyDown = (e: any, blockId: string, index: number) => {
    // Clear block selection when user starts typing normally inside an editor
    if (selectedBlockIdsRef.current.size > 0 && !e.shiftKey && e.key !== 'Escape') {
      setSelectedBlockIds(new Set());
    }

    const isIndentKey = (e.ctrlKey || e.metaKey) && (e.key === ']' || e.code === 'BracketRight');
    const isOutdentKey = (e.ctrlKey || e.metaKey) && (e.key === '[' || e.code === 'BracketLeft');

    if (isIndentKey) {
      e.preventDefault();
      const editor = editorRegistryRef.current[blockId];
      if (editor) {
        editor.commands.indent();
      } else {
        handleIndentBlock(blockId, index);
      }
      return;
    }

    if (isOutdentKey) {
      e.preventDefault();
      const editor = editorRegistryRef.current[blockId];
      if (editor) {
        editor.commands.outdent();
      } else {
        handleOutdentBlock(blockId, index);
      }
      return;
    }

    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const currentBlocks = [...blocksRef.current];
      const targetIndex = e.key === 'ArrowUp' ? index - 1 : index + 1;
      if (targetIndex >= 0 && targetIndex < currentBlocks.length) {
        const temp = currentBlocks[index];
        currentBlocks[index] = currentBlocks[targetIndex];
        currentBlocks[targetIndex] = temp;
        setBlocks(currentBlocks);
        handleSavePage(currentBlocks);
        setTimeout(() => {
          const ed = editorRegistryRef.current[blockId];
          if (ed) ed.commands.focus();
        }, 10);
      }
      return;
    }

    if (e.key === 'Tab') {
      const editor = editorRegistryRef.current[blockId];
      const hasListItem = !!editor?.schema?.nodes?.listItem;
      const hasTaskItem = !!editor?.schema?.nodes?.taskItem;

      if (e.shiftKey) {
        if ((hasListItem && editor?.can()?.liftListItem('listItem')) || (hasTaskItem && editor?.can()?.liftListItem('taskItem'))) {
          e.preventDefault();
          if (hasListItem && editor?.can()?.liftListItem('listItem')) editor.commands.liftListItem('listItem');
          else if (hasTaskItem) editor.commands.liftListItem('taskItem');
          return;
        }
      } else {
        if ((hasListItem && editor?.can()?.sinkListItem('listItem')) || (hasTaskItem && editor?.can()?.sinkListItem('taskItem'))) {
          e.preventDefault();
          if (hasListItem && editor?.can()?.sinkListItem('listItem')) editor.commands.sinkListItem('listItem');
          else if (hasTaskItem) editor.commands.sinkListItem('taskItem');
          return;
        }
      }

      e.preventDefault();
      if (e.shiftKey) {
        handleOutdentBlock(blockId, index);
      } else {
        handleIndentBlock(blockId, index);
      }
      return;
    }

    if (e.key === 'Backspace') {
      // Only delete the block itself when it's truly empty — let the editor handle normal deletions
      const currentBlocks = blocksRef.current;
      const block = currentBlocks.find(b => b.id === blockId);
      const isEmpty = !block?.content || block.content === '' || block.content === '<p></p>' || block.content === '<p><br></p>';
      if (isEmpty) {        e.preventDefault();
        handleDeleteBlock(blockId);
        if (index > 0) {
          const prevBlock = currentBlocks[index - 1];
          if (prevBlock) {
            const prevId = prevBlock.id;
            handleFocusBlock(prevId);
            setTimeout(() => {
              const prevEditor = editorRegistryRef.current[prevId];
              if (prevEditor) {
                prevEditor.commands.focus('end');
              }
            }, 10);
          }
        }
      } else if (index > 0) {
        // Block is not empty, but Backspace was pressed at the very beginning
        e.preventDefault();
        const prevBlock = currentBlocks[index - 1];
        const prevId = prevBlock.id;
        
        const currentEditor = editorRegistryRef.current[blockId];
        const prevEditor = editorRegistryRef.current[prevId];
        
        if (currentEditor && prevEditor) {
          const currentContent = currentEditor.getHTML();
          let cHtml = currentContent;
          if (cHtml.startsWith('<p>')) cHtml = cHtml.substring(3);
          if (cHtml.endsWith('</p>')) cHtml = cHtml.substring(0, cHtml.length - 4);
          
          let pHtml = prevEditor.getHTML();
          let newPHtml = pHtml.replace(/<\/p>$/, cHtml + '</p>');
          
          const oldSize = prevEditor.state.doc.content.size;
          prevEditor.commands.setContent(newPHtml, false);
          
          handleDeleteBlock(blockId);
          
          setTimeout(() => {
            // focus at the merge point
            prevEditor.commands.focus(Math.max(1, oldSize - 1));
          }, 10);
        }
      }
    } else if (e.key === 'Delete') {
      const currentBlocks = blocksRef.current;
      if (index < currentBlocks.length - 1) {
        e.preventDefault();
        const nextBlock = currentBlocks[index + 1];
        const nextId = nextBlock.id;
        
        const currentEditor = editorRegistryRef.current[blockId];
        const nextEditor = editorRegistryRef.current[nextId];
        
        if (currentEditor && nextEditor) {
          const currentContent = currentEditor.getHTML();
          const nextContent = nextEditor.getHTML();
          
          let nHtml = nextContent;
          if (nHtml.startsWith('<p>')) nHtml = nHtml.substring(3);
          if (nHtml.endsWith('</p>')) nHtml = nHtml.substring(0, nHtml.length - 4);
          
          let newCHtml = currentContent.replace(/<\/p>$/, nHtml + '</p>');
          
          const oldSize = currentEditor.state.doc.content.size;
          currentEditor.commands.setContent(newCHtml, false);
          
          handleDeleteBlock(nextId);
          
          setTimeout(() => {
            currentEditor.commands.focus(Math.max(1, oldSize - 1));
          }, 10);
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();      // Enter block selection mode for the current block
      const newSelection = new Set<string>();
      newSelection.add(blockId);
      setSelectedBlockIds(newSelection);
      // Blur the editor so native keydown takes over
      const editor = editorRegistryRef.current[blockId];
      if (editor) {
        editor.commands.blur();
      }
    } else if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      // Only jump to block-selection mode when Shift+Arrow is pressed from within the
      // editor — do NOT intercept it if Tiptap can still move the cursor within the block.
      // We use the Tiptap editor's state to check if we're at the very start/end.
      const editor = editorRegistryRef.current[blockId];
      const atStart = editor?.state?.selection?.$from?.parentOffset === 0;
      const atEnd = editor?.state?.selection?.$to?.parentOffset === editor?.state?.selection?.$to?.parent?.content?.size;
      const shouldCrossBlock = (e.key === 'ArrowUp' && atStart) || (e.key === 'ArrowDown' && atEnd);

      if (shouldCrossBlock) {
        e.preventDefault();        const newSelection = new Set<string>();
        newSelection.add(blockId);
        const currentBlocks = blocksRef.current;
        if (e.key === 'ArrowUp' && index > 0) newSelection.add(currentBlocks[index - 1].id);
        if (e.key === 'ArrowDown' && index < currentBlocks.length - 1) newSelection.add(currentBlocks[index + 1].id);
        setSelectedBlockIds(newSelection);
        if (editor) editor.commands.blur();
      }
      // else: let Tiptap/native handle Shift+Arrow within the block
    } else if (!e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const editor = editorRegistryRef.current[blockId];
      const docSize = editor?.state?.doc?.content?.size || 0;
      const atStart = editor?.state?.selection?.$from?.pos === 1;
      const atEnd = editor?.state?.selection?.$to?.pos === Math.max(1, docSize - 1);
      
      if (e.key === 'ArrowUp' && atStart && index > 0) {
        e.preventDefault();
        const prevId = blocksRef.current[index - 1].id;
        handleFocusBlock(prevId);
        setTimeout(() => {
          const prevEditor = editorRegistryRef.current[prevId];
          if (prevEditor) prevEditor.commands.focus('end');
        }, 10);
      } else if (e.key === 'ArrowDown' && atEnd && index < blocksRef.current.length - 1) {
        e.preventDefault();
        const nextId = blocksRef.current[index + 1].id;
        handleFocusBlock(nextId);
        setTimeout(() => {
          const nextEditor = editorRegistryRef.current[nextId];
          if (nextEditor) nextEditor.commands.focus('start');
        }, 10);
      }
    }
  };


  // ── Mouse tracking.
  // IMPORTANT: We deliberately do NOT convert cross-block native text selection
  // into block-selection mode here. This gives Google Docs-style behaviour:
  // the user can freely click-drag to highlight text across block boundaries
  // and the native blue cursor highlight is preserved.
  // Block selection mode (blue block highlight) is ONLY entered via:
  //   - Escape key inside an editor
  //   - Click on the grip handle (⠿)
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      isMouseDownRef.current = true;
      crossBlockNativeSelectionRef.current = false;
      dragSelectRangeKeyRef.current = null;
      const target = e.target as HTMLElement;

      // Clear BLOCK-selection when clicking anywhere that isn't the grip or inside
      // an already-selected block wrapper
      setSelectedBlockIds(prev => {
        if (prev.size === 0) return prev;
        if (e.shiftKey) return prev;
        const isGrip = !!target.closest('.cursor-grab');
        const isOnSelectedBlock = !!target.closest('.is-selected-block');
        if (!isGrip && !isOnSelectedBlock) {          return new Set();
        }
        return prev;
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      isMouseDownRef.current = false;
      dragSelectionStartBlockIndexRef.current = null;
      crossBlockNativeSelectionRef.current = false;
      dragSelectRangeKeyRef.current = null;

      // Debug: log what the native selection looks like after mouseup
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) {
        const anchorEl = (
          sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement
        )?.closest('[data-block-id]');
        const focusEl = (
          sel.focusNode instanceof Element ? sel.focusNode : sel.focusNode?.parentElement
        )?.closest('[data-block-id]');
        if (anchorEl && focusEl) {
          const isCrossBlock = anchorEl !== focusEl;
          
        }
      }
    };

    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('mouseup', handleMouseUp, true);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
    };
  }, []);

  // ── Handle cross-block native text selection + Backspace/Delete → merge blocks
  // This works in tandem with Google Docs-style free selection. When the user
  // has dragged text across block boundaries and presses Backspace, we:
  //  1) delete the native selection contents via range.deleteContents()
  //  2) read the remaining innerHTML from the two boundary editors
  //  3) merge them into the start block and remove intermediate blocks
  useEffect(() => {
    const handleNativeBackspace = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      if (isFromTaskModal(e.target)) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;

      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      if (!anchorNode || !focusNode) return;

      const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
      const focusElement = focusNode instanceof Element ? focusNode : focusNode.parentElement;

      const anchorBlock = anchorElement?.closest('[data-block-id]');
      const focusBlock = focusElement?.closest('[data-block-id]');

      // Only intercept when the selection genuinely spans two different blocks
      if (!anchorBlock || !focusBlock || anchorBlock === focusBlock) return;

      e.preventDefault();
      const anchorId = anchorBlock.getAttribute('data-block-id');
      const focusId = focusBlock.getAttribute('data-block-id');
      if (!anchorId || !focusId) return;

      const currentBlocks = blocksRef.current;
      const startIndex = currentBlocks.findIndex(b => b.id === anchorId);
      const endIndex = currentBlocks.findIndex(b => b.id === focusId);
      if (startIndex === -1 || endIndex === -1) return;

      const min = Math.min(startIndex, endIndex);
      const max = Math.max(startIndex, endIndex);
      

      try {
        const range = selection.getRangeAt(0);
        range.deleteContents();

        const startEditorDOM = document.querySelector(`[data-block-id="${currentBlocks[min].id}"] .ProseMirror`);
        const endEditorDOM = document.querySelector(`[data-block-id="${currentBlocks[max].id}"] .ProseMirror`);

        let startContent = startEditorDOM?.innerHTML || '';
        let endContent = endEditorDOM?.innerHTML || '';
        startContent = startContent.replace(/<p><\/p>/g, '').replace(/<p><br\s*\/?><\/p>/g, '');
        endContent = endContent.replace(/<p><\/p>/g, '').replace(/<p><br\s*\/?><\/p>/g, '');
        
        if (startContent.endsWith('</p>') && endContent.startsWith('<p>')) {
          startContent = startContent.substring(0, startContent.length - 4);
          endContent = endContent.substring(3);
        }
        
        const mergedContent = startContent + endContent || '';

        

        const newBlocks = [
          ...currentBlocks.slice(0, min),
          { ...currentBlocks[min], content: mergedContent },
          ...currentBlocks.slice(max + 1)
        ];

        setBlocks(newBlocks);
        handleSavePage(newBlocks);

        requestAnimationFrame(() => {
          const editor = editorRegistryRef.current[currentBlocks[min].id];
          if (editor) editor.commands.focus('end');
        });
      } catch (err) {
        console.error('[BlockEditor] Failed to merge cross-block selection on backspace', err);
      }
    };

    const handleNativeCopyCut = (e: ClipboardEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;

      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      if (!anchorNode || !focusNode) return;

      const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
      const focusElement = focusNode instanceof Element ? focusNode : focusNode.parentElement;

      const anchorBlock = anchorElement?.closest('[data-block-id]');
      const focusBlock = focusElement?.closest('[data-block-id]');

      // Only intercept when the selection genuinely spans two different blocks
      if (!anchorBlock || !focusBlock || anchorBlock === focusBlock) return;

      const anchorId = anchorBlock.getAttribute('data-block-id');
      const focusId = focusBlock.getAttribute('data-block-id');
      if (!anchorId || !focusId) return;

      const currentBlocks = blocksRef.current;
      const startIndex = currentBlocks.findIndex(b => b.id === anchorId);
      const endIndex = currentBlocks.findIndex(b => b.id === focusId);
      if (startIndex === -1 || endIndex === -1) return;

      const min = Math.min(startIndex, endIndex);
      const max = Math.max(startIndex, endIndex);

      e.preventDefault();
      // Extract raw text natively spanning the blocks.
      // window.getSelection().toString() natively returns newlines for paragraph breaks in contenteditable.
      // We will ensure blocks are separated by double newlines so our paste handler recognizes them.
      let textToCopy = selection.toString();
      
      // If the native toString() didn't give us multi-line text, we can build it manually.
      // But typically browser does it right for cross-div selection.
      // To be completely safe and ensure \n\n structure:
      const selectedBlocks = currentBlocks.slice(min, max + 1);
      if (selectedBlocks.length > 0) {
        // Fallback: if browser native text is completely unformatted, we force it.
        // But native selection toString() is usually the most accurate for partial text selection in the first and last blocks!
        // We'll trust the native selection, but replace single newlines between block boundaries with double newlines.
        // Actually, just standardizing on what the browser gives is safest for partial selections.
      }

      e.clipboardData?.setData('text/plain', textToCopy);

      if (e.type === 'cut') {
        try {
          const range = selection.getRangeAt(0);
          range.deleteContents();

          const startEditorDOM = document.querySelector(`[data-block-id="${currentBlocks[min].id}"] .ProseMirror`);
          const endEditorDOM = document.querySelector(`[data-block-id="${currentBlocks[max].id}"] .ProseMirror`);

          let startContent = startEditorDOM?.innerHTML || '';
          let endContent = endEditorDOM?.innerHTML || '';
          startContent = startContent.replace(/<p><\/p>/g, '').replace(/<p><br\s*\/?><\/p>/g, '');
          endContent = endContent.replace(/<p><\/p>/g, '').replace(/<p><br\s*\/?><\/p>/g, '');
          
          if (startContent.endsWith('</p>') && endContent.startsWith('<p>')) {
            startContent = startContent.substring(0, startContent.length - 4);
            endContent = endContent.substring(3);
          }
          
          const mergedContent = startContent + endContent || '';

          const newBlocks = [
            ...currentBlocks.slice(0, min),
            { ...currentBlocks[min], content: mergedContent },
            ...currentBlocks.slice(max + 1)
          ];

          setBlocks(newBlocks);
          handleSavePage(newBlocks);

          requestAnimationFrame(() => {
            const editor = editorRegistryRef.current[currentBlocks[min].id];
            if (editor) editor.commands.focus('end');
          });
        } catch (err) {
          console.error('[BlockEditor] Failed to cut cross-block selection', err);
        }
      }
    };

    const handleSelectAll = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        if (isFromTaskModal(e.target)) return;
        // If they are focusing something that is NOT our editor (like a title input), don't intercept
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          if (!target.closest('.ProseMirror')) return;
        }

        // Notion-style: the first Ctrl+A inside a block selects that block's text (so it can be
        // formatted); only a second press, once the whole block is already selected, selects all blocks.
        const blockEl = target.closest?.('.ProseMirror')?.closest('[data-block-id]');
        const blockEditor = blockEl ? editorRegistryRef.current[blockEl.getAttribute('data-block-id') || ''] : null;
        if (blockEditor && !blockEditor.isEmpty) {
          const { from, to } = blockEditor.state.selection;
          const docSize = blockEditor.state.doc.content.size;
          const wholeBlockSelected = from <= 1 && to >= docSize - 1;
          if (!wholeBlockSelected) return;
        }

        e.preventDefault();
        const allIds = new Set(blocksRef.current.map(b => b.id));
        setSelectedBlockIds(allIds);
        
        // Blur active element to exit Tiptap edit mode natively
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        window.getSelection()?.removeAllRanges();
      }
    };

    document.addEventListener('keydown', handleNativeBackspace);
    document.addEventListener('keydown', handleSelectAll, true);
    document.addEventListener('copy', handleNativeCopyCut);
    document.addEventListener('cut', handleNativeCopyCut);
    return () => {
      document.removeEventListener('keydown', handleNativeBackspace);
      document.removeEventListener('keydown', handleSelectAll, true);
      document.removeEventListener('copy', handleNativeCopyCut);
      document.removeEventListener('cut', handleNativeCopyCut);
    };
  }, []);

  // ── Global key listener for Block Selection Mode
  // Only active when selectedBlockIds has entries (i.e., user pressed Escape or clicked grip)
  useEffect(() => {
    if (selectedBlockIds.size === 0) return;

    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      if (isFromTaskModal(e.target)) return;
      // Don't intercept if focus is inside an active editor
      if (e.target instanceof HTMLElement && e.target.closest('.ProseMirror') && document.activeElement === e.target) {        return;
      }
      if (e.key === 'Escape') {
        setSelectedBlockIds(new Set());
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        const updated = blocks.filter(b => !selectedBlockIds.has(b.id));
        setBlocks(updated);
        handleSavePage(updated);
        setSelectedBlockIds(new Set());
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const blockArray = Array.from(selectedBlockIds);
        if (blockArray.length === 0) return;
        
        let targetIndex = -1;
        if (e.key === 'ArrowUp') {
          const firstSelectedId = blockArray[0];
          const idx = blocks.findIndex(b => b.id === firstSelectedId);
          if (idx > 0) targetIndex = idx - 1;
        } else {
          const lastSelectedId = blockArray[blockArray.length - 1];
          const idx = blocks.findIndex(b => b.id === lastSelectedId);
          if (idx < blocks.length - 1) targetIndex = idx + 1;
        }

        if (targetIndex >= 0) {
          const newSelection = e.shiftKey ? new Set(selectedBlockIds) : new Set<string>();
          newSelection.add(blocks[targetIndex].id);
          setSelectedBlockIds(newSelection);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        const selectedBlocks = blocks.filter(b => selectedBlockIds.has(b.id));
        const textToCopy = selectedBlocks.map(b => {
          // Strip HTML tags, preserving paragraph boundaries as real newlines
          let html = b.content;
          html = html.replace(/<p[^>]*>/g, '').replace(/<\/p>/g, '\n');
          html = html.replace(/<br\s*[/]?>/gi, '\n');
          // DOMParser builds an inert document: unlike innerHTML on a live element, nothing in it loads or runs
          // (an <img onerror> in stored page content would otherwise execute on copy)
          return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() || '';
        }).filter(t => t.length > 0).join('\n\n');

        navigator.clipboard.writeText(textToCopy);
        return;
      }

      // Cut text content of selected blocks
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault();
        const selectedBlocks = blocks.filter(b => selectedBlockIds.has(b.id));
        const textToCopy = selectedBlocks.map(b => {
          let html = b.content;
          html = html.replace(/<p[^>]*>/g, '').replace(/<\/p>/g, '\n');
          html = html.replace(/<br\s*[/]?>/gi, '\n');
          return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() || '';
        }).filter(t => t.length > 0).join('\n\n');        navigator.clipboard.writeText(textToCopy);
        // Remove cut blocks
        const remainingBlocks = blocks.filter(b => !selectedBlockIds.has(b.id));
        setBlocks(remainingBlocks);
        setSelectedBlockIds(new Set());
        handleSavePage(remainingBlocks);
        return;
      }

      // Paste over selected blocks (replaces them)
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && selectedBlockIds.size > 0) {
        e.preventDefault();
        navigator.clipboard.readText().then(text => {
          if (!text) return;
          // Split on real newlines (double newline = block boundary, single = within block)
          const parts = text.split(/\n\n|\n/).map(t => t.trim()).filter(t => t.length > 0);
          if (parts.length === 0) return;
          
          const newBlocks: DocBlock[] = parts.map(part => {
            const nexus = parseNexusTaskLink(part);
            if (nexus) {
              const snapshot = getTaskSnapshot(nexus.taskId);
              return {
                id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                type: 'text',
                content: `<p><span data-type="mention" class="task-mention" data-id="${nexus.taskId}" data-label="${snapshot.title.replace(/"/g, '&quot;')}" data-mention-type="${nexus.isSubtask ? 'subtask' : 'task'}" data-task-status="${(snapshot.status || '').replace(/"/g, '&quot;')}" data-task-assignees="${(snapshot.assignees || '').replace(/"/g, '&quot;')}">${snapshot.title}</span></p>`,
              };
            }
            return {
              id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              type: 'text',
              content: `<p>${part}</p>`,
            };
          });
          const selectedArr = Array.from(selectedBlockIds);
          const firstSelectedId = selectedArr[0];
          const insertIndex = blocks.findIndex(b => b.id === firstSelectedId);
          if (insertIndex !== -1) {
            let updated = [
              ...blocks.slice(0, insertIndex),
              ...newBlocks,
              ...blocks.slice(insertIndex + selectedArr.length)
            ];

            const lastBlock = updated[updated.length - 1];
            const isLastBlockEmpty = !lastBlock || !lastBlock.content || lastBlock.content === '<p></p>' || lastBlock.content === '<p><br></p>';
            if (updated.length === 0 || !isLastBlockEmpty) {
              updated.push({
                id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                type: 'text',
                content: '',
              });
            }

            setBlocks(updated);
            setSelectedBlockIds(new Set());
            handleSavePage(updated);
          }
        }).catch(err => {
          console.error('[BlockEditor] Failed to read clipboard on paste:', err);
        });
        return;
      }
      
      if (e.key === 'Enter') {
        e.preventDefault();
        const selectedArr = Array.from(selectedBlockIds);
        const lastSelectedId = selectedArr[selectedArr.length - 1];
        setSelectedBlockIds(new Set());
        handleAddBlock('text', lastSelectedId);
        return;
      }

      // If user types a printable character, overwrite the selected blocks with a new block containing that text
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        
        // Find the index of the first selected block to insert the new one there
        const firstSelectedId = Array.from(selectedBlockIds)[0];
        const insertIndex = blocks.findIndex(b => b.id === firstSelectedId);
        
        const newBlock: DocBlock = {
          id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          type: 'text',
          content: `<p>${e.key}</p>`,
        };

        const remainingBlocks = blocks.filter(b => !selectedBlockIds.has(b.id));
        const updated = [
          ...remainingBlocks.slice(0, insertIndex),
          newBlock,
          ...remainingBlocks.slice(insertIndex)
        ];

        setBlocks(updated);
        handleSavePage(updated);
        setSelectedBlockIds(new Set());
        setFocusedBlockId(newBlock.id);
        
        requestAnimationFrame(() => {
          const newEditor = editorRegistryRef.current[newBlock.id];
          if (newEditor) {
            newEditor.commands.focus('end');
          }
        });
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [selectedBlockIds, blocks]);


  // Emit locks for multi-selected blocks
  useEffect(() => {
    if (socket && selectedBlockIds.size > 0) {
      selectedBlockIds.forEach(blockId => {
        socket.emit('block_focus', { docId: id, blockId });
      });
    }
  }, [selectedBlockIds, socket, id]);

  const handleUndo = useCallback(async () => {
    // First undo on this page: put the caller's earlier saved versions underneath this session's history
    const pageId = activePageRef.current?.id;
    if (pageId && undoHistoryPageRef.current !== pageId) {
      undoHistoryPageRef.current = pageId;
      try {
        const res = await spacesApi.getPageVersions(pageId, { mine: true });
        if (activePageRef.current?.id !== pageId) return;
        const earlier = (res.versions || [])
          .filter((v: any) => new Date(v.createdAt).getTime() < pageOpenedAtRef.current)
          .map((v: any) => v.content as string)
          .reverse();
        if (earlier.length > 0) setUndoStack(session => [...earlier, ...session].slice(-50));
      } catch (err) {
        console.error('Failed to load undo history:', err);
      }
    }
    setUndoStack(prevUndo => {
      if (prevUndo.length <= 1) return prevUndo; // Need at least current + previous
      
      const currentState = prevUndo[prevUndo.length - 1];
      const previousState = prevUndo[prevUndo.length - 2];
      
      setRedoStack(prevRedo => [...prevRedo, currentState]);
      const newUndo = prevUndo.slice(0, -1);
      
      const restoredBlocks = markdownToBlocks(previousState);
      setBlocks(restoredBlocks);
      handleSavePage(restoredBlocks, true);
      
      return newUndo;
    });
  }, []);

  const handleRedo = useCallback(() => {
    setRedoStack(prevRedo => {
      if (prevRedo.length === 0) return prevRedo;
      
      const nextState = prevRedo[prevRedo.length - 1];
      const newRedo = prevRedo.slice(0, -1);
      
      setUndoStack(prevUndo => [...prevUndo, nextState]);
      
      const restoredBlocks = markdownToBlocks(nextState);
      setBlocks(restoredBlocks);
      handleSavePage(restoredBlocks, true);
      
      return newRedo;
    });
  }, []);

  // Global Undo/Redo keydown
  useEffect(() => {
    const handleUndoRedoKeys = (e: KeyboardEvent) => {
      if (isFromTaskModal(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    document.addEventListener('keydown', handleUndoRedoKeys);
    return () => document.removeEventListener('keydown', handleUndoRedoKeys);
  }, [handleUndo, handleRedo]);

  // ── Global paste & drop handler.
  // Strategy:
  //   1. Always read the clipboard/drop text first so we can inspect it.
  //   2. If text has \n\n (multi-block content) → we ALWAYS intercept, even inside ProseMirror.
  //      Tiptap can't split across blocks, so we must handle it ourselves.
  //   3. If text is single-line AND focus is inside ProseMirror → let Tiptap handle it.
  //   4. If block-selection mode is active → the keydown Ctrl+V handler takes precedence.
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent | DragEvent) => {
      if (isFromTaskModal(e.target)) return;
      let text = '';
      if (e.type === 'drop') {
        text = (e as DragEvent).dataTransfer?.getData('text/plain') ?? '';
      } else {
        text = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
      }

      const isInsideProseMirror = !!document.activeElement?.closest('.ProseMirror');
      const currentlySelectedIds = selectedBlockIdsRef.current;
      const currentBlocks = blocksRef.current;
      const focusedId = focusedBlockIdRef.current;

      

      // If no text at all, do nothing
      if (!text.trim()) {        return;
      }

      // Split candidate: \n\n = block boundary, \n = line within block
      const parts = text.split(/\n\n|\n/).map(t => t.trim()).filter(t => t.length > 0);
      const isMultiBlock = parts.length > 1;
      // If block-selection mode is active, the keydown Ctrl+V handler replaces selected blocks.
      // Don't double-handle it here.
      if (currentlySelectedIds.size > 0) {        return;
      }

      // If single-line paste inside an active editor → let Tiptap handle it naturally
      if (!isMultiBlock && isInsideProseMirror) {        return;
      }

      // From here we own the paste event.
      // We must stop propagation so Tiptap's internal paste handler doesn't also fire.
      e.preventDefault();
      e.stopPropagation();
      

      if (parts.length === 0) return;

      // Determine insert position: after the focused block (or after the active ProseMirror block)
      let anchorBlockId = focusedId;
      if (!anchorBlockId && isInsideProseMirror) {
        // Find which block the active editor belongs to
        const proseMirrorEl = document.activeElement?.closest('[data-block-id]');
        anchorBlockId = proseMirrorEl?.getAttribute('data-block-id') ?? null;      }

      const insertAfterIndex = anchorBlockId
        ? currentBlocks.findIndex(b => b.id === anchorBlockId)
        : currentBlocks.length - 1;

      

      // Helper: focus a block's editor with retry (React commit may be async)
      const focusBlockWithRetry = (blockId: string, attempts = 0) => {
        const editor = editorRegistryRef.current[blockId];
        if (editor) {
          editor.commands.focus('end');        } else if (attempts < 10) {
          
          setTimeout(() => focusBlockWithRetry(blockId, attempts + 1), 16);
        } else {        }
      };

      if (isInsideProseMirror && anchorBlockId) {
        const [firstPart, ...restParts] = parts;

        // Use Tiptap's insertContent to put the first part at cursor position.
        // This avoids touching blocks state for the anchor block → no re-mount → no cursor loss.
        const anchorEditor = editorRegistryRef.current[anchorBlockId];
        if (anchorEditor && firstPart) {
          
          anchorEditor.commands.insertContent(firstPart);
        }

        if (restParts.length === 0) {
          
          return;
        }

        // Create new blocks for the remaining parts
        const newBlocks: DocBlock[] = restParts.map(part => ({
          id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          type: 'text' as const,
          content: `<p>${part}</p>`,
        }));

        

        const insertAt = insertAfterIndex >= 0 ? insertAfterIndex + 1 : currentBlocks.length;
        let updatedBlocks = [
          ...currentBlocks.slice(0, insertAt),
          ...newBlocks,
          ...currentBlocks.slice(insertAt),
        ];

        const lastBlock = updatedBlocks[updatedBlocks.length - 1];
        const isLastBlockEmpty = !lastBlock || !lastBlock.content || lastBlock.content === '<p></p>' || lastBlock.content === '<p><br></p>';
        if (updatedBlocks.length === 0 || !isLastBlockEmpty) {
          updatedBlocks.push({
            id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            type: 'text',
            content: '',
          });
        }

        const lastNew = newBlocks[newBlocks.length - 1];
        setBlocks(updatedBlocks);
        handleSavePage(updatedBlocks);
        setSelectedBlockIds(new Set());
        setFocusedBlockId(lastNew.id);        setTimeout(() => focusBlockWithRetry(lastNew.id), 0);

      } else {
        // Outside ProseMirror: all parts become new blocks inserted after anchor
        const newBlocks: DocBlock[] = parts.map(part => ({
          id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          type: 'text' as const,
          content: `<p>${part}</p>`,
        }));

        const insertAt = insertAfterIndex >= 0 ? insertAfterIndex + 1 : currentBlocks.length;
        let updatedBlocks = [
          ...currentBlocks.slice(0, insertAt),
          ...newBlocks,
          ...currentBlocks.slice(insertAt),
        ];

        

        const lastBlock = updatedBlocks[updatedBlocks.length - 1];
        const isLastBlockEmpty = !lastBlock || !lastBlock.content || lastBlock.content === '<p></p>' || lastBlock.content === '<p><br></p>';
        if (updatedBlocks.length === 0 || !isLastBlockEmpty) {
          updatedBlocks.push({
            id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            type: 'text',
            content: '',
          });
        }

        const lastNew = newBlocks[newBlocks.length - 1];
        setBlocks(updatedBlocks);
        handleSavePage(updatedBlocks);
        setSelectedBlockIds(new Set());
        setFocusedBlockId(lastNew.id);        setTimeout(() => focusBlockWithRetry(lastNew.id), 0);
      }
    };

    // Use capture phase (true) so we intercept the paste/drop before Tiptap's internal handler does.
    document.addEventListener('paste', handleGlobalPaste as EventListener, true);
    
    // For drop events, we also need to allow the drop action by preventing default on dragover
    const handleDragOver = (e: DragEvent) => {
      // If we're dragging text (not files, not blocks), allow it
      if (e.dataTransfer?.types.includes('text/plain') && !e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
      }
    };
    
    document.addEventListener('drop', handleGlobalPaste as EventListener, true);
    document.addEventListener('dragover', handleDragOver, true);
    
    return () => {
      document.removeEventListener('paste', handleGlobalPaste as EventListener, true);
      document.removeEventListener('drop', handleGlobalPaste as EventListener, true);
      document.removeEventListener('dragover', handleDragOver, true);
    };
  }, []);

  const handleTurnInto = (blockId: string, type: DocBlock['type']) => {
    const statusMap: Record<string, DocBlock['status']> = { task: 'DAILY', subtask: 'DAILY' };
    const updated = blocksRef.current.map(b => {
      if (b.id !== blockId) return b;
      const result: DocBlock = {
        ...b,
        type,
        status: statusMap[type] ?? undefined,
        isCollapsed: type === 'collapsible' ? false : undefined,
      };
      return result;
    });
    setBlocks(updated);
    handleSavePage(updated);
  };

  const handleToggleCollapse = (blockId: string) => {
    setBlocks(prev => prev.map(b =>
      b.id === blockId ? { ...b, isCollapsed: !b.isCollapsed } : b
    ));
  };

  const handleUpdateBlockContent = (blockId: string, content: string) => {
    
    // Markdown shortcuts for rapid editing
    if (content === '<p>&gt; </p>') {
      handleTurnInto(blockId, 'collapsible');
      content = '<p></p>';
      setTimeout(() => {
        const editor = editorRegistryRef.current[blockId];
        if (editor) {
          editor.commands.setContent('<p></p>');
        }
      }, 0);
    }
    
    if (socket) {
      socket.emit('block_content_update', { docId: id, blockId, content });
    }

    setBlocks(prevBlocks => {
      let updated = prevBlocks.map((b) => {
        if (b.id !== blockId) return b;
        return {
          ...b,
          content: content,
        };
      });
      return updated;
    });
    // Don't call handleSavePage here on every keystroke! It is already handled on blur.
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    setDraggedBlockIndex(index);
    
    // Set the drag image to the whole block row for better visual feedback
    const rowEl = document.querySelector(`[data-block-id="${blocksRef.current[index]?.id}"]`);
    if (rowEl) {
      e.dataTransfer.setDragImage(rowEl as Element, 0, 0);
    }
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (draggedBlockIndex === null) return;
    e.preventDefault();
    if (draggedBlockIndex === index) {
      // Don't spam the console too much for self-hover
      return;
    }
    
    // Hide drop indicator if dragging a selection over itself
    const targetId = blocksRef.current[index]?.id;
    const draggedId = blocksRef.current[draggedBlockIndex]?.id;
    if (targetId && draggedId && selectedBlockIdsRef.current.has(targetId) && selectedBlockIdsRef.current.has(draggedId)) {
      return;
    }
    
    // Determine whether we're in the top or bottom half of the target block
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const pos = e.clientY < midY ? 'above' : 'below';
    
    if (dragOverBlockIndex !== index || dragOverPosition !== pos) {
      setDragOverBlockIndex(index);
      setDragOverPosition(pos);
    }
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    if (draggedBlockIndex === null) {
      return;
    }
    e.preventDefault();

    const currentBlocks = blocksRef.current;
    const currentSelectedBlockIds = selectedBlockIdsRef.current;
    const draggedBlock = currentBlocks[draggedBlockIndex];
    if (!draggedBlock) return;

    const isMultiSelectDrag = currentSelectedBlockIds.has(draggedBlock.id) && currentSelectedBlockIds.size > 1;

    let blocksToMove: DocBlock[];
    let remainingBlocks: DocBlock[];

    if (isMultiSelectDrag) {
      blocksToMove = currentBlocks.filter(b => currentSelectedBlockIds.has(b.id));
      remainingBlocks = currentBlocks.filter(b => !currentSelectedBlockIds.has(b.id));
    } else {
      // Gather dragged block and its children
      const draggedDepth = draggedBlock.depth || 0;
      let numChildren = 0;
      for (let i = draggedBlockIndex + 1; i < currentBlocks.length; i++) {
        const childDepth = currentBlocks[i].depth || 0;
        if (childDepth > draggedDepth) {
          numChildren++;
        } else {
          break;
        }
      }
      blocksToMove = currentBlocks.slice(draggedBlockIndex, draggedBlockIndex + 1 + numChildren);
      
      const toMoveIds = new Set(blocksToMove.map(b => b.id));
      remainingBlocks = currentBlocks.filter(b => !toMoveIds.has(b.id));
    }

    const targetBlock = currentBlocks[index];
    
    if (targetBlock && blocksToMove.find(b => b.id === targetBlock.id)) {
      handleDragEnd();
      return;
    }

    let insertAt: number;
    let targetDepth = 0;
    
    if (!targetBlock) {
      insertAt = remainingBlocks.length;
    } else {
      const targetIndexInRemaining = remainingBlocks.findIndex(b => b.id === targetBlock.id);
      targetDepth = targetBlock.depth || 0;
      
      if (targetIndexInRemaining === -1) {
        insertAt = remainingBlocks.length;
      } else if (dragOverPosition === 'above') {
        insertAt = targetIndexInRemaining;
      } else {
        insertAt = targetIndexInRemaining + 1;
        // If dropping below a collapsible, make it a child
        if (targetBlock.type === 'collapsible') {
          targetDepth += 1;
          // Also expand the target collapsible since we are dropping something into it
          const originalTargetIndex = currentBlocks.findIndex(b => b.id === targetBlock.id);
          if (originalTargetIndex !== -1 && currentBlocks[originalTargetIndex].isCollapsed) {
             const b = currentBlocks[originalTargetIndex];
             // we'll update it below when constructing newBlocks
             // but we don't have to strictly do it here if it's too complicated, let's just focus on depth
          }
        }
      }
    }
    
    // Calculate the difference in depth for the base dragged block vs the target depth
    const baseDraggedDepth = blocksToMove[0]?.depth || 0;
    const depthDiff = targetDepth - baseDraggedDepth;

    // Apply depthDiff to all blocksToMove
    const updatedBlocksToMove = blocksToMove.map(b => ({
       ...b,
       depth: Math.max(0, (b.depth || 0) + depthDiff)
    }));
    
    // If we dropped below a collapsed collapsible, we should expand it
    if (targetBlock && targetBlock.type === 'collapsible' && dragOverPosition === 'below') {
       remainingBlocks = remainingBlocks.map(b => b.id === targetBlock.id ? { ...b, isCollapsed: false } : b);
    }

    let newBlocks = [
      ...remainingBlocks.slice(0, insertAt),
      ...updatedBlocksToMove,
      ...remainingBlocks.slice(insertAt)
    ];


    const lastBlock = newBlocks[newBlocks.length - 1];
    const isLastBlockEmpty = !lastBlock || !lastBlock.content || lastBlock.content === '<p></p>' || lastBlock.content === '<p><br></p>';
    if (newBlocks.length === 0 || !isLastBlockEmpty) {
      newBlocks.push({
        id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        type: 'text',
        content: '',
      });
    }

    setBlocks(newBlocks);
    handleSavePage(newBlocks);
    setDragOverBlockIndex(null);
    setDragOverPosition(null);
    setDraggedBlockIndex(null);
    setSelectedBlockIds(new Set());
  };

  const handleDragEnd = () => {
    setDragOverBlockIndex(null);
    setDragOverPosition(null);
    setDraggedBlockIndex(null);
  };

  const handleDeleteBlock = (id: string) => {
    let finalBlocksToSave: DocBlock[] = [];
    setBlocks(prevBlocks => {
      const updated = prevBlocks.filter((b) => b.id !== id);
      finalBlocksToSave = updated;
      return updated;
    });
    delete editorRegistryRef.current[id];
    setTimeout(() => {
      if (finalBlocksToSave.length > 0) handleSavePage(finalBlocksToSave);
    }, 0);
  };

  const handleFocusBlock = (blockId: string) => {
    // Don't emit block_focus if the block is already locked by someone else.
    // The editor is read-only for them (editable=false), but the focus event
    // can still fire. We must not overwrite their lock with ours.
    const block = blocks.find(b => b.id === blockId);
    if (block?.lockedBy && block.lockedBy !== currentUser?.id) return;

    setFocusedBlockId(blockId);
    setSelectedBlockIds(prev => prev.size > 0 ? new Set() : prev);
    if (socket && currentUser) {
      socket.emit('block_focus', { docId: id, blockId, userId: currentUser.id, userName: currentUser.name });
    }
  };

  const handleBlurBlock = (blockId: string) => {
    setFocusedBlockId(null);
    if (socket && currentUser) {
      socket.emit('block_blur', { docId: id, blockId, userId: currentUser.id });
    }
    handleSavePage();
  };

  const handleOpenTaskModal = async (taskId: string) => {
    const { tasksIndex } = useAppStore.getState();
    if (tasksIndex[taskId]) {
      setSelectedTaskForModal(tasksIndex[taskId]);
      setIsTaskModalOpen(true);
    } else {
      try {
        const res = await tasksApi.getTask(taskId);
        if (res.task) {
          setSelectedTaskForModal(res.task);
          setIsTaskModalOpen(true);
        }
      } catch (err) {
        console.error('Failed to load task details:', err);
      }
    }
  };

  const handleLinkTaskToDoc = (task: Task) => {
    const taskUrl = `/tasks/${task.id}`;
    const newItemText = `${task.title} ${taskUrl}`;
    const newBlock: DocBlock = {
      id: `blk-${Date.now()}`,
      type: 'task',
      content: newItemText,
      status: 'DAILY',
    };

    const updated = [...blocks, newBlock];
    setBlocks(updated);
    handleSavePage(updated);
    setIsLinkModalOpen(false);
  };

  // ── Export: this page (live editor state) or the entire doc (fresh from the server)
  const handleExport = async (scope: ExportScope, format: ExportFormat) => {
    const currentPageId = activePageRef.current?.id;
    // Mounted editors hold the freshest HTML (including unsaved keystrokes / Tiptap JSON blocks)
    const liveHtml = (blockId: string): string | undefined => editorRegistryRef.current[blockId]?.getHTML?.();

    let exportTitle = pageTitleRef.current || 'Untitled Page';
    let pages: ExportPage[] = [{ title: exportTitle, blocks: blocksRef.current }];

    if (scope === 'doc') {
      const res = await spacesApi.getDoc(id as string);
      const freshDoc = res.doc;
      exportTitle = freshDoc?.title || doc?.title || 'Document';
      // Same ordering as the sidebar
      type ApiPage = { id: string; title?: string; content?: string; order?: number; subpages?: ApiPage[] };
      const sortPages = (list: ApiPage[]) => [...(list || [])].sort((a, b) => {
        if (freshDoc?.isDailyRollover) {
          const timeA = new Date(a.title || '').getTime();
          const timeB = new Date(b.title || '').getTime();
          if (!isNaN(timeA) && !isNaN(timeB)) return timeB - timeA;
        }
        return (a.order || 0) - (b.order || 0);
      });
      pages = [];
      const collect = (list: ApiPage[]) => {
        for (const p of sortPages(list)) {
          pages.push(p.id === currentPageId
            ? { title: pageTitleRef.current || p.title || 'Untitled Page', blocks: blocksRef.current }
            : { title: p.title || 'Untitled Page', blocks: markdownToBlocks(p.content || '') });
          if (p.subpages?.length) collect(p.subpages);
        }
      };
      collect(freshDoc?.pages || []);
    }

    const fileBase = safeFileName(exportTitle);
    if (format === 'markdown') {
      downloadFile(`${fileBase}.md`, pagesToMarkdown(pages, liveHtml), 'text/markdown');
      return;
    }
    const html = pagesToHtmlDocument(exportTitle, pages, liveHtml);
    if (format === 'html') {
      downloadFile(`${fileBase}.html`, html, 'text/html');
    } else {
      // PDF and Print both use the browser print dialog; its "Save as PDF" names the file after <title>
      printHtmlDocument(html);
    }
  };

  // ── Import: every file (or H1 section, for page splitting) becomes a new top-level page
  const handleImport = async (kind: ImportKind, files: File[]): Promise<string> => {
    const created: Awaited<ReturnType<typeof spacesApi.createPage>>['page'][] = [];
    const failures: string[] = [];
    for (const file of files) {
      try {
        const importedPages = await fileToPages(file, kind);
        for (const imported of importedPages) {
          const newBlocks: DocBlock[] = imported.blockHtml.map(html => ({
            id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            type: 'text',
            content: html,
          }));
          newBlocks.push({ id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`, type: 'text', content: '' });
          const res = await spacesApi.createPage({
            title: imported.title,
            content: blocksToMarkdown(newBlocks),
            docId: id as string,
          });
          created.push(res.page);
        }
      } catch (err) {
        failures.push(err instanceof Error ? err.message : `${file.name}: import failed`);
      }
    }

    if (created.length > 0) {
      await fetchDoc();
      handleSelectPage(created[0]);
    }
    if (created.length === 0) throw new Error(failures.join(' · ') || 'Nothing to import');
    const summary = `Imported ${created.length} page${created.length === 1 ? '' : 's'}`;
    return failures.length ? `${summary} · Skipped: ${failures.join(' · ')}` : summary;
  };

  const filteredTasks = tasks.filter((t) =>
    t.title.toLowerCase().includes(taskSearchQuery.toLowerCase())
  );

  const totalPages = doc?.pages?.reduce(
    (acc: number, p: any) => acc + 1 + (p.subpages?.length ?? 0),
    0
  ) ?? 0;

  if (loading) return <DocSkeleton />;
  if (error) return <div className="flex items-center justify-center h-full text-red-400 text-sm">{error}</div>;

  return (
    <div className="relative flex h-full w-full bg-background text-foreground overflow-hidden font-sans">
      {/* Collapsed pages panel: a slim rail to bring it back */}
      {isPagesPanelCollapsed && (
        <aside className={`w-12 shrink-0 bg-card border-r border-zinc-800/60 py-3 flex flex-col items-center gap-2 h-full select-none ${activePage && pageStyles.focusPage ? 'hidden' : ''}`}>
          <button
            onClick={togglePagesPanel}
            title="Expand pages"
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
          <div className="w-6 border-t border-zinc-800/60" />
          <button
            onClick={() => { pageLoadSeqRef.current++; setPageContentState('ready'); resetUndoForPageSwitch(); setActivePage(null); }}
            title={doc?.title || 'Document'}
            className="p-1 rounded-md hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <FileText className="w-4 h-4 text-purple-400" />
          </button>
        </aside>
      )}

      {/* Hidden (not unmounted) when collapsed or in page focus mode so the tree keeps its expand state */}
      <aside className={`w-60 shrink-0 bg-card border-r border-zinc-800/60 p-4 flex flex-col h-full overflow-y-auto custom-scrollbar select-none ${(activePage && pageStyles.focusPage) || isPagesPanelCollapsed ? 'hidden' : ''}`}>
        <div
          onClick={() => { pageLoadSeqRef.current++; setPageContentState('ready'); resetUndoForPageSwitch(); setActivePage(null); }}
          className="mb-5 pb-3 border-b border-zinc-800/60 cursor-pointer group hover:opacity-90 transition-all"
        >
          <div className="flex items-center gap-2 text-zinc-400 mb-1">
            <FileText className="w-4 h-4 text-purple-400 shrink-0" />
            <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 group-hover:text-purple-400 transition-colors truncate">Document</span>
            <button
              onClick={(e) => { e.stopPropagation(); togglePagesPanel(); }}
              title="Collapse pages"
              className="ml-auto -my-1 p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
          </div>
          <h2 className="text-base font-bold text-zinc-100 group-hover:text-white transition-colors truncate">{doc?.title || 'Priorities for Today'}</h2>
        </div>

        <div className="flex items-center justify-between mb-2 px-1 group/pages-header">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Pages</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-600 font-mono group-hover/pages-header:hidden">{totalPages}</span>
            <div className="hidden group-hover/pages-header:flex items-center justify-center transition-colors">
              <ActionMenu icon={<Plus className="size-4 cursor-pointer rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 p-0.5" />}>
                <button onClick={(e) => { e.stopPropagation(); handleCreatePage(); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer"><Folder className="size-3.5 text-amber-400" />Folder</button>
                <button onClick={(e) => { e.stopPropagation(); handleCreatePage(); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer"><FileText className="size-3.5 text-purple-400" />Page</button>
              </ActionMenu>
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-1">
          {doc?.pages?.length === 0 ? (
            <p className="text-xs text-zinc-600 italic px-1 py-2">No pages created yet.</p>
          ) : (
            [...(doc?.pages || [])].sort((a: any, b: any) => {
              if (doc?.isDailyRollover) {
                const timeA = new Date(a.title || '').getTime();
                const timeB = new Date(b.title || '').getTime();
                if (!isNaN(timeA) && !isNaN(timeB)) return timeB - timeA;
              }
              return (a.order || 0) - (b.order || 0);
            }).map((page: any) => (
              <SidebarPageItem
                key={page.id}
                page={page}
                activePageId={activePage?.id}
                onSelect={handleSelectPage}
                onAddSubpage={(pId) => handleCreatePage(pId)}
                onRename={handleRenamePageClick}
                onDelete={handleDeletePage}
                isJournal={doc?.isDailyRollover}
              />
            ))
          )}

          <button
            onClick={() => handleCreatePage()}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-zinc-400 hover:text-white rounded hover:bg-zinc-800/60 mt-3 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-zinc-500" />
            <span>Add page</span>
          </button>
        </div>
      </aside>

      <main ref={mainScrollRef as any} className="flex-1 overflow-y-auto custom-scrollbar bg-background">
        <style>{`
          .is-selected-block .tiptap p,
          .is-selected-block .tiptap h1,
          .is-selected-block .tiptap h2,
          .is-selected-block .tiptap h3,
          .is-selected-block .tiptap li {
            background-color: #3b82f6 !important;
            color: white !important;
            border-radius: 2px;
            width: fit-content;
          }
          .is-selected-block .tiptap [style*="text-align: center"] {
            margin-left: auto;
            margin-right: auto;
          }
          .is-selected-block .tiptap [style*="text-align: right"] {
            margin-left: auto;
          }
          .is-selected-block .tiptap .is-editor-empty {
            min-width: 8px;
            min-height: 1em;
            display: inline-block;
          }
          .is-selected-block .tiptap * {
            color: white !important;
          }
        `}</style>
        {activePage ? (
          <div className="flex items-start">
          {/* Read-only version preview (Google Docs-style). The live editor below stays mounted but hidden. */}
          {selectedVersionEntry && (
            <div className={`flex-1 min-w-0 ${pageStyles.fullWidth ? 'max-w-none' : 'max-w-4xl'} mx-auto px-10 py-6`}>
              <VersionPreview
                entry={selectedVersionEntry}
                diffs={selectedVersionDiffs}
                isCurrent={selectedVersionEntry.version.id === versionEntries[0]?.version.id}
                typographyClass={`${FONT_STYLE_CLASS[pageStyles.fontStyle]} ${FONT_SIZE_CLASS[pageStyles.fontSize]}`}
                onRestore={() => setRestoreTarget(selectedVersionEntry.version)}
                onExit={() => setRightPanel(null)}
              />
            </div>
          )}
          <div className={`flex-1 min-w-0 ${pageStyles.fullWidth ? 'max-w-none' : 'max-w-4xl'} mx-auto px-10 py-6 space-y-6 ${selectedVersionEntry ? 'hidden' : ''}`}>

            <div className="space-y-2">
              {pageStyles.showTitle && (
                <input
                  type="text"
                  value={pageTitle}
                  onChange={(e) => setPageTitle(e.target.value)}
                  onBlur={() => handleSavePage()}
                  placeholder="Page Title..."
                  className="w-full bg-transparent border-none text-4xl font-extrabold text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-700 focus:outline-none tracking-tight"
                />
              )}

              <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 flex-wrap">
                {(() => {
                  const metaItems: React.ReactNode[] = [];
                  if (pageStyles.showOwners) {
                    metaItems.push(
                      <span key="owner" className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center font-bold text-[10px] shadow-sm">
                          {pageOwner?.name ? pageOwner.name[0] : 'H'}
                        </span>
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">{pageOwner?.name || 'Hannah'}</span>
                      </span>
                    );
                  }
                  if (pageStyles.showContributors && pageContributors.length > 0) {
                    metaItems.push(
                      <span key="contributors" className="flex items-center gap-1.5" title={pageContributors.map((u) => u.name).join(', ')}>
                        <span className="flex -space-x-1.5">
                          {pageContributors.slice(0, 4).map((u) => (
                            <span key={u.id} className="w-5 h-5 rounded-full overflow-hidden ring-2 ring-background bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-[9px]">
                              {u.avatarUrl
                                ? <img src={u.avatarUrl} alt={u.name} className="w-full h-full rounded-full object-cover" />
                                : (u.name?.charAt(0).toUpperCase() || '?')}
                            </span>
                          ))}
                        </span>
                        <span>
                          {pageContributors.length} contributor{pageContributors.length === 1 ? '' : 's'}
                        </span>
                      </span>
                    );
                  }
                  if (pageStyles.showLastModified) {
                    metaItems.push(
                      <span key="modified" className="text-zinc-500 dark:text-zinc-400">Last updated {formatLastModified(lastModifiedAt)}</span>
                    );
                  }
                  if (pageStyles.showStats && pageStats) {
                    metaItems.push(
                      <span key="stats" className="text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {pageStats.words.toLocaleString()} words · {pageStats.readingTime} read
                      </span>
                    );
                  }
                  return metaItems.flatMap((item, i) => i === 0 ? [item] : [
                    <span key={`sep-${i}`} className="text-zinc-400 dark:text-zinc-600">•</span>,
                    item,
                  ]);
                })()}
                <button
                  onClick={() => { if (rightPanel !== 'history') toggleRightPanel('history'); }}
                  className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 underline underline-offset-2 transition-colors ml-1"
                >
                  Version History
                </button>

                {savingPage && <span className="text-purple-500 dark:text-purple-400 text-[10px] italic ml-2">Saving...</span>}
              </div>
            </div>

            {/* ── Subpages List ── */}
            {activePage.subpages && activePage.subpages.length > 0 && pageStyles.subpagesView !== 'hidden' && (() => {
              const sortedContentSubpages = [...activePage.subpages].sort((a: any, b: any) => {
                if (doc?.isDailyRollover) {
                  const timeA = new Date(a.title || '').getTime();
                  const timeB = new Date(b.title || '').getTime();
                  if (!isNaN(timeA) && !isNaN(timeB)) return timeB - timeA;
                }
                return (a.order || 0) - (b.order || 0);
              });

              return (
                <div className="pt-4 pb-2">
                  <div className="flex items-center justify-between text-xs text-zinc-500 font-semibold border-b border-zinc-800 pb-2 mb-2 px-2">
                    <span>Subpages</span>
                  </div>
                  {pageStyles.subpagesView === 'table' ? (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-zinc-500">
                          <th className="font-medium py-1.5 px-2">Name</th>
                          <th className="font-medium py-1.5 px-2 w-24">Subpages</th>
                          <th className="font-medium py-1.5 px-2 w-36">Last updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedContentSubpages.slice(0, subpageLimit).map((sub: any) => (
                          <tr
                            key={sub.id}
                            onClick={() => handleSelectPage(sub)}
                            className="border-t border-zinc-800/60 hover:bg-zinc-800/40 cursor-pointer transition-colors group"
                          >
                            <td className="py-2 px-2">
                              <span className="flex items-center gap-2 text-sm text-zinc-200 font-medium group-hover:text-white">
                                <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                                <span className="truncate">{sub.title || 'Untitled Page'}</span>
                              </span>
                            </td>
                            <td className="py-2 px-2 text-zinc-400 tabular-nums">{sub.subpages?.length ?? 0}</td>
                            <td className="py-2 px-2 text-zinc-400">{sub.updatedAt ? formatLastModified(sub.updatedAt) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                  <div className="space-y-1">
                    {sortedContentSubpages.slice(0, subpageLimit).map((sub: any) => (
                      <div
                        key={sub.id}
                        onClick={() => handleSelectPage(sub)}
                        className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-zinc-800/40 cursor-pointer group transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-1 rounded bg-zinc-800/80 group-hover:bg-zinc-700 transition-colors">
                            <FileText className="w-3.5 h-3.5 text-zinc-400" />
                          </div>
                          <span className="text-sm text-zinc-200 font-medium group-hover:text-white transition-colors">{sub.title || 'Untitled Page'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  )}
                  {activePage.subpages.length > subpageLimit && (
                    <div className="flex justify-center mt-3">
                      <button
                        onClick={() => setSubpageLimit(prev => prev + 10)}
                        className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-bold text-zinc-400 hover:text-zinc-100 bg-secondary/50 hover:bg-zinc-800 border border-zinc-800/60 hover:border-zinc-700 rounded-full transition-all cursor-pointer shadow-sm"
                      >
                        <span>See More</span>
                        <span className="text-[10px] font-mono bg-zinc-800/80 px-1.5 py-0.5 rounded-md">
                          {activePage.subpages.length - subpageLimit} left
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className={`space-y-1.5 pt-2 ${FONT_STYLE_CLASS[pageStyles.fontStyle]} ${FONT_SIZE_CLASS[pageStyles.fontSize]} ${
              // Block focus mode: dim every row except the one holding the caret
              pageStyles.focusBlock && focusedBlockId
                ? '[&>[data-block-id]]:transition-opacity [&>[data-block-id]:not(:focus-within)]:opacity-30'
                : ''
            }`}>
              {(() => {
                if (pageContentState === 'loading') {
                  return (
                    <div className="space-y-3 px-2 py-1 animate-pulse" aria-busy="true" aria-label="Loading page">
                      {[40, 72, 64, 80, 56, 68, 48, 76].map((width, i) => (
                        <div key={i} className="h-4 rounded bg-zinc-800/60" style={{ width: `${width}%` }} />
                      ))}
                    </div>
                  );
                }
                if (pageContentState === 'error') {
                  return (
                    <div className="px-2 py-6 text-sm text-zinc-400 flex items-center gap-3">
                      <span>This page couldn&apos;t be loaded.</span>
                      <button
                        type="button"
                        onClick={() => activePageRef.current && openPage({ ...activePageRef.current, content: undefined })}
                        className="px-3 py-1 rounded-md border border-zinc-700 hover:bg-zinc-800 text-zinc-200"
                      >
                        Retry
                      </button>
                    </div>
                  );
                }
                if (blocks.length === 0) {
                  return (
                    <div
                      onClick={() => handleAddBlock('text')}
                      className="py-1 px-2 cursor-text"
                    >
                      <input
                        type="text"
                        autoFocus
                        placeholder="Start typing..."
                        onFocus={() => handleAddBlock('text')}
                        className="w-full bg-transparent border-none text-white text-sm font-semibold focus:outline-none placeholder-zinc-700"
                      />
                    </div>
                  );
                }

                // Compute hidden blocks based on depth and isCollapsed
                const hiddenBlockIds = new Set<string>();
                let currentCollapsedDepth: number | null = null;
                for (let i = 0; i < blocks.length; i++) {
                  const block = blocks[i];
                  const depth = block.depth || 0;
                  
                  if (currentCollapsedDepth !== null) {
                    if (depth > currentCollapsedDepth) {
                      hiddenBlockIds.add(block.id);
                      continue;
                    } else {
                      currentCollapsedDepth = null;
                    }
                  }
                  
                  if (block.type === 'collapsible' && block.isCollapsed) {
                    currentCollapsedDepth = depth;
                  }
                }

                return blocks.map((block, index) => {
                  if (hiddenBlockIds.has(block.id)) return null;
                  
                  const isLockedBySomeoneElse = block.lockedBy && block.lockedBy !== currentUser?.id;
                  const isSelected = selectedBlockIds.has(block.id);
                  const isFirstSelected = isSelected && Array.from(selectedBlockIds)[0] === block.id;

                  return (
                      <DocBlockRow
                        key={block.id}
                        block={block}
                        index={index}
                        isLast={index === blocks.length - 1}
                        isLockedBySomeoneElse={isLockedBySomeoneElse}
                        isSelected={isSelected}
                        isFirstSelected={isFirstSelected}
                        dragOverBlockIndex={dragOverBlockIndex}
                        dragOverPosition={dragOverPosition}
                        draggedBlockIndex={draggedBlockIndex}
                        focusedBlockId={focusedBlockId}
                        handleAddBlock={handleAddBlock}
                        handleDragStart={handleDragStart}
                        handleDragEnd={handleDragEnd}
                        setSelectedBlockIds={setSelectedBlockIds}
                        selectedBlockIds={selectedBlockIds}
                        handleUpdateBlockContent={handleUpdateBlockContent}
                        handleBlurBlock={handleBlurBlock}
                        handleKeyDown={handleKeyDown}
                        handleIndentBlock={handleIndentBlock}
                        handleOutdentBlock={handleOutdentBlock}
                        handleSplitBlock={handleSplitBlock}
                        handleFocusBlock={handleFocusBlock}
                        editorRegistryRef={editorRegistryRef}
                        handleDeleteBlock={handleDeleteBlock}
                        handleTurnInto={handleTurnInto}
                        handleToggleCollapse={handleToggleCollapse}
                        onDragOverWrapper={(e: any) => handleDragOver(e, index)}
                        onDropWrapper={(e: any) => handleDrop(e, index)}
                        onMouseDownCaptureWrapper={(e: any) => {
                          const target = e.target as Element;
                          const isInteractive = target.closest('.ProseMirror') || target.closest('button') || target.closest('[draggable="true"]') || target.closest('[role="dialog"]') || target.closest('[data-radix-popper-content-wrapper]');
                          if (!isInteractive) {
                            // Prevent native browser caret placement which causes left-flashing
                            e.preventDefault();
                            // Immediately and synchronously force focus to the end
                            const editor = editorRegistryRef.current[block.id];
                            if (editor) {
                              editor.commands.focus('end');
                            }
                          }
                          // Allow triggering block selection mode from anywhere (including text)
                          if (!e.shiftKey) {
                            dragSelectionStartBlockIndexRef.current = index;
                          } else {
                            dragSelectionStartBlockIndexRef.current = null;
                          }
                        }}
                        onMouseMoveWrapper={(e: any) => {
                          const start = dragSelectionStartBlockIndexRef.current;
                          if (!isMouseDownRef.current || e.buttons !== 1 || start === null) return;

                          if (start !== index) {
                            // Dead zone: the pointer must be clearly inside this block, not just grazing
                            // its edge — otherwise a text highlight that overshoots its line by a few
                            // pixels would be wiped out and turned into a block selection.
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const DEAD_ZONE_PX = 8;
                            const notFarEnough = index > start
                              ? e.clientY < rect.top + DEAD_ZONE_PX
                              : e.clientY > rect.bottom - DEAD_ZONE_PX;
                            if (notFarEnough) return;
                          } else if (dragSelectRangeKeyRef.current === null) {
                            // Still highlighting text inside the origin block — leave it alone
                            return;
                          }

                          const min = Math.min(start, index);
                          const max = Math.max(start, index);
                          const rangeKey = `${min}-${max}`;
                          if (dragSelectRangeKeyRef.current === rangeKey) return;
                          dragSelectRangeKeyRef.current = rangeKey;

                          const newSel = new Set<string>();
                          const currentBlocks = blocksRef.current;
                          for (let i = min; i <= max; i++) {
                            if (currentBlocks[i]) newSel.add(currentBlocks[i].id);
                          }
                          setSelectedBlockIds(newSel);

                          if (document.activeElement instanceof HTMLElement) {
                            document.activeElement.blur();
                          }
                          window.getSelection()?.removeAllRanges();
                        }}
                        onClickWrapper={(e: any) => {
                          const isProseMirror = (e.target as Element).closest('.ProseMirror');
                          if (!isProseMirror) {
                            if (e.shiftKey) {
                              setSelectedBlockIds(prev => {
                                const newSel = new Set(prev);
                                newSel.has(block.id) ? newSel.delete(block.id) : newSel.add(block.id);
                                return newSel;
                              });
                            } else {
                              setSelectedBlockIds(new Set());
                              handleFocusBlock(block.id);
                              // Focus is now handled synchronously in onMouseDownCaptureWrapper
                            }
                          }
                        }}
                      />
                  );
                });
              })()}
            </div>

            {/* Clickable area at the bottom to append a new block (Innate Line) */}
            <div
              className={`min-h-[50vh] w-full cursor-text ${dragOverBlockIndex === blocks.length ? 'border-t-2 border-[#6b4cff] bg-blue-500/5' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggedBlockIndex !== null) setDragOverBlockIndex(blocks.length);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedBlockIndex !== null) handleDrop(e, blocks.length);
              }}
              onClick={() => {
                if (blocks.length === 0) {
                  handleAddBlock('text');
                } else {
                  const lastBlock = blocks[blocks.length - 1];
                  const isEmpty = !lastBlock.content || lastBlock.content === '' || lastBlock.content === '<p></p>' || lastBlock.content === '<p><br></p>';
                  if (!isEmpty) {
                    handleAddBlock('text');
                  } else {
                    handleFocusBlock(lastBlock.id);
                    setTimeout(() => {
                      const editor = editorRegistryRef.current[lastBlock.id];
                      if (editor) editor.commands.focus('end');
                    }, 10);
                  }
                }
              }}
            />
          </div>

          {/* ── Page outline (headings in this page) ── */}
          {pageStyles.showOutline && !selectedVersionEntry && (
            <nav className="hidden lg:block w-52 shrink-0 sticky top-0 self-start max-h-screen overflow-y-auto custom-scrollbar py-6 pr-4 select-none">
              <div className="text-[11px] font-medium text-zinc-500 mb-2 px-2">On this page</div>
              {pageOutline.length === 0 ? (
                <p className="text-[11px] text-zinc-600 italic px-2">Add headings to build an outline.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {pageOutline.map((item, i) => (
                    <button
                      key={`${item.blockId}-${i}`}
                      onClick={() => {
                        document.querySelector(`[data-block-id="${item.blockId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className={`text-left text-xs truncate rounded-md py-1 pr-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 transition-colors cursor-pointer ${
                        item.level === 1 ? 'pl-2' : item.level === 2 ? 'pl-5' : 'pl-8'
                      }`}
                      title={item.text}
                    >
                      {item.text}
                    </button>
                  ))}
                </div>
              )}
            </nav>
          )}

          {/* ── Floating tool rail (stays in view while the page scrolls) ── */}
          <div className="sticky top-6 self-start shrink-0 flex flex-col items-center gap-1 mt-6 mr-3 select-none">
            <button
              onClick={() => toggleRightPanel('styles')}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${rightPanel === 'styles' ? 'text-zinc-200 bg-zinc-800' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
              title="Page styles"
            >
              <CaseSensitive className="w-4 h-4" />
            </button>
            <button
              onClick={() => toggleRightPanel('transfer')}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${rightPanel === 'transfer' ? 'text-zinc-200 bg-zinc-800' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
              title="Export & import"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={() => toggleRightPanel('history')}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${rightPanel === 'history' ? 'text-zinc-200 bg-zinc-800' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
              title="Version history"
            >
              <History className="w-4 h-4" />
            </button>
          </div>
          </div>
        ) : (
          /* Document Overview State */
          <div className="max-w-4xl mx-auto p-10 space-y-6">
            <div className="p-12 rounded-2xl bg-card border border-zinc-800/80 text-center space-y-3">
              <FileText className="w-12 h-12 text-purple-400 mx-auto opacity-50" />
              <h2 className="text-xl font-bold text-zinc-100">{doc?.title}</h2>
              <p className="text-xs text-zinc-500">Select a page from the left sub-sidebar to open your clean board.</p>
              <button
                onClick={() => handleCreatePage()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md transition-colors mx-auto mt-2"
              >
                <Plus className="w-4 h-4" />
                <span>Create Page</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {rightPanel === 'styles' && activePage && pageStats && (
        <PageStylesPanel
          styles={pageStyles}
          onChange={updatePageStyles}
          onApplyTypographyToAll={applyTypographyToAll}
          stats={pageStats}
          onClose={() => setRightPanel(null)}
        />
      )}
      {rightPanel === 'history' && activePage && (
        <VersionHistoryPanel
          entries={versionEntries}
          selectedId={selectedVersionEntry?.version.id ?? null}
          loading={versionsLoading}
          onSelect={setSelectedVersionId}
          onClose={() => setRightPanel(null)}
        />
      )}
      <ConfirmActionModal
        isOpen={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        title="Restore this version?"
        message={restoreTarget && (
          <>
            The page will go back to the version from{' '}
            <strong className="text-zinc-100">{formatVersionTime(restoreTarget.createdAt)}</strong>
            {restoreTarget.user?.name ? <> edited by <strong className="text-zinc-100">{restoreTarget.user.name}</strong></> : null}.
            {' '}The current content is kept in version history, so you can switch back later.
          </>
        )}
        confirmText="Restore"
        onConfirm={async () => {
          if (!restoreTarget) return;
          const newBlocks = markdownToBlocks(restoreTarget.content);
          blocksRef.current = newBlocks;
          setBlocks(newBlocks);
          await handleSavePage(newBlocks);
          setRightPanel(null);
          refreshVersions();
        }}
      />
      {rightPanel === 'transfer' && activePage && (
        <DocTransferPanel
          onClose={() => setRightPanel(null)}
          onExport={handleExport}
          onImport={handleImport}
        />
      )}

      {/* ── Link Task Picker Modal ── */}
      {isLinkModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-zinc-800 rounded-xl w-full max-w-md shadow-2xl p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <LinkIcon className="w-4 h-4 text-purple-400" />
                <span>Link a Task to Document</span>
              </div>
              <button
                onClick={() => setIsLinkModalOpen(false)}
                className="text-zinc-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={taskSearchQuery}
                onChange={(e) => setTaskSearchQuery(e.target.value)}
                placeholder="Search tasks..."
                className="w-full bg-secondary border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1 custom-scrollbar">
              {filteredTasks.length === 0 ? (
                <p className="text-xs text-zinc-500 italic p-3 text-center">No tasks found.</p>
              ) : (
                filteredTasks.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => handleLinkTaskToDoc(task)}
                    className="flex items-center justify-between p-2.5 rounded-lg hover:bg-zinc-800/80 cursor-pointer transition-colors group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckSquare className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      <span className="text-xs text-zinc-200 font-medium truncate group-hover:text-white">
                        {task.title}
                      </span>
                    </div>
                    <span
                      className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded uppercase shrink-0 ${getTaskStatusBadgeColor(
                        task.status
                      )}`}
                    >
                      {task.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Task Detail Modal Trigger ── */}
      <TaskDetailModal
        isOpen={isTaskModalOpen}
        onClose={() => {
          setIsTaskModalOpen(false);
          setSelectedTaskForModal(null);
          if (typeof window !== 'undefined') {
            const url = new URL(window.location.href);
            url.searchParams.delete('task');
            url.searchParams.delete('subtask');
            window.history.replaceState(null, '', url.toString());
          }
        }}
        task={selectedTaskForModal || null}
        mode={doc?.isDailyRollover ? "full" : "modal"}
        onUpdateTask={(updatedTask: any) => {
          setSelectedTaskForModal(updatedTask);
          updateTask(updatedTask);
        }}
        workspaceRoles={workspaceRoles}
      />

      {/* Global Task Hover Card */}
      {hoverCardPos && hoverCardData && (
        <div
          id="global-task-hover-card"
          className="fixed z-99999"
          style={{ left: Math.min(hoverCardPos.x, window.innerWidth - 330), top: Math.min(hoverCardPos.y, window.innerHeight - 250) }}
        >
          <div className="w-[320px] bg-card border border-border rounded-lg shadow-xl overflow-hidden flex flex-col text-sm text-foreground">
            <div className="p-3 border-b border-zinc-200 dark:border-zinc-700">
              <h3 className="font-semibold text-base truncate">{hoverCardData.label}</h3>
              <div className="flex items-center text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                <Circle className="w-3 h-3 mr-1" />
                <span>Task Mention</span>
              </div>
            </div>

            <div className="flex flex-col p-2 max-h-75 overflow-y-auto custom-scrollbar">
              {hoverCardData.mentionType === 'status' ? (
                (() => {
                  try {
                    const tasks = hoverCardData.tasks ? JSON.parse(hoverCardData.tasks) : [];
                    return (
                      <div className="flex flex-col gap-1.5">
                        {tasks.length === 0 ? (
                          <div className="text-zinc-500 italic p-2 text-center text-xs">No tasks in this column</div>
                        ) : (
                          tasks.map((task: any) => (
                            <div key={task.id} className="flex flex-col bg-zinc-50 dark:bg-zinc-800/60 p-2 rounded border border-zinc-100 dark:border-zinc-800">
                              <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">{task.title}</span>
                              <div className="flex items-center justify-between mt-1.5">
                                <div className="flex items-center gap-1">
                                  {task.assignees?.slice(0, 3).map((user: any) => (
                                    <div key={user.id} className="w-4 h-4 rounded-full overflow-hidden shrink-0 border border-zinc-200 dark:border-zinc-700 bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center">
                                      {user.avatarUrl ? (
                                        <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
                                      ) : (
                                        <span className="text-[7px] font-medium text-zinc-700 dark:text-zinc-300">
                                          {user.name?.charAt(0).toUpperCase()}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                                <span className="text-[9px] text-zinc-500 dark:text-zinc-400">
                                  {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : ''}
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                        <div className="mt-2">
                          <input
                            type="text"
                            placeholder={`Add task to ${hoverCardData.label}...`}
                            className="w-full text-xs px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-blue-500"
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                const title = e.currentTarget.value.trim();
                                e.currentTarget.value = 'Adding...';
                                e.currentTarget.disabled = true;
                                try {
                                  await tasksApi.createTask({
                                    title,
                                    status: hoverCardData.label,
                                    priority: 'MEDIUM'
                                  });
                                  // Note: To see the new task, the user can re-open the hover card or refresh.
                                  // A full state sync would be better, but this handles the automated input!
                                  setHoverCardPos(null);
                                } catch (err) {
                                  console.error('Failed to create task', err);
                                  e.currentTarget.value = title;
                                  e.currentTarget.disabled = false;
                                }
                              }
                            }}
                          />
                        </div>
                      </div>
                    );
                  } catch (e) {
                    return <div className="text-red-500 text-xs p-2">Failed to load tasks</div>;
                  }
                })()
              ) : (
                // Task Mention UI
                <div className="flex flex-col">
                  <div className="flex border-b border-zinc-200 dark:border-zinc-700">
                    <div className="w-1/3 p-2 px-3 text-zinc-500 dark:text-zinc-400 flex items-center border-r border-zinc-200 dark:border-zinc-700">Status</div>
                    <div className="w-2/3 p-2 px-3 flex items-center">
                      <span className="px-2 py-0.5 rounded text-xs font-semibold uppercase truncate max-w-full bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200">
                        {hoverCardData.taskStatus || 'Pending'}
                      </span>
                    </div>
                  </div>
                  <div className="flex border-b border-zinc-200 dark:border-zinc-700">
                    <div className="w-1/3 p-2 px-3 text-zinc-500 dark:text-zinc-400 flex items-center border-r border-zinc-200 dark:border-zinc-700">Assignees</div>
                    <div className="w-2/3 p-2 px-3 flex items-center gap-1 overflow-x-auto">
                      {(() => {
                        try {
                          const assignees = hoverCardData.taskAssignees ? JSON.parse(hoverCardData.taskAssignees) : [];
                          if (assignees.length > 0) {
                            return assignees.map((user: any) => (
                              <div key={user.id} className="w-5 h-5 rounded-full overflow-hidden shrink-0 border border-zinc-300 dark:border-zinc-600 bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center">
                                {user.avatarUrl ? (
                                  <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
                                ) : (
                                  <span className="text-[9px] font-medium text-zinc-700 dark:text-zinc-300">
                                    {user.name?.charAt(0).toUpperCase()}
                                  </span>
                                )}
                              </div>
                            ));
                          }
                        } catch (e) { }
                        return <span className="text-zinc-500 italic">Unassigned</span>;
                      })()}
                    </div>
                  </div>
                  <div className="flex border-b border-zinc-200 dark:border-zinc-700">
                    <div className="w-1/3 p-2 px-3 text-zinc-500 dark:text-zinc-400 flex items-center border-r border-zinc-200 dark:border-zinc-700">Due Date</div>
                    <div className="w-2/3 p-2 px-3 flex items-center">
                      {hoverCardData.taskDueDate ? new Date(hoverCardData.taskDueDate).toLocaleDateString() : <span className="text-zinc-500 italic">Not set</span>}
                    </div>
                  </div>
                  <div className="flex">
                    <div className="w-1/3 p-2 px-3 text-zinc-500 dark:text-zinc-400 flex items-center border-r border-zinc-200 dark:border-zinc-700">Priority</div>
                    <div className="w-2/3 p-2 px-3 flex items-center gap-1.5">
                      <span>{hoverCardData.taskPriority || 'None'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <RenameModal
        isOpen={isRenameOpen}
        onClose={() => setIsRenameOpen(false)}
        onConfirm={handleConfirmRename}
        title="Rename Page"
        initialName={pageToRename?.title || ''}
      />
    </div>
  );
}
