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
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="w-4 h-4 flex items-center justify-center rounded hover:bg-zinc-700/50 text-zinc-400"
            >
              {expanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
          ) : (
            <span className="w-4" />
          )}

          {depth > 0 ? (
            <Pin className="w-3.5 h-3.5 text-rose-500 shrink-0 fill-rose-500/20" />
          ) : (
            <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          )}
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
            className="p-1 hover:bg-zinc-700/60 rounded text-zinc-400 hover:text-white transition-opacity"
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
  const [pageTitle, setPageTitle] = useState('');
  const [blocks, setBlocks] = useState<DocBlock[]>([]);
  const [savingPage, setSavingPage] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);

  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [tasksMap, setTasksMap] = useState<Record<string, Task>>({});
  const [selectedTaskForModal, setSelectedTaskForModal] = useState<Task | null>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

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
      if (docRes.doc?.pages?.length > 0 && !activePage) {
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
      setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, lockedBy: userId } : b));
    });

    s.on('block_unlocked', ({ blockId, userId }) => {
      setBlocks(prev => prev.map(b => b.id === blockId && b.lockedBy === userId ? { ...b, lockedBy: null } : b));
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
    } else if (e.key === 'Backspace' && blocks[index].content === '') {
      e.preventDefault();
      handleDeleteBlock(blockId);
      if (index > 0) {
        handleFocusBlock(blocks[index - 1].id);
      }
    }
  };

  const handleUpdateBlockContent = (id: string, content: string) => {
    let updated = blocks.map((b) => {
      if (b.id !== id) return b;
      return {
        ...b,
        content: content,
      };
    });

    if (updated.length === 0 || updated[updated.length - 1].content !== '') {
      updated.push({
        id: `blk-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        type: 'text',
        content: '',
      });
    }

    setBlocks(updated);
    handleSavePage(updated);
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
                            onClick={() => {
                              if (!isLockedBySomeoneElse) handleFocusBlock(block.id);
                            }}
                            className={`flex-1 ${!isLockedBySomeoneElse ? 'cursor-text select-text' : 'cursor-not-allowed text-zinc-500 select-none'} min-h-[24px] prose prose-invert max-w-none text-sm text-zinc-100 prose-p:my-0 prose-headings:my-0 prose-ul:my-0 prose-ol:my-0 ${block.content ? '' : 'text-zinc-600 italic'
                              }`}
                            dangerouslySetInnerHTML={{ __html: block.content || 'Write text...' }}
                          />
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
                          <div className="p-1 text-red-500 flex items-center gap-1 bg-red-950/30 rounded" title="Locked by another user">
                            <Lock className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-bold">LOCKED</span>
                          </div>
                        )}

                        {!isLockedBySomeoneElse && (
                          <>
                            {focusedBlockId === block.id && (
                              <button
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  handleBlurBlock(block.id);
                                }}
                                className="p-1.5 text-purple-500 hover:bg-purple-500/20 hover:text-purple-400 rounded transition-colors"
                                title="Save block"
                              >
                                <Save className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteBlock(block.id)}
                              className="p-1.5 text-zinc-500 hover:bg-red-500/20 hover:text-red-400 rounded transition-colors"
                              title="Delete block"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
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
        <TaskDetailModal
          isOpen={isTaskModalOpen}
          onClose={() => setIsTaskModalOpen(false)}
          task={selectedTaskForModal}
          onUpdateTask={(updatedTask) => {
            setSelectedTaskForModal(updatedTask);
            setTasksMap((prev) => ({ ...prev, [updatedTask.id]: updatedTask }));
          }}
        />
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
