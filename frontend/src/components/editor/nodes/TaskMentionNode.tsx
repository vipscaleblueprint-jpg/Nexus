import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import React, { useEffect, useState, useRef } from 'react';
import { tasksApi, usersApi, spacesApi } from '@/api';
import { PortalDropdown } from '@/components/ui/PortalDropdown';
import { toast } from '@/lib/toast';
import { Flag, User as UserIcon, CheckCircle2, AlignLeft } from 'lucide-react';
import { useAppStore } from '@/lib/store';

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

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-zinc-400',
  MEDIUM: 'text-blue-400',
  HIGH: 'text-orange-400',
  URGENT: 'text-red-400',
};

const getStatusColor = (status: string) => STATUS_COLORS[status] || '#3b82f6';

export const TaskMentionNode = (props: NodeViewProps) => {
  const { node, updateAttributes } = props;
  const { id, label, mentionType, taskStatus, taskAssignees, taskPriority, taskHasDescription } = node.attrs;

  const currentUser = useAppStore(s => s.currentUser);
  
  const [taskData, setTaskData] = useState<any>(null);
  const [openDropdown, setOpenDropdown] = useState<'status' | 'assignee' | 'priority' | 'description' | null>(null);
  const [dbUsers, setDbUsers] = useState<any[]>([]);
  const [listStatuses, setListStatuses] = useState<any[]>([]);

  const statusRef = useRef<HTMLSpanElement>(null);
  const priorityRef = useRef<HTMLSpanElement>(null);
  const assigneesRef = useRef<HTMLSpanElement>(null);
  const descTriggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (mentionType !== 'status' && id) {
      tasksApi.getTask(id).then(({ task }) => {
        if (!task) return;
        setTaskData(task);
        let currentStatusName = '';
        try {
          if (taskStatus && taskStatus.startsWith('{')) {
            currentStatusName = JSON.parse(taskStatus).name;
          } else {
            currentStatusName = taskStatus;
          }
        } catch (e) {}

        const shouldUpdate = currentStatusName !== task.status || 
          taskPriority !== task.priority || 
          (!taskAssignees && task.assignees && task.assignees.length > 0) ||
          taskHasDescription !== !!task.description;

        if (shouldUpdate) {
          updateAttributes({
            taskStatus: JSON.stringify({ name: task.status, color: getStatusColor(task.status) }),
            taskAssignees: JSON.stringify(task.assignees || []),
            taskPriority: task.priority || '',
            taskHasDescription: !!task.description
          });
        }
      }).catch(() => {});
    }
  }, [id, mentionType, updateAttributes]);

  useEffect(() => {
    let cancelled = false;
    if (openDropdown === 'assignee' && dbUsers.length === 0) {
      usersApi.getUsers().then(res => {
        if (!cancelled && res?.users) setDbUsers(res.users);
      }).catch(console.error);
    } else if (openDropdown === 'status' && listStatuses.length === 0 && taskData?.listId) {
      spacesApi.getList(taskData.listId).then(res => {
        if (!cancelled && res?.list?.statuses) {
          setListStatuses(res.list.statuses);
        }
      }).catch(console.error);
    }
    return () => { cancelled = true; };
  }, [openDropdown, dbUsers.length, listStatuses.length, taskData?.listId]);
  
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

  const handleStatusChange = async (newStatus: string) => {
    if (!currentUser || !taskData) return;
    try {
      await tasksApi.moveTask(id, newStatus, taskData.listId, currentUser.id);
      updateAttributes({ taskStatus: JSON.stringify({ name: newStatus, color: getStatusColor(newStatus) }) });
      toast.success('Status updated');
    } catch (e: any) {
      toast.error(e.message || 'Failed to update status');
    }
    setOpenDropdown(null);
  };

  const handlePriorityChange = async (p: string | null) => {
    if (!currentUser) return;
    updateAttributes({ taskPriority: p || '' });
    setOpenDropdown(null);
    try {
      await tasksApi.updateTask(id, { priority: (p || undefined) as any, userId: currentUser.id });
      toast.success('Priority updated');
    } catch (e: any) {
      toast.error('Failed to update priority');
    }
  };

  const handleAssigneeToggle = async (user: any) => {
    if (!currentUser) return;
    const isAssigned = assignees.some(a => a.id === user.id);
    let newAssignees = [];
    if (isAssigned) {
      newAssignees = assignees.filter(a => a.id !== user.id);
    } else {
      newAssignees = [...assignees, user];
    }
    updateAttributes({ taskAssignees: JSON.stringify(newAssignees) });
    try {
      await tasksApi.updateTask(id, { assigneeIds: newAssignees.map(a => a.id), userId: currentUser.id });
    } catch (e) {
      toast.error('Failed to update assignees');
    }
  };

  return (
    <NodeViewWrapper as="span" className="inline-block align-middle mx-1 group" data-drag-handle>
      <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md hover:bg-zinc-100 dark:hover:bg-[#1f1f1f] transition-colors duration-200 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-800">
        
        <span 
          className="font-medium text-sm text-zinc-700 dark:text-zinc-200 max-w-[200px] truncate cursor-pointer hover:opacity-70 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: id } }));
          }}
          title="Open Task Detail"
        >
          {label}
        </span>

        <span
          ref={descTriggerRef}
          className="cursor-pointer hover:opacity-70 transition-opacity flex items-center justify-center p-0.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 rounded"
          onClick={(e) => {
            e.stopPropagation();
            setOpenDropdown(openDropdown === 'description' ? null : 'description');
          }}
          title="Task Description"
        >
          <AlignLeft className="w-3.5 h-3.5" />
        </span>

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

        <span 
          ref={priorityRef}
          className={`flex items-center justify-center w-5 h-5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer transition-colors ${PRIORITY_COLORS[taskPriority] || 'text-zinc-500'}`}
          onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'priority' ? null : 'priority'); }}
          title={taskPriority ? `${taskPriority} Priority` : 'Set Priority'}
        >
          <Flag className="w-3 h-3" />
        </span>

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
            <span className="w-5 h-5 rounded-full border-2 border-white dark:border-zinc-800 border-dashed text-zinc-400 hover:text-zinc-200 flex items-center justify-center bg-transparent z-10 shrink-0 hover:bg-zinc-800 transition-colors">
              <UserIcon className="w-3 h-3" />
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
                onClick={() => handleStatusChange(s.name)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-700/50 flex items-center gap-2"
              >
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-zinc-300">{s.name}</span>
                {s.name === parsedStatusName && <CheckCircle2 className="w-3 h-3 text-blue-400 ml-auto" />}
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
                onClick={() => handlePriorityChange(p.id)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-700/50 flex items-center gap-2 group"
              >
                <Flag className={`w-3.5 h-3.5 ${p.color}`} />
                <span className="text-zinc-300 group-hover:text-white transition-colors">{p.label}</span>
                {p.id === taskPriority && <CheckCircle2 className="w-3 h-3 text-blue-400 ml-auto" />}
              </button>
            ))}
          </div>
        </PortalDropdown>
      )}

      {openDropdown === 'description' && (
        <PortalDropdown triggerRef={descTriggerRef} onClose={() => setOpenDropdown(null)}>
          <div className="w-64 p-3">
            <div className="font-semibold mb-1.5 text-xs text-zinc-100 uppercase tracking-wider">Deliverables:</div>
            <div 
              className="text-sm text-zinc-300 prose prose-invert prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: taskData?.description || 'No deliverables specified.' }} 
            />
          </div>
        </PortalDropdown>
      )}

      {openDropdown === 'assignee' && (
        <PortalDropdown triggerRef={assigneesRef} onClose={() => setOpenDropdown(null)}>
          <div className="w-48 py-1 max-h-60 overflow-y-auto custom-scrollbar">
            <div className="px-2 py-1.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Assignees</div>
            {dbUsers.map(user => {
              const isAssigned = assignees.some(a => a.id === user.id);
              return (
                <button
                  key={user.id}
                  onClick={() => handleAssigneeToggle(user)}
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
                  {isAssigned && <CheckCircle2 className="w-3 h-3 text-blue-400 ml-auto shrink-0" />}
                </button>
              );
            })}
          </div>
        </PortalDropdown>
      )}
    </NodeViewWrapper>
  );
};
