'use client';

import { useState, useEffect, useRef } from 'react';
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
}

function SidebarPageItem({
  page,
  activePageId,
  onSelect,
  onAddSubpage,
  onRename,
  onDelete,
  depth = 0,
}: SidebarPageItemProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = page.subpages && page.subpages.length > 0;
  const isActive = activePageId === page.id;

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

      {expanded && hasChildren && (
        <div className="space-y-0.5 mt-0.5">
          {page.subpages.map((sub: any) => (
            <SidebarPageItem
              key={sub.id}
              page={sub}
              activePageId={activePageId}
              onSelect={onSelect}
              onAddSubpage={onAddSubpage}
              onRename={onRename}
              onDelete={onDelete}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
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

export default function DocPage() {
  const { id } = useParams<{ id: string }>();
  const { currentUser, setCurrentUser } = useAppStore();
  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activePage, setActivePage] = useState<any>(null);
  const activePageRef = useRef<any>(null);
  useEffect(() => {
    activePageRef.current = activePage;
  }, [activePage]);

  const [pageTitle, setPageTitle] = useState('');
  const [blocks, setBlocks] = useState<DocBlock[]>([]);
  const [savingPage, setSavingPage] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [subpageLimit, setSubpageLimit] = useState(10);

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

  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [tasksMap, setTasksMap] = useState<Record<string, Task>>({});
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
      const foundTask = tasksMap[taskId] || allTasks.find((t: any) => t.id === taskId);
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
  }, [tasksMap, allTasks]);

  useEffect(() => {
    const handleOpenTaskDetail = async (e: any) => {
      const taskId = e.detail?.taskId;
      if (!taskId) return;
      const foundTask = tasksMap[taskId] || allTasks.find((t: any) => t.id === taskId);
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

    const handleTaskCreated = (e: any) => {
      const task = e.detail?.task;
      
      setBlocks(prevBlocks => {
        if (!task || !task.list?.name) return prevBlocks;

        const exists = prevBlocks.some(b => b.content && b.content.includes(`data-id="${task.id}"`));
        if (exists) return prevBlocks;

        if (!activePageRef.current) return prevBlocks;

        const STATUS_COLORS: Record<string, string> = {
          'KYC': '#06b6d4',
          'Pin Board': '#06b6d4',
          'Daily': '#a855f7',
          'Weekly': '#a855f7',
          'Monthly': '#a855f7',
          'Pending': '#6366f1',
          'In Progress': '#eab308',
          'Revision': '#6366f1',
          'Waiting': '#f97316',
          'In Review': '#6366f1',
          'Checking': '#6366f1',
          'On-Hold': '#ef4444',
          'Closed': '#10b981',
        };
        const statusColor = STATUS_COLORS[task.status] || '#3b82f6';
        const escapedTitle = task.title.replace(/"/g, '&quot;');
        const taskStatusStr = JSON.stringify({ name: task.status, color: statusColor }).replace(/"/g, '&quot;');
        const assigneesStr = JSON.stringify(task.assignees || []).replace(/"/g, '&quot;');

        const mentionHTML = `<p><span data-type="mention" data-id="${task.id}" data-label="${escapedTitle}" data-mention-type="task" data-task-status="${taskStatusStr}" data-task-assignees="${assigneesStr}"></span></p>`;
        
        const newMentionBlock = {
          id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          type: 'text' as any,
          content: mentionHTML
        };

        let newBlocks = [...prevBlocks];
        let foundBlockIdx = -1;

        for (let i = 0; i < newBlocks.length; i++) {
           const b = newBlocks[i];
           // Ignore task blocks when searching for the client heading to prevent matching task names
           if (b.content && 
               b.content.toLowerCase().includes(task.list.name.toLowerCase()) && 
               !b.content.includes('data-type="mention"')) {
              foundBlockIdx = i;
           }
        }

        if (foundBlockIdx !== -1) {
           let taskBlockIdx = foundBlockIdx;
           if (foundBlockIdx + 1 < newBlocks.length) {
              const nextBlock = newBlocks[foundBlockIdx + 1];
              if (nextBlock.content.includes('data-type="mention"')) {
                 taskBlockIdx = foundBlockIdx + 1;
              }
           }
           
           if (taskBlockIdx === foundBlockIdx) {
              if (newBlocks[foundBlockIdx].content.includes('data-type="mention"')) {
                 newBlocks[foundBlockIdx].content += mentionHTML;
              } else {
                 newBlocks.splice(foundBlockIdx + 1, 0, newMentionBlock);
              }
           } else {
              newBlocks[taskBlockIdx] = {
                 ...newBlocks[taskBlockIdx],
                 content: newBlocks[taskBlockIdx].content + mentionHTML
              };
           }
        } else {
           const clientHeadings = [];
           for (let i = 0; i < newBlocks.length; i++) {
             const b = newBlocks[i];
             if (b.content && b.content.startsWith('<h3>') && b.content.endsWith('</h3>')) {
               const clientName = b.content.replace('<h3>', '').replace('</h3>', '').trim();
               clientHeadings.push({ index: i, name: clientName });
             }
           }

           let insertIdx = newBlocks.length;
           if (clientHeadings.length > 0) {
             const nextClient = clientHeadings.find(h => h.name.toLowerCase() > task.list.name.toLowerCase());
             if (nextClient) {
               insertIdx = nextClient.index;
             }
           }

           const blocksToInsert = [];
           if (insertIdx > 0 && newBlocks[insertIdx - 1].content.trim() !== '') {
             blocksToInsert.push({
               id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
               type: 'text' as any,
               content: ''
             });
           }
           blocksToInsert.push({
             id: `blk-h-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
             type: 'text' as any,
             content: `<h3>${task.list.name}</h3>`
           });
           blocksToInsert.push({
             ...newMentionBlock,
             id: `blk-t-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`
           });
           
           if (insertIdx < newBlocks.length && newBlocks[insertIdx].content.trim() !== '') {
              blocksToInsert.push({
                 id: `blk-s-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                 type: 'text' as any,
                 content: ''
              });
           }

           newBlocks.splice(insertIdx, 0, ...blocksToInsert);
        }

        // Delay the save slightly to allow block state to settle
        setTimeout(() => {
          spacesApi.updatePage(activePageRef.current.id, {
            title: activePageRef.current.title || 'Untitled Page',
            content: blocksToMarkdown(newBlocks),
          }).catch(err => console.error('Failed to auto-save new task block:', err));
        }, 100);

        return newBlocks;
      });
    };
    window.addEventListener('task:created', handleTaskCreated as any);

    return () => {
      window.removeEventListener('open-task-detail', handleOpenTaskDetail as any);
      window.removeEventListener('task:created', handleTaskCreated as any);
    };
  }, [tasksMap, allTasks]);

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

  const fetchTasks = async () => {
    try {
      const res = await tasksApi.getTasks();
      if (res.tasks) {
        setAllTasks(res.tasks);
        const map: Record<string, Task> = {};
        res.tasks.forEach((t) => {
          map[t.id] = t;
        });
        setTasksMap(map);
      }
    } catch (err) {
      console.warn('Failed to load tasks for doc page linking:', err);
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
      await fetchTasks();
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
        { id: `blk-${Date.now()}`, type: 'task', content: '', status: 'DAILY' },
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

  const handleSavePage = async (updatedBlocks = blocks) => {
    if (!activePage) return;
    setSavingPage(true);
    try {
      await spacesApi.updatePage(activePage.id, {
        title: pageTitle,
        content: blocksToMarkdown(updatedBlocks),
      });
      if (socket) {
        socket.emit('page_updated', { docId: id, pageId: activePage.id });
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
  };

  const handleKeyDown = (e: any, blockId: string, index: number) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAddBlock('text', blockId);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      handleDeleteBlock(blockId);
      if (index > 0) {
        handleFocusBlock(blocks[index - 1].id);
      }
    }
  };

  const handleUpdateBlockContent = (blockId: string, content: string) => {
    let updated = blocks.map((b) => {
      if (b.id !== blockId) return b;
      return {
        ...b,
        content: content,
      };
    });

    if (socket) {
      socket.emit('block_content_update', { docId: id, blockId, content });
    }

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
    // Don't call handleSavePage here on every keystroke! It is already handled on blur.
  };

  const handleDeleteBlock = (id: string) => {
    const updated = blocks.filter((b) => b.id !== id);
    setBlocks(updated);
    handleSavePage(updated);
  };

  const handleFocusBlock = (blockId: string) => {
    setFocusedBlockId(blockId);
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
    if (tasksMap[taskId]) {
      setSelectedTaskForModal(tasksMap[taskId]);
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

  const filteredTasks = allTasks.filter((t) =>
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

        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Pages</span>
          <span className="text-[10px] text-zinc-600 font-mono">{totalPages}</span>
        </div>

        <div className="flex-1 space-y-1">
          {doc?.pages?.length === 0 ? (
            <p className="text-xs text-zinc-600 italic px-1 py-2">No pages created yet.</p>
          ) : (
            doc?.pages?.map((page: any) => (
              <SidebarPageItem
                key={page.id}
                page={page}
                activePageId={activePage?.id}
                onSelect={handleSelectPage}
                onAddSubpage={(pId) => handleCreatePage(pId)}
                onRename={handleRenamePageClick}
                onDelete={handleDeletePage}
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

              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <div className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center font-bold text-[10px] shadow-sm">
                  {currentUser?.name ? currentUser.name[0] : 'H'}
                </div>
                <span className="font-semibold text-zinc-300">{currentUser?.name || 'Hannah'}</span>
                <span className="text-zinc-600">•</span>
                <span className="text-zinc-400">Last updated today</span>
                {savingPage && <span className="text-purple-400 text-[10px] italic ml-2">Saving...</span>}
              </div>
            </div>

            {/* ── Subpages List ── */}
            {activePage.subpages && activePage.subpages.length > 0 && (
              <div className="pt-4 pb-2">
                <div className="flex items-center justify-between text-xs text-zinc-500 font-semibold border-b border-zinc-800 pb-2 mb-2 px-2">
                  <span>Subpages</span>
                </div>
                <div className="space-y-1">
                  {activePage.subpages.slice(0, subpageLimit).map((sub: any) => (
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
            )}

            {/* ── Freeform Writable Canvas Blocks ── */}
            <div className="space-y-1.5 pt-2">
              {blocks.length === 0 ? (
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
              ) : (
                blocks.map((block, index) => {
                  const isLockedBySomeoneElse = block.lockedBy && block.lockedBy !== currentUser?.id;

                  return (
                    <div
                      key={block.id}
                      className={`flex items-center justify-between py-1 px-2 rounded-md group transition-colors relative ${block.type === 'callout'
                          ? 'bg-red-500/20 border border-red-500/30 py-3 px-4'
                          : 'hover:bg-zinc-800/40'
                        }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-20">

                        {block.type === 'callout' && (
                          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                        )}
                        {block.type === 'tags' && (
                          <Tags className="w-4 h-4 text-zinc-500 shrink-0" />
                        )}

                        {/* Content Input / Formatted View */}
                        {focusedBlockId === block.id && !isLockedBySomeoneElse ? (
                          <div key={`editor-wrapper-${block.id}`} className="flex-1 min-w-0">
                            <BlockEditor
                              autoFocus
                              content={block.content}
                              onChange={(newContent) => handleUpdateBlockContent(block.id, newContent)}
                              onBlur={() => handleBlurBlock(block.id)}
                              onKeyDown={(e) => handleKeyDown(e as any, block.id, index)}
                            />
                          </div>
                        ) : (
                          <div
                            key={`viewer-${block.id}`}
                            onClick={(e) => {
                              const target = e.target as HTMLElement;
                              // Intercept checkbox clicks so we can toggle them without focusing the block
                              if (target.tagName === 'INPUT' && target.getAttribute('type') === 'checkbox') {
                                const input = target as HTMLInputElement;
                                const isChecked = input.checked;
                                
                                // Find the index of this checkbox among all checkboxes in this block's DOM
                                const checkboxesInBlock = Array.from(e.currentTarget.querySelectorAll('input[type="checkbox"]'));
                                const checkboxIndex = checkboxesInBlock.indexOf(input);
                                
                                if (checkboxIndex !== -1) {
                                  // Parse the actual HTML content to update it
                                  const tempDiv = document.createElement('div');
                                  tempDiv.innerHTML = block.content;
                                  
                                  const tempCheckboxes = tempDiv.querySelectorAll('input[type="checkbox"]');
                                  const tempCheckbox = tempCheckboxes[checkboxIndex] as HTMLInputElement;
                                  
                                  if (tempCheckbox) {
                                    if (isChecked) {
                                      tempCheckbox.setAttribute('checked', 'checked');
                                    } else {
                                      tempCheckbox.removeAttribute('checked');
                                    }
                                    
                                    // Also update the parent li data-checked attribute for Tiptap
                                    const li = tempCheckbox.closest('li[data-type="taskItem"]');
                                    if (li) {
                                      li.setAttribute('data-checked', isChecked ? 'true' : 'false');
                                    }
                                    
                                    const newContent = tempDiv.innerHTML;
                                    
                                    // Update blocks state and save
                                    const updated = blocks.map(b => b.id === block.id ? { ...b, content: newContent } : b);
                                    setBlocks(updated);
                                    handleSavePage(updated);
                                    
                                    if (socket) {
                                      socket.emit('block_content_update', { docId: id, blockId: block.id, content: newContent });
                                    }
                                  }
                                }
                                return; // Prevent focusing the block
                              }

                              if (!isLockedBySomeoneElse) handleFocusBlock(block.id);
                            }}
                            className={`flex-1 ${!isLockedBySomeoneElse ? 'cursor-text select-text' : 'cursor-not-allowed text-zinc-500 select-none'} min-h-[24px]`}
                          >
                            {block.content?.includes('data-type="live-kanban-block"') || block.content?.includes('data-type="mention"') ? (
                              <BlockEditor
                                editable={false}
                                content={block.content}
                                onChange={() => {}}
                                onBlur={() => {}}
                              />
                            ) : (
                              <div
                                className={`prose prose-invert max-w-none text-sm text-zinc-100 prose-p:my-0 prose-headings:my-0 prose-ul:my-0 prose-ol:my-0 ${block.content ? '' : 'text-zinc-600 italic'}`}
                                dangerouslySetInnerHTML={{ __html: block.content || 'Write text...' }}
                              />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Assignee badges */}
                      {block.assignees && block.assignees.length > 0 && (
                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          {block.assignees.map((ass, idx) => (
                            <span
                              key={idx}
                              className="h-4 min-w-[16px] px-1 rounded-full text-[9px] font-extrabold flex items-center justify-center bg-zinc-700 text-zinc-200 border border-zinc-700/60"
                            >
                              {ass.value}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Block Hover Actions */}
                      <div className={`transition-opacity flex items-center gap-1 absolute right-2 bottom-1 bg-[#0d0d0d] px-1 py-1 rounded-md shadow-sm border border-zinc-800 ${focusedBlockId === block.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        {isLockedBySomeoneElse && (
                          <div className="px-1.5 py-1 text-red-500 flex items-center gap-1 bg-red-950/40 rounded shadow-sm border border-red-900/50" title={`Locked by ${block.lockedByName || 'another user'}`}>
                            <Lock className="w-3 h-3" />
                            <span className="text-[10px] font-bold tracking-wide">
                              LOCKED BY {block.lockedByName ? block.lockedByName.toUpperCase() : 'USER'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Clickable area at the bottom to append a new block (Innate Line) */}
            <div
              className="min-h-[50vh] w-full cursor-text"
              onClick={() => {
                if (blocks.length === 0 || blocks[blocks.length - 1].content !== '') {
                  handleAddBlock('text');
                } else {
                  handleFocusBlock(blocks[blocks.length - 1].id);
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
      {isTaskModalOpen && selectedTaskForModal && (
        <div 
          className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
          onClick={(e) => { if (e.target === e.currentTarget) setIsTaskModalOpen(false); }}
        >
          <div className="w-full max-w-7xl h-[90vh] rounded-xl overflow-hidden shadow-2xl border border-zinc-800 flex flex-col">
            <TaskDetailModal
              isOpen={isTaskModalOpen}
              onClose={() => setIsTaskModalOpen(false)}
              task={selectedTaskForModal}
              onUpdateTask={(updatedTask) => {
                setSelectedTaskForModal(updatedTask);
                setTasksMap((prev) => ({ ...prev, [updatedTask.id]: updatedTask }));
              }}
            />
          </div>
        </div>
      )}

      {/* Global Task Hover Card */}
      {hoverCardPos && hoverCardData && (
        <div 
          id="global-task-hover-card"
          className="fixed z-[99999]"
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
            
            <div className="flex flex-col p-2 max-h-[300px] overflow-y-auto custom-scrollbar">
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
                        } catch (e) {}
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
