'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { spacesApi } from '@/api';
import { useAppStore } from '@/lib/store';
import { useShallow } from 'zustand/react/shallow';
import {
  List as ListIcon,
  Plus,
  CheckSquare,
  Calendar,
  User,
  Flag,
  ChevronDown,
  ChevronLeft,
  Loader2,
  KanbanSquare,
  Share2,
  Pencil,
  Search,
  X,
} from 'lucide-react';
// useRouter is imported above
import { ListSkeleton } from '@/components/ui/Skeleton';

import { KanbanBoard } from '@/components/board/KanbanBoard';
import { arrayMove } from '@dnd-kit/sortable';
import { tasksApi } from '@/api/tasks';
import { CreateTaskModal } from '@/components/modals/CreateTaskModal';
import { TaskDetailModal, STATUS_COLORS } from '@/components/modals/TaskDetailModal';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '@/api/client';
import { toast } from '@/lib/toast';
import { canUserMoveTask, canTransitionTaskStatus } from '@/lib/permissions';
import { findMatchingTasksSorted } from '@/lib/searchUtils';
// getRoles removed — workspaceRoles now read from Zustand store (avoids a fresh HTTP call per board visit)

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-zinc-400 bg-zinc-800',
  MEDIUM: 'text-blue-400 bg-blue-500/20',
  HIGH: 'text-orange-400 bg-orange-500/20',
  URGENT: 'text-red-400 bg-red-500/20',
};

function getListCache(id: string) {
  try { const r = localStorage.getItem(`nexus_list_cache_${id}`); return r ? JSON.parse(r) : null; } catch { return null; }
}
function setListCache(id: string, data: any) {
  try { localStorage.setItem(`nexus_list_cache_${id}`, JSON.stringify(data)); } catch {}
}

/**
 * Merges a fetched task list into the one on screen:
 * - a task changed locally after the request was sent (e.g. a card just dragged) keeps its local
 *   copy — the response was read from the DB before that change, so applying it would snap the card
 *   back until the socket update arrives;
 * - a task identical to its on-screen copy keeps that object, so memoized cards skip re-rendering.
 */
function mergeFetchedTasks(prev: any[] | undefined, next: any[] | undefined, requestedAt: number, localEdits: Map<string, number>) {
  if (!prev?.length || !next) return next;
  const prevById = new Map(prev.map((t) => [t.id, t]));
  return next.map((t) => {
    const old = prevById.get(t.id);
    if (!old) return t;
    if ((localEdits.get(t.id) ?? 0) >= requestedAt) return old;
    return JSON.stringify(old) === JSON.stringify(t) ? old : t;
  });
}

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');

/** Everything a task can be found by: its title, description, subtask titles and assignees. */
function searchTextOf(task: any): string {
  return [
    task.title,
    task.description ? stripHtml(String(task.description)) : '',
    ...(task.subtasks || []).map((s: any) => s.title),
    task.assignee?.name,
    ...(task.assignees || []).map((a: any) => a.name),
  ].filter(Boolean).join(' \n ').toLowerCase();
}

