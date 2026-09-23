import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import React, { useEffect, useState, useRef } from 'react';
import { tasksApi } from '@/api/tasks';
import { usersApi, spacesApi } from '@/api';
import { PortalDropdown } from '@/components/ui/PortalDropdown';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';
import { BlockEditor } from '@/components/ui/BlockEditor';
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
const getStatusColor = (status: string) => STATUS_COLORS[status] || '#3b82f6';

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-zinc-400',
  MEDIUM: 'text-blue-400',
  HIGH: 'text-orange-400',
  URGENT: 'text-red-400',
};

const LiveTaskItem = ({ task, currentUser }: { task: any, currentUser: any }) => {
  const [openDropdown, setOpenDropdown] = useState<'status' | 'assignee' | 'priority' | 'description' | null>(null);
  const [dbUsers, setDbUsers] = useState<any[]>([]);
  const [listStatuses, setListStatuses] = useState<any[]>([]);
  const [optimisticTask, setOptimisticTask] = useState<any>({});
  const lastOptimisticTime = useRef<number>(0);

  const [localDesc, setLocalDesc] = useState(task.description || '');
  useEffect(() => {
    setLocalDesc(task.description || '');
    if (Date.now() - lastOptimisticTime.current > 3000) {
      setOptimisticTask({});
    }
  }, [task]);

  const handleDescBlur = () => {
    if (localDesc !== currentTask.description) {
      lastOptimisticTime.current = Date.now();
      tasksApi.updateTask(currentTask.id, { description: localDesc, userId: currentUser?.id }).catch(err => console.error(err));
      setOptimisticTask((prev: any) => ({ ...prev, description: localDesc }));
    }
  };

  const statusRef = useRef<HTMLSpanElement>(null);
  const priorityRef = useRef<HTMLSpanElement>(null);
  const assigneesRef = useRef<HTMLSpanElement>(null);
  const descTriggerRef = useRef<HTMLSpanElement>(null);

  const currentTask = { ...task, ...optimisticTask };

  useEffect(() => {
    let cancelled = false;
    if (openDropdown === 'assignee' && dbUsers.length === 0) {
      usersApi.getUsers().then(res => { if (!cancelled && res?.users) setDbUsers(res.users); }).catch(console.error);
    } else if (openDropdown === 'status' && listStatuses.length === 0 && currentTask.listId) {
      spacesApi.getList(currentTask.listId).then(res => {
        if (!cancelled && res?.list?.statuses) setListStatuses(res.list.statuses);
      }).catch(console.error);
    }
    return () => { cancelled = true; };
  }, [openDropdown, dbUsers.length, listStatuses.length, currentTask.listId]);

  let parsedStatusName = currentTask.status;
  let parsedStatusColor = '#3b82f6';
  try {
    if (currentTask.status && typeof currentTask.status === 'string' && currentTask.status.startsWith('{')) {
      const parsed = JSON.parse(currentTask.status);
      parsedStatusName = parsed.name || parsed.NAME || currentTask.status;
      parsedStatusColor = parsed.color || parsed.COLOR || '#3b82f6';
    } else if (currentTask.status && typeof currentTask.status === 'object') {
      parsedStatusName = currentTask.status.name || currentTask.status.NAME || 'Unknown';
      parsedStatusColor = currentTask.status.color || currentTask.status.COLOR || '#3b82f6';
    }
  } catch (e) { }
  const assignees = currentTask.assignees || [];

  const handleStatusChange = async (newStatus: string) => {
    if (!currentUser) return;
    lastOptimisticTime.current = Date.now();
    setOptimisticTask((prev: any) => ({ ...prev, status: JSON.stringify({ name: newStatus, color: getStatusColor(newStatus) }) }));
    setOpenDropdown(null);
    try {
      await tasksApi.moveTask(currentTask.id, newStatus, currentTask.listId, currentUser.id);
      toast.success('Status updated');
      setTimeout(() => window.dispatchEvent(new CustomEvent('task_activity')), 500);
    } catch (e: any) {
      toast.error(e.message || 'Failed to update status');
      setOptimisticTask({});
    }
  };

  const handlePriorityChange = async (p: string | null) => {
    if (!currentUser) return;
    lastOptimisticTime.current = Date.now();
    setOptimisticTask((prev: any) => ({ ...prev, priority: p }));
    setOpenDropdown(null);
    try {
      await tasksApi.updateTask(currentTask.id, { priority: (p || undefined) as any, userId: currentUser.id });
      toast.success('Priority updated');
      setTimeout(() => window.dispatchEvent(new CustomEvent('task_activity')), 500);
    } catch (e: any) {
      toast.error('Failed to update priority');
      setOptimisticTask({});
    }
  };

  const handleAssigneeToggle = async (user: any) => {
    if (!currentUser) return;
    const isAssigned = assignees.some((a: any) => a.id === user.id);
    let newAssignees = [];
    if (isAssigned) newAssignees = assignees.filter((a: any) => a.id !== user.id);
    else newAssignees = [...assignees, user];

    lastOptimisticTime.current = Date.now();
    setOptimisticTask((prev: any) => ({ ...prev, assignees: newAssignees }));
    try {
      await tasksApi.updateTask(currentTask.id, { assigneeIds: newAssignees.map((a: any) => a.id), userId: currentUser.id });
      setTimeout(() => window.dispatchEvent(new CustomEvent('task_activity')), 500);
    } catch (e) {
      toast.error('Failed to update assignees');
      setOptimisticTask({});
    }
  };

  return (
    <div key={currentTask.id} className="py-0.5">
      <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md hover:bg-zinc-100 dark:hover:bg-[#1f1f1f] transition-colors duration-200 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-800 group">

        <span
          className="font-medium text-sm text-zinc-700 dark:text-zinc-200 max-w-[200px] truncate cursor-pointer hover:opacity-70 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: currentTask.id, task: currentTask } }));
          }}
          title="Open Task Detail"
        >
          {currentTask.title}
        </span>

        {currentTask.description !== undefined && (
          <span
            ref={descTriggerRef}
            className="cursor-pointer hover:opacity-70 transition-opacity flex items-center justify-center p-0.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 rounded"
            title="Task Description"
            onClick={(e) => {
              e.stopPropagation();
              setOpenDropdown(openDropdown === 'description' ? null : 'description');
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="21" x2="3" y1="6" y2="6" />
              <line x1="15" x2="3" y1="12" y2="12" />
              <line x1="17" x2="3" y1="18" y2="18" />
            </svg>
          </span>
        )}

        {parsedStatusName && (
          <span
            ref={statusRef}
            className="px-1.5 py-[1px] rounded text-[10px] font-bold uppercase tracking-wider text-white shrink-0 ml-1 cursor-pointer hover:opacity-80 transition-opacity"
            style={{ backgroundColor: parsedStatusColor }}
            onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'status' ? null : 'status'); }}
          >
            {parsedStatusName}
          </span>
        )}

        {currentTask.priority && (
          <span
            ref={priorityRef}
            className={`flex items-center justify-center w-5 h-5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer transition-colors ${PRIORITY_COLORS[currentTask.priority] || 'text-zinc-500'}`}
            title={`${currentTask.priority} Priority`}
            onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'priority' ? null : 'priority'); }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" x2="4" y1="22" y2="15" />
            </svg>
          </span>
        )}

        <span
          ref={assigneesRef}
          className="inline-flex items-center -space-x-1 shrink-0 ml-0.5 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'assignee' ? null : 'assignee'); }}
        >
          {assignees.length > 0 ? (
            <>
              {assignees.slice(0, 3).map((user: any) => (
                <span key={user.id} className="w-5 h-5 rounded-full overflow-hidden border-2 border-white dark:border-[#1a1a1a] z-10 shrink-0 bg-zinc-200 dark:bg-zinc-600 flex items-center justify-center">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover rounded-full" />
                  ) : (
                    <span className="text-[9px] font-medium text-zinc-700 dark:text-zinc-300">
                      {user.name?.charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
              ))}
              {assignees.length > 3 && (
                <span className="w-5 h-5 rounded-full border-2 border-white dark:border-[#1a1a1a] bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[9px] font-medium z-10 shrink-0">
                  +{assignees.length - 3}
                </span>
              )}
            </>
          ) : (
            <span className="w-5 h-5 rounded-full border-2 border-white dark:border-zinc-800 border-dashed text-zinc-400 hover:text-zinc-200 flex items-center justify-center bg-transparent z-10 shrink-0 cursor-pointer hover:bg-zinc-800 transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
            </span>
          )}
        </span>
      </span>

      {openDropdown === 'status' && (
        <PortalDropdown triggerRef={statusRef} onClose={() => setOpenDropdown(null)}>
          <div className="w-48 py-1">
            <div className="px-2 py-1.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Change Status</div>
            {listStatuses.length > 0 ? listStatuses.map(s => (
              <button
                key={s.id}
                onClick={(e) => { e.stopPropagation(); handleStatusChange(s.name); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-700/50 flex items-center gap-2"
              >
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-zinc-300">{s.name}</span>
                {s.name === parsedStatusName && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 ml-auto"><polyline points="20 6 9 17 4 12"></polyline></svg>}
              </button>
            )) : (
              <div className="px-3 py-2 text-xs text-zinc-500 italic">Loading statuses...</div>
            )}
          </div>
        </PortalDropdown>
      )}

      {openDropdown === 'priority' && (
        <PortalDropdown triggerRef={priorityRef} onClose={() => setOpenDropdown(null)}>
          <div className="w-40 py-1">
            <div className="px-2 py-1.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Priority</div>
            {[
              { id: 'URGENT', label: 'Urgent', color: 'text-red-400' },
              { id: 'HIGH', label: 'High', color: 'text-orange-400' },
              { id: 'MEDIUM', label: 'Medium', color: 'text-blue-400' },
              { id: 'LOW', label: 'Low', color: 'text-zinc-400' },
              { id: null, label: 'Clear Priority', color: 'text-zinc-500' }
            ].map(p => (
              <button
                key={p.id || 'clear'}
                onClick={(e) => { e.stopPropagation(); handlePriorityChange(p.id); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-700/50 flex items-center gap-2 group"
              >
                <span className={p.color}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" x2="4" y1="22" y2="15" /></svg>
                </span>
                <span className="text-zinc-300 group-hover:text-white transition-colors">{p.label}</span>
                {p.id === currentTask.priority && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 ml-auto"><polyline points="20 6 9 17 4 12"></polyline></svg>}
              </button>
            ))}
          </div>
        </PortalDropdown>
      )}

      {openDropdown === 'description' && (
        <PortalDropdown triggerRef={descTriggerRef} onClose={() => setOpenDropdown(null)}>
          <div className="w-[400px] p-3 max-h-[400px] overflow-y-auto custom-scrollbar relative">
            <div className="font-semibold mb-2 text-xs text-zinc-100 uppercase tracking-wider">Description:</div>
            <div className="relative group cursor-text p-2 -mx-2 hover:bg-zinc-800/20 rounded-lg transition-colors">
              <BlockEditor
                content={localDesc}
                onChange={(html) => setLocalDesc(html)}
                onBlur={handleDescBlur}
                editable={true}
              />
              {(!localDesc || localDesc === '<p></p>' || localDesc === '<p><br></p>') && (
                <div className="absolute top-2 left-2 text-sm text-zinc-500 italic pointer-events-none">
                  Add description...
                </div>
              )}
            </div>
          </div>
        </PortalDropdown>
      )}

      {openDropdown === 'assignee' && (
        <PortalDropdown triggerRef={assigneesRef} onClose={() => setOpenDropdown(null)}>
          <div className="w-48 py-1 max-h-60 overflow-y-auto custom-scrollbar">
            <div className="px-2 py-1.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Assignees</div>
            {dbUsers.map(user => {
              const isAssigned = assignees.some((a: any) => a.id === user.id);
              return (
                <button
                  key={user.id}
                  onClick={(e) => { e.stopPropagation(); handleAssigneeToggle(user); }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-700/50 flex items-center gap-2 group"
                >
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.name} className="w-5 h-5 rounded-full object-cover" />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-zinc-700 flex items-center justify-center text-[9px] font-medium text-zinc-300">
                      {user.name?.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="text-zinc-300 group-hover:text-white transition-colors truncate">{user.name}</span>
                  {isAssigned && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 ml-auto shrink-0"><polyline points="20 6 9 17 4 12"></polyline></svg>}
                </button>
              );
            })}
          </div>
        </PortalDropdown>
      )}
    </div>
  );
};

export const LiveKanbanBlockNode = (props: NodeViewProps) => {
  const { node, updateAttributes, editor } = props;
  const { currentUser } = useAppStore();
  const { blockType, assigneeName, listId, frozenData } = node.attrs;
  let initialData = null;
  try {
    if (typeof frozenData === 'string' && frozenData.startsWith('{')) {
      initialData = JSON.parse(frozenData);
    } else if (typeof frozenData === 'object' && frozenData !== null) {
      initialData = frozenData;
    }
  } catch (e) { }

  const [data, setData] = useState<any>(initialData);
  const [loading, setLoading] = useState(false);

  const isClosed = !editor.isEditable;

  useEffect(() => {
    if (isClosed) {
      return;
    }

    let mounted = true;
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await tasksApi.getLiveBlocksData(blockType, assigneeName, '', listId);
        if (mounted) {
          setData(res.blocks);
          const newFrozen = JSON.stringify(res.blocks);
          const oldFrozen = typeof frozenData === 'string' ? frozenData : JSON.stringify(frozenData);
          if (newFrozen !== oldFrozen) {
            updateAttributes({ frozenData: res.blocks });
          }
        }
      } catch (e) {
        console.error('Failed to fetch live kanban block', e);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30 * 60 * 1000); // 30 mins
    window.addEventListener('task_activity', fetchData);
    return () => {
      mounted = false;
      clearInterval(interval);
      window.removeEventListener('task_activity', fetchData);
    };
  }, [isClosed, blockType, assigneeName, listId, updateAttributes]);

  const renderTaskLikeMention = (task: any) => {
    return <LiveTaskItem key={task.id} task={task} currentUser={currentUser} />;
  };

  return (
    <NodeViewWrapper
      className={blockType === 'plain-list' || blockType === 'daily-report'
        ? "live-kanban-block-plain"
        : "kanban-live-block my-4 p-4 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-zinc-50/50 dark:bg-zinc-900/50"}
      data-drag-handle
    >
      {blockType !== 'plain-list' && blockType !== 'daily-report' && (
        <div className="flex items-center justify-between mb-4 border-b border-zinc-200 dark:border-zinc-800 pb-3" contentEditable={false}>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2 m-0">
            {blockType === 'newtasks' ? '🆕 New Tasks' : '📊 Status Board'}
            {assigneeName && <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs">{assigneeName}</span>}
          </h3>
          <div className="flex items-center gap-2">
            {loading && <span className="text-xs text-zinc-500 animate-pulse">Syncing...</span>}
            {isClosed && <span className="text-xs text-zinc-500 font-medium bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 rounded">Historical</span>}
          </div>
        </div>
      )}

      <div contentEditable={false}>
        {data ? (
          blockType === 'daily-report' ? (
            <div className="space-y-6 py-2">
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2 m-0">🚨 Priorities for Today</h2>
                {Object.keys(data.priorities || {}).length === 0 ? (
                  <p className="text-sm text-zinc-500 italic m-0">No priorities</p>
                ) : (
                  Object.entries(data.priorities).map(([assigneeName, tasks]: [string, any]) => (
                    <div key={assigneeName} className="space-y-1">
                      <h3 className="text-sm font-bold text-zinc-200 m-0 pt-2 flex items-center gap-2">
                        <span className="text-zinc-500">•</span> {assigneeName}
                      </h3>
                      {tasks.map((task: any) => renderTaskLikeMention(task))}
                    </div>
                  ))
                )}
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2 m-0 mt-6">👀 ACTIVE CLIENT</h2>
                {Object.keys(data.clients || {}).length === 0 ? (
                  <p className="text-sm text-zinc-500 italic m-0">No clients</p>
                ) : (
                  Object.entries(data.clients).map(([listName, tasks]: [string, any]) => (
                    <div key={listName} className="space-y-1">
                      <h3 className="text-sm font-bold text-zinc-200 m-0 pt-2 flex items-center gap-2">
                        <span className="text-zinc-500">•</span> {listName}
                      </h3>
                      {tasks.map((task: any) => renderTaskLikeMention(task))}
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : blockType === 'plain-list' ? (
            <div className="space-y-0.5">
              {Object.keys(data).length === 0 ? (
                <p className="text-sm text-zinc-500 italic m-0">No tasks</p>
              ) : (
                Object.values(data).flat().map((task: any) => renderTaskLikeMention(task))
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {Object.keys(data).length === 0 ? (
                <p className="text-sm text-zinc-500 italic m-0">No tasks found.</p>
              ) : (
                Object.entries(data).map(([status, tasks]: [string, any]) => (
                  <div key={status} className="space-y-2">
                    <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider m-0">{status} ({tasks.length})</h4>
                    <ul className="space-y-1 m-0 p-0 list-none">
                      {Array.isArray(tasks) && tasks.map((task: any) => renderTaskLikeMention(task))}
                    </ul>
                    {tasks.length === 0 && <p className="text-xs text-zinc-400 italic m-0">No tasks</p>}
                  </div>
                ))
              )}
            </div>
          )
        ) : (
          <div className="text-sm text-zinc-500 italic">Loading tasks...</div>
        )}
      </div>
    </NodeViewWrapper>
  );
};
