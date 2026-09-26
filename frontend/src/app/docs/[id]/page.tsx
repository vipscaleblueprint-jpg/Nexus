'use client';

import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { authApi, spacesApi } from '@/api';
import { FormattedRichText, markdownToBlocks, blocksToMarkdown } from './utils';
import { BlockEditor } from '@/components/ui/BlockEditor';
import { tasksApi } from '@/api/tasks';
import { useAppStore } from '@/lib/store';
import { Task } from '@/lib/types';
import { TaskDetailModal } from '@/components/modals/TaskDetailModal';
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
  History
} from 'lucide-react';
import { DocSkeleton } from '@/components/ui/Skeleton';

export interface Assignee {
  type: 'letter' | 'more';
  value: string;
}

export interface DocBlock {
  id: string;
  type: 'heading' | 'task' | 'text' | 'callout' | 'tags';
  content: string;
  status?: 'CLOSED' | 'WAITING' | 'DAILY' | 'IN_PROGRESS';
  stars?: number;
  assignees?: Assignee[];
  lockedBy?: string | null;
  lockedByName?: string;
}

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
  const [expanded, setExpanded] = useState(true);
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

  return (
    <div className="select-none">
      <div
        onClick={() => onSelect(page)}
        className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors group ${isActive
          ? 'bg-[#27272a] text-white shadow-sm font-semibold'
          : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-white'
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
            {sortedSubpages.map((sub: any) => (
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const getTaskStatusBadgeColor = (status?: string) => {
  switch (status) {
    case 'CLOSED':
      return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    case 'WAITING':
      return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
    case 'DAILY':
      return 'bg-purple-500/20 text-purple-400 border border-purple-500/30';
    case 'IN_PROGRESS':
      return 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
    default:
      return 'bg-zinc-800 text-zinc-400 border border-zinc-700';
  }
};

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
  handleSplitBlock,
  handleFocusBlock,
  editorRegistryRef,
  handleDeleteBlock,
  onDragOverWrapper,
  onDropWrapper,
  onMouseDownCaptureWrapper,
  onMouseEnterWrapper,
  onClickWrapper,
}: any) => {
  return (
    <div
      data-block-id={block.id}
      onDragOver={onDragOverWrapper}
      onDrop={onDropWrapper}
      onDragEnd={handleDragEnd}
      onMouseDownCapture={onMouseDownCaptureWrapper}
      onMouseEnter={onMouseEnterWrapper}
      onClick={onClickWrapper}
      className={`flex items-center justify-between py-1 rounded-md group transition-all relative ${
        block.type === 'callout'
          ? 'bg-red-500/20 border border-red-500/30 py-3 px-4'
          : 'hover:bg-zinc-800/40 pl-6 pr-2'
      } ${isLockedBySomeoneElse ? 'ring-1 ring-red-500/30 ring-inset' : ''}
      ${dragOverBlockIndex === index && dragOverPosition === 'above' ? 'border-t-2 border-t-[#6b4cff]' : ''}
      ${dragOverBlockIndex === index && dragOverPosition === 'below' ? 'border-b-2 border-b-[#6b4cff]' : ''}
      ${draggedBlockIndex === index ? 'bg-blue-500/10 opacity-50' : ''}`}
    >
      {/* Left Gutter: +, :: */}
      <div className={`absolute left-0 top-1.5 transition-opacity flex items-center gap-0.5 z-50 select-none -translate-x-full pr-1 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        {(!isSelected || isFirstSelected) && (
          <button
            className="flex items-center justify-center w-5 h-5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors duration-150 cursor-pointer"
            onClick={() => handleAddBlock('text', block.id)}
            title="Add block below"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
        {(!isSelected || isFirstSelected) && (
          <div
            draggable={true}
            onDragStart={(e) => {
              handleDragStart(e, index);
            }}
            onDragEnd={(e) => {
              handleDragEnd();
            }}
            onClick={(e) => {
              e.stopPropagation();
              const newSel = e.shiftKey ? new Set(selectedBlockIds) : new Set<string>();
              newSel.has(block.id) ? newSel.delete(block.id) : newSel.add(block.id);
              setSelectedBlockIds(newSel);
            }}
            className="flex items-center justify-center w-6 h-6 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors duration-150 cursor-grab active:cursor-grabbing"
            title="Drag to move · Click to select"
          >
            <GripVertical className="w-4 h-4 pointer-events-none" />
          </div>
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
      <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-20 relative">
        {block.type === 'callout' && (
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
        )}
        {block.type === 'tags' && (
          <Tags className="w-4 h-4 text-zinc-500 shrink-0" />
        )}

        <div key={`editor-${block.id}`} className={`flex-1 min-w-0 relative ${isSelected ? 'is-selected-block' : ''}`}>
          {isLast && (!block.content || block.content === '<p></p>' || block.content === '<p><br></p>') && (
            <div className="absolute top-0 left-0 text-[#71717a] text-sm pointer-events-none" style={{ userSelect: 'none', WebkitUserSelect: 'none' }}>
              Write, press 'space' for AI, '/' for commands
            </div>
          )}
          <BlockEditor
            editable={!isLockedBySomeoneElse}
            content={block.content}
            onChange={(newContent) => handleUpdateBlockContent(block.id, newContent)}
            onBlur={() => handleBlurBlock(block.id)}
            onKeyDown={(e) => handleKeyDown(e, block.id, index)}
            onSplit={(contents) => handleSplitBlock(block.id, index, contents)}
            onFocus={() => handleFocusBlock(block.id)}
            onEditorReady={(editor) => { editorRegistryRef.current[block.id] = editor; }}
          />
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

      <div className={`transition-opacity flex items-center gap-1 absolute right-2 bottom-1 bg-[#0d0d0d] px-1 py-1 rounded-md shadow-sm border border-zinc-800 ${focusedBlockId === block.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
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

export default function DocPage({ docId }: { docId?: string }) {
  const params = useParams<{ id: string }>();
  const id = docId || params?.id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbg = (...args: any[]) => console.log('[BlockEditor]', ...args);
  const { currentUser, setCurrentUser, tasks, tasksIndex, loadTasks, hydrateTasksFromCache, updateTask } = useAppStore();
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
  useEffect(() => {
    activePageRef.current = activePage;
  }, [activePage]);

  const [pageTitle, setPageTitle] = useState('');
  const pageTitleRef = useRef(pageTitle);
  useEffect(() => { pageTitleRef.current = pageTitle; }, [pageTitle]);
  const [blocks, setBlocks] = useState<DocBlock[]>([]);
  // Stable ref so event-handler closures registered with deps:[] never read stale blocks
  const blocksRef = useRef<DocBlock[]>([]);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  const [savingPage, setSavingPage] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  
  // Custom multi-block selection state
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());
  const isMouseDownRef = useRef(false);
  const dragSelectionStartBlockIndexRef = useRef<number | null>(null);
  // Track whether the last mouseup resolved a cross-block native text selection
  const crossBlockNativeSelectionRef = useRef(false);
  
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
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  useEffect(() => {
    if (activePage?.id && currentUser?.id) {
      spacesApi.getPageVersions(activePage.id).then(res => {
        if (res.versions) {
          setPageVersions(res.versions);
          if (res.versions.length > 0) {
            const history = res.versions
              .filter((v: any) => v.userId === currentUser.id)
              .map((v: any) => v.content).reverse();
            setUndoStack(history);
            setRedoStack([]);
          }
        }
      }).catch(err => console.error("Failed to load versions:", err));
    }
  }, [activePage?.id, currentUser?.id]);



  // Global hover card state
  const [hoverCardData, setHoverCardData] = useState<any>(null);
  const [hoverCardPos, setHoverCardPos] = useState<{ x: number, y: number } | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  // Native click handler for mention nodes — works even in read-only BlockEditor
  useEffect(() => {
    const handleDocClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const mentionSpan = target.closest('span[data-type="mention"]');
      if (!mentionSpan) return;
      const taskId = mentionSpan.getAttribute('data-id');
      if (!taskId) return;
      e.preventDefault();
      e.stopPropagation();
      const foundTask = tasksIndex[taskId] || tasks.find((t: any) => t.id === taskId);
      if (foundTask) {
        setSelectedTaskForModal(foundTask);
        setIsTaskModalOpen(true);
      } else {
        try {
          const res = await tasksApi.getTask(taskId);
          if (res.task) {
            setSelectedTaskForModal(res.task);
            setIsTaskModalOpen(true);
          }
        } catch (err) {
          console.error('Could not load task detail:', err);
        }
      }
    };
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, [tasksIndex, tasks]);

  useEffect(() => {
    const handleOpenTaskDetail = async (e: any) => {
      const taskId = e.detail?.taskId;
      if (!taskId) return;
      const foundTask = tasksIndex[taskId] || tasks.find((t: any) => t.id === taskId);
      if (foundTask) {
        setSelectedTaskForModal(foundTask);
        setIsTaskModalOpen(true);
      } else {
        try {
          const res = await tasksApi.getTask(taskId);
          if (res.task) {
            setSelectedTaskForModal(res.task);
            setIsTaskModalOpen(true);
          }
        } catch (err) {
          console.error('Could not load task detail:', err);
        }
      }
    };
    window.addEventListener('open-task-detail', handleOpenTaskDetail as any);

    return () => {
      window.removeEventListener('open-task-detail', handleOpenTaskDetail as any);
    };
  }, [tasksIndex, tasks]);

  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
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

  const fetchDoc = async () => {
    try {
      const docRes = await spacesApi.getDoc(id as string);
      setDoc(docRes.doc);
      if (docRes.doc?.pages?.length > 0 && !activePageRef.current) {
        const firstPage = docRes.doc.pages[0];
        setActivePage(firstPage);
        setPageTitle(firstPage.title || 'Untitled Page');
        setBlocks(markdownToBlocks(firstPage.content));
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

    s.on('page_updated', () => {
      // Allow other users to see structure changes (new blocks/deleted blocks) by re-fetching
      fetchDoc();
    });

    setSocket(s);

    return () => {
      s.emit('leave_doc', id);
      s.disconnect();
    };
  }, [id]);

  const handleSelectPage = (page: any) => {
    setActivePage(page);
    setPageTitle(page.title || 'Untitled Page');
    setBlocks(markdownToBlocks(page.content));
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
      setActivePage(res.page);
      setPageTitle(res.page.title || 'Untitled Page');
      setBlocks(cleanBlocks);
    } catch (err) {
      console.error('Failed to create page:', err);
    }
  };

  const handleSavePage = async (updatedBlocks = blocksRef.current, skipHistory = false) => {
    if (!activePageRef.current) return;
    setSavingPage(true);
    try {
      const content = blocksToMarkdown(updatedBlocks);
      
      if (!skipHistory) {
        setUndoStack(prev => {
          if (prev.length === 0 || prev[prev.length - 1] !== content) {
            return [...prev, content].slice(-50); // keep last 50
          }
          return prev;
        });
        setRedoStack([]);
      }

      await spacesApi.updatePage(activePageRef.current.id, {
        title: pageTitleRef.current,
        content: content,
      });
      if (socket) {
        socket.emit('page_updated', { docId: id, pageId: activePageRef.current.id });
      }
    } catch (err) {
      console.error('Failed to save page:', err);
    } finally {
      setSavingPage(false);
    }
  };

  const handleDeletePage = async (pageId: string) => {
    if (!pageId) return;
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
    console.log(`[DocsPage] handleAddBlock called. type: ${type}, afterId: ${afterId}`);
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
    console.log(`[DocsPage] handleSplitBlock called. blockId: ${blockId}, index: ${index}, split into ${contents.length} parts`);
    if (contents.length < 2) return;
    
    const newBlocks: DocBlock[] = contents.slice(1).map(part => ({
      id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      type: 'text',
      content: part,
    }));
    
    let finalBlocksToSave: DocBlock[] = [];
    setBlocks(prevBlocks => {
      const idx = prevBlocks.findIndex(b => b.id === blockId);
      if (idx === -1) return prevBlocks;
      
      const updatedBlocks = [...prevBlocks];
      updatedBlocks[idx] = { ...updatedBlocks[idx], content: contents[0] };
      
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

  const handleKeyDown = (e: any, blockId: string, index: number) => {
    console.log(`[DocsPage] handleKeyDown. key: ${e.key}, blockId: ${blockId}, index: ${index}`);
    // Clear block selection when user starts typing normally inside an editor
    if (selectedBlockIdsRef.current.size > 0 && !e.shiftKey && e.key !== 'Escape') {
      dbg('keydown inside editor, clearing block selection');
      setSelectedBlockIds(new Set());
    }

    if (e.key === 'Backspace') {
      // Only delete the block itself when it's truly empty — let the editor handle normal deletions
      const currentBlocks = blocksRef.current;
      const block = currentBlocks.find(b => b.id === blockId);
      const isEmpty = !block?.content || block.content === '' || block.content === '<p></p>' || block.content === '<p><br></p>';
      if (isEmpty) {
        dbg('Backspace on empty block', blockId, '@ index', index);
        e.preventDefault();
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
      e.preventDefault();
      dbg('Escape → entering block selection mode for', blockId);
      // Enter block selection mode for the current block
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
        e.preventDefault();
        dbg('Shift+Arrow at block edge → block selection mode', blockId, e.key);
        const newSelection = new Set<string>();
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
      const target = e.target as HTMLElement;

      // Clear BLOCK-selection when clicking anywhere that isn't the grip or inside
      // an already-selected block wrapper
      setSelectedBlockIds(prev => {
        if (prev.size === 0) return prev;
        if (e.shiftKey) return prev;
        const isGrip = !!target.closest('.cursor-grab');
        const isOnSelectedBlock = !!target.closest('.is-selected-block');
        if (!isGrip && !isOnSelectedBlock) {
          dbg('mousedown outside selection → clearing block selection');
          return new Set();
        }
        return prev;
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      isMouseDownRef.current = false;
      dragSelectionStartBlockIndexRef.current = null;
      crossBlockNativeSelectionRef.current = false;

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
          dbg(
            isCrossBlock ? '✨ Cross-block native text selection' : 'Single-block text selection',
            '| anchor block:', anchorEl.getAttribute('data-block-id'),
            '| focus block:', focusEl.getAttribute('data-block-id'),
            '| text:', `"${sel.toString().slice(0, 80)}"`,
          );
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
      dbg('Backspace/Delete on cross-block selection → merging blocks');

      const anchorId = anchorBlock.getAttribute('data-block-id');
      const focusId = focusBlock.getAttribute('data-block-id');
      if (!anchorId || !focusId) return;

      const currentBlocks = blocksRef.current;
      const startIndex = currentBlocks.findIndex(b => b.id === anchorId);
      const endIndex = currentBlocks.findIndex(b => b.id === focusId);
      if (startIndex === -1 || endIndex === -1) return;

      const min = Math.min(startIndex, endIndex);
      const max = Math.max(startIndex, endIndex);
      dbg('Merging blocks', min, '→', max, '(', currentBlocks[min].id, '…', currentBlocks[max].id, ')');

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

        dbg('Merged content (first 120 chars):', mergedContent.slice(0, 120));

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
      dbg(`Cross-block native ${e.type} intercepted!`, min, '→', max);

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
        // If they are focusing something that is NOT our editor (like a title input), don't intercept
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          if (!target.closest('.ProseMirror')) return;
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
      // Don't intercept if focus is inside an active editor
      if (e.target instanceof HTMLElement && e.target.closest('.ProseMirror') && document.activeElement === e.target) {
        dbg('keydown in active ProseMirror editor → not intercepting in block-selection mode');
        return;
      }

      dbg('Global keydown in block-selection mode:', e.key, '| selected:', [...selectedBlockIds]);

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
          const div = document.createElement('div');
          div.innerHTML = html;
          return div.textContent?.trim() || '';
        }).filter(t => t.length > 0).join('\n\n');
        dbg('Ctrl+C: copying', selectedBlocks.length, 'blocks:', JSON.stringify(textToCopy.slice(0, 80)));
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
          const div = document.createElement('div');
          div.innerHTML = html;
          return div.textContent?.trim() || '';
        }).filter(t => t.length > 0).join('\n\n');
        dbg('Ctrl+X: cutting', selectedBlocks.length, 'blocks');
        navigator.clipboard.writeText(textToCopy);
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
          dbg('Ctrl+V (block-selection mode): pasting', parts.length, 'parts over', selectedBlockIds.size, 'selected blocks');
          const newBlocks: DocBlock[] = parts.map(part => ({
            id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            type: 'text',
            content: `<p>${part}</p>`,
          }));
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

  const handleUndo = useCallback(() => {
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

      dbg(
        'paste event fired',
        '| insideProseMirror:', isInsideProseMirror,
        '| blockSelectionActive:', currentlySelectedIds.size > 0,
        '| focusedBlockId:', focusedId,
        '| clipboardText:', JSON.stringify(text.slice(0, 120)),
      );

      // If no text at all, do nothing
      if (!text.trim()) {
        dbg('paste: clipboard empty, skipping');
        return;
      }

      // Split candidate: \n\n = block boundary, \n = line within block
      const parts = text.split(/\n\n|\n/).map(t => t.trim()).filter(t => t.length > 0);
      const isMultiBlock = parts.length > 1;

      dbg('paste: parts =', parts, '| isMultiBlock:', isMultiBlock);

      // If block-selection mode is active, the keydown Ctrl+V handler replaces selected blocks.
      // Don't double-handle it here.
      if (currentlySelectedIds.size > 0) {
        dbg('paste: block-selection mode active → deferring to keydown Ctrl+V handler');
        return;
      }

      // If single-line paste inside an active editor → let Tiptap handle it naturally
      if (!isMultiBlock && isInsideProseMirror) {
        dbg('paste: single-line inside ProseMirror → letting Tiptap handle it');
        return;
      }

      // From here we own the paste event.
      // We must stop propagation so Tiptap's internal paste handler doesn't also fire.
      e.preventDefault();
      e.stopPropagation();
      dbg('paste: intercepted —', parts.length, 'block(s) to insert');

      if (parts.length === 0) return;

      // Determine insert position: after the focused block (or after the active ProseMirror block)
      let anchorBlockId = focusedId;
      if (!anchorBlockId && isInsideProseMirror) {
        // Find which block the active editor belongs to
        const proseMirrorEl = document.activeElement?.closest('[data-block-id]');
        anchorBlockId = proseMirrorEl?.getAttribute('data-block-id') ?? null;
        dbg('paste: resolved anchor block from DOM:', anchorBlockId);
      }

      const insertAfterIndex = anchorBlockId
        ? currentBlocks.findIndex(b => b.id === anchorBlockId)
        : currentBlocks.length - 1;

      dbg('paste: insertAfterIndex =', insertAfterIndex, '(anchor:', anchorBlockId, ')');

      // Helper: focus a block's editor with retry (React commit may be async)
      const focusBlockWithRetry = (blockId: string, attempts = 0) => {
        const editor = editorRegistryRef.current[blockId];
        if (editor) {
          editor.commands.focus('end');
          dbg('paste focus: focused', blockId, 'on attempt', attempts);
        } else if (attempts < 10) {
          dbg('paste focus: editor not mounted yet for', blockId, '— retrying (attempt', attempts + 1, ')');
          setTimeout(() => focusBlockWithRetry(blockId, attempts + 1), 16);
        } else {
          dbg('paste focus: gave up focusing', blockId, 'after 10 attempts');
        }
      };

      if (isInsideProseMirror && anchorBlockId) {
        const [firstPart, ...restParts] = parts;

        // Use Tiptap's insertContent to put the first part at cursor position.
        // This avoids touching blocks state for the anchor block → no re-mount → no cursor loss.
        const anchorEditor = editorRegistryRef.current[anchorBlockId];
        if (anchorEditor && firstPart) {
          dbg('paste: inserting first part into Tiptap editor via insertContent:', JSON.stringify(firstPart));
          anchorEditor.commands.insertContent(firstPart);
        }

        if (restParts.length === 0) {
          dbg('paste: only one part — done (Tiptap handled it all)');
          return;
        }

        // Create new blocks for the remaining parts
        const newBlocks: DocBlock[] = restParts.map(part => ({
          id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          type: 'text' as const,
          content: `<p>${part}</p>`,
        }));

        dbg('paste: creating', newBlocks.length, 'new block(s) for remaining parts after anchor');

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
        setFocusedBlockId(lastNew.id);
        dbg('paste: set focusedBlockId to', lastNew.id, '— scheduling focus with retry');
        setTimeout(() => focusBlockWithRetry(lastNew.id), 0);

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

        dbg('paste: inserting', newBlocks.length, 'new block(s) at index', insertAt);

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
        setFocusedBlockId(lastNew.id);
        dbg('paste: set focusedBlockId to', lastNew.id, '— scheduling focus with retry');
        setTimeout(() => focusBlockWithRetry(lastNew.id), 0);
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

  const handleUpdateBlockContent = (blockId: string, content: string) => {
    console.log(`[DocsPage] handleUpdateBlockContent. blockId: ${blockId}, new content length: ${content.length}`);
    
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
    console.log(`[DRAG_DEBUG] handleDragStart initiated on index: ${index}, blockId: ${blocksRef.current[index]?.id}`);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedBlockIndex(index);
    
    // Set the drag image to the whole block row for better visual feedback
    const rowEl = document.querySelector(`[data-block-id="${blocksRef.current[index]?.id}"]`);
    if (rowEl) {
      console.log(`[DRAG_DEBUG] handleDragStart: Set drag image to full block row.`);
      e.dataTransfer.setDragImage(rowEl as Element, 0, 0);
    } else {
      console.warn(`[DRAG_DEBUG] handleDragStart: Could not find block row element for drag image.`);
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
      console.log(`[DRAG_DEBUG] handleDragOver: set drop indicator to ${pos} block ${index} (${targetId})`);
      setDragOverBlockIndex(index);
      setDragOverPosition(pos);
    }
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    console.log(`[DRAG_DEBUG] handleDrop triggered on index: ${index}`);
    if (draggedBlockIndex === null) {
      console.log(`[DRAG_DEBUG] handleDrop aborted: draggedBlockIndex is null`);
      return;
    }
    e.preventDefault();

    const currentBlocks = blocksRef.current;
    const currentSelectedBlockIds = selectedBlockIdsRef.current;
    const draggedBlock = currentBlocks[draggedBlockIndex];
    if (!draggedBlock) return;

    const isMultiSelectDrag = currentSelectedBlockIds.has(draggedBlock.id) && currentSelectedBlockIds.size > 1;
    console.log(`[DRAG_DEBUG] handleDrop: isMultiSelectDrag=${isMultiSelectDrag}`);

    let blocksToMove: DocBlock[];
    let remainingBlocks: DocBlock[];

    if (isMultiSelectDrag) {
      blocksToMove = currentBlocks.filter(b => currentSelectedBlockIds.has(b.id));
      remainingBlocks = currentBlocks.filter(b => !currentSelectedBlockIds.has(b.id));
    } else {
      blocksToMove = [currentBlocks[draggedBlockIndex]];
      remainingBlocks = currentBlocks.filter((_, i) => i !== draggedBlockIndex);
    }

    const targetBlock = currentBlocks[index];
    console.log(`[DRAG_DEBUG] handleDrop: targetBlock=${targetBlock?.id}`);
    
    if (targetBlock && blocksToMove.find(b => b.id === targetBlock.id)) {
      console.log(`[DRAG_DEBUG] handleDrop aborted: Dropped onto self or selection`);
      handleDragEnd();
      return;
    }

    let insertAt: number;
    if (!targetBlock) {
      insertAt = remainingBlocks.length;
      console.log(`[DRAG_DEBUG] handleDrop: Dropped off end, insertAt=${insertAt}`);
    } else {
      const targetIndexInRemaining = remainingBlocks.findIndex(b => b.id === targetBlock.id);
      if (targetIndexInRemaining === -1) {
        insertAt = remainingBlocks.length;
        console.log(`[DRAG_DEBUG] handleDrop: target not found in remaining, insertAt=${insertAt}`);
      } else if (dragOverPosition === 'above') {
        insertAt = targetIndexInRemaining;
        console.log(`[DRAG_DEBUG] handleDrop: above target, insertAt=${insertAt}`);
      } else {
        insertAt = targetIndexInRemaining + 1;
        console.log(`[DRAG_DEBUG] handleDrop: below target, insertAt=${insertAt}`);
      }
    }

    let newBlocks = [
      ...remainingBlocks.slice(0, insertAt),
      ...blocksToMove,
      ...remainingBlocks.slice(insertAt)
    ];

    console.log(`[DRAG_DEBUG] handleDrop: reordered blocks successfully`);
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
    console.log(`[DRAG_DEBUG] handleDragEnd triggered`);
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
    console.log(`[DocsPage] handleFocusBlock. blockId: ${blockId}`);
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
    <div className="flex h-full w-full bg-[#0d0d0d] text-[#e4e4e7] overflow-hidden font-sans">
      <aside className="w-60 shrink-0 bg-[#141414] border-r border-zinc-800/60 p-4 flex flex-col h-full overflow-y-auto custom-scrollbar select-none">
        <div
          onClick={() => setActivePage(null)}
          className="mb-5 pb-3 border-b border-zinc-800/60 cursor-pointer group hover:opacity-90 transition-all"
        >
          <div className="flex items-center gap-2 text-zinc-400 mb-1">
            <FileText className="w-4 h-4 text-purple-400 shrink-0" />
            <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 group-hover:text-purple-400 transition-colors truncate">Document</span>
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

      <main className="flex-1 overflow-y-auto custom-scrollbar bg-[#0d0d0d]">
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
          <div className="max-w-4xl mx-auto px-10 py-6 space-y-6">

            <div className="space-y-2">
              <input
                type="text"
                value={pageTitle}
                onChange={(e) => setPageTitle(e.target.value)}
                onBlur={() => handleSavePage()}
                placeholder="Page Title..."
                className="w-full bg-transparent border-none text-4xl font-extrabold text-zinc-100 placeholder-zinc-700 focus:outline-none tracking-tight"
              />

              <div className="flex items-center gap-2 text-xs text-zinc-400 flex-wrap">
                <div className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center font-bold text-[10px] shadow-sm">
                  {currentUser?.name ? currentUser.name[0] : 'H'}
                </div>
                <span className="font-semibold text-zinc-300">{currentUser?.name || 'Hannah'}</span>
                <span className="text-zinc-600">•</span>
                <span className="text-zinc-400">Last updated today</span>
                <button 
                  onClick={() => setShowVersionHistory(true)}
                  className="text-zinc-400 hover:text-zinc-200 underline underline-offset-2 transition-colors ml-1"
                >
                  Version History
                </button>
                {!doc?.isDailyRollover && (
                  <>
                    <span className="text-zinc-600">•</span>
                    <Popover.Root open={isRolePopoverOpen} onOpenChange={setIsRolePopoverOpen}>
                      <Popover.Trigger asChild>
                        <button className="flex items-center gap-1.5 rounded-md hover:bg-zinc-800/60 transition-colors cursor-pointer px-1.5 py-1">
                          {(doc?.assigneeRoleRestrictions && doc.assigneeRoleRestrictions.length > 0) ? (
                            <span className="flex items-center">
                              {doc.assigneeRoleRestrictions.map((role: string, i: number) => {
                                const colors = ['bg-purple-500', 'bg-red-500', 'bg-emerald-500', 'bg-blue-500', 'bg-amber-500', 'bg-pink-500'];
                                const bgColor = colors[i % colors.length];
                                return (
                                  <div 
                                    key={role} 
                                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white border-2 border-[#0d0d0d] ${i > 0 ? '-ml-2' : ''} shadow-sm relative transition-transform ${bgColor} animate-in fade-in zoom-in-50 duration-300`}
                                    style={{ zIndex: 10 - i }}
                                    title={role}
                                  >
                                    {role.substring(0, 2).toUpperCase()}
                                  </div>
                                );
                              })}
                            </span>
                          ) : (
                            <div className="w-4 h-4 rounded-sm border border-dashed border-zinc-600" title="Assign Role" />
                          )}
                        </button>
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content
                          className="bg-[#1c1c1e] border border-zinc-800/60 rounded-xl shadow-2xl w-64 p-2 z-100 animate-in fade-in zoom-in-95 duration-100"
                          sideOffset={4}
                          align="start"
                        >
                          <div className="max-h-75 overflow-y-auto custom-scrollbar">
                            {dbTeams.length === 0 && <div className="px-2 py-1.5 text-xs text-zinc-500">No teams found.</div>}
                            <div className="flex flex-col gap-3 mt-1">
                              {dbTeams.map(team => (
                                <div key={team.id} className="flex flex-col">
                                    {(() => {
                                      const teamRoles = team.teamRoles || [];
                                      const current = doc?.assigneeRoleRestrictions || [];
                                      const hasRoles = teamRoles.length > 0;
                                      const allSelected = hasRoles && teamRoles.every((r: any) => current.includes(r.name));
                                      const someSelected = hasRoles && teamRoles.some((r: any) => current.includes(r.name));
                                      
                                      return (
                                        <div 
                                          onClick={async (e) => {
                                            e.preventDefault();
                                            if (!hasRoles || !doc) return;
                                            let next = [...current];
                                            if (allSelected) {
                                              next = next.filter((r: string) => !teamRoles.find((tr: any) => tr.name === r));
                                            } else {
                                              const toAdd = teamRoles.filter((tr: any) => !next.includes(tr.name)).map((tr: any) => tr.name);
                                              next = [...next, ...toAdd];
                                            }
                                            const updatedDoc = { ...doc, assigneeRoleRestrictions: next, teamId: team.id };
                                            setDoc(updatedDoc);
                                            try {
                                              await spacesApi.updateDoc(doc.id, { assigneeRoleRestrictions: next, teamId: team.id });
                                            } catch (err) { console.error('Failed to update roles', err); }
                                          }}
                                          onPointerDown={(e) => e.preventDefault()}
                                          className={`flex items-center gap-2.5 px-2 py-1 ${hasRoles ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                                        >
                                          {hasRoles && (
                                            <div className={`w-3.5 h-3.5 rounded-[3px] flex items-center justify-center shrink-0 transition-colors ${allSelected || someSelected ? 'bg-zinc-700' : 'bg-[#2a2a2c]'}`}>
                                              {allSelected && <Check className="w-2.5 h-2.5 text-zinc-300 stroke-3" />}
                                              {!allSelected && someSelected && <div className="w-1.5 h-0.5 bg-zinc-300 rounded-full" />}
                                            </div>
                                          )}
                                          <span className="text-[11px] font-bold tracking-wide uppercase text-zinc-400">{team.name}</span>
                                        </div>
                                      );
                                    })()}
                                  {(!team.teamRoles || team.teamRoles.length === 0) && (
                                    <div className="px-2 py-1 text-[10px] text-zinc-600 italic">No roles</div>
                                  )}
                                  {team.teamRoles && team.teamRoles.length > 0 && (
                                    <div className="flex flex-col ml-3.25 pl-4 py-1 border-l border-zinc-800/60 mt-1 space-y-0.5">
                                      {team.teamRoles.map((role: any) => {
                                        const selected = (doc?.assigneeRoleRestrictions || []).includes(role.name);
                                        return (
                                          <div
                                            key={role.id}
                                            onClick={async (e) => {
                                              e.preventDefault();
                                              if (!doc) return;
                                              const current = doc.assigneeRoleRestrictions || [];
                                              const next = selected
                                                ? current.filter((r: string) => r !== role.name)
                                                : [...current, role.name];
                                              const updatedDoc = { ...doc, assigneeRoleRestrictions: next, teamId: team.id };
                                              setDoc(updatedDoc);
                                              try {
                                                await spacesApi.updateDoc(doc.id, { assigneeRoleRestrictions: next, teamId: team.id });
                                              } catch (e) { console.error('Failed to update role', e); }
                                            }}
                                            onPointerDown={(e) => e.preventDefault()}
                                            className="flex items-center gap-2.5 cursor-pointer px-1 py-1 text-[13px] font-medium text-zinc-200 hover:text-white transition-colors"
                                          >
                                            <div className={`w-3.5 h-3.5 rounded-[3px] flex items-center justify-center shrink-0 transition-colors ${selected ? 'bg-zinc-700' : 'bg-[#2a2a2c]'}`}>
                                              {selected && <Check className="w-2.5 h-2.5 text-zinc-300 stroke-3" />}
                                            </div>
                                            {role.name}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  </>
                )}

                {savingPage && <span className="text-purple-400 text-[10px] italic ml-2">Saving...</span>}
              </div>
            </div>

            {/* ── Subpages List ── */}
            {activePage.subpages && activePage.subpages.length > 0 && (() => {
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
                  {activePage.subpages.length > subpageLimit && (
                    <div className="flex justify-center mt-3">
                      <button
                        onClick={() => setSubpageLimit(prev => prev + 10)}
                        className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-bold text-zinc-400 hover:text-zinc-100 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800/60 hover:border-zinc-700 rounded-full transition-all cursor-pointer shadow-sm"
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

            {/* ── Freeform Writable Canvas Blocks ── */}
            <div className="space-y-1.5 pt-2">
              {(() => {
                const visibleBlocks = blocks;

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

                return visibleBlocks.map((block, index) => {
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
                        handleSplitBlock={handleSplitBlock}
                        handleFocusBlock={handleFocusBlock}
                        editorRegistryRef={editorRegistryRef}
                        handleDeleteBlock={handleDeleteBlock}
                        onDragOverWrapper={(e: any) => handleDragOver(e, index)}
                        onDropWrapper={(e: any) => handleDrop(e, index)}
                        onMouseDownCaptureWrapper={(e: any) => {
                          // Allow triggering block selection mode from anywhere (including text)
                          if (!e.shiftKey) {
                            dragSelectionStartBlockIndexRef.current = index;
                          } else {
                            dragSelectionStartBlockIndexRef.current = null;
                          }
                        }}
                        onMouseEnterWrapper={(e: any) => {
                          if (isMouseDownRef.current && e.buttons === 1 && dragSelectionStartBlockIndexRef.current !== null) {
                            const start = dragSelectionStartBlockIndexRef.current;
                            const min = Math.min(start, index);
                            const max = Math.max(start, index);
                            
                            if (min !== max) { // Crossed block boundaries
                              setSelectedBlockIds(prev => {
                                const newSel = new Set<string>();
                                const currentBlocks = blocksRef.current;
                                for (let i = min; i <= max; i++) {
                                  if (currentBlocks[i]) newSel.add(currentBlocks[i].id);
                                }
                                return newSel;
                              });
                              
                              if (document.activeElement instanceof HTMLElement) {
                                document.activeElement.blur();
                              }
                              window.getSelection()?.removeAllRanges();
                            }
                          }
                        }}
                        onClickWrapper={(e: any) => {
                          // Click to select/deselect if not clicking the editor itself
                          if (e.target === e.currentTarget) {
                            if (e.shiftKey) {
                              setSelectedBlockIds(prev => {
                                const newSel = new Set(prev);
                                newSel.has(block.id) ? newSel.delete(block.id) : newSel.add(block.id);
                                return newSel;
                              });
                            } else {
                              setSelectedBlockIds(new Set());
                              handleFocusBlock(block.id);
                              setTimeout(() => {
                                const editor = editorRegistryRef.current[block.id];
                                if (editor) editor.commands.focus('end');
                              }, 10);
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
        ) : (
          /* Document Overview State */
          <div className="max-w-4xl mx-auto p-10 space-y-6">
            <div className="p-12 rounded-2xl bg-[#141414] border border-zinc-800/80 text-center space-y-3">
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

      {/* ── Link Task Picker Modal ── */}
      {isLinkModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#18181b] border border-zinc-800 rounded-xl w-full max-w-md shadow-2xl p-4 space-y-4">
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
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
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
        onClose={() => setIsTaskModalOpen(false)}
        task={selectedTaskForModal || null}
        mode="modal"
        onUpdateTask={(updatedTask: any) => {
          setSelectedTaskForModal(updatedTask);
          updateTask(updatedTask);
        }}
      />

      {/* Global Task Hover Card */}
      {hoverCardPos && hoverCardData && (
        <div
          id="global-task-hover-card"
          className="fixed z-99999"
          style={{ left: Math.min(hoverCardPos.x, window.innerWidth - 330), top: Math.min(hoverCardPos.y, window.innerHeight - 250) }}
        >
          <div className="w-[320px] bg-white dark:bg-[#1a1a1a] border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl overflow-hidden flex flex-col text-sm text-zinc-900 dark:text-zinc-100">
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

      {/* Version History Sidebar */}
      {showVersionHistory && (
        <div className="fixed inset-0 z-[100] flex justify-end bg-black/20 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowVersionHistory(false)}>
          <div 
            className="w-80 h-full bg-[#111111] border-l border-zinc-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <div className="flex items-center gap-2 text-zinc-200">
                <History className="w-4 h-4" />
                <h3 className="font-semibold">Version History</h3>
              </div>
              <button onClick={() => setShowVersionHistory(false)} className="text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              {pageVersions.length === 0 ? (
                <div className="text-zinc-500 text-sm text-center py-10">No version history available</div>
              ) : (
                pageVersions.map((version, i) => (
                  <div key={version.id || i} className="flex flex-col gap-2 p-3 rounded-md bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-zinc-300">
                        {new Date(version.createdAt).toLocaleString(undefined, { 
                          month: 'short', day: 'numeric', 
                          hour: 'numeric', minute: '2-digit'
                        })}
                      </span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if(confirm('Restore this version? This will overwrite the current page content.')) {
                            const newBlocks = markdownToBlocks(version.content);
                            blocksRef.current = newBlocks;
                            setBlocks(newBlocks);
                            handleSavePage(newBlocks);
                            setShowVersionHistory(false);
                          }
                        }}
                        className="text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2 py-1 rounded transition-colors"
                      >
                        Restore
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full overflow-hidden shrink-0 bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                        {version.user?.avatarUrl ? (
                          <img src={version.user.avatarUrl} alt={version.user.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[10px] font-bold text-zinc-400">
                            {version.user?.name?.charAt(0) || '?'}
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-zinc-400">
                        Edited by <strong className="text-zinc-200 font-medium">{version.user?.name || 'Unknown'}</strong>
                      </span>
                    </div>
                  </div>
                ))
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