export default function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { currentUser, setCurrentUser, workspaceRoles, loadRoles, hasLoadedRoles } = useAppStore(
    useShallow(s => ({
      currentUser: s.currentUser,
      setCurrentUser: s.setCurrentUser,
      workspaceRoles: s.workspaceRoles,
      loadRoles: s.loadRoles,
      hasLoadedRoles: s.hasLoadedRoles,
    }))
  );

  const [list, setList] = useState<any>(null);
  const [customGroups, setCustomGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setPageTitle = useAppStore(s => s.setPageTitle);

  useEffect(() => {
    if (list?.name) {
      setPageTitle(list.name);
    }
  }, [list?.name, setPageTitle]);

  // Instantly hydrate or switch list from localStorage cache whenever list ID changes
  useEffect(() => {
    if (!currentUser) return;
    const cachedList = getListCache(id);
    if (cachedList) {
      setList(cachedList);
      setCustomGroups(cachedList.customGroups || []);
      setLoading(false);
    } else {
      setList(null);
      setLoading(true);
    }
  }, [id, currentUser]);
  const [activeTab, setActiveTab] = useState<'list' | 'board'>('board');
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskModalStatus, setTaskModalStatus] = useState<string>('TODO');
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState('');
  // Searches this client's tasks only; kept with the list it was typed on, so another list starts blank
  const [searchState, setSearchState] = useState({ listId: id, text: '' });
  const search = searchState.listId === id ? searchState.text : '';
  const setSearch = (text: string) => setSearchState({ listId: id, text });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchCycleRef = useRef<{ query: string; index: number }>({ query: '', index: 0 });

  const handleSearchSubmit = useCallback(() => {
    const q = search.trim();
    if (!q) return;

    const allTasks = list?.tasks || [];
    if (allTasks.length === 0) return;

    const matches = findMatchingTasksSorted(q, allTasks);
    if (matches.length === 0) {
      toast.info('No matching tasks found');
      return;
    }

    // Switch to board view if on list view so the user can see the card highlight and scroll
    if (activeTab !== 'board') {
      setActiveTab('board');
    }

    // Cycle through matches on repeated Enter
    let matchIndex = 0;
    if (searchCycleRef.current.query === q.toLowerCase()) {
      matchIndex = (searchCycleRef.current.index + 1) % matches.length;
    }
    searchCycleRef.current = {
      query: q.toLowerCase(),
      index: matchIndex,
    };

    const targetMatch = matches[matchIndex];
    const targetTask = targetMatch.task;

    const mainEl = document.getElementById('main-scroll-container');
    if (mainEl && mainEl.scrollTop !== 0) {
      mainEl.scrollTop = 0;
    }

    // Fire the custom event that KanbanBoard and KanbanCard listen to
    window.dispatchEvent(
      new CustomEvent('nexus:kanban-highlight-task', {
        detail: {
          taskId: targetTask.id,
          subtaskId: targetMatch.subtaskId,
          status: targetTask.status,
        },
      })
    );
  }, [search, list?.tasks, activeTab]);

  // Guard: lock main-scroll-container strictly to 0 so board headers are never cut off
  useEffect(() => {
    const mainEl = document.getElementById('main-scroll-container');
    if (mainEl) {
      mainEl.scrollTop = 0;
      const onMainScroll = () => {
        if (mainEl.scrollTop !== 0) {
          mainEl.scrollTop = 0;
        }
      };
      mainEl.addEventListener('scroll', onMainScroll, { passive: true });
      return () => mainEl.removeEventListener('scroll', onMainScroll);
    }
  }, []);

  // "/" focuses the search, like ClickUp, unless typing somewhere already
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const searchTerms = useMemo(() => search.toLowerCase().split(/\s+/).filter(Boolean), [search]);
  const visibleTasks = useMemo(() => {
    const tasks = list?.tasks || [];
    if (searchTerms.length === 0) return tasks;
    const directMatches = tasks.filter((t: any) => {
      const text = searchTextOf(t);
      return searchTerms.every((term) => text.includes(term));
    });
    if (directMatches.length > 0) return directMatches;
    // Fallback to nearest fuzzy matches so typos or similar words still show on the board
    const fuzzy = findMatchingTasksSorted(search, tasks);
    if (fuzzy.length > 0) {
      const topIds = new Set(fuzzy.slice(0, 10).map((m) => m.task.id));
      return tasks.filter((t: any) => topIds.has(t.id));
    }
    return [];
  }, [list?.tasks, searchTerms, search]);
  const isSearching = searchTerms.length > 0;

  // Ensure workspace roles are loaded — uses store cache so no extra HTTP call if already fetched
  useEffect(() => {
    if (!hasLoadedRoles) loadRoles();
  }, [hasLoadedRoles, loadRoles]);

  // When each task was last changed optimistically on this page (see mergeFetchedTasks)
  const localTaskEditsRef = useRef<Map<string, number>>(new Map());

  // Keep the cached board in step with socket and optimistic changes, so coming back to it shows the latest
  // state instead of the last full fetch. Debounced (a drag streams move previews; serialising the board on
  // each would stutter it) and flushed on leaving, so nothing pending is lost.
  const pendingListCacheRef = useRef<any>(null);
  const listCacheTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushListCache = () => {
    if (listCacheTimerRef.current) clearTimeout(listCacheTimerRef.current);
    listCacheTimerRef.current = null;
    const pending = pendingListCacheRef.current;
    pendingListCacheRef.current = null;
    if (pending?.id) {
      // Unsaved optimistic tasks are left out; the next fetch brings them back with their real ids
      setListCache(pending.id, { ...pending, tasks: pending.tasks.filter((t: any) => !String(t.id).startsWith('temp-')) });
    }
  };
  useEffect(() => {
    // list.id check: right after switching boards, the previous board is still in state until its fetch lands
    if (!list?.tasks || list.id !== id) return;
    pendingListCacheRef.current = list;
    if (listCacheTimerRef.current) clearTimeout(listCacheTimerRef.current);
    listCacheTimerRef.current = setTimeout(flushListCache, 2000);
  }, [list, id]);
  useEffect(() => flushListCache, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const requestedAt = Date.now();
      try {
        const listRes = await spacesApi.getList(id);

        if (!cancelled && listRes.list) {
          setListCache(id, listRes.list);
          setList((prev: any) => {
            const isSameList = prev?.id === id;
            return {
              ...listRes.list,
              tasks: isSameList
                ? mergeFetchedTasks(prev?.tasks, listRes.list.tasks, requestedAt, localTaskEditsRef.current)
                : listRes.list.tasks,
            };
          });
          if (listRes.list?.customGroups) {
            setCustomGroups(listRes.list.customGroups);
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load board');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const lastUrlTaskId = useRef<string | null>(null);

  useEffect(() => {
    if (!loading && list?.tasks) {
      const taskIdParam = searchParams.get('task');
      const actualTaskId = taskIdParam ? taskIdParam.split('/')[0] : null;

      if (actualTaskId !== lastUrlTaskId.current) {
        lastUrlTaskId.current = actualTaskId;
        if (actualTaskId) {
          const taskToOpen = list.tasks.find((t: any) => t.id === actualTaskId);
          if (taskToOpen) {
            setSelectedTask(taskToOpen);
          }
        }
      } else if (actualTaskId) {
        // If task in list.tasks has an updated status, keep selectedTask in sync
        const matching = list.tasks.find((t: any) => t.id === actualTaskId);
        if (matching) {
          setSelectedTask((prev: any) => {
            if (prev && prev.id === matching.id && prev.status !== matching.status) {
              return { ...prev, status: matching.status };
            }
            return prev;
          });
        }
      }
    }
  }, [loading, list?.tasks, searchParams]);

  const hadSelectedTask = useRef(false);

  // Sync selectedTask to URL so that copy-pasting the address bar works
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (selectedTask) {
        hadSelectedTask.current = true;
        if (url.searchParams.get('task') !== selectedTask.id) {
          url.searchParams.set('task', selectedTask.id);
          window.history.replaceState(null, '', url.pathname + url.search);
        }
        // Only clear on close: on first load the task from the link isn't selected yet,
        // and clearing here would drop ?subtask= before the task window reads it.
      } else if (hadSelectedTask.current && url.searchParams.has('task')) {
        url.searchParams.delete('task');
        url.searchParams.delete('subtask');
        window.history.replaceState(null, '', url.pathname + url.search);
      }
    }
  }, [selectedTask]);

  useEffect(() => {
    if (!id) return;
    const s = io(API_BASE_URL, { withCredentials: true });
    setSocket(s);

    s.on('connect', () => {
      s.emit('join_list', id);
    });

    // Real-time: task created by another user
    s.on('task:created', (newTask: any) => {
      // task:created is broadcast globally — ignore tasks that belong to other lists
      if (newTask?.listId && newTask.listId !== id) return;
      setList((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        // Don't add if we already have it by real ID (API response arrived first)
        if (prev.tasks.some((t: any) => t.id === newTask.id)) return prev;
        // If we have a temp task (we were the creator), replace it with the real one
        const tempIdx = prev.tasks.findIndex((t: any) =>
          typeof t.id === 'string' && t.id.startsWith('temp-') && t.title === newTask.title
        );
        if (tempIdx !== -1) {
          const updated = [...prev.tasks];
          updated[tempIdx] = newTask;
          return { ...prev, tasks: updated };
        }
        // Mirror the server's board order (position, else createdAt) so duplicates land beside their original
        const sortKey = (t: any) => t.position ?? new Date(t.createdAt).getTime();
        const newKey = sortKey(newTask);
        const insertIdx = prev.tasks.findIndex((t: any) => sortKey(t) > newKey);
        if (insertIdx === -1) return { ...prev, tasks: [...prev.tasks, newTask] };
        const updated = [...prev.tasks];
        updated.splice(insertIdx, 0, newTask);
        return { ...prev, tasks: updated };
      });
    });

    // Real-time: task updated/moved by another user
    s.on('task:updated', (updatedTask: any) => {
      setList((prev: any) => {
        if (!prev || !prev.tasks) {
          return prev;
        }
        
        let found = false;
        const newTasks = prev.tasks.map((t: any) => {
          if (t.id === updatedTask.id) {
            found = true;
            return { ...t, ...updatedTask };
          }
          return t;
        });

        return {
          ...prev,
          tasks: newTasks
        };
      });
      setSelectedTask((prev: any) => prev?.id === updatedTask.id ? { ...prev, ...updatedTask } : prev);
    });

    // Real-time: task deleted by another user
    s.on('task:deleted', (data: { id: string }) => {
      setList((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        return { ...prev, tasks: prev.tasks.filter((t: any) => t.id !== data.id) };
      });
      setSelectedTask((prev: any) => prev?.id === data.id ? null : prev);
    });

    // Real-time: task dragging between columns
    s.on('task_move_preview', (data: { taskId: string; status: string }) => {
      setList((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((t: any) => 
            t.id === data.taskId ? { ...t, status: data.status } : t
          ),
        };
      });
      setSelectedTask((prev: any) => (prev?.id === data.taskId ? { ...prev, status: data.status } : prev));
    });

    s.on('task:comment_added', (payload: { taskId: string, comment: any }) => {
      // Since comments aren't in the raw list fetch typically, we can just update selectedTask if it's open
      setSelectedTask((prev: any) => {
        if (prev?.id === payload.taskId) {
          return { ...prev, comments: [...(prev.comments || []), payload.comment] };
        }
        return prev;
      });
    });

    s.on('task:checklist_item_updated', (payload: { taskId: string; checklistId: string; item: any; subtaskId?: string }) => {
      setList((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        const newTasks = prev.tasks.map((t: any) => {
          if (payload.subtaskId) {
            if (t.subtasks && t.subtasks.some((st: any) => st.id === payload.subtaskId)) {
              const updatedSubtasks = t.subtasks.map((st: any) => {
                if (st.id === payload.subtaskId && st.checklists) {
                  const updatedChecklists = st.checklists.map((c: any) => {
                    if (c.id === payload.checklistId) {
                      const updatedItems = (c.items || []).map((i: any) =>
                        (i.id === payload.item.id || (typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text))
                          ? { ...i, ...payload.item }
                          : i
                      );
                      return { ...c, items: updatedItems };
                    }
                    return c;
                  });
                  return { ...st, checklists: updatedChecklists };
                }
                return st;
              });
              return { ...t, subtasks: updatedSubtasks };
            }
          } else if (t.id === payload.taskId && t.checklists) {
            const updatedChecklists = t.checklists.map((c: any) => {
              if (c.id === payload.checklistId) {
                const updatedItems = (c.items || []).map((i: any) =>
                  (i.id === payload.item.id || (typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text))
                    ? { ...i, ...payload.item }
                    : i
                );
                return { ...c, items: updatedItems };
              }
              return c;
            });
            return { ...t, checklists: updatedChecklists };
          }
          return t;
        });
        return { ...prev, tasks: newTasks };
      });
    });

    s.on('task:checklist_item_created', (payload: { taskId: string; checklistId: string; item: any; subtaskId?: string }) => {
      setList((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        const newTasks = prev.tasks.map((t: any) => {
          if (payload.subtaskId) {
            if (t.subtasks && t.subtasks.some((st: any) => st.id === payload.subtaskId)) {
              const updatedSubtasks = t.subtasks.map((st: any) => {
                if (st.id === payload.subtaskId && st.checklists) {
                  const updatedChecklists = st.checklists.map((c: any) => {
                    if (c.id === payload.checklistId) {
                      if ((c.items || []).some((i: any) => i.id === payload.item.id)) return c;
                      const tempIdx = (c.items || []).findIndex((i: any) => typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text);
                      if (tempIdx !== -1) {
                        const newItems = [...c.items];
                        newItems[tempIdx] = payload.item;
                        return { ...c, items: newItems };
                      }
                      return { ...c, items: [...(c.items || []), payload.item] };
                    }
                    return c;
                  });
                  return { ...st, checklists: updatedChecklists };
                }
                return st;
              });
              return { ...t, subtasks: updatedSubtasks };
            }
          } else if (t.id === payload.taskId && t.checklists) {
            const updatedChecklists = t.checklists.map((c: any) => {
              if (c.id === payload.checklistId) {
                if ((c.items || []).some((i: any) => i.id === payload.item.id)) return c;
                const tempIdx = (c.items || []).findIndex((i: any) => typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text);
                if (tempIdx !== -1) {
                  const newItems = [...c.items];
                  newItems[tempIdx] = payload.item;
                  return { ...c, items: newItems };
                }
                return { ...c, items: [...(c.items || []), payload.item] };
              }
              return c;
            });
            return { ...t, checklists: updatedChecklists };
          }
          return t;
        });
        return { ...prev, tasks: newTasks };
      });
    });

    s.on('task:checklist_item_deleted', (payload: { taskId: string; checklistId: string; itemId: string; subtaskId?: string }) => {
      setList((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        const newTasks = prev.tasks.map((t: any) => {
          if (payload.subtaskId) {
            if (t.subtasks && t.subtasks.some((st: any) => st.id === payload.subtaskId)) {
              const updatedSubtasks = t.subtasks.map((st: any) => {
                if (st.id === payload.subtaskId && st.checklists) {
                  const updatedChecklists = st.checklists.map((c: any) => {
                    if (c.id === payload.checklistId) {
                      const updatedItems = (c.items || []).filter((i: any) => i.id !== payload.itemId);
                      return { ...c, items: updatedItems };
                    }
                    return c;
                  });
                  return { ...st, checklists: updatedChecklists };
                }
                return st;
              });
              return { ...t, subtasks: updatedSubtasks };
            }
          } else if (t.id === payload.taskId && t.checklists) {
            const updatedChecklists = t.checklists.map((c: any) => {
              if (c.id === payload.checklistId) {
                const updatedItems = (c.items || []).filter((i: any) => i.id !== payload.itemId);
                return { ...c, items: updatedItems };
              }
              return c;
            });
            return { ...t, checklists: updatedChecklists };
          }
          return t;
        });
        return { ...prev, tasks: newTasks };
      });
    });

    s.on('task:checklist_deleted', (payload: { taskId: string; checklistId: string; subtaskId?: string }) => {
      setList((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        const newTasks = prev.tasks.map((t: any) => {
          if (payload.subtaskId) {
            if (t.subtasks && t.subtasks.some((st: any) => st.id === payload.subtaskId)) {
              const updatedSubtasks = t.subtasks.map((st: any) => {
                if (st.id === payload.subtaskId && st.checklists) {
                  const updatedChecklists = st.checklists.filter((c: any) => c.id !== payload.checklistId);
                  return { ...st, checklists: updatedChecklists };
                }
                return st;
              });
              return { ...t, subtasks: updatedSubtasks };
            }
          } else if (t.id === payload.taskId && t.checklists) {
            const updatedChecklists = t.checklists.filter((c: any) => c.id !== payload.checklistId);
            return { ...t, checklists: updatedChecklists };
          }
          return t;
        });
        return { ...prev, tasks: newTasks };
      });
    });

    s.on('list:group_added', (group: string) => {
      setCustomGroups(prev => prev.includes(group) ? prev : [...prev, group]);
    });

    s.on('list:groups_reordered', (newGroups: string[]) => {
      setCustomGroups(newGroups);
    });

    s.on('list:group_deleted', (group: string) => {
      setCustomGroups(prev => prev.filter(g => g !== group));
      // Move orphaned statuses locally
      setList((prev: any) => {
        if (!prev || !prev.statuses) return prev;
        return {
          ...prev,
          statuses: prev.statuses.map((s: any) => 
            s.groupName === group ? { ...s, groupName: null } : s
          )
        };
      });
    });

    s.on('list:group_renamed', (data: { oldName: string; newName: string }) => {
      setCustomGroups(prev => prev.map(g => g === data.oldName ? data.newName : g));
      setList((prev: any) => {
        if (!prev || !prev.statuses) return prev;
        return {
          ...prev,
          statuses: prev.statuses.map((s: any) => 
            s.groupName === data.oldName ? { ...s, groupName: data.newName } : s
          )
        };
      });
    });

    // Real-time: task reorder within a column
    s.on('task_reorder', (data: { status: string; taskIds: string[] }) => {
      setList((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        const otherTasks = prev.tasks.filter((t: any) => t.status !== data.status);
        const statusTasks = prev.tasks.filter((t: any) => t.status === data.status);
        // Reorder statusTasks according to the received taskIds order
        const reordered = data.taskIds
          .map((tid: string) => statusTasks.find((t: any) => t.id === tid))
          .filter(Boolean);
        // Append any tasks not in the reorder list (safety net)
        const remaining = statusTasks.filter((t: any) => !data.taskIds.includes(t.id));
        return { ...prev, tasks: [...otherTasks, ...reordered, ...remaining] };
      });
    });

    const handleWindowTaskUpdated = (e: any) => {
      const updatedTask = e.detail?.task;
      if (!updatedTask) return;
      setList((prev: any) => {
        if (!prev || !prev.tasks) return prev;
        const newTasks = prev.tasks.map((t: any) => {
          if (t.id === updatedTask.id) {
            return { ...t, ...updatedTask };
          }
          return t;
        });
        return { ...prev, tasks: newTasks };
      });
      setSelectedTask((prev: any) => prev?.id === updatedTask.id ? { ...prev, ...updatedTask } : prev);
    };

    window.addEventListener('task:updated', handleWindowTaskUpdated);

    return () => {
      window.removeEventListener('task:updated', handleWindowTaskUpdated);
      s.emit('leave_list', id);
      s.disconnect();
    };
  }, [id]);

  // Group tasks by status
  const tasksByStatus = visibleTasks.reduce((acc: Record<string, any[]>, task: any) => {
    const status = task.status || 'TODO';
    if (!acc[status]) acc[status] = [];
    acc[status].push(task);
    return acc;
  }, {} as Record<string, any[]>) ?? {};

  const statusOrder = [
    'KYC',
    'Pin Board',
    'Daily',
    'Weekly',
    'Monthly',
    'Pending',
    'In Progress',
    'Revision',
    'Waiting',
    'In Review',
    'Checking',
    'On-Hold',
    'Closed',
  ];
  const orderedStatuses = [
    ...statusOrder.filter((s) => tasksByStatus[s]),
    ...Object.keys(tasksByStatus).filter((s) => !statusOrder.includes(s)),
  ];
  


  const breadcrumb = [
    list?.space?.name,
    list?.folder?.name,
    list?.name,
  ].filter(Boolean).join(' / ');

  const handleTaskMove = async (taskId: string, newStatus: string) => {
    const task = list?.tasks?.find((t: any) => t.id === taskId);
    if (task) {
      const check = canUserMoveTask(task, list?.statuses, currentUser, workspaceRoles);
      if (!check.allowed) {
        toast.error(check.reason || 'You do not have permission to move tasks from this status');
        return;
      }
      const transitionCheck = canTransitionTaskStatus(task, newStatus);
      if (!transitionCheck.allowed) {
        toast.error(transitionCheck.reason || 'Cannot move task to this status.');
        return;
      }
    }

    // Optimistically update UI, and remember it so an older in-flight list fetch can't undo it
    localTaskEditsRef.current.set(taskId, Date.now());
    const nowIso = new Date().toISOString();
    const optimisticTask = task ? { ...task, status: newStatus, updatedAt: nowIso } : { id: taskId, status: newStatus, updatedAt: nowIso };

    setList((prev: any) => ({
      ...prev,
      tasks: prev.tasks.map((t: any) =>
        t.id === taskId ? { ...t, status: newStatus, updatedAt: nowIso } : t
      ),
    }));
    setSelectedTask((prev: any) => (prev?.id === taskId ? { ...prev, status: newStatus } : prev));
    useAppStore.getState().updateTask(optimisticTask as any);
    window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: optimisticTask } }));

    try {
      await tasksApi.moveTask(taskId, newStatus, id as string, currentUser?.id);
    } catch (err: any) {
      console.error('Failed to move task:', err);
      // Revert on failure by refetching
      const listRes = await spacesApi.getList(id as string);
      setList(listRes.list);
      toast.error(err.message || 'You do not have permission to move tasks from this status');
    }
  };

  const handleTaskReorder = (activeId: string, overId: string) => {
    setList((prev: any) => {
      if (!prev || !prev.tasks) return prev;
      const oldIndex = prev.tasks.findIndex((t: any) => t.id === activeId);
      const newIndex = prev.tasks.findIndex((t: any) => t.id === overId);
      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = arrayMove(prev.tasks, oldIndex, newIndex);
        // Broadcast the new order to other users
        if (socket) {
          const movedTask = prev.tasks[oldIndex];
          const statusTasks = reordered.filter((t: any) => t.status === movedTask.status);
          socket.emit('task_reorder', {
            listId: id,
            status: movedTask.status,
            taskIds: statusTasks.map((t: any) => t.id),
          });
        }
        return { ...prev, tasks: reordered };
      }
      return prev;
    });
  };

  const handleTaskMovePreview = (taskId: string, newStatus: string) => {
    if (socket) {
      socket.emit('task_move_preview', {
        listId: id,
        taskId,
        status: newStatus,
      });
    }
  };

  const handleAddTask = async (task: any) => {
    // Optimistic ID for UI
    const tempId = `temp-${Date.now()}`;
    const targetListId = task.listId || id;
    const isCurrentBoard = targetListId === id;
    
    const newTask = { ...task, id: tempId, listId: targetListId, creatorId: currentUser?.id, createdAt: new Date().toISOString() };

    if (isCurrentBoard) {
      setList((prev: any) => ({
        ...prev,
        tasks: [...(prev.tasks || []), newTask],
      }));
    }

    try {
      const res = await tasksApi.createTask({ ...task, listId: targetListId, creatorId: currentUser?.id });
      
      if (isCurrentBoard) {
        // Replace temp task with real task
        setList((prev: any) => ({
          ...prev,
          tasks: prev.tasks.map((t: any) => t.id === tempId ? res.task : t),
        }));
      }
    } catch (err) {
      console.error('Failed to add task:', err);
      if (isCurrentBoard) {
        // Revert optimistic update
        setList((prev: any) => ({
          ...prev,
          tasks: prev.tasks.filter((t: any) => t.id !== tempId),
        }));
      }
    }
  };

  return (
    <div className="w-full h-full relative flex flex-col">
      {/* TaskDetailModal is lazy-mounted: only added to the DOM when a task is selected.
          This keeps the 286KB component tree out of every board render cycle. */}
      {selectedTask && (
        <TaskDetailModal
          isOpen={true}
          onClose={() => setSelectedTask(null)}
          task={selectedTask}
          mode="full"
          socket={socket}
          listStatuses={list?.statuses || []}
          workspaceRoles={workspaceRoles}
          onStatusChange={(newStatus) => {
            if (selectedTask) {
              const check = canUserMoveTask(selectedTask, list?.statuses, currentUser, workspaceRoles);
              if (!check.allowed) {
                toast.error(check.reason || 'You do not have permission to move tasks from this status');
                return;
              }
              const transitionCheck = canTransitionTaskStatus(selectedTask, newStatus);
              if (!transitionCheck.allowed) {
                toast.error(transitionCheck.reason || 'Cannot move task to this status.');
                return;
              }
              handleTaskMove(selectedTask.id, newStatus);
              setSelectedTask({ ...selectedTask, status: newStatus });
            }
          }}
          onUpdateTask={async (updatedTask) => {
            // Sync board and modal state
            localTaskEditsRef.current.set(updatedTask.id, Date.now());
            setSelectedTask((prev: any) => prev?.id === updatedTask.id ? { ...prev, ...updatedTask } : prev);
            useAppStore.getState().updateTask(updatedTask);
            setList((prev: any) => ({
              ...prev,
              tasks: prev?.tasks ? prev.tasks.map((t: any) => {
                if (t.id === updatedTask.id) {
                  return { ...t, ...updatedTask };
                }
                return t;
              }) : []
            }));
          }}
        />
      )}
      
      {loading ? (
        <ListSkeleton />
      ) : error ? (
        <div className="flex items-center justify-center h-full text-red-400 text-sm">{error}</div>
      ) : (
        <div className="w-full h-full flex flex-col px-6 pt-6 overflow-hidden">
          {/* Header */}
          <div className="mb-6 flex items-start justify-between">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => router.push('/tasks')}
                  className="p-1 rounded-md bg-zinc-800/50 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                  title="Go back"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  {list?.space && (
                    <>
                      <button onClick={() => router.push('/tasks')} className="hover:text-zinc-300 transition-colors cursor-pointer">{list.space.name}</button>
                      <span className="text-zinc-600">/</span>
                    </>
                  )}
                  {list?.folder && (
                    <>
                      <button onClick={() => router.push('/tasks')} className="hover:text-zinc-300 transition-colors cursor-pointer">{list.folder.name}</button>
                      <span className="text-zinc-600">/</span>
                    </>
                  )}
                  {list?.name && (
                    <span className="text-zinc-400">{list.name}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/15">
                  <ListIcon className="w-5 h-5 text-blue-400" />
                </div>
                {isEditingName ? (
                  <input
                    type="text"
                    value={editingNameValue}
                    onChange={(e) => setEditingNameValue(e.target.value)}
                    onBlur={async () => {
                      setIsEditingName(false);
                      if (editingNameValue.trim() && editingNameValue !== list?.name) {
                        try {
                          await spacesApi.updateList(id as string, { name: editingNameValue.trim() });
                          setList((prev: any) => ({ ...prev, name: editingNameValue.trim() }));
                          toast.success('List name updated');
                        } catch (err: any) {
                          toast.error(err.message || 'Failed to update list name');
                        }
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                      if (e.key === 'Escape') {
                        setIsEditingName(false);
                      }
                    }}
                    autoFocus
                    className="text-xl font-semibold text-zinc-100 bg-secondary border border-zinc-700 rounded px-2 py-0.5 outline-none focus:border-indigo-500"
                  />
                ) : (
                  <div className="group flex items-center gap-2">
                    <h1 className="text-xl font-semibold text-zinc-100">{list?.name}</h1>
                    <button
                      onClick={() => {
                        setEditingNameValue(list?.name || '');
                        setIsEditingName(true);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <span className="text-[11px] text-zinc-500 px-2 py-0.5 bg-zinc-800 rounded-full">
                  {list?.tasks?.length ?? 0} tasks
                </span>
              </div>
            </div>
          </div>

          {/* View Tabs */}
          <div className="flex items-center gap-4 border-b border-zinc-800/80 mb-4">
            <button
              onClick={() => setActiveTab('board')}
              className={`flex items-center gap-2 pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'board'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                }`}
            >
              <KanbanSquare className="w-4 h-4" />
              Board
            </button>

            <div className="ml-auto mb-2 flex items-center gap-2">
              {isSearching && (
                <span className={`text-[11px] ${visibleTasks.length ? 'text-zinc-500' : 'text-amber-400'}`}>
                  {visibleTasks.length ? `${visibleTasks.length} of ${list?.tasks?.length ?? 0}` : 'No matching tasks'}
                </span>
              )}
              <div className={`relative flex items-center w-64 rounded-md border bg-secondary/60 transition-colors ${isSearching ? 'border-indigo-500/60' : 'border-zinc-800 focus-within:border-zinc-600'}`}>
                <Search className="absolute left-2.5 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearch('');
                      searchCycleRef.current = { query: '', index: 0 };
                      e.currentTarget.blur();
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSearchSubmit();
                    }
                  }}
                  placeholder={`Search ${list?.name ?? 'this list'}'s tasks…`}
                  aria-label="Search tasks in this list"
                  className="w-full bg-transparent pl-8 pr-7 py-1.5 text-[12px] text-zinc-200 placeholder:text-zinc-600 outline-none"
                />
                {search ? (
                  <button
                    onClick={() => { setSearch(''); searchInputRef.current?.focus(); }}
                    className="absolute right-1.5 p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors cursor-pointer"
                    title="Clear search (Esc)"
                  >
                    <X className="w-3 h-3" />
                  </button>
                ) : (
                  <kbd className="absolute right-2 text-[10px] text-zinc-600 border border-zinc-700 rounded px-1 leading-4 pointer-events-none">/</kbd>
                )}
              </div>
            </div>
          </div>

          {/* Task Groups by Status */}
          {activeTab === 'board' ? (
            <div className="flex-1 min-h-0">
              <KanbanBoard
                listId={id}
                tasks={visibleTasks}
                onTaskMove={handleTaskMove}
                onTaskMovePreview={handleTaskMovePreview}
                onTaskReorder={handleTaskReorder}
                onAddTaskClick={(status) => {
                  setTaskModalStatus(status);
                  setIsTaskModalOpen(true);
                }}
                onTaskClick={setSelectedTask}
                customGroups={customGroups}
                listStatuses={list?.statuses || []}
                onStatusChange={async (statusName, data) => {
                  try {
                    const existingStatus = list?.statuses?.find(
                      (s: any) => String(s.name).toLowerCase() === String(statusName).toLowerCase()
                    );
                    const payload: any = {
                      name: data.name || statusName,
                      color: data.color || existingStatus?.color || 'zinc',
                      allowedRoles: data.allowedRoles !== undefined ? data.allowedRoles : (existingStatus?.allowedRoles || []),
                    };
                    if (data.groupName !== undefined) {
                      payload.groupName = data.groupName;
                    }

                    if (existingStatus) {
                      // ⚡ Optimistic update FIRST — so props.listStatuses converges immediately.
                      // This prevents the 2s pendingLock in KanbanBoard from expiring with stale data.
                      setList((prev: any) => ({
                        ...prev,
                        statuses: prev.statuses.map((s: any) =>
                          s.id === existingStatus.id ? { ...s, ...payload } : s
                        ),
                        tasks: (prev.tasks || []).map((t: any) =>
                          t.status === existingStatus.name && data.name
                            ? { ...t, status: data.name }
                            : t
                        )
                      }));

                      const res = await fetch(`${API_BASE_URL}/api/lists/${id}/statuses/${existingStatus.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      });
                      if (res.ok) {
                        const updated = await res.json();
                        // Confirm with the real server data
                        setList((prev: any) => ({
                          ...prev,
                          statuses: prev.statuses.map((s: any) => s.id === existingStatus.id ? updated.status : s),
                        }));
                      } else {
                        // Rollback optimistic update on failure
                        const errData = await res.json().catch(() => ({}));
                        toast.error(errData.error || 'Failed to update column');
                        setList((prev: any) => ({
                          ...prev,
                          statuses: prev.statuses.map((s: any) => s.id === existingStatus.id ? existingStatus : s),
                        }));
                      }
                    } else {
                      const res = await fetch(`${API_BASE_URL}/api/lists/${id}/statuses`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      });
                      if (res.ok) {
                        const created = await res.json();
                        // The server returns the existing column when there already is one by this name.
                        setList((prev: any) => ({
                          ...prev,
                          statuses: (prev.statuses || []).some((s: any) => s.id === created.status.id)
                            ? prev.statuses.map((s: any) => (s.id === created.status.id ? created.status : s))
                            : [...(prev.statuses || []), created.status]
                        }));
                      } else {
                        const errData = await res.json().catch(() => ({}));
                        toast.error(errData.error || 'Failed to save column settings');
                      }
                    }
                  } catch (e: any) {
                    console.error('Failed to update status', e);
                    toast.error(e.message || 'Failed to update status');
                  }
                }}
                onAddGroup={(group, applyToAll) => {
                  setCustomGroups(prev => {
                    const newGroups = [...prev, group];
                    // Persist to backend
                    spacesApi.updateList(id as string, { customGroups: newGroups, applyToAll }).catch(console.error);
                    return newGroups;
                  });
                  socket?.emit('add_group', { listId: id, group });
                }}
                onDeleteGroup={async (groupToDelete) => {
                  try {
                    const newGroups = customGroups.filter(g => g !== groupToDelete);
                    setCustomGroups(newGroups);
                    socket?.emit('delete_group', { listId: id, group: groupToDelete });
                    
                    setList((prev: any) => {
                      if (!prev || !prev.statuses) return prev;
                      return {
                        ...prev,
                        statuses: prev.statuses.map((s: any) => 
                          s.groupName === groupToDelete ? { ...s, groupName: null } : s
                        )
                      };
                    });

                    // Run the list update and all status patches in parallel
                    const statusesToUpdate = list?.statuses?.filter((s: any) => s.groupName === groupToDelete) || [];
                    await Promise.all([
                      spacesApi.updateList(id as string, { customGroups: newGroups }),
                      ...statusesToUpdate.map((status: any) =>
                        fetch(`${API_BASE_URL}/api/lists/${id}/statuses/${status.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ groupName: null }),
                        })
                      ),
                    ]);
                  } catch (e: any) {
                    console.error('Failed to delete group', e);
                    toast.error(e.message || 'Failed to delete group');
                  }
                }}
                onRenameGroup={async (oldName, newName) => {
                  try {
                    const newGroups = customGroups.map(g => g === oldName ? newName : g);
                    setCustomGroups(newGroups);
                    socket?.emit('rename_group', { listId: id, oldName, newName });
                    
                    setList((prev: any) => {
                      if (!prev || !prev.statuses) return prev;
                      return {
                        ...prev,
                        statuses: prev.statuses.map((s: any) => 
                          s.groupName === oldName ? { ...s, groupName: newName } : s
                        )
                      };
                    });

                    // Run the list update and all status patches in parallel
                    const statusesToUpdate = list?.statuses?.filter((s: any) => s.groupName === oldName) || [];
                    await Promise.all([
                      spacesApi.updateList(id as string, { customGroups: newGroups }),
                      ...statusesToUpdate.map((status: any) =>
                        fetch(`${API_BASE_URL}/api/lists/${id}/statuses/${status.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ groupName: newName }),
                        })
                      ),
                    ]);
                  } catch (e: any) {
                    console.error('Failed to rename group', e);
                    toast.error(e.message || 'Failed to rename group');
                  }
                }}
                onStatusDelete={async (statusName) => {
                  try {
                    const existingStatus = list?.statuses?.find((s: any) => s.name === statusName);
                    if (existingStatus) {
                      const res = await fetch(`${API_BASE_URL}/api/lists/${id}/statuses/${existingStatus.id}`, {
                        method: 'DELETE',
                      });
                      if (res.ok) {
                        setList((prev: any) => ({
                          ...prev,
                          statuses: prev.statuses.filter((s: any) => s.id !== existingStatus.id)
                        }));
                      } else {
                        const errData = await res.json().catch(() => ({}));
                        toast.error(errData.error || 'Failed to delete column');
                      }
                    }
                  } catch (e: any) {
                    console.error('Failed to delete status', e);
                    toast.error(e.message || 'Failed to delete status');
                  }
                }}
                onStatusReorder={(newStatuses: any[]) => {
                  // KanbanBoard fully owns the drag logic and passes the final ordered array here.
                  setList((prev: any) => {
                    if (!prev?.statuses) return prev;
                    
                    const orderedStatusIds = newStatuses.map((s: any) => s.id).filter(Boolean);

                    // Fire API fire-and-forget — do NOT await
                    fetch(`${API_BASE_URL}/api/lists/${id}/statuses/reorder`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('nexus_token')}` },
                      body: JSON.stringify({ listId: id, orderedStatusIds })
                    }).catch(console.error);

                    // Update parent state to instantly reflect the perfect local drag result
                    return { ...prev, statuses: newStatuses };
                  });
                }}
                onGroupReorder={(newGroups) => {
                  setCustomGroups(newGroups);
                  spacesApi.updateList(id as string, { customGroups: newGroups }).catch(console.error);
                  socket?.emit('reorder_groups', { listId: id, customGroups: newGroups });
                }}
              />
            </div>
          ) : list?.tasks?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
              <CheckSquare className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm font-medium">No tasks yet</p>
              <p className="text-xs mt-1">Tasks added to this list will appear here</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-6 custom-scrollbar pr-2">
              {orderedStatuses.map((status) => (
                <div key={status}>
                  {/* Status group header */}
                  <div className="flex items-center gap-2 mb-2">
                    <button className="flex items-center gap-1.5">
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${STATUS_COLORS[status] ?? 'bg-zinc-700 text-zinc-300'}`}>
                        {status.replace('_', ' ')}
                      </span>
                    </button>
                    <span className="text-[11px] text-zinc-600">{tasksByStatus[status].length}</span>
                  </div>

                  {/* Task table */}
                  <div className="border border-zinc-800 rounded-lg overflow-hidden">
                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_140px_120px_100px] bg-secondary/60 border-b border-zinc-800 px-4 py-2 text-[10px] text-zinc-500 uppercase tracking-wide font-semibold">
                      <span>Name</span>
                      <span>Assignee</span>
                      <span>Due Date</span>
                      <span>Priority</span>
                    </div>

                    {/* Task rows */}
                    {tasksByStatus[status].map((task: any) => (
                      <div
                        key={task.id}
                        onClick={() => setSelectedTask(task)}
                        className="grid grid-cols-[1fr_140px_120px_100px] px-4 py-2.5 border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/30 transition-colors group cursor-pointer"
                      >
                        {/* Name */}
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckSquare className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                          <span className="text-[12px] text-zinc-200 truncate">{task.title}</span>
                          {task.subtasks?.length > 0 && (
                            <span className="text-[10px] text-zinc-500 shrink-0">
                              {task.subtasks.filter((s: any) => s.completed).length}/{task.subtasks.length}
                            </span>
                          )}
                        </div>

                        {/* Assignee */}
                        <div className="flex items-center gap-1.5">
                          {task.assignee ? (
                            <>
                              <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-[9px] text-white font-bold shrink-0">
                                {task.assignee.name?.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-[11px] text-zinc-400 truncate">{task.assignee.name}</span>
                            </>
                          ) : (
                            <div className="flex items-center gap-1 text-zinc-600">
                              <User className="w-3.5 h-3.5" />
                              <span className="text-[11px]">Unassigned</span>
                            </div>
                          )}
                        </div>

                        {/* Due Date */}
                        <div className="flex items-center gap-1 text-zinc-500">
                          <Calendar className="w-3 h-3" />
                          <span className="text-[11px]">
                            {task.dueDate
                              ? new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                              : '—'}
                          </span>
                        </div>

                        {/* Priority */}
                        <div className="flex items-center">
                          {task.priority ? (
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${PRIORITY_COLORS[task.priority] ?? 'text-zinc-400 bg-zinc-800'}`}>
                              {task.priority}
                            </span>
                          ) : (
                            <Flag className="w-3.5 h-3.5 text-zinc-700" />
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Add Task row */}
                    <div
                      onClick={() => {
                        setTaskModalStatus(status);
                        setIsTaskModalOpen(true);
                      }}
                      className="px-4 py-2 flex items-center gap-2 text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/20 cursor-pointer transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span className="text-[11px]">Add Task</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <CreateTaskModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        status={taskModalStatus}
        listId={id as string}
        onSave={handleAddTask}
      />
    </div>
  );
}
