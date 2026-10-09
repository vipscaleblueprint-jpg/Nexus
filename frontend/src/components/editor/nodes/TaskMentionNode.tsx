import { STATUS_COLORS, CustomCircleDotted, CustomCircleDot, ALL_STATUSES } from '@/components/modals/TaskDetailModal';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import React, { useEffect, useState, useRef } from 'react';
import { tasksApi, usersApi } from '@/api';
import { fetchListStatuses } from '@/lib/listStatusCache';
import { loadTask } from '@/lib/taskBatchLoader';
import { PortalDropdown } from '@/components/ui/PortalDropdown';
import { toast } from '@/lib/toast';
import { Flag, User as UserIcon, CheckCircle2, CircleDashed, AlignLeft, Shield, Check, Users2, X } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { motion, AnimatePresence } from 'framer-motion';
import { Command } from 'cmdk';
import { getPriorityConfig, PRIORITY_OPTIONS } from '@/lib/priority';

const STATUS_HEX_MAP: Record<string, string> = {
  PENDING: '#D4A02A',
  'IN PROGRESS': '#D04A7C',
  DONE: '#22c55e', 
  REVISION: '#5B6BD6',
  CHECKING: '#A35DB8',
  CLOSED: '#2FA37A',
};

const getStatusColor = (status: string) => {
  if (!status) return '#3b82f6';
  
  // Directly map from known hex codes first
  const up = status.toUpperCase();
  if (STATUS_HEX_MAP[up]) return STATUS_HEX_MAP[up];

  const colorStr = STATUS_COLORS[up];
  if (!colorStr) return '#3b82f6';
  
  // Custom bg-[hex] match
  const match = colorStr.match(/bg-\[([^\]]+)\]/);
  return match ? match[1] : '#3b82f6';
};

