import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import React, { useEffect, useState, useRef } from 'react';
import { tasksApi, usersApi, spacesApi } from '@/api';
import { PortalDropdown } from '@/components/ui/PortalDropdown';
import { toast } from '@/lib/toast';
import { Flag, User as UserIcon, CheckCircle2, AlignLeft, Shield, Check, Users2 } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { motion, AnimatePresence } from 'framer-motion';

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

  const dbUsers = workspaceUsers;
  const dbTeams = workspaceTeams;
  
  const listStatuses = React.useMemo(() => {
    if (fallbackListStatuses.length > 0) return fallbackListStatuses;
    if (!taskData?.listId) return [];
    const found = allLists.find(l => l.id === taskData.listId);
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
      }
    };

    if (globalTask) {
      handleTaskData(globalTask);
    } else {
      tasksApi.getTask(id).then(({ task }) => {
        handleTaskData(task);
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mentionType, globalTask]);

  useEffect(() => {
    let cancelled = false;
    if (openDropdown === 'assignee' && !hasLoadedUsers) {
      loadUsers().catch(console.error);
    } else if (openDropdown === 'team' && !hasLoadedTeams) {
      loadTeams().catch(console.error);
    } else if (openDropdown === 'status' && listStatuses.length === 0 && taskData?.listId) {
      spacesApi.getList(taskData.listId).then(res => {
        if (!cancelled && res?.list?.statuses) {
          setFallbackListStatuses(res.list.statuses);
        }
      }).catch(console.error);
    }
    return () => { cancelled = true; };
  }, [openDropdown, hasLoadedUsers, hasLoadedTeams, loadUsers, loadTeams, listStatuses.length, taskData?.listId]);
  
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
  let parsedStatusName = localStatus;
  let parsedStatusColor = '#3b82f6'; // default blue
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
      parsedStatusColor = parsed.color || parsed.COLOR || '#3b82f6';
    }
  } catch (e) {}

  const handleStatusChange = async (newStatus: string) => {
    if (!currentUser || !taskData) return;
    const optimisticTask = { ...taskData, status: newStatus };
    updateTaskStore(optimisticTask);
    
    try {
      await tasksApi.moveTask(id, newStatus, taskData.listId, currentUser.id);
      try { updateAttributes({ taskStatus: JSON.stringify({ name: newStatus, color: getStatusColor(newStatus) }) }); } catch (e) {}
      setLocalStatus(JSON.stringify({ name: newStatus, color: getStatusColor(newStatus) }));
      toast.success('Status updated');
    } catch (e: any) {
      toast.error(e.message || 'Failed to update status');
    }
    setOpenDropdown(null);
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
    try { updateAttributes({ taskAssignees: JSON.stringify(newAssignees) }); } catch (e) {}
    setLocalAssignees(JSON.stringify(newAssignees));
    if (taskData) {
      updateTaskStore({ ...taskData, assignees: newAssignees, assigneeIds: newAssignees.map(a => a.id) });
    }
    try {
      await tasksApi.updateTask(id, { assigneeIds: newAssignees.map(a => a.id), userId: currentUser.id });
    } catch (e) {
      toast.error('Failed to update assignees');
    }
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
      await tasksApi.updateTask(id, { teamId: selectedTeam ? selectedTeam.id : null, userId: currentUser.id });
      toast.success('Team updated');
    } catch (e) {
      toast.error('Failed to update team');
    }
  };

  // Resolve board/list name: prefer live taskData, fallback to stored taskListName attr
  const resolvedListName = (taskData?.list?.name) || node.attrs.taskListName || '';

  return (
    <NodeViewWrapper as="span" className="inline-block align-middle mx-1 group" data-drag-handle>
      <motion.span layout className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md hover:bg-zinc-100 dark:hover:bg-[#1f1f1f] transition-colors duration-200 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-800">
        
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
          className={`flex items-center justify-center w-5 h-5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer transition-colors ${PRIORITY_COLORS[localPriority] || 'text-zinc-500'}`}
          onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'priority' ? null : 'priority'); }}
          title={localPriority ? `${localPriority} Priority` : 'Set Priority'}
        >
          <Flag className="w-3 h-3" />
        </span>

        <motion.span layout
          ref={teamRef}
          className="inline-flex items-center justify-center shrink-0 ml-0.5 cursor-pointer hover:opacity-80 transition-opacity"
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
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white border-2 border-white dark:border-[#1a1a1a] ${i > 0 ? '-ml-2' : ''} shadow-sm relative ${bgColor}`}
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
          className="inline-flex items-center -space-x-1 shrink-0 ml-0.5 cursor-pointer hover:opacity-80 transition-opacity"
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
                  className="w-5 h-5 rounded-full overflow-hidden border-2 border-white dark:border-[#1a1a1a] z-10 shrink-0 bg-zinc-200 dark:bg-zinc-600 flex items-center justify-center relative shadow-sm"
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

      {openDropdown === 'status' && (
        <PortalDropdown triggerRef={statusRef} onClose={() => setOpenDropdown(null)}>
          <div className="w-48 py-1">
            <div className="px-2 py-1.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Change Status</div>
            {listStatuses.length > 0 ? listStatuses.map((s: any) => (
              <button
                key={s.id}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleStatusChange(s.name); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-700/50 flex items-center gap-2 cursor-pointer transition-colors"
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
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handlePriorityChange(p.id); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-700/50 flex items-center gap-2 group cursor-pointer transition-colors"
              >
                <Flag className={`w-3.5 h-3.5 ${p.color}`} />
                <span className="text-zinc-300 group-hover:text-white transition-colors">{p.label}</span>
                {p.id === localPriority && <CheckCircle2 className="w-3 h-3 text-blue-400 ml-auto" />}
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
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAssigneeToggle(user); }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-700/50 flex items-center gap-2 group cursor-pointer transition-colors"
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

      {openDropdown === 'team' && (
        <PortalDropdown triggerRef={teamRef} onClose={() => setOpenDropdown(null)}>
          <div className="bg-[#1c1c1e] border border-zinc-800/60 rounded-xl shadow-2xl w-64 p-2 z-[100] animate-in fade-in zoom-in-95 duration-100">
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
                            <div className={`w-[14px] h-[14px] rounded-[3px] flex items-center justify-center shrink-0 transition-colors ${allSelected || someSelected ? 'bg-zinc-700' : 'bg-[#2a2a2c]'}`}>
                              {allSelected && <Check className="w-2.5 h-2.5 text-zinc-300 stroke-[3]" />}
                              {!allSelected && someSelected && <div className="w-1.5 h-0.5 bg-zinc-300 rounded-full" />}
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
                              <div className={`w-[14px] h-[14px] rounded-[3px] flex items-center justify-center shrink-0 transition-colors ${selected ? 'bg-zinc-700' : 'bg-[#2a2a2c]'}`}>
                                {selected && <Check className="w-2.5 h-2.5 text-zinc-300 stroke-[3]" />}
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
