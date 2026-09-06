'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { authApi, spacesApi } from '@/api';
import { tasksApi } from '@/api/tasks';
import { useAppStore } from '@/lib/store';
import { Task } from '@/lib/types';
import { TaskDetailModal } from '@/components/modals/TaskDetailModal';
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
} from 'lucide-react';
import { DocSkeleton } from '@/components/ui/Skeleton';

export interface Assignee {
  type: 'letter' | 'more';
  value: string;
}

export interface DocBlock {
  id: string;
  type: 'heading' | 'task' | 'text';
  content: string;
  status?: 'CLOSED' | 'WAITING' | 'DAILY' | 'IN_PROGRESS';
  stars?: number;
  assignees?: Assignee[];
}

interface SidebarPageItemProps {
  page: any;
  activePageId: string | null;
  onSelect: (page: any) => void;
  onAddSubpage: (parentPageId: string) => void;
  depth?: number;
}

function SidebarPageItem({
  page,
  activePageId,
  onSelect,
  onAddSubpage,
  depth = 0,
}: SidebarPageItemProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = page.subpages && page.subpages.length > 0;
  const isActive = activePageId === page.id;

  return (
    <div className="select-none">
      <div
        onClick={() => onSelect(page)}
        className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors group ${
          isActive
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

        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddSubpage(page.id);
          }}
          title="Add subpage"
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-700/60 rounded text-zinc-400 hover:text-white transition-opacity"
        >
          <Plus className="w-3 h-3" />
        </button>
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
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusCircle({ status, onClick }: { status: string; onClick?: () => void }) {
  if (status === 'CLOSED') {
    return (
      <button
        onClick={onClick}
        title="Status: CLOSED (Click to toggle)"
        className="w-4 h-4 rounded-full bg-emerald-600 flex items-center justify-center text-white shrink-0 hover:scale-110 transition-transform shadow-sm"
      >
        <svg className="w-2.5 h-2.5 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </button>
    );
  }
  if (status === 'WAITING') {
    return (
      <button
        onClick={onClick}
        title="Status: WAITING (Click to toggle)"
        className="w-4 h-4 rounded-full bg-red-600 flex items-center justify-center text-white shrink-0 hover:scale-110 transition-transform shadow-sm"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-white" />
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      title="Status: DAILY (Click to toggle)"
      className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center text-white shrink-0 hover:scale-110 transition-transform shadow-sm"
    >
      <div className="w-1.5 h-1.5 rounded-full bg-white" />
    </button>
  );
}

function getTaskStatusBadgeColor(status?: string) {
  if (!status) return 'bg-zinc-700 text-white';
  const s = status.toUpperCase().replace(/\s+/g, '_');
  if (s === 'CLOSED' || s === 'DONE' || s === 'COMPLETED') return 'bg-emerald-600 text-white';
  if (s === 'WAITING' || s === 'ON_HOLD' || s === 'REVISION') return 'bg-red-600 text-white';
  if (s === 'IN_PROGRESS' || s === 'PIN_BOARD' || s === 'CHECKING') return 'bg-blue-600 text-white';
  if (s === 'PENDING') return 'bg-amber-600 text-white';
  return 'bg-purple-600 text-white';
}

function FormattedRichText({
  text,
  tasksMap,
  onOpenTask,
}: {
  text: string;
  tasksMap: Record<string, Task>;
  onOpenTask: (taskId: string) => void;
}) {
  const pattern = /(https?:\/\/[^\s]+\/(?:tasks\/|lists\/[^\s\?]+\?task=)|(?:\/tasks\/|task:))([a-zA-Z0-9_-]+)/gi;
  
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const taskId = match[2];
    const matchIndex = match.index;

    if (matchIndex > lastIndex) {
      parts.push(text.substring(lastIndex, matchIndex));
    }

    const task = tasksMap[taskId];
    parts.push(
      <span
        key={`${taskId}-${matchIndex}`}
        onClick={(e) => {
          e.stopPropagation();
          onOpenTask(taskId);
        }}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded bg-zinc-800/90 border border-purple-500/40 text-xs text-white hover:bg-zinc-700/90 cursor-pointer shadow-sm transition-all group/chip select-none"
        title="Click to open Task Modal"
      >
        <CheckSquare className="w-3.5 h-3.5 text-purple-400 shrink-0" />
        <span className="font-semibold text-purple-200 group-hover/chip:text-white transition-colors underline decoration-dotted underline-offset-2">
          {task ? task.title : `Task #${taskId}`}
        </span>
        <span
          className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded uppercase tracking-wider shrink-0 ${getTaskStatusBadgeColor(
            task?.status
          )}`}
        >
          {task?.status || 'TASK'}
        </span>
      </span>
    );

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return <>{parts.length > 0 ? parts : text}</>;
}

// Convert Markdown text content into flat block list
export function markdownToBlocks(md: string): DocBlock[] {
  if (!md || !md.trim()) {
    return [{ id: `blk-1`, type: 'text', content: '' }];
  }

  // Gracefully support legacy JSON strings
  if (md.trim().startsWith('[') || md.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(md);
      if (Array.isArray(parsed) && parsed.length > 0) {
        if ('type' in parsed[0] || 'content' in parsed[0]) return parsed;
        const converted: DocBlock[] = [];
        parsed.forEach((sec: any) => {
          if (sec.title) converted.push({ id: `h-${Math.random()}`, type: 'heading', content: sec.title.replace(/\[(CLOSED|WAITING|DAILY|IN_PROGRESS)\]/g, '').trim() });
          if (Array.isArray(sec.items)) {
            sec.items.forEach((item: any) => {
              converted.push({
                id: `t-${Math.random()}`,
                type: 'task',
                content: (item.title || '').replace(/\[(CLOSED|WAITING|DAILY|IN_PROGRESS)\]/g, '').trim(),
                status: item.status === 'CLOSED' ? 'CLOSED' : 'DAILY',
              });
            });
          }
        });
        return converted.length > 0 ? converted : [{ id: `blk-1`, type: 'text', content: '' }];
      }
    } catch {}
  }

  const lines = md.split('\n');
  const blocks: DocBlock[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const id = `blk-${index}-${Math.random().toString(36).substr(2, 4)}`;

    if (trimmed.startsWith('# ')) {
      let text = trimmed.replace(/^#+\s*/, '').replace(/\[(CLOSED|WAITING|DAILY|IN_PROGRESS)\]/g, '').trim();
      blocks.push({ id, type: 'heading', content: text });
    } else if (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]')) {
      const isChecked = trimmed.startsWith('- [x]');
      let text = trimmed.replace(/^- \[(?:x| )\]\s*/, '').replace(/\[(CLOSED|WAITING|DAILY|IN_PROGRESS)\]/g, '').trim();

      blocks.push({
        id,
        type: 'task',
        content: text,
        status: isChecked ? 'CLOSED' : 'DAILY',
      });
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      let text = trimmed.replace(/^[-*]\s*/, '').replace(/\[(CLOSED|WAITING|DAILY|IN_PROGRESS)\]/g, '').trim();
      blocks.push({ id, type: 'text', content: text });
    } else {
      let text = trimmed.replace(/\[(CLOSED|WAITING|DAILY|IN_PROGRESS)\]/g, '').trim();
      blocks.push({ id, type: 'text', content: text });
    }
  });

  return blocks.length > 0 ? blocks : [{ id: `blk-1`, type: 'text', content: '' }];
}

export function blocksToMarkdown(blocks: DocBlock[]): string {
  return blocks
    .map((b) => {
      const cleanContent = (b.content || '').replace(/\[(CLOSED|WAITING|DAILY|IN_PROGRESS)\]/g, '').trim();
      if (b.type === 'heading') return `# ${cleanContent}`;
      if (b.type === 'task') {
        const check = b.status === 'CLOSED' ? '[x]' : '[ ]';
        return `- ${check} ${cleanContent}`;
      }
      return cleanContent;
    })
    .join('\n');
}

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

  // Active editing block
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);

  // Task integration states
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [tasksMap, setTasksMap] = useState<Record<string, Task>>({});
  const [selectedTaskForModal, setSelectedTaskForModal] = useState<Task | null>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

  // Link Task Selector Modal
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [taskSearchQuery, setTaskSearchQuery] = useState('');

  // Fetch task list
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

  // Fetch doc data
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
        } catch {}
      }
      await fetchTasks();
      await fetchDoc();
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleSelectPage = (page: any) => {
    setActivePage(page);
    setPageTitle(page.title || 'Untitled Page');
    setBlocks(markdownToBlocks(page.content));
  };

  // Completely clean empty page creation
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
      await fetchDoc();
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

  // Block manipulation helpers
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

  const handleUpdateBlockContent = (id: string, content: string) => {
    let newType: DocBlock['type'] | undefined;
    let newContent = content;

    if (content.startsWith('# ')) {
      newType = 'heading';
      newContent = content.slice(2);
    } else if (content.startsWith('- [ ] ') || content.startsWith('- [x] ')) {
      newType = 'task';
      newContent = content.replace(/^- \[(?:x| )\]\s*/, '');
    }

    const updated = blocks.map((b) => {
      if (b.id !== id) return b;
      return {
        ...b,
        type: newType || b.type,
        content: newContent,
      };
    });
    setBlocks(updated);
  };

  const handleToggleBlockStatus = (id: string) => {
    const statusCycle: DocBlock['status'][] = ['CLOSED', 'WAITING', 'DAILY'];
    const updated = blocks.map((b) => {
      if (b.id !== id) return b;
      const cur = b.status || 'DAILY';
      const nextIndex = (statusCycle.indexOf(cur) + 1) % statusCycle.length;
      return { ...b, status: statusCycle[nextIndex] };
    });
    setBlocks(updated);
    handleSavePage(updated);
  };

  const handleChangeBlockType = (id: string, type: DocBlock['type']) => {
    const updated = blocks.map((b) => {
      if (b.id !== id) return b;
      return {
        ...b,
        type,
        status: type === 'task' ? b.status || 'DAILY' : undefined,
      };
    });
    setBlocks(updated);
    handleSavePage(updated);
  };

  const handleDeleteBlock = (id: string) => {
    const updated = blocks.filter((b) => b.id !== id);
    setBlocks(updated);
    handleSavePage(updated);
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
      {/* ── Sub-Sidebar Panel for Pages ── */}
      <aside className="w-60 shrink-0 bg-[#141414] border-r border-zinc-800/60 p-4 flex flex-col h-full overflow-y-auto custom-scrollbar select-none">
        {/* Document Header */}
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

        {/* Pages Section Label */}
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Pages</span>
          <span className="text-[10px] text-zinc-600 font-mono">{totalPages}</span>
        </div>

        {/* Nested Pages Tree */}
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
              />
            ))
          )}

          {/* Add Top Level Page */}
          <button
            onClick={() => handleCreatePage()}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-zinc-400 hover:text-white rounded hover:bg-zinc-800/60 mt-3 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-zinc-500" />
            <span>Add page</span>
          </button>
        </div>
      </aside>

      {/* ── Main Clean Writable Canvas ── */}
      <main className="flex-1 overflow-y-auto custom-scrollbar bg-[#0d0d0d]">
        {activePage ? (
          <div className="max-w-4xl mx-auto px-10 py-6 space-y-6">
            {/* Top Toolbar Actions */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800/40 text-xs text-zinc-400">
              <button
                onClick={() => setIsLinkModalOpen(true)}
                className="flex items-center gap-1.5 text-purple-400 hover:text-purple-300 transition-colors font-medium hover:bg-purple-950/30 px-2 py-1 rounded"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                <span>Link Task or Doc</span>
              </button>

              <div className="flex items-center gap-4 text-zinc-400">
                <button title="Typography" className="hover:text-white transition-colors p-1"><Type className="w-4 h-4" /></button>
                <button title="Pin Page" className="hover:text-white transition-colors p-1"><Pin className="w-4 h-4" /></button>
                <button title="View Options" className="hover:text-white transition-colors p-1"><SlidersHorizontal className="w-4 h-4" /></button>
                <button title="Download / Export" className="hover:text-white transition-colors p-1"><Download className="w-4 h-4" /></button>
                <button
                  onClick={() => handleDeletePage(activePage.id)}
                  title="Delete page"
                  className="hover:text-red-400 transition-colors ml-2 p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Page Header (Title + Avatar Info) */}
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
                  onClick={() => handleAddBlock('task')}
                  className="py-1 px-2 cursor-text"
                >
                  <input
                    type="text"
                    autoFocus
                    placeholder="Start typing..."
                    onFocus={() => handleAddBlock('task')}
                    className="w-full bg-transparent border-none text-white text-sm font-semibold focus:outline-none placeholder-zinc-700"
                  />
                </div>
              ) : (
                blocks.map((block) => (
                  <div
                    key={block.id}
                    className="flex items-center justify-between py-1 px-2 rounded-md hover:bg-zinc-800/40 group transition-colors relative"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {block.type === 'text' && (
                        <span className="text-zinc-400 font-bold text-sm select-none shrink-0">•</span>
                      )}
                      {/* Content Input / Formatted View */}
                      {focusedBlockId === block.id ? (
                        <input
                          type="text"
                          autoFocus
                          value={block.content}
                          onChange={(e) => handleUpdateBlockContent(block.id, e.target.value)}
                          onBlur={() => {
                            setFocusedBlockId(null);
                            handleSavePage();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddBlock(block.type, block.id);
                            }
                            if (e.key === 'Backspace' && block.content === '') {
                              e.preventDefault();
                              handleDeleteBlock(block.id);
                            }
                          }}
                          placeholder={
                            block.type === 'heading'
                              ? 'Heading title...'
                              : block.type === 'task'
                              ? 'Task title or URL...'
                              : 'Write text...'
                          }
                          className={`bg-transparent border-none text-white focus:outline-none flex-1 ${
                            block.type === 'heading'
                              ? 'text-xl font-bold tracking-tight text-zinc-100'
                              : 'text-sm font-semibold'
                          }`}
                        />
                      ) : (
                        <span
                          onClick={() => setFocusedBlockId(block.id)}
                          className={`flex-1 cursor-text select-text ${
                            block.type === 'heading'
                              ? 'text-xl font-bold tracking-tight text-zinc-100'
                              : 'text-sm font-semibold text-white'
                          }`}
                        >
                          {block.content ? (
                            <FormattedRichText
                              text={block.content}
                              tasksMap={tasksMap}
                              onOpenTask={handleOpenTaskModal}
                            />
                          ) : (
                            <span className="text-zinc-600 italic text-xs">
                              {block.type === 'heading' ? 'Heading...' : 'Empty line...'}
                            </span>
                          )}
                        </span>
                      )}

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
                    </div>
                  </div>
                ))
              )}
            </div>
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
    </div>
  );
}

