import React, { forwardRef, useEffect, useImperativeHandle, useState, useCallback, useMemo } from 'react';
import { CornerDownLeft, Layout, Search, Filter, Folder, ListTodo, X, ChevronRight, Hash, CircleDashed } from 'lucide-react';
import { CustomCircleDot, CustomCircleDotted } from '@/components/modals/TaskDetailModal';
import * as Popover from '@radix-ui/react-popover';

type FilterType = 'all' | 'task' | 'board';

interface TaskItem {
  id: string;
  type: 'task';
  name: string;
  title?: string;
  status?: string;
  statusColor?: string;
  frequencyLabel?: string | null;
  listName?: string;
  listId?: string;
  assignees?: Array<{ id: string; name: string; avatarUrl?: string }>;
  priority?: string;
}

interface BoardItem {
  id: string;
  type: 'board';
  name: string;
  color?: string;
  icon?: string | null;
}

export const TaskListDropdown = forwardRef((props: any, ref) => {
  const rawItems = props.items || {};
  const tasks: TaskItem[] = rawItems.tasks || [];
  const boards: BoardItem[] = rawItems.boards || [];

  const [filter, setFilter] = useState<FilterType>('all');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const visibleTasks = useMemo(() => {
    if (filter === 'board') return [];
    let t = tasks;
    if (selectedListId) {
      t = t.filter((task) => task.listId === selectedListId);
    }
    return t.slice(0, 30);
  }, [tasks, filter, selectedListId]);

  const visibleBoards = useMemo(() => {
    if (filter === 'task' || selectedListId) return [];
    return boards.slice(0, 10);
  }, [boards, filter, selectedListId]);

  const flatItems: Array<TaskItem | BoardItem> = useMemo(() => {
    return [...visibleBoards, ...visibleTasks];
  }, [visibleBoards, visibleTasks]);

  useEffect(() => setSelectedIndex(0), [props.items, filter, selectedListId]);

  const selectItem = useCallback((item: TaskItem | BoardItem, forceInsertBoard = false) => {
    if (!item) return;

    if (item.type === 'board' && !forceInsertBoard) {
      // By default, selecting a board filters the view
      setSelectedListId(item.id);
      return;
    }

    if (item.type === 'board' && forceInsertBoard) {
      props.command({
        id: item.id,
        label: item.name,
        mentionType: 'board',
        taskStatus: '',
        tasks: '',
        taskAssignees: '',
        taskPriority: '',
        taskDueDate: '',
      });
      return;
    }

    // Task mention
    const task = item as TaskItem;
    props.command({
      id: task.id,
      label: task.name || task.title || 'Untitled',
      mentionType: (task as any).isSubtask ? 'subtask' : 'task',
      taskStatus: task.status || '',
      tasks: '',
      taskAssignees: task.assignees ? JSON.stringify(task.assignees) : '',
      taskPriority: task.priority || '',
      taskDueDate: (task as any).dueDate || '',
      taskListName: task.listName || '',
      frozenTaskData: JSON.stringify(task),
    });
  }, [props]);

  const upHandler = useCallback(() => {
    setSelectedIndex(i => (i + flatItems.length - 1) % Math.max(flatItems.length, 1));
  }, [flatItems.length]);

  const downHandler = useCallback(() => {
    setSelectedIndex(i => (i + 1) % Math.max(flatItems.length, 1));
  }, [flatItems.length]);

  const enterHandler = useCallback(() => {
    const item = flatItems[selectedIndex];
    if (item) selectItem(item);
  }, [flatItems, selectedIndex, selectItem]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: any) => {
      if (event.key === 'ArrowUp') { upHandler(); return true; }
      if (event.key === 'ArrowDown') { downHandler(); return true; }
      if (event.key === 'Enter') { enterHandler(); return true; }
      if (event.key === 'Backspace' && !props.query && selectedListId) {
        setSelectedListId(null);
        return true;
      }
      return false;
    },
  }));

  const hasNoResults = flatItems.length === 0;

  return (
    <div className="bg-[#131315] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden w-[400px] z-[99999] flex flex-col font-sans">
      
      {/* ── Search Header ───────────────────────────────────────── */}
      <div className="flex flex-col border-b border-zinc-800/80 bg-[#18181b]">
        <div className="flex items-center px-3 py-2.5 cursor-text">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Search className="w-4 h-4 text-teal-400 shrink-0" />
            <div className="text-[13px] text-zinc-300 flex-1 flex items-center gap-1.5 min-w-0">
              {selectedListId && (
                <div className="flex items-center gap-1 bg-teal-500/10 text-teal-400 px-1.5 py-0.5 rounded text-[11px] font-medium border border-teal-500/20 shrink-0">
                  <span>{boards.find(b => b.id === selectedListId)?.name}</span>
                  <button onClick={() => setSelectedListId(null)} className="hover:text-teal-300 transition-colors ml-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
              <div className="flex flex-row items-baseline flex-1 min-w-0 pt-[1px] relative">
                {props.query ? (
                  <>
                    <span className="text-zinc-100 truncate">{props.query}</span>
                    <span className="inline-block w-[1.5px] h-[15px] bg-teal-400 ml-[1px] shrink-0 animate-[blink_1s_step-end_infinite] relative top-[2px]" />
                  </>
                ) : (
                  <>
                    <span className="inline-block w-[1.5px] h-[15px] bg-teal-400 mr-[1px] shrink-0 animate-[blink_1s_step-end_infinite] relative top-[2px]" />
                    <span className="text-zinc-500 italic truncate">Search for a task...</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs Row */}
        {!selectedListId && (
          <div className="flex items-center px-2 pb-2 gap-4">
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFilter('board'); }}
              className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold tracking-widest uppercase transition-colors border-b-2 ${filter === 'board' || filter === 'all' ? 'text-teal-400 border-teal-500' : 'text-zinc-500 border-transparent hover:text-zinc-400'}`}
            >
              <Folder className="w-3 h-3" /> Clients
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFilter('task'); }}
              className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold tracking-widest uppercase transition-colors border-b-2 ${filter === 'task' ? 'text-teal-400 border-teal-500' : 'text-zinc-500 border-transparent hover:text-zinc-400'}`}
            >
              <ListTodo className="w-3 h-3" /> Tasks
            </button>
          </div>
        )}
      </div>

      {/* ── Results list ─────────────────────────────────────────────────── */}
      <div className="max-h-[320px] overflow-y-auto custom-scrollbar p-1.5">
        {hasNoResults ? (
          <div className="px-3 py-6 flex flex-col items-center justify-center text-center gap-2">
            <div className="w-10 h-10 rounded-full bg-zinc-800/50 flex items-center justify-center border border-zinc-800">
              <Search className="w-4 h-4 text-zinc-500" />
            </div>
            <div className="text-sm font-medium text-zinc-400">No results found</div>
            <div className="text-xs text-zinc-600">Try a different search term or filter</div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            
            {/* Clients / Boards section */}
            {visibleBoards.length > 0 && (
              <div className="mb-1">
                {visibleBoards.map((board, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <div
                      key={board.id}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onClick={() => selectItem(board)}
                      className={`w-full flex items-center justify-between px-2 py-2 rounded-lg transition-all cursor-pointer group ${
                        isSelected ? 'bg-indigo-500/10' : 'hover:bg-zinc-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <div 
                          className="w-5 h-5 rounded flex items-center justify-center shadow-sm shrink-0 border border-black/20"
                          style={{ backgroundColor: board.color || '#3b82f6' }}
                        >
                          <Hash className="w-3 h-3 text-white/90" />
                        </div>
                        <span className={`text-[13px] font-medium truncate ${isSelected ? 'text-indigo-300' : 'text-zinc-200'}`}>
                          {board.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={(e) => { e.stopPropagation(); selectItem(board, true); }}
                          className="px-2 py-1 rounded bg-zinc-800 text-[10px] font-medium text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors"
                        >
                          Insert
                        </button>
                        <ChevronRight className="w-4 h-4 text-zinc-500" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Tasks section */}
            {visibleTasks.length > 0 && (
              <div>
                {visibleTasks.map((task, relativeIdx) => {
                  const idx = visibleBoards.length + relativeIdx;
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={task.id}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onClick={() => selectItem(task)}
                      className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg transition-all text-left group ${
                        isSelected ? 'bg-zinc-800/80' : 'hover:bg-zinc-800/40'
                      }`}
                    >
                      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-[13px] font-medium truncate ${isSelected ? 'text-zinc-100' : 'text-zinc-300'}`}>
                            {task.name}
                          </span>
                          {task.frequencyLabel && (
                            <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0 border border-zinc-700/50">
                              {task.frequencyLabel}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {task.status && (
                            <div className="flex items-center gap-1.5 shrink-0">
                              {(task.status || '').toUpperCase() === 'KYC' ? (
                                <CustomCircleDotted 
                                  className="w-3 h-3 shrink-0"
                                  style={{ color: task.statusColor }}
                                />
                              ) : (
                                <CustomCircleDot
                                  className="w-3 h-3 shrink-0"
                                  style={{ color: task.statusColor }}
                                />
                              )}
                              <span className="text-[10px] font-medium text-zinc-500">
                                {task.status}
                              </span>
                            </div>
                          )}
                          {!selectedListId && task.listName && (
                            <>
                              <span className="text-zinc-700 text-[10px]">•</span>
                              <span className="text-[10px] font-medium text-zinc-500 truncate">
                                {task.listName}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {task.assignees && task.assignees.length > 0 && (
                        <div className="flex items-center -space-x-1 shrink-0 opacity-75 group-hover:opacity-100 transition-opacity">
                          {task.assignees.slice(0, 3).map((u, i) => (
                            <div 
                              key={u.id} 
                              className="w-5 h-5 rounded-full bg-zinc-800 border border-[#131315] flex items-center justify-center overflow-hidden z-10"
                              style={{ zIndex: 3 - i }}
                            >
                              {u.avatarUrl ? (
                                <img src={u.avatarUrl} alt={u.name} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-[9px] font-bold text-zinc-400">
                                  {u.name.charAt(0).toUpperCase()}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
});
