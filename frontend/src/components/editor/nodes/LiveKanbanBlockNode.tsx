import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import React, { useEffect, useState } from 'react';
import { tasksApi } from '@/api/tasks';

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

export const LiveKanbanBlockNode = (props: NodeViewProps) => {
  const { node, updateAttributes, editor } = props;
  const { blockType, assigneeName, listId, frozenData } = node.attrs;
  let initialData = null;
  try {
    if (typeof frozenData === 'string' && frozenData.startsWith('{')) {
      initialData = JSON.parse(frozenData);
    } else if (typeof frozenData === 'object' && frozenData !== null) {
      initialData = frozenData;
    }
  } catch (e) {}

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
          updateAttributes({ frozenData: res.blocks });
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
        let parsedStatusName = task.status;
        let parsedStatusColor = '#3b82f6';
        try {
          if (task.status && typeof task.status === 'string' && task.status.startsWith('{')) {
            const parsed = JSON.parse(task.status);
            parsedStatusName = parsed.name || parsed.NAME || task.status;
            parsedStatusColor = parsed.color || parsed.COLOR || '#3b82f6';
          }
        } catch (e) {}

        const assignees = task.assignees || [];

        return (
          <div key={task.id} className="py-0.5">
            <span 
              className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md hover:bg-zinc-100 dark:hover:bg-[#1f1f1f] transition-colors duration-200 cursor-pointer group"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: task.id, task: task } }));
              }}
            >
              <span className="flex items-center text-zinc-400 group-hover:text-blue-500 transition-colors shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <circle cx="12" cy="12" r="3" className="fill-current"></circle>
                </svg>
              </span>
              <span className="font-medium text-sm text-zinc-700 dark:text-zinc-200 max-w-[200px] truncate">
                {task.title}
              </span>
              {parsedStatusName && (
                <span 
                  className="px-1.5 py-[1px] rounded text-[10px] font-bold uppercase tracking-wider text-white shrink-0 ml-1"
                  style={{ backgroundColor: parsedStatusColor }}
                >
                  {parsedStatusName}
                </span>
              )}
              {assignees.length > 0 && (
                <span className="inline-flex items-center -space-x-1 shrink-0 ml-0.5">
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
                </span>
              )}
            </span>
          </div>
        );
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
