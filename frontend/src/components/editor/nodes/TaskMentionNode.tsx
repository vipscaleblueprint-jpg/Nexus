import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import React, { useEffect } from 'react';
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

export const TaskMentionNode = (props: NodeViewProps) => {
  const { node, updateAttributes } = props;
  const { id, label, mentionType, taskStatus, taskAssignees } = node.attrs;

  useEffect(() => {
    if (mentionType !== 'status' && id) {
      tasksApi.getTask(id).then(({ task }) => {
        if (!task) return;
        let currentStatusName = '';
        try {
          if (taskStatus && taskStatus.startsWith('{')) {
            currentStatusName = JSON.parse(taskStatus).name;
          } else {
            currentStatusName = taskStatus;
          }
        } catch (e) {}

        if (currentStatusName !== task.status) {
          updateAttributes({
            taskStatus: JSON.stringify({ name: task.status, color: getStatusColor(task.status) }),
            taskAssignees: JSON.stringify(task.assignees || [])
          });
        }
      }).catch(() => {});
    }
  }, [id, mentionType, taskStatus, updateAttributes]);
  
  if (mentionType === 'status') {
    let statusObj = null;
    try {
      if (taskStatus) statusObj = JSON.parse(taskStatus);
    } catch (e) {}

    const headerColor = statusObj?.color || '#3b82f6';
    const statusName = statusObj?.name || label || 'STATUS';

    const gradientStyle = {
      background: `linear-gradient(90deg, ${headerColor} 0%, ${headerColor}cc 100%)`,
      color: '#fff',
    };

    return (
      <NodeViewWrapper as="span" className="inline-block align-middle mx-1 cursor-pointer hover:opacity-90 transition-opacity" data-drag-handle>
        <span 
          className="inline-flex items-center pl-2 pr-2 py-0.5 rounded-sm uppercase font-bold text-[10px] tracking-wide"
          style={gradientStyle}
        >
          {statusName}
        </span>
      </NodeViewWrapper>
    );
  }

  // Task Mention UI
  let assignees: any[] = [];
  let parsedStatusName = taskStatus;
  let parsedStatusColor = '#3b82f6'; // default blue

  try {
    if (taskAssignees) {
      assignees = JSON.parse(taskAssignees);
    }
  } catch (e) {}

  try {
    if (taskStatus && typeof taskStatus === 'string' && taskStatus.startsWith('{')) {
      const parsed = JSON.parse(taskStatus);
      parsedStatusName = parsed.name || parsed.NAME || taskStatus;
      parsedStatusColor = parsed.color || parsed.COLOR || '#3b82f6';
    }
  } catch (e) {}

  return (
    <NodeViewWrapper as="span" className="inline-block align-middle mx-1 cursor-pointer group" data-drag-handle>
      <span 
        className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md hover:bg-zinc-100 dark:hover:bg-[#1f1f1f] transition-colors duration-200"
        onClick={() => window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: id } }))}
      >
        <span className="flex items-center text-zinc-400 group-hover:text-blue-500 transition-colors shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <circle cx="12" cy="12" r="3" className="fill-current"></circle>
          </svg>
        </span>
        <span className="font-medium text-sm text-zinc-700 dark:text-zinc-200 max-w-[200px] truncate">
          {label}
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
    </NodeViewWrapper>
  );
};
