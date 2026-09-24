import React, { forwardRef, useEffect, useImperativeHandle, useState, useCallback } from 'react';
import { CornerDownLeft, Layout } from 'lucide-react';

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

/**
 * TaskListDropdown — redesigned @mention dropdown.
 *
 * Layout:
 *  ┌─────────────────────────────────────────┐
 *  │ [Filter pills: All | Task | Boards]      │
 *  ├─────────────────────────────────────────┤
 *  │ TASKS                                   │
 *  │  ● Task title            DAILY  [avatar]│
 *  │  ● Task title                   [avatar]│
 *  ├─────────────────────────────────────────┤
 *  │ BOARDS                                  │
 *  │  ■ Board name                           │
 *  ├─────────────────────────────────────────┤
 *  │  @search query typed here               │
 *  └─────────────────────────────────────────┘
 */
export const TaskListDropdown = forwardRef((props: any, ref) => {
  // props.items is now { tasks: TaskItem[], boards: BoardItem[] }
  const rawItems = props.items || {};
  const tasks: TaskItem[] = rawItems.tasks || [];
  const boards: BoardItem[] = rawItems.boards || [];

  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Build the flat navigation list based on current filter
  const visibleTasks = filter === 'board' ? [] : tasks;
  const visibleBoards = filter === 'task' ? [] : boards;
  const flatItems: Array<TaskItem | BoardItem> = [...visibleTasks, ...visibleBoards];

  // Reset selection when items or filter changes
  useEffect(() => setSelectedIndex(0), [props.items, filter]);

  const selectItem = useCallback((item: TaskItem | BoardItem) => {
    if (!item) return;

    if (item.type === 'board') {
      // Insert a board mention
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
      mentionType: 'task',
      taskStatus: task.status || '',
      tasks: '',
      taskAssignees: task.assignees ? JSON.stringify(task.assignees) : '',
      taskPriority: task.priority || '',
      taskDueDate: (task as any).dueDate || '',
      // Extra fields for chip display
      taskListName: task.listName || '',
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
      return false;
    },
  }));

  // Index offset for boards in the flat list
  const boardStartIndex = visibleTasks.length;

  const hasNoResults = flatItems.length === 0;

  return (
    <div className="bg-[#18181c] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden w-[360px] z-[99999] flex flex-col">
      
      {/* ── Filter pills ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5 border-b border-zinc-800/60">
        {(['all', 'task', 'board'] as FilterType[]).map(f => (
          <button
            key={f}
            onMouseDown={e => { e.preventDefault(); setFilter(f); }}
            className={`px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize transition-colors ${
              filter === f
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            {f === 'all' ? 'All' : f === 'task' ? 'Tasks' : 'Boards'}
          </button>
        ))}
      </div>

      {/* ── Results list ─────────────────────────────────────────────────── */}
      <div className="max-h-[280px] overflow-y-auto custom-scrollbar">
        {hasNoResults ? (
          <div className="px-3 py-4 text-xs text-zinc-500 text-center italic">
            No results found
          </div>
        ) : (
          <>
            {/* Tasks section */}
            {visibleTasks.length > 0 && (
              <div>
                <div className="px-3 pt-2 pb-0.5 text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
                  Tasks
                </div>
                {visibleTasks.map((task, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={task.id}
                      className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors group ${
                        isSelected
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-300 hover:bg-zinc-800/60'
                      }`}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onMouseDown={e => { e.preventDefault(); selectItem(task); }}
                    >
                      {/* Status dot */}
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: task.statusColor || '#3b82f6' }}
                      />

                      {/* Task title */}
                      <span className="flex-1 truncate font-medium text-[13px]">
                        {task.name || task.title || 'Untitled'}
                      </span>

                      {/* Frequency badge */}
                      {task.frequencyLabel && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300">
                          {task.frequencyLabel}
                        </span>
                      )}

                      {/* Assignee avatars */}
                      {task.assignees && task.assignees.length > 0 && (
                        <span className="flex items-center -space-x-1 shrink-0">
                          {task.assignees.slice(0, 2).map((a, i) => (
                            <span
                              key={a.id}
                              className="w-5 h-5 rounded-full border-2 border-[#18181c] overflow-hidden bg-zinc-700 flex items-center justify-center shrink-0"
                              style={{ zIndex: 10 - i }}
                            >
                              {a.avatarUrl ? (
                                <img src={a.avatarUrl} alt={a.name} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-[9px] font-medium text-zinc-300">
                                  {a.name?.charAt(0).toUpperCase()}
                                </span>
                              )}
                            </span>
                          ))}
                        </span>
                      )}

                      {/* ↵ Enter icon on selection */}
                      {isSelected && (
                        <CornerDownLeft className="w-3 h-3 text-zinc-500 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Boards section */}
            {visibleBoards.length > 0 && (
              <div>
                <div className="px-3 pt-2 pb-0.5 text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
                  Boards
                </div>
                {visibleBoards.map((board, idx) => {
                  const flatIdx = boardStartIndex + idx;
                  const isSelected = flatIdx === selectedIndex;
                  return (
                    <button
                      key={board.id}
                      className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors group ${
                        isSelected
                          ? 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-300 hover:bg-zinc-800/60'
                      }`}
                      onMouseEnter={() => setSelectedIndex(flatIdx)}
                      onMouseDown={e => { e.preventDefault(); selectItem(board); }}
                    >
                      {/* Board color swatch / icon */}
                      <span
                        className="w-4 h-4 rounded shrink-0 flex items-center justify-center text-white text-[10px] font-bold"
                        style={{ backgroundColor: board.color || '#3b82f6' }}
                      >
                        {board.icon ? board.icon : <Layout className="w-2.5 h-2.5" />}
                      </span>

                      {/* Board name */}
                      <span className="flex-1 truncate font-medium text-[13px]">
                        {board.name}
                      </span>

                      {/* ↵ icon on selection */}
                      {isSelected && (
                        <CornerDownLeft className="w-3 h-3 text-zinc-500 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Query input display (read-only, shows what's typed after @) ─────── */}
      <div className="px-3 py-2 border-t border-zinc-800/60 flex items-center gap-2">
        <span className="text-[11px] text-zinc-600">@</span>
        <span className="text-[11px] text-zinc-400 flex-1 truncate">
          {props.query || <span className="italic text-zinc-600">Search tasks and boards…</span>}
        </span>
        <span className="text-[10px] text-zinc-600">
          {flatItems.length} result{flatItems.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
});

TaskListDropdown.displayName = 'TaskListDropdown';