export const TaskMentionNode = (props: NodeViewProps) => {
  const { node, updateAttributes, getPos, editor } = props;
  const { id, label, mentionType, taskStatus, taskAssignees, taskPriority, taskHasDescription, frozenTaskData, taskListName } = node.attrs;

  const currentUser = useAppStore(s => s.currentUser);
  const globalTask = useAppStore(s => s.tasksIndex[id]);
  const updateTaskStore = useAppStore(s => s.updateTask);
  
  let initialTaskData = null;
  try {
    if (typeof frozenTaskData === 'string' && frozenTaskData.startsWith('{')) {
      initialTaskData = JSON.parse(frozenTaskData);
    } else if (typeof frozenTaskData === 'object' && frozenTaskData !== null) {
      initialTaskData = frozenTaskData;
    }
  } catch (e) {}

  const [taskData, setTaskData] = useState<any>(initialTaskData);
  const [openDropdown, setOpenDropdown] = useState<'status' | 'assignee' | 'priority' | 'description' | 'team' | null>(null);
  const [fallbackListStatuses, setFallbackListStatuses] = useState<any[]>([]);

  const workspaceUsers = useAppStore(s => s.workspaceUsers);
  const workspaceTeams = useAppStore(s => s.workspaceTeams);
  const allLists = useAppStore(s => s.allLists);
  const hasLoadedUsers = useAppStore(s => s.hasLoadedUsers);
  const hasLoadedTeams = useAppStore(s => s.hasLoadedTeams);
  const loadUsers = useAppStore(s => s.loadUsers);
  const loadTeams = useAppStore(s => s.loadTeams);
  const hydrateUsersFromCache = useAppStore(s => s.hydrateUsersFromCache);
  const hydrateTeamsFromCache = useAppStore(s => s.hydrateTeamsFromCache);

  const dbUsers = workspaceUsers;
  const dbTeams = workspaceTeams;

  const assignableUsers = React.useMemo(() => {
    if (!taskData?.assigneeRoleRestrictions || taskData.assigneeRoleRestrictions.length === 0) {
      return workspaceUsers;
    }
    // Build a map of TeamRole name -> teamId for fast lookup
    const teamRoleToTeamId = new Map<string, string>();
    workspaceTeams.forEach((team: any) => {
      (team.teamRoles || []).forEach((tr: any) => {
        teamRoleToTeamId.set(tr.name.toLowerCase(), team.id);
      });
    });

    return workspaceUsers.filter((u) => {
      const userRoles = (u.roles || []) as string[];
      return taskData.assigneeRoleRestrictions.some((role: string) => {
        // Check generic role match
        if (userRoles.map(r => r.toUpperCase()).includes(role.toUpperCase())) return true;
        // Check TeamRole match
        const teamId = teamRoleToTeamId.get(role.toLowerCase());
        if (teamId && (u as any).teamId === teamId) return true;
        return false;
      });
    });
  }, [taskData?.assigneeRoleRestrictions, workspaceUsers, workspaceTeams]);
  
  const listStatuses = React.useMemo(() => {
    if (fallbackListStatuses.length > 0) return fallbackListStatuses;
    if (!taskData?.listId) return [];
    const foundObj = allLists.find((l: any) => l.list?.id === taskData.listId || l.id === taskData.listId);
    const found = foundObj?.list || foundObj;
    return found?.statuses || [];
  }, [allLists, taskData?.listId, fallbackListStatuses]);

  // Local state for read-only interactivity
  const [localStatus, setLocalStatus] = useState<string>(taskStatus || '');
  const [localPriority, setLocalPriority] = useState<string>(taskPriority || '');
  const [localAssignees, setLocalAssignees] = useState<string>(taskAssignees || '');
  const [localTeam, setLocalTeam] = useState<string>(node.attrs.taskTeam || '');

  // Sync local state when node.attrs change from outside (e.g., initial load)
  useEffect(() => {
    if (taskStatus !== localStatus) setLocalStatus(taskStatus || '');
  }, [taskStatus]);
  useEffect(() => {
    if (taskPriority !== localPriority) setLocalPriority(taskPriority || '');
  }, [taskPriority]);
  useEffect(() => {
    if (taskAssignees !== localAssignees) setLocalAssignees(taskAssignees || '');
  }, [taskAssignees]);
  useEffect(() => {
    if (node.attrs.taskTeam !== localTeam) setLocalTeam(node.attrs.taskTeam || '');
  }, [node.attrs.taskTeam]);

  const statusRef = useRef<HTMLSpanElement>(null);
  const priorityRef = useRef<HTMLSpanElement>(null);
  const assigneesRef = useRef<HTMLSpanElement>(null);
  const teamRef = useRef<HTMLSpanElement>(null);
  const descTriggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (mentionType === 'status' || !id) return;

    const handleTaskData = (task: any) => {
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

      const oldFrozen = typeof frozenTaskData === 'string' ? frozenTaskData : JSON.stringify(frozenTaskData);
      const newFrozen = JSON.stringify(task);

      const currentPriority = taskPriority || null;
      const currentTeam = node.attrs.taskTeam === 'null' ? null : node.attrs.taskTeam;
      
      const shouldUpdate = currentStatusName !== task.status || 
        currentPriority !== task.priority || 
        (!taskAssignees && task.assignees && task.assignees.length > 0) ||
        taskHasDescription !== !!task.description ||
        currentTeam !== (task.team ? JSON.stringify({ id: task.team.id, name: task.team.name, color: task.team.color }) : null) ||
        oldFrozen !== newFrozen;

      if (shouldUpdate) {
        setTimeout(() => {
          try { 
            updateAttributes({
              label: task.title,
              taskStatus: JSON.stringify({ name: task.status, color: getStatusColor(task.status) }),
              taskAssignees: JSON.stringify(task.assignees || []),
              taskPriority: task.priority || null,
              taskDueDate: task.dueDate || '',
              taskTeam: task.team ? JSON.stringify({ id: task.team.id, name: task.team.name, color: task.team.color }) : null,
              taskHasDescription: !!task.description,
              taskListName: task.list?.name || '',
              frozenTaskData: task
            }); 
          } catch (e) {}
          setLocalStatus(JSON.stringify({ name: task.status, color: getStatusColor(task.status) }));
          setLocalAssignees(JSON.stringify(task.assignees || []));
          setLocalTeam(task.team ? JSON.stringify({ id: task.team.id, name: task.team.name, color: task.team.color }) : '');
          setLocalPriority(task.priority || '');
        }, 0);
      }
    };

    if (globalTask) {
      handleTaskData(globalTask);
    } else {
      loadTask(id).then(({ task, subtask }) => {
        if (subtask && mentionType === 'subtask') {
          handleTaskData(subtask);
        } else {
          handleTaskData(task);
        }
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mentionType, globalTask]);

  // Pre-populate statuses from store cache immediately — zero network latency
  useEffect(() => {
    if (!taskData?.listId || fallbackListStatuses.length > 0) return;
    const entry = allLists.find((l: any) => l.list?.id === taskData.listId || l.id === taskData.listId);
    const cached = entry?.list || entry;
    if (cached?.statuses?.length > 0) {
      setFallbackListStatuses(cached.statuses);
      return;
    }
    let cancelled = false;
    fetchListStatuses(taskData.listId).then(statuses => {
      if (!cancelled && statuses.length > 0) setFallbackListStatuses(statuses);
    }).catch(console.error);
    return () => { cancelled = true; };
  }, [taskData?.listId, allLists]);

  useEffect(() => {
    let cancelled = false;

    if (!hasLoadedUsers && workspaceUsers.length === 0) {
      hydrateUsersFromCache();
    }
    if (!hasLoadedTeams && workspaceTeams.length === 0) {
      hydrateTeamsFromCache();
    }

    if (openDropdown === 'assignee' && (!hasLoadedUsers || workspaceUsers.length === 0)) {
      loadUsers().catch(console.error);
    } else if (openDropdown === 'team' && (!hasLoadedTeams || workspaceTeams.length === 0)) {
      loadTeams().catch(console.error);
    }
    return () => { cancelled = true; };
  }, [openDropdown, hasLoadedUsers, hasLoadedTeams, workspaceUsers.length, workspaceTeams.length, loadUsers, loadTeams, hydrateUsersFromCache, hydrateTeamsFromCache]);
  
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
      <NodeViewWrapper 
        as="span" 
        data-drag-handle 
        contentEditable={false}
        onMouseDown={(e: React.MouseEvent) => {
          // If they click a dropdown or button inside, let it handle its own click,
          // but for selection, we want to route the cursor to the right.
          // We don't preventDefault here so that onClick still fires for buttons,
          // but we do set the selection. Actually, ProseMirror also listens to mousedown.
          // By calling setTextSelection and focus, we override it.
          if (typeof getPos === 'function') {
            editor.commands.setTextSelection(getPos() + node.nodeSize);
            editor.commands.focus();
          }
        }}
      >
        <span 
          className="inline-flex items-center justify-center px-1.5 py-[2px] leading-none rounded-sm uppercase font-bold text-[10px] tracking-wide align-middle hover:opacity-90 transition-opacity"
          style={gradientStyle}
        >
          {statusName}
        </span>
        <span className="inline-block w-1 cursor-text">&#8203;</span>
      </NodeViewWrapper>
    );
  }

  // Task Mention UI
  let assignees: any[] = [];
  let parsedStatusName = localStatus;
  let parsedStatusColor = getStatusColor(parsedStatusName);
  let team: any = null;

  try {
    if (localTeam) {
      team = JSON.parse(localTeam);
    }
  } catch (e) {}

  try {
    if (localAssignees) {
      assignees = JSON.parse(localAssignees);
    }
  } catch (e) {}

  try {
    if (localStatus && typeof localStatus === 'string' && localStatus.startsWith('{')) {
      const parsed = JSON.parse(localStatus);
      parsedStatusName = parsed.name || parsed.NAME || localStatus;
      parsedStatusColor = parsed.color || parsed.COLOR || getStatusColor(parsedStatusName);
    }
  } catch (e) {}

  const handleStatusChange = async (newStatus: string) => {
    if (!currentUser || !taskData) return;
    
    // Optimistic UI updates
    const optimisticTask = { ...taskData, status: newStatus };
    updateTaskStore(optimisticTask);
    try { updateAttributes({ taskStatus: JSON.stringify({ name: newStatus, color: getStatusColor(newStatus) }) }); } catch (e) {}
    setLocalStatus(JSON.stringify({ name: newStatus, color: getStatusColor(newStatus) }));
    setOpenDropdown(null);
    
    try {
      if (mentionType === 'subtask') {
        await tasksApi.updateSubtask(taskData.taskId, id, { status: newStatus });
      } else {
        await tasksApi.moveTask(id, newStatus, taskData.listId, currentUser.id);
      }
      toast.success('Status updated');
    } catch (e: any) {
      toast.error(e.message || 'Failed to update status');
      // Revert could be added here if needed
    }
  };

  const handlePriorityChange = async (p: string | null) => {
    if (!currentUser) return;
    try { updateAttributes({ taskPriority: p || '' }); } catch (e) {}
    setLocalPriority(p || '');
    setOpenDropdown(null);
    if (taskData) {
      updateTaskStore({ ...taskData, priority: p });
    }
    try {
      if (mentionType === 'subtask') {
        await tasksApi.updateSubtask(taskData?.taskId, id, { priority: (p !== null ? p : null) as any });
      } else {
        await tasksApi.updateTask(id, { priority: (p !== null ? p : null) as any, userId: currentUser.id });
      }
      toast.success(p ? `Priority set to ${getPriorityConfig(p).label}` : 'Priority cleared');
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
    try { updateAttributes({ taskAssignees: JSON.stringify(newAssignees) }); } catch (e) {}
    setLocalAssignees(JSON.stringify(newAssignees));
    if (taskData) {
      updateTaskStore({ ...taskData, assignees: newAssignees, assigneeIds: newAssignees.map(a => a.id) });
    }
    try {
      if (mentionType === 'subtask') {
        await tasksApi.updateSubtask(taskData?.taskId, id, { assigneeIds: newAssignees.map(a => a.id) });
      } else {
        await tasksApi.updateTask(id, { assigneeIds: newAssignees.map(a => a.id), userId: currentUser.id });
      }
    } catch (e) {
      toast.error('Failed to update assignees');
    }
  };

  const handleClearAllAssignees = async () => {
    if (!currentUser) return;
    try { updateAttributes({ taskAssignees: JSON.stringify([]) }); } catch (e) {}
    setLocalAssignees(JSON.stringify([]));
    if (taskData) {
      updateTaskStore({ ...taskData, assignees: [], assigneeIds: [] });
    }
    try {
      if (mentionType === 'subtask') {
        await tasksApi.updateSubtask(taskData?.taskId, id, { assigneeIds: [] });
      } else {
        await tasksApi.updateTask(id, { assigneeIds: [], userId: currentUser.id });
      }
    } catch (e) {
      toast.error('Failed to clear assignees');
    }
    setOpenDropdown(null);
  };

  const handleTeamChange = async (selectedTeam: any) => {
    if (!currentUser) return;
    const teamStr = selectedTeam ? JSON.stringify(selectedTeam) : '';
    try { updateAttributes({ taskTeam: teamStr }); } catch (e) {}
    setLocalTeam(teamStr);
    setOpenDropdown(null);
    if (taskData) {
      updateTaskStore({ ...taskData, team: selectedTeam, teamId: selectedTeam ? selectedTeam.id : null });
    }
    try {
      if (mentionType === 'subtask') {
        await tasksApi.updateSubtask(taskData?.taskId, id, { teamId: selectedTeam ? selectedTeam.id : null });
      } else {
        await tasksApi.updateTask(id, { teamId: selectedTeam ? selectedTeam.id : null, userId: currentUser.id });
      }
      toast.success('Team updated');
    } catch (e) {
      toast.error('Failed to update team');
    }
  };

  // Resolve board/list name: prefer live taskData, fallback to stored taskListName attr
  const resolvedListName = (taskData?.list?.name) || node.attrs.taskListName || '';

  const isSubtask = mentionType === 'subtask';
  const isClosedNode = (parsedStatusName || '').toUpperCase() === 'CLOSED' || (parsedStatusName || '').toUpperCase() === 'DONE';

  return (
    <NodeViewWrapper 
      as="span" 
      data-drag-handle 
      contentEditable={false}
      onMouseDown={(e: React.MouseEvent) => {
        if (typeof getPos === 'function') {
          // Put the cursor immediately after this node when ANY part of the block is clicked
          editor.commands.setTextSelection(getPos() + node.nodeSize);
          editor.commands.focus();
        }
      }}
    >
      <motion.span layout className={`relative inline align-middle px-1.5 py-[2px] rounded-md transition-all duration-300 box-decoration-clone leading-relaxed ${isSubtask ? 'bg-[#111113] hover:bg-[#111113]/80' : 'bg-[#17171A] hover:bg-[#17171A]/80'} ${isClosedNode ? 'opacity-75' : ''}`}>
        
        {isClosedNode && (
          <div className="absolute top-1/2 left-1.5 right-1.5 h-[1.5px] bg-zinc-500/70 -translate-y-1/2 pointer-events-none z-50 rounded-full" />
        )}

        <span 
          className="inline-flex items-center justify-center shrink-0 cursor-pointer mr-1.5 align-middle transition-transform duration-300 group-hover:scale-110 relative z-10" 
          title="Open Task Detail"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: id, task: taskData } }));
          }}
        >
          {taskStatus === 'Closed' || taskStatus === 'CLOSED' || taskStatus === 'DONE' ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: parsedStatusColor, fill: 'transparent' }} />
          ) : ((taskStatus || '').toUpperCase() === 'KYC' ? (
            <CustomCircleDotted className="w-3.5 h-3.5 shrink-0" style={{ color: parsedStatusColor }} />
          ) : (
            <CustomCircleDot className="w-3.5 h-3.5 shrink-0" style={{ color: parsedStatusColor }} />
          ))}
        </span>

        <span 
          className={`cursor-pointer border-b border-transparent hover:border-zinc-500 pb-[1px] transition-all duration-300 mr-1.5 align-middle ${
            isSubtask ? 'text-[13px] font-normal text-[#A1A1AA]' : 'text-[15px] font-medium text-[#F4F4F5]'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('open-task-detail', { detail: { taskId: id, task: taskData } }));
          }}
          title="Open Task Detail"
        >
          {label}
        </span>
        


        <span
          ref={descTriggerRef}
          className="cursor-pointer hover:opacity-70 transition-opacity inline-flex items-center justify-center p-0.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 rounded mr-1.5 align-middle"
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
            className={`px-2 py-[3px] rounded text-[10px] font-bold uppercase tracking-wider text-white shrink-0 cursor-pointer hover:opacity-80 transition-opacity mr-1.5 inline-flex items-center align-middle leading-none ${isSubtask ? 'opacity-60' : ''}`}
            style={{ backgroundColor: parsedStatusColor }}
            onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'status' ? null : 'status'); }}
          >
            {parsedStatusName}
          </span>
        )}

        <span 
          ref={priorityRef}
          className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700/50 cursor-pointer transition-colors mr-1.5 align-middle"
          onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'priority' ? null : 'priority'); }}
          title={localPriority ? `${getPriorityConfig(localPriority).label} Priority` : 'Set Priority'}
        >
          <Flag className={`w-3.5 h-3.5 shrink-0 transition-colors ${
            localPriority ? getPriorityConfig(localPriority).iconColor : 'text-zinc-400 dark:text-zinc-500'
          }`} />
        </span>

        <motion.span layout
          ref={teamRef}
          className="inline-flex items-center justify-center shrink-0 cursor-pointer hover:opacity-80 transition-opacity mr-1.5 align-middle"
          onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'team' ? null : 'team'); }}
          title={taskData?.assigneeRoleRestrictions?.length ? taskData.assigneeRoleRestrictions.join(', ') : 'Assign Role'}
        >
          <AnimatePresence mode="popLayout">
            {(taskData?.assigneeRoleRestrictions && taskData.assigneeRoleRestrictions.length > 0) ? (
              taskData.assigneeRoleRestrictions.map((role: string, i: number) => {
                const colors = ['bg-purple-500', 'bg-red-500', 'bg-emerald-500', 'bg-blue-500', 'bg-amber-500', 'bg-pink-500'];
                const bgColor = colors[i % colors.length];
                return (
                  <motion.div 
                    key={role}
                    layout
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.2 }}
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white border-2 border-white dark:border-zinc-900 ${i > 0 ? '-ml-2' : ''} shadow-sm relative ${bgColor}`}
                    style={{ zIndex: 10 - i }}
                    title={role}
                  >
                    {role.substring(0, 2).toUpperCase()}
                  </motion.div>
                );
              })
            ) : (
              <motion.span 
                key="empty-team"
                layout
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                className="w-5 h-5 rounded border-2 border-white dark:border-zinc-800 border-dashed text-zinc-400 flex items-center justify-center bg-transparent z-10 shrink-0 hover:bg-zinc-800 transition-colors"
              >
                <Shield className="w-3 h-3" />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.span>

        <motion.span layout
          ref={assigneesRef}
          className="inline-flex items-center -space-x-1 shrink-0 cursor-pointer hover:opacity-80 transition-opacity align-middle"
          onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'assignee' ? null : 'assignee'); }}
        >
          <AnimatePresence mode="popLayout">
            {assignees.length > 0 ? (
              assignees.slice(0, 3).map((user: any, i: number) => (
                <motion.span 
                  key={user.id} 
                  layout
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ duration: 0.2 }}
                  className="w-5 h-5 rounded-full overflow-hidden border-2 border-white dark:border-zinc-900 z-10 shrink-0 bg-zinc-200 dark:bg-zinc-600 flex items-center justify-center relative shadow-sm"
                  style={{ zIndex: 10 - i, marginLeft: i > 0 ? '-4px' : '0' }}
                >
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover rounded-full" />
                  ) : (
                    <span className="text-[9px] font-medium text-zinc-700 dark:text-zinc-300">
                      {user.name?.charAt(0).toUpperCase()}
                    </span>
                  )}
                </motion.span>
              ))
            ) : (
              <motion.span 
                key="empty-assignees"
                layout
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                className="w-5 h-5 rounded border-2 border-white dark:border-zinc-800 border-dashed text-zinc-400 flex items-center justify-center bg-transparent z-10 shrink-0 hover:bg-zinc-800 transition-colors"
              >
                <Users2 className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.span>
      </motion.span>
      <span className="inline-block w-1 cursor-text">&#8203;</span>

      {openDropdown === 'status' && (
        <PortalDropdown triggerRef={statusRef} onClose={() => setOpenDropdown(null)}>
          <div className="z-[9999] w-48 p-1.5 bg-popover border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl outline-none flex flex-col gap-0.5">
            <div className="px-2.5 py-1.5 text-[10px] font-bold text-zinc-500 uppercase tracking-wider shrink-0">Change Status</div>
            <div className="max-h-60 overflow-y-auto custom-scrollbar flex flex-col gap-0.5 pr-1">
              {(listStatuses.length > 0 ? listStatuses.map((s: any) => s.name) : ALL_STATUSES).map((statusName: string) => {
                const isActive = statusName === parsedStatusName;
                const customObj = listStatuses.find((s: any) => (s.name || s.status || s.title) === statusName);
                const colorHex = customObj?.color || getStatusColor(statusName);
                return (
                  <button
                    key={statusName}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleStatusChange(statusName); }}
                    className={`w-full text-left flex items-center gap-2.5 px-2.5 py-2 text-sm rounded-lg cursor-pointer transition-colors ${
                      isActive ? 'bg-blue-500/10 text-blue-400' : 'text-zinc-600 dark:text-zinc-300 hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    {(statusName || '').toUpperCase() === 'KYC' ? (
                      <CustomCircleDotted className="w-3.5 h-3.5 shrink-0" style={{ color: colorHex }} />
                    ) : (
                      <CustomCircleDot className="w-3.5 h-3.5 shrink-0" style={{ color: colorHex }} />
                    )}
                    <span>{statusName}</span>
                    {isActive && <Check className="w-4 h-4 ml-auto text-blue-500 opacity-70" />}
                  </button>
                );
              })}
            </div>
          </div>
        </PortalDropdown>
      )}


      {openDropdown === 'priority' && (
        <PortalDropdown triggerRef={priorityRef} onClose={() => setOpenDropdown(null)}>
          <div className="z-[9999] w-36 p-1.5 bg-popover border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl outline-none flex flex-col gap-0.5">
            <div className="px-2.5 py-1.5 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Priority</div>
            {PRIORITY_OPTIONS.map((p) => (
              <button
                key={p}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handlePriorityChange(p); }}
                className={`w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors cursor-pointer ${localPriority === p ? 'bg-accent' : 'hover:bg-accent'}`}
              >
                <Flag className={`w-3.5 h-3.5 shrink-0 ${getPriorityConfig(p).iconColor}`} />
                <span className={`font-medium ${getPriorityConfig(p).color}`}>{getPriorityConfig(p).label}</span>
                {localPriority === p && <Check className="w-4 h-4 ml-auto text-blue-500" />}
              </button>
            ))}
            {localPriority && (
              <div className="border-t border-zinc-200 dark:border-zinc-800/60 mt-1 pt-1">
                <button
                  className="w-full text-left flex items-center gap-2.5 px-2.5 py-2 hover:bg-accent hover:text-accent-foreground rounded-lg text-sm text-zinc-500 dark:text-zinc-400 transition-colors cursor-pointer"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handlePriorityChange(null); }}
                >
                  <Flag className="w-3.5 h-3.5 shrink-0 text-zinc-500 dark:text-zinc-400" />
                  <span>Clear Priority</span>
                </button>
              </div>
            )}
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
          <div className="bg-card border border-zinc-800/80 rounded-lg shadow-2xl w-[260px] overflow-hidden flex flex-col text-zinc-100 z-[100] animate-in fade-in zoom-in-95 duration-100">
            <Command className="flex flex-col w-full bg-transparent">
              <Command.Input 
                autoFocus 
                className="flex-1 w-full bg-transparent border-b border-zinc-800/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-500" 
                placeholder="Search assignee..." 
              />
              <Command.List className="max-h-[260px] overflow-y-auto p-1.5 custom-scrollbar">
                <Command.Empty className="py-4 text-center text-sm text-zinc-500">
                  No user found.
                </Command.Empty>

                {assignees.length > 0 && (
                  <Command.Item
                    value="clear all unassigned none"
                    onSelect={() => handleClearAllAssignees()}
                    className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none data-[selected=true]:bg-accent text-zinc-600 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-accent mb-1 border-b border-zinc-800/40"
                  >
                    <div className="w-5 h-5 rounded-full border border-dashed border-zinc-600 flex items-center justify-center text-[10px] text-zinc-400 mr-2 shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </div>
                    <span>Clear all assignees</span>
                  </Command.Item>
                )}

                {assignableUsers.map(user => {
                  const isAssigned = assignees.some(a => a.id === user.id);
                  return (
                    <Command.Item
                      key={user.id}
                      value={`${user.name} ${user.email}`}
                      onSelect={() => handleAssigneeToggle(user)}
                      className="relative flex cursor-pointer select-none items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-accent hover:bg-accent text-zinc-700 dark:text-zinc-300 hover:text-accent-foreground"
                    >
                      <div className="flex items-center gap-2 truncate min-w-0">
                        {user.avatarUrl ? (
                          <img src={user.avatarUrl} alt={user.name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] text-white font-bold shrink-0">
                            {(user.name || 'U').substring(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="flex flex-col truncate">
                          <span className="truncate text-xs font-medium text-zinc-200">{user.name}</span>
                          <span className="truncate text-[10px] text-zinc-500">{user.roles?.[0] || user.email}</span>
                        </div>
                      </div>
                      {isAssigned && (
                        <div className="w-5 h-5 rounded-full bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0 ml-2">
                          <Check className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </Command.Item>
                  );
                })}
              </Command.List>
            </Command>
          </div>
        </PortalDropdown>
      )}

      {openDropdown === 'team' && (
        <PortalDropdown triggerRef={teamRef} onClose={() => setOpenDropdown(null)}>
          <div className="bg-card border border-zinc-800/60 rounded-xl shadow-2xl w-64 p-2 z-[100] animate-in fade-in zoom-in-95 duration-100">
            <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
              {dbTeams.length === 0 && <div className="px-2 py-1.5 text-xs text-zinc-500">No teams found.</div>}
              <div className="flex flex-col gap-3 mt-1">
                {dbTeams.map(t => (
                  <div key={t.id} className="flex flex-col">
                    {(() => {
                      const teamRoles = t.teamRoles || [];
                      const current = taskData?.assigneeRoleRestrictions || [];
                      const hasRoles = teamRoles.length > 0;
                      const allSelected = hasRoles && teamRoles.every((r: any) => current.includes(r.name));
                      const someSelected = hasRoles && teamRoles.some((r: any) => current.includes(r.name));
                      
                      return (
                            <div 
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!hasRoles) return;
                                let next = [...current];
                                if (allSelected) {
                                  next = next.filter((r: string) => !teamRoles.find((tr: any) => tr.name === r));
                                } else {
                                  const toAdd = teamRoles.filter((tr: any) => !next.includes(tr.name)).map((tr: any) => tr.name);
                                  next = [...next, ...toAdd];
                                }
                                
                                const teamStr = t ? JSON.stringify(t) : '';
                                try { updateAttributes({ taskTeam: teamStr }); } catch (e) {}
                                setLocalTeam(teamStr);
                                
                                if (taskData) {
                                  const updatedTask = { ...taskData, assigneeRoleRestrictions: next, teamId: t.id, team: t };
                                  setTaskData(updatedTask);
                                  updateTaskStore(updatedTask);
                                  tasksApi.updateTask(taskData.id, { assigneeRoleRestrictions: next, teamId: t.id } as any).catch(console.error);
                                }
                              }}
                          className={`flex items-center gap-2.5 px-2 py-1 ${hasRoles ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                        >
                          {hasRoles && (
                            <div className={`w-[14px] h-[14px] rounded-[3px] flex items-center justify-center shrink-0 transition-colors ${allSelected || someSelected ? 'bg-indigo-500 border-indigo-500' : 'border border-zinc-300 dark:border-zinc-700 bg-transparent'}`}>
                              {allSelected && <Check className="w-2.5 h-2.5 text-white stroke-[3]" />}
                              {!allSelected && someSelected && <div className="w-1.5 h-0.5 bg-white rounded-full" />}
                            </div>
                          )}
                          <span className="text-[11px] font-bold tracking-wide uppercase text-zinc-400">{t.name}</span>
                        </div>
                      );
                    })()}
                    {(!t.teamRoles || t.teamRoles.length === 0) && (
                      <div className="px-2 py-1 text-[10px] text-zinc-600 italic">No roles</div>
                    )}
                    {t.teamRoles && t.teamRoles.length > 0 && (
                      <div className="flex flex-col ml-[13px] pl-4 py-1 border-l border-zinc-800/60 mt-1 space-y-0.5">
                        {t.teamRoles.map((role: any) => {
                          const selected = (taskData?.assigneeRoleRestrictions || []).includes(role.name);
                          return (
                            <div
                              key={role.id}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const current = taskData?.assigneeRoleRestrictions || [];
                                const next = selected
                                  ? current.filter((r: string) => r !== role.name)
                                  : [...current, role.name];
                                  
                                const teamStr = t ? JSON.stringify(t) : '';
                                try { updateAttributes({ taskTeam: teamStr }); } catch (e) {}
                                setLocalTeam(teamStr);
                                
                                if (taskData) {
                                  const updatedTask = { ...taskData, assigneeRoleRestrictions: next, teamId: t.id, team: t };
                                  setTaskData(updatedTask);
                                  updateTaskStore(updatedTask);
                                  tasksApi.updateTask(taskData.id, { assigneeRoleRestrictions: next, teamId: t.id } as any).catch(console.error);
                                }
                              }}
                              className="flex items-center gap-2.5 cursor-pointer px-1 py-1 text-[13px] font-medium text-zinc-200 hover:text-white transition-colors"
                            >
                              <div className={`w-[14px] h-[14px] rounded-[3px] flex items-center justify-center shrink-0 transition-colors ${selected ? 'bg-indigo-500 border-indigo-500' : 'border border-zinc-300 dark:border-zinc-700 bg-transparent'}`}>
                                {selected && <Check className="w-2.5 h-2.5 text-white stroke-[3]" />}
                              </div>
                              {role.name}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </PortalDropdown>
      )}
    </NodeViewWrapper>
  );
};


