import { useSortable } from '@dnd-kit/sortable';
import { memo, useState, useMemo, useRef, useEffect, useCallback } from 'react';

import { createPortal } from 'react-dom';
import { CSS } from '@dnd-kit/utilities';
import { Task, Subtask } from '@/lib/types';
import { Check, CheckSquare, Calendar, User, Users, Flag, AlignLeft, CheckCircle2, CircleDashed, CircleDot, Tag, Lock, CornerDownRight, ChevronDown, ChevronRight, MoreHorizontal, Plus, Pencil, X, Shield, Copy, Trash2 } from 'lucide-react';
import { CustomCircleDot, CustomCircleDotted } from '@/components/modals/TaskDetailModal';
import { tasksApi, usersApi } from '@/api';
import { useAppStore } from '@/lib/store';
import { toast } from '@/lib/toast';
import { PortalDropdown } from '@/components/ui/PortalDropdown';
import { canUserEditTask } from '@/lib/permissions';
import { getPriorityConfig, PRIORITY_OPTIONS } from '@/lib/priority';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { ConfirmDeleteModal } from '@/components/modals/ConfirmDeleteModal';

interface Props {
  task: Task;
  isOverlay?: boolean;
  onClick?: (task: Task) => void;
  isMoveDisabled?: boolean;
  moveLockReason?: string;
  listStatuses?: any[];
  onUnauthorizedDragAttempt?: () => void;
}

const CardContent = memo(({ task: initialTask, isSubtask = false, children, onDropdownOpenChange, listStatuses = [] }: { task: Task | Subtask, isSubtask?: boolean, children?: React.ReactNode, onDropdownOpenChange?: (isOpen: boolean) => void, listStatuses?: any[] }) => {
  const [task, setTask] = useState(initialTask);

  useEffect(() => {
    setTask(initialTask);
  }, [initialTask]);

  const [isDescOpen, setIsDescOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<'status' | 'assignee' | 'teamRole' | 'date' | 'priority' | null>(null);

  const { currentUser, workspaceUsers, loadUsers, hydrateUsersFromCache, allLists, workspaceRoles } = useAppStore();

  const orderedListStatuses = useMemo(() => {
    const sortedInternals = [...(listStatuses || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    const listObj = allLists.find((l: any) => l.list?.id === (task as any)?.listId || l.id === (task as any)?.listId);
    const list = listObj?.list || listObj;

    if (!list?.customGroups || list.customGroups.length === 0) {
      return sortedInternals.filter(s => {
        if (!list?.customGroups) return true;
        const sName = (s.name || s.status || s.title || '').toUpperCase();
        return !list.customGroups.some((g: string) => g.toUpperCase() === sName);
      });
    }

    const finalStatuses: any[] = [];
    const processed = new Set<string>();

    list.customGroups.forEach((groupName: string) => {
      const groupStatuses = sortedInternals.filter(s => s.groupName === groupName);
      groupStatuses.forEach(s => {
        const sName = s.name || s.status || s.title || '';
        finalStatuses.push(s);
        processed.add(sName);
      });
    });

    sortedInternals.forEach(s => {
      const sName = s.name || s.status || s.title || '';
      if (!processed.has(sName)) {
        if (!list.customGroups.some((g: string) => g.toUpperCase() === sName.toUpperCase())) {
          finalStatuses.push(s);
          processed.add(sName);
        }
      }
    });

    return finalStatuses;
  }, [listStatuses, allLists, (task as any)?.listId]);

  

  useEffect(() => {
    let cancelled = false;
    if (openDropdown === 'assignee' && workspaceUsers.length === 0) {
      hydrateUsersFromCache();
      loadUsers();
    }
    return () => { cancelled = true; };
  }, [openDropdown, workspaceUsers.length, hydrateUsersFromCache, loadUsers]);

  const handleStatusChange = async (newStatus: string) => {
    if (!currentUser) return;
    try {
      if (isSubtask) {
        await tasksApi.updateSubtask((task as Subtask).taskId, task.id, { status: newStatus });
      } else {
        await tasksApi.moveTask(task.id, newStatus, 'listId' in task ? task.listId : undefined, currentUser.id);
      }
      toast.success('Status updated');
    } catch (e: any) {
      toast.error(e.message || 'Failed to update status');
    }
    closeDropdown();
  };

  const handlePriorityChange = async (p: string | null) => {
    if (!currentUser) return;

    setTask(prev => ({ ...prev, priority: p as any }));
    closeDropdown();

    try {
      if (isSubtask) {
        await tasksApi.updateSubtask((task as Subtask).taskId, task.id, { priority: p || undefined });
      } else {
        await tasksApi.updateTask(task.id, { priority: (p || undefined) as any, userId: currentUser.id });
      }
      toast.success(p ? `Priority set to ${getPriorityConfig(p).label}` : 'Priority cleared');
    } catch (e: any) {
      toast.error(e.message || 'Failed to update priority');
      setTask(initialTask);
    }
  };

  const handleDueDateChange = async (date: Date | undefined) => {
    if (!currentUser) return;
    
    setTask(prev => ({ ...prev, dueDate: date?.toISOString() || null } as any));
    closeDropdown();

    try {
      if (isSubtask) {
        await tasksApi.updateSubtask((task as Subtask).taskId, task.id, { dueDate: date?.toISOString() || null });
      } else {
        await tasksApi.updateTask(task.id, { dueDate: date?.toISOString() || null });
      }
      toast.success(date ? 'Due date set' : 'Due date cleared');
    } catch (e: any) {
      toast.error(e.message || 'Failed to update due date');
      setTask(initialTask);
    }
  };

  const assignees = 'assignees' in task && task.assignees?.length ? task.assignees : ('assignee' in task && task.assignee) ? [task.assignee] : [];

  // Unified edit access check: uses teamAssignAccessRole on the task
  const canEditTask = useMemo(() => {
    return canUserEditTask(task as any, currentUser).allowed;
  }, [(task as any).teamAssignAccessRole, currentUser]);

  // Role-based filter: which users can be assigned (assigneeRoleRestrictions)
  const assignableUsers = useMemo(() => {
    const t = task as any;
    if (!t.assigneeRoleRestrictions?.length) return workspaceUsers;
    const requiredRoles = t.assigneeRoleRestrictions.map((r: string) => r.trim().toUpperCase());
    return workspaceUsers.filter((u: any) => {
      const uRoles = (u.roles || [])
        .filter(Boolean).map((r: any) => r.trim().toUpperCase());
      return requiredRoles.some((req: string) => uRoles.includes(req));
    });
  }, [workspaceUsers, (task as any).assigneeRoleRestrictions]);

  const handleAssigneeToggle = async (user: any) => {
    if (!currentUser) return;
    const currentAssignees = assignees;
    const isAssigned = currentAssignees.some((a: any) => a.id === user.id);
    const newAssignees = isAssigned ? currentAssignees.filter((a: any) => a.id !== user.id) : [...currentAssignees, user];
    const assigneeIds = newAssignees.map(a => a.id);
    const primaryAssignee = newAssignees.length > 0 ? newAssignees[0] : null;

    setTask(prev => ({ ...prev, assignees: newAssignees, assignee: primaryAssignee, assigneeId: primaryAssignee?.id || null, assigneeIds }));

    try {
      if (isSubtask) {
        await tasksApi.updateSubtask((task as Subtask).taskId, task.id, { assigneeIds });
      } else {
        await tasksApi.updateTask(task.id, {
          assigneeIds,
          assigneeId: primaryAssignee?.id || null,
          userId: currentUser.id,
        });
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to update assignee');
      setTask(initialTask);
    }
  };

  const handleClearAssignees = async () => {
    if (!currentUser) return;

    setTask(prev => ({ ...prev, assignees: [], assignee: null, assigneeId: null, assigneeIds: [] }));

    try {
      if (isSubtask) {
        await tasksApi.updateSubtask((task as Subtask).taskId, task.id, { assigneeIds: [] });
      } else {
        await tasksApi.updateTask(task.id, {
          assigneeIds: [],
          assigneeId: null,
          userId: currentUser.id,
        });
      }
      toast.success('Assignees cleared');
    } catch (e: any) {
      toast.error(e.message || 'Failed to clear assignees');
      setTask(initialTask);
    }
  };
  const statusTriggerRef = useRef<HTMLDivElement>(null);
  const assigneeTriggerRef = useRef<HTMLDivElement>(null);
  const teamRoleTriggerRef = useRef<HTMLDivElement>(null);
  const dateTriggerRef = useRef<HTMLDivElement>(null);
  const priorityTriggerRef = useRef<HTMLDivElement>(null);
  const descTriggerRef = useRef<HTMLDivElement>(null);

  const handleTeamRoleChange = async (roleName: string | null) => {
    if (!currentUser) return;
    setTask(prev => ({ ...prev, teamAssignAccessRole: roleName }));
    closeDropdown();
    try {
      if (isSubtask) {
        await tasksApi.updateSubtask((task as Subtask).taskId, task.id, { teamAssignAccessRole: roleName });
      } else {
        await tasksApi.updateTask(task.id, { teamAssignAccessRole: roleName });
      }
      toast.success(roleName ? `Team role assigned` : 'Team role cleared');
    } catch (e: any) {
      toast.error(e.message || 'Failed to update team role');
      setTask(initialTask);
    }
  };

  const closeDropdown = () => setOpenDropdown(null);

  useEffect(() => {
    onDropdownOpenChange?.(openDropdown !== null);
  }, [openDropdown, onDropdownOpenChange]);

  const plainTextDescription = useMemo(() => {
    if (!task.description) return '';
    return task.description.replace(/<[^>]*>?/gm, '').trim();
  }, [task.description]);

    let checklistTotal = 0;
  let checklistCompleted = 0;
  if ('checklists' in task && task.checklists) {
    task.checklists.forEach((c: any) => {
      if (isSubtask && c.subtaskId !== task.id) return;
      if (!isSubtask && c.subtaskId) return;
      
      checklistTotal += c.items?.length || 0;
      checklistCompleted += c.items?.filter((i: any) => i.completed).length || 0;
    });
  }

  const breadcrumbs = 'list' in task && task.list ? `In ${task.list.space?.name || 'Space'} | ${task.list.folder?.name || 'Folder'} | ${task.list.name}` : '';
  const statusStr = ('status' in task && task.status) ? task.status : ('completed' in task && task.completed ? 'CLOSED' : 'PENDING');
  const isClosed = statusStr.toUpperCase() === 'CLOSED' || ('completed' in task && task.completed);

  // Field hover class
  const fieldHoverClass = "flex items-center gap-2 text-[11px] hover:bg-black/5 dark:hover:bg-zinc-700/50 -mx-1.5 px-1.5 py-1 rounded cursor-pointer transition-colors";

  return (
    <div className="flex flex-col w-full text-left">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[13px] font-semibold text-foreground leading-tight">
          {task.title}
        </h4>
      </div>

      {!isSubtask && breadcrumbs && (
        <div className="text-[11px] text-zinc-500 dark:text-zinc-500 truncate mt-1">
          {breadcrumbs}
        </div>
      )}

      {isSubtask && breadcrumbs && (
        <div className="text-[11px] text-zinc-500 dark:text-zinc-500 truncate mt-1">
          {breadcrumbs}
        </div>
      )}

      {/* Description Icon */}
      <div className="mt-2 relative inline-flex">
        <div
          ref={descTriggerRef}
          className={`flex items-center ${plainTextDescription ? 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-300' : 'text-zinc-600 hover:text-zinc-500 dark:text-zinc-500 dark:text-zinc-400'} hover:bg-black/5 dark:hover:bg-zinc-700/50 p-1 -ml-1 rounded cursor-pointer transition-colors`}
          onClick={(e) => { e.stopPropagation(); setIsDescOpen(!isDescOpen); }}
          title={plainTextDescription ? 'View Description' : 'No description'}
        >
          <AlignLeft className="w-3.5 h-3.5" />
        </div>
        {isDescOpen && (
          <PortalDropdown triggerRef={descTriggerRef} onClose={() => setIsDescOpen(false)}>
            <div className="w-64 p-3">
              <div className="font-semibold mb-1.5 text-xs text-zinc-100">Deliverables:</div>
              <div className="line-clamp-6 leading-relaxed text-zinc-300 text-[11px]">
                {plainTextDescription || <span className="italic text-zinc-500 dark:text-zinc-500">No description provided.</span>}
              </div>
            </div>
          </PortalDropdown>
        )}
      </div>

      <div className="flex flex-col gap-1.5 mt-2.5">
        {/* Status */}
        <div className="relative">
          <div
            ref={statusTriggerRef}
            className={`${fieldHoverClass} text-zinc-300`}
            onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'status' ? null : 'status'); }}
          >
            {(() => {
              const statusObj = listStatuses?.find((ls: any) => (ls.name || ls.status || ls.title) === statusStr);
              const getHexColor = (color: string) => {
                const colors: Record<string, string> = {
                  slate: '#64748b', gray: '#6b7280', zinc: '#71717a', neutral: '#737373', stone: '#78716c',
                  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', lime: '#84cc16',
                  green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9',
                  blue: '#3b82f6', indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef',
                  pink: '#ec4899', rose: '#f43f5e'
                };
                return colors[color] || color;
              };

              const statusHexColor = statusObj?.color ? getHexColor(statusObj.color) : undefined;

              const STATUS_COLORS: Record<string, string> = {
                PENDING: 'text-[#D29A2A]',
                'IN PROGRESS': 'text-[#D04A7C]',
                CLOSED: 'text-[#2FA37A]',
                'KYC': 'text-[#3A8F55]',
                'PIN BOARD': 'text-[#1F8A6E]',
                'DAILY': 'text-[#2F7BD0]',
                'WEEKLY': 'text-[#2F7BD0]',
                'MONTHLY': 'text-[#2F7BD0]',
                'REVISION': 'text-[#5B6BD6]',
                'WAITING': 'text-[#D9534F]',
                'IN REVIEW': 'text-[#D97B3A]',
                'CHECKING': 'text-[#A35DB8]',
                'CRM': 'text-[#22A3AE]',
                'ON-HOLD': 'text-[#8A8F98]',
              };

              const statusIconColorClass = statusHexColor ? '' : (STATUS_COLORS[statusStr] || 'text-zinc-500 dark:text-zinc-500');
              const statusIconStyle = statusHexColor ? { color: statusHexColor } : {};

              return isClosed ? (
                <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${statusIconColorClass}`} style={statusIconStyle} />
              ) : statusStr.toUpperCase() === 'KYC' ? (
                <CustomCircleDotted className={`w-3.5 h-3.5 shrink-0 ${statusIconColorClass}`} style={statusIconStyle} />
              ) : (
                <CustomCircleDot className={`w-3.5 h-3.5 shrink-0 ${statusIconColorClass}`} style={statusIconStyle} />
              );
            })()}
            <span className="uppercase font-semibold">{statusStr}</span>
          </div>
          {openDropdown === 'status' && (
            <PortalDropdown triggerRef={statusTriggerRef} onClose={closeDropdown}>
              <div className="w-48 max-h-60 overflow-y-auto custom-scrollbar flex flex-col gap-0.5 pb-1.5 px-1.5 bg-background border border-zinc-800 rounded-md shadow-xl">
                <div className="px-2 pt-2 pb-1 text-[10px] text-zinc-500 dark:text-zinc-500 font-bold tracking-wider uppercase sticky top-0 bg-background z-10 mb-0.5">Change Status</div>
                {orderedListStatuses.length > 0 ? (
                  orderedListStatuses.map(s => {
                    const statusName = s.name || s.status || s.title;
                    const customObj = s;
                    const getHexColor = (color: string) => {
                      const colors: Record<string, string> = {
                        slate: '#64748b', gray: '#6b7280', zinc: '#71717a', neutral: '#737373', stone: '#78716c',
                        red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', lime: '#84cc16',
                        green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9',
                        blue: '#3b82f6', indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef',
                        pink: '#ec4899', rose: '#f43f5e'
                      };
                      return colors[color] || color;
                    };
                    
                    const STATUS_COLORS: Record<string, string> = {
                      PENDING: 'text-[#D29A2A]',
                      'IN PROGRESS': 'text-[#D04A7C]',
                      CLOSED: 'text-[#2FA37A]',
                      'KYC': 'text-[#3A8F55]',
                      'PIN BOARD': 'text-[#1F8A6E]',
                      'DAILY': 'text-[#2F7BD0]',
                      'WEEKLY': 'text-[#2F7BD0]',
                      'MONTHLY': 'text-[#2F7BD0]',
                      'REVISION': 'text-[#5B6BD6]',
                      'WAITING': 'text-[#D9534F]',
                      'IN REVIEW': 'text-[#D97B3A]',
                      'CHECKING': 'text-[#A35DB8]',
                      'CRM': 'text-[#22A3AE]',
                      'ON-HOLD': 'text-[#8A8F98]',
                    };

                    return (
                      <div
                        key={s.id || statusName}
                        onClick={() => handleStatusChange(statusName)}
                        className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${statusStr === statusName ? 'bg-blue-500/10 text-blue-400' : 'text-zinc-500 dark:text-zinc-300 hover:bg-accent hover:text-accent-foreground'}`}
                      >
                        {(() => {
                          if (customObj?.color) {
                            if ((statusName || '').toUpperCase() === 'KYC') {
                              return <CustomCircleDotted className="w-3 h-3 shrink-0" style={{ color: getHexColor(customObj.color) }} />;
                            }
                            return <CustomCircleDot className="w-3 h-3 shrink-0" style={{ color: getHexColor(customObj.color) }} />;
                          }
                          
                          if ((statusName || '').toUpperCase() === 'KYC') {
                            return <CustomCircleDotted className={`w-3 h-3 shrink-0 ${STATUS_COLORS[statusName] ? STATUS_COLORS[statusName] : 'text-zinc-500 dark:text-zinc-500'}`} />;
                          }
                          return <CustomCircleDot className={`w-3 h-3 shrink-0 ${STATUS_COLORS[statusName] ? STATUS_COLORS[statusName] : 'text-zinc-500 dark:text-zinc-500'}`} />;
                        })()}
                        <span className="uppercase">{statusName}</span>
                        {statusName === statusStr && <Check className="w-3 h-3 ml-auto opacity-70" />}
                      </div>
                    );
                  })
                ) : (
                  ['PENDING', 'IN PROGRESS', 'COMPLETED', 'CLOSED'].map(s => (
                    <div key={s} className="px-2 py-1.5 text-xs text-zinc-300 hover:bg-black/5 dark:hover:bg-zinc-700/50 rounded cursor-pointer transition-colors font-medium uppercase" onClick={() => handleStatusChange(s)}>
                      {s}
                    </div>
                  ))
                )}
              </div>
            </PortalDropdown>
          )}
        </div>

        {/* Checklists */}
        {checklistTotal > 0 && (
          <div className={`${fieldHoverClass} text-zinc-500 dark:text-zinc-500 dark:text-zinc-400`}>
            <CheckSquare className="w-3.5 h-3.5" />
            <span>{checklistCompleted}/{checklistTotal}</span>
          </div>
        )}

        {/* Team Role & Assignees */}
        <div className="flex items-center gap-4">
          {/* Team Role Assign */}
          <div className="relative flex items-center group/teamrole">
            <div
              ref={teamRoleTriggerRef}
              className={`${fieldHoverClass} text-zinc-500 dark:text-zinc-500 dark:text-zinc-400 max-w-[150px]`}
              onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'teamRole' ? null : 'teamRole'); }}
            >
              <Shield className="w-4 h-4 shrink-0" />
              {('teamAssignAccessRole' in task && task.teamAssignAccessRole) && (
                <span className="truncate">{task.teamAssignAccessRole}</span>
              )}
            </div>
            {openDropdown === 'teamRole' && (
              <PortalDropdown triggerRef={teamRoleTriggerRef} onClose={closeDropdown}>
                <div className="w-52 max-h-64 overflow-y-auto custom-scrollbar p-0.5 flex flex-col gap-0.5">
                  <div className="text-[10px] font-bold text-zinc-500 tracking-wider px-2.5 py-1.5 uppercase sticky top-0 bg-zinc-900 z-10">Assign Role</div>
                  {workspaceRoles?.map(role => {
                    const isSelected = ('teamAssignAccessRole' in task && task.teamAssignAccessRole === role.name);
                    return (
                      <div
                        key={role.id}
                        className={`px-2 py-1.5 flex items-center gap-2 rounded-md cursor-pointer transition-colors ${
                          isSelected ? 'bg-zinc-800/80 text-white' : 'hover:bg-zinc-800/50 text-zinc-300 hover:text-zinc-100'
                        }`}
                        onClick={() => handleTeamRoleChange(role.name)}
                      >
                        <span className="text-xs truncate flex-1">
                          {role.name}
                        </span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                      </div>
                    );
                  })}
                  <div
                    className="px-2 py-1.5 flex items-center gap-2 rounded-md cursor-pointer transition-colors mt-1 border-t border-zinc-800/50 hover:bg-red-500/10 text-red-400/80 hover:text-red-400"
                    onClick={() => handleTeamRoleChange(null)}
                  >
                    <span className="text-xs truncate flex-1">Clear Role</span>
                  </div>
                </div>
              </PortalDropdown>
            )}
          </div>

          {/* Assignees */}
          <div className="relative flex items-center group/assignee">
            <div
              ref={assigneeTriggerRef}
              className={`${fieldHoverClass} text-zinc-500 dark:text-zinc-500 dark:text-zinc-400 max-w-[150px]`}
              onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'assignee' ? null : 'assignee'); }}
            >
              {assignees.length > 0 ? (
                <div className="flex items-center -space-x-1 overflow-hidden">
                  {assignees.slice(0, 2).map((a: any) => (
                    <div key={a.id} className="relative ring-1 ring-[#18181b] rounded-full shrink-0" title={a.name}>
                      {a.avatarUrl ? (
                        <img src={a.avatarUrl} alt={a.name} className="w-4 h-4 rounded-full object-cover" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-indigo-600 flex items-center justify-center text-[8px] text-white font-bold">
                          {(a.name || 'U').charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                  ))}
                  {assignees.length > 2 && (
                    <div className="relative ring-1 ring-[#18181b] rounded-full shrink-0 w-4 h-4 bg-zinc-700 flex items-center justify-center text-[8px] text-zinc-300 font-bold">
                      +{assignees.length - 2}
                    </div>
                  )}
                </div>
              ) : (
                <Users className="w-4 h-4 shrink-0" />
              )}
            </div>
            {assignees.length > 0 && (
              <div
                className="ml-1 p-0.5 rounded-full bg-red-500/80 hover:bg-red-500 text-white opacity-0 group-hover/assignee:opacity-100 transition-opacity cursor-pointer z-10"
                onClick={(e) => { e.stopPropagation(); handleClearAssignees(); }}
                title="Remove all assignees"
              >
                <X className="w-3 h-3" />
              </div>
            )}
            {openDropdown === 'assignee' && (
              <PortalDropdown triggerRef={assigneeTriggerRef} onClose={closeDropdown}>
                <div className="w-52 max-h-64 overflow-y-auto custom-scrollbar p-0.5 flex flex-col gap-0.5">
                  <div className="text-[10px] font-bold text-zinc-500 tracking-wider px-2.5 py-1.5 uppercase sticky top-0 bg-zinc-900 z-10">Assign To</div>
                  {assignableUsers.length > 0 ? (
                    assignableUsers.map(user => {
                      const isAssigned = assignees.some((a: any) => a.id === user.id);
                      return (
                        <div
                          key={user.id}
                          className={`px-2 py-1.5 flex items-center gap-2 rounded-md cursor-pointer transition-colors ${
                            isAssigned ? 'bg-zinc-800/80 text-white' : 'hover:bg-zinc-800/50 text-zinc-300 hover:text-zinc-100'
                          }`}
                          onClick={() => handleAssigneeToggle(user)}
                        >
                          {user.avatarUrl ? (
                            <img src={user.avatarUrl} alt={user.name} className="w-5 h-5 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-[9px] text-white font-bold shrink-0">
                              {(user.name || 'U').charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="text-xs truncate flex-1">
                            {user.name}
                          </span>
                          {isAssigned && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                        </div>
                      );
                    })
                  ) : (
                    <div className="px-2 py-2 text-xs text-zinc-500 dark:text-zinc-500 dark:text-zinc-400 italic">Loading assignees...</div>
                  )}
                </div>
              </PortalDropdown>
            )}
          </div>
        </div>

        {/* Due Date */}
        <div className="relative">
          <div
            ref={dateTriggerRef}
            className={`${fieldHoverClass} text-zinc-500 dark:text-zinc-500 dark:text-zinc-400`}
            onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'date' ? null : 'date'); }}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>
              {('dueDate' in task && task.dueDate) ? new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '-'}
            </span>
          </div>
          {openDropdown === 'date' && (
            <PortalDropdown triggerRef={dateTriggerRef} onClose={closeDropdown}>
              <div className="bg-background border border-zinc-800 rounded-xl shadow-xl z-50 p-3">
                <style>{`
                  .rdp { --rdp-cell-size: 32px; --rdp-accent-color: #6366f1; --rdp-background-color: rgba(99, 102, 241, 0.2); margin: 0; }
                  .rdp-day_selected, .rdp-day_selected:focus-visible, .rdp-day_selected:hover { background-color: var(--rdp-accent-color); font-weight: bold; color: white; }
                  .rdp-button:hover:not([disabled]):not(.rdp-day_selected) { background-color: rgba(255, 255, 255, 0.1); }
                  .rdp-day { border-radius: 6px; color: #d4d4d8; font-size: 13px; }
                  .rdp-caption { color: #f4f4f5; }
                  .rdp-head_cell { color: #a1a1aa; font-weight: 500; font-size: 12px; }
                  .rdp-nav_button { color: #d4d4d8; }
                  .rdp-nav_button:hover { background-color: rgba(255, 255, 255, 0.1); }
                `}</style>
                <div className="flex justify-between items-center mb-2 px-2">
                  <div className="text-[11px] text-zinc-500 font-semibold uppercase">Set Due Date</div>
                  {('dueDate' in task && task.dueDate) && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleDueDateChange(undefined); }}
                      className="text-[10px] text-red-400/80 hover:text-red-400 hover:bg-red-500/10 px-2 py-0.5 rounded transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <DayPicker
                  mode="single"
                  selected={('dueDate' in task && task.dueDate) ? new Date(task.dueDate) : undefined}
                  onSelect={handleDueDateChange}
                />
              </div>
            </PortalDropdown>
          )}
        </div>

        {/* Priority */}
        <div className="relative">
          <div
            ref={priorityTriggerRef}
            className={`${fieldHoverClass} max-w-[150px]`}
            onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'priority' ? null : 'priority'); }}
          >
            {(() => {
              const priority = 'priority' in task ? task.priority : null;
              const config = getPriorityConfig(priority);
              return (
                <>
                  <Flag className={`w-3.5 h-3.5 shrink-0 ${config.iconColor}`} />
                  <span className={`truncate font-medium ${config.color}`}>
                    {priority ? config.label : '-'}
                  </span>
                </>
              );
            })()}
          </div>
          {openDropdown === 'priority' && (
            <PortalDropdown triggerRef={priorityTriggerRef} onClose={closeDropdown}>
              <div className="w-44 max-h-64 overflow-y-auto custom-scrollbar p-0.5 flex flex-col gap-0.5">
                <div className="text-[10px] font-bold text-zinc-500 tracking-wider px-2.5 py-1.5 uppercase sticky top-0 bg-zinc-900 z-10">Priority</div>
                {PRIORITY_OPTIONS.map(p => {
                  const config = getPriorityConfig(p);
                  const isSelected = ('priority' in task && task.priority === p);
                  return (
                    <div
                      key={p}
                      className={`px-2.5 py-2 flex items-center gap-2.5 rounded-md cursor-pointer transition-colors ${
                        isSelected ? 'bg-zinc-800/80 text-white' : 'hover:bg-zinc-800/50 text-zinc-300 hover:text-zinc-100'
                      }`}
                      onClick={() => handlePriorityChange(p)}
                    >
                      <Flag className={`w-3.5 h-3.5 shrink-0 ${config.iconColor}`} />
                      <span className={`text-xs font-medium flex-1 ${config.color}`}>
                        {config.label}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                    </div>
                  );
                })}
                <div
                  className="px-2.5 py-2 flex items-center gap-2.5 hover:bg-red-500/10 text-red-400/80 hover:text-red-400 rounded-md cursor-pointer transition-colors mt-1 border-t border-zinc-800/50"
                  onClick={() => handlePriorityChange(null)}
                >
                  <span className="text-xs capitalize flex-1">Clear priority</span>
                </div>
              </div>
            </PortalDropdown>
          )}
        </div>

        {children}
      </div>
    </div>
  );
});

export const KanbanCard = memo(function KanbanCard({ task, isOverlay, onClick, isMoveDisabled, moveLockReason, listStatuses, onUnauthorizedDragAttempt }: Props) {

  const [isSubtasksExpanded, setIsSubtasksExpanded] = useState(false);
  const [hasOpenDropdown, setHasOpenDropdown] = useState(false);
  const pointerPosRef = useRef<{ x: number, y: number } | null>(null);

  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [isCreatingSubtask, setIsCreatingSubtask] = useState(false);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const currentUser = useAppStore((s) => s.currentUser);
  const removeTask = useAppStore((s) => s.removeTask);
  const editCheck = useMemo(() => canUserEditTask(task as any, currentUser), [(task as any).teamAssignAccessRole, currentUser]);

  const closeMenu = useCallback(() => setIsMenuOpen(false), []);

  const handleDuplicate = async () => {
    if (!currentUser || isDuplicating) return;
    setIsMenuOpen(false);
    setIsDuplicating(true);
    try {
      // The new task reaches every view through the `task:created` websocket broadcast
      await tasksApi.createTask({
        title: `${task.title} (copy)`,
        description: task.description,
        status: task.status,
        priority: task.priority,
        listId: task.listId,
        assigneeIds: task.assignees?.map((a) => a.id) ?? task.assigneeIds,
        teamId: task.teamId,
        creatorId: currentUser.id,
        dueDate: task.dueDate,
        startDate: task.startDate,
        assigneeRoleRestrictions: task.assigneeRoleRestrictions,
        teamAssignAccessRole: task.teamAssignAccessRole,
        afterTaskId: task.id,
      });
      toast.success('Task duplicated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to duplicate task');
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleDelete = async () => {
    try {
      // Other views (list board, other clients) drop the card via the `task:deleted` broadcast
      await tasksApi.deleteTask(task.id);
      removeTask(task.id);
      toast.success('Task deleted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete task');
      throw err;
    }
  };

  const effectivelyDisabled = isMoveDisabled || !editCheck.allowed;

  const sortableData = useMemo(() => ({
    type: 'Task',
    task,
  }), [task]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: isOverlay ? `${task.id}-overlay` : task.id,
    data: sortableData,
    disabled: effectivelyDisabled || isOverlay,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const subtasksCount = task.subtasks?.length || 0;

  const subtasksToggle = useMemo(() => {
    if (subtasksCount === 0) return null;
    return (
      <div
        className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-500 dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-zinc-700/50 -mx-1.5 px-1.5 py-1 rounded cursor-pointer transition-colors group/subtasks"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setIsSubtasksExpanded(prev => !prev); }}
      >
        {!isSubtasksExpanded && (
          <CornerDownRight className="w-3.5 h-3.5 block group-hover/subtasks:hidden shrink-0" />
        )}
        <ChevronRight
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${isSubtasksExpanded ? 'rotate-90 block' : 'hidden group-hover/subtasks:block'
            }`}
        />
        <span>{subtasksCount} subtask{subtasksCount > 1 ? 's' : ''}</span>
      </div>
    );
  }, [subtasksCount, isSubtasksExpanded]);

  const dragTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  return (
    // Outer wrapper owns the DnD ref+style so dnd-kit tracks a single stable DOM node.
    // Card visuals and subtasks are children — prevents the infinite loop that occurs
    // when a Fragment is used as the root of a useSortable component.
    <div ref={setNodeRef} style={style} className="relative">
      {/* ── Visible card ── */}
      <div
        {...attributes}
        {...listeners}
        onPointerDown={(e) => {
          pointerPosRef.current = { x: e.clientX, y: e.clientY };
          if (effectivelyDisabled) {
            dragTimeoutRef.current = setTimeout(() => {
              onUnauthorizedDragAttempt?.();
              toast.error(moveLockReason || editCheck.reason || 'You do not have permission to move this task.');
            }, 600); // Only shake if they hold for 600ms
            return;
          }
          if (listeners?.onPointerDown) {
            listeners.onPointerDown(e as any);
          }
        }}
        onPointerUp={() => {
          if (dragTimeoutRef.current) {
            clearTimeout(dragTimeoutRef.current);
            dragTimeoutRef.current = null;
          }
        }}
        onClick={(e) => {
          if (dragTimeoutRef.current) {
            clearTimeout(dragTimeoutRef.current);
            dragTimeoutRef.current = null;
          }
          if (!pointerPosRef.current) return;
          const dx = Math.abs(e.clientX - pointerPosRef.current.x);
          const dy = Math.abs(e.clientY - pointerPosRef.current.y);
          if (dx < 5 && dy < 5 && onClick) {
            onClick(task);
          }
          pointerPosRef.current = null;
        }}
        className={isDragging
          ? "bg-zinc-800/60 rounded-xl p-3.5 border border-transparent shadow-none flex flex-col gap-3"
          : `bg-card hover:bg-card/90 border border-border hover:border-zinc-400 dark:hover:border-zinc-600 rounded-xl p-3.5 group relative shadow-sm flex flex-col transition-all duration-300 ease-out hover:scale-[1.01] hover:shadow-lg hover:shadow-black/20 ${effectivelyDisabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'
          } ${isOverlay ? 'rotate-2 scale-105 shadow-xl shadow-black/40 cursor-grabbing' : ''
          } ${hasOpenDropdown || isMenuOpen ? 'z-50' : 'z-10'}`}
      >
        {!isOverlay && !isDragging && (
          <button
            ref={menuTriggerRef}
            type="button"
            title="Task actions"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setIsMenuOpen((prev) => !prev); }}
            className={`absolute top-2.5 right-2.5 z-10 p-1 rounded-md border border-border bg-card text-zinc-500 hover:text-foreground hover:bg-black/5 dark:hover:bg-zinc-700/50 transition-opacity ${isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        )}
        {isMenuOpen && (
          <PortalDropdown triggerRef={menuTriggerRef} onClose={closeMenu}>
            <div className="w-40 flex flex-col" onPointerDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                disabled={isDuplicating}
                onClick={handleDuplicate}
                className="px-2.5 py-2 flex items-center gap-2.5 text-xs text-zinc-300 hover:bg-zinc-700/50 rounded-md transition-colors disabled:opacity-50"
              >
                <Copy className="w-3.5 h-3.5" /> Duplicate
              </button>
              {editCheck.allowed && (
                <button
                  type="button"
                  onClick={() => { setIsMenuOpen(false); setIsConfirmDeleteOpen(true); }}
                  className="px-2.5 py-2 flex items-center gap-2.5 text-xs text-red-400/80 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
            </div>
          </PortalDropdown>
        )}
        <div className={isDragging ? 'opacity-0 pointer-events-none flex flex-col gap-3 w-full h-full' : 'contents'}>
          <CardContent task={task} listStatuses={listStatuses} onDropdownOpenChange={setHasOpenDropdown}>
            {subtasksToggle}
          </CardContent>
        </div>
      </div>

      {/* ── Subtasks: tree-indented, outside the draggable card ── */}
      {subtasksCount > 0 && isSubtasksExpanded && !isDragging && (
        <div className="mt-1 ml-3">
          {task.subtasks.map((sub, idx) => {
            const isLast = false; // Add Subtask button is always the last item visually
            return (
              <div key={sub.id} className="relative flex items-start" onClick={(e) => e.stopPropagation()}>
                {/* Vertical line — stops at elbow midpoint on last item */}
                <div
                  className="absolute left-0 w-px bg-zinc-700/50"
                  style={{ top: 0, bottom: isLast ? '50%' : 0 }}
                />
                {/* Horizontal elbow */}
                <div
                  className="absolute left-0 h-px bg-zinc-700/50"
                  style={{ top: '1.25rem', width: 10 }}
                />
                {/* Subtask card */}
                <div
                  className="flex-1 min-w-0 ml-3 mb-1.5 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-2.5 py-2 hover:border-zinc-600 hover:bg-zinc-800 transition-all cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    const url = new URL(window.location.href);
                    url.searchParams.set('task', task.id);
                    url.searchParams.set('subtask', sub.id);
                    window.history.replaceState(null, '', url.pathname + url.search);
                    if (onClick) onClick(task);
                  }}
                >
                  <CardContent task={{ ...sub, list: task.list } as any} isSubtask={true} listStatuses={listStatuses} />
                </div>
              </div>
            );
          })}

          {isAddingSubtask ? (
            <div className="relative flex items-start" onClick={(e) => e.stopPropagation()}>
              <div
                className="absolute left-0 w-px bg-zinc-700/50"
                style={{ top: 0, bottom: '50%' }}
              />
              <div
                className="absolute left-0 h-px bg-zinc-700/50"
                style={{ top: '1.25rem', width: 10 }}
              />
              <div className="flex-1 min-w-0 ml-3 mb-1.5 bg-zinc-800/80 border border-indigo-500/50 rounded-lg px-2.5 py-2">
                <input
                  autoFocus
                  type="text"
                  disabled={isCreatingSubtask}
                  placeholder="Subtask title..."
                  value={newSubtaskTitle}
                  onChange={(e) => setNewSubtaskTitle(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && newSubtaskTitle.trim() && !isCreatingSubtask) {
                      try {
                        setIsCreatingSubtask(true);
                        await tasksApi.createSubtask(task.id, {
                          title: newSubtaskTitle.trim(),
                          status: 'PENDING',
                          listId: 'listId' in task ? task.listId : undefined
                        });
                        setNewSubtaskTitle('');
                        setIsAddingSubtask(false);
                        toast.success('Subtask created');
                      } catch (err: any) {
                        toast.error('Failed to create subtask');
                      } finally {
                        setIsCreatingSubtask(false);
                      }
                    }
                    if (e.key === 'Escape') {
                      setIsAddingSubtask(false);
                      setNewSubtaskTitle('');
                    }
                  }}
                  onBlur={() => {
                    setIsAddingSubtask(false);
                    setNewSubtaskTitle('');
                  }}
                  className="w-full bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-500 dark:text-zinc-500"
                />
              </div>
            </div>
          ) : (
            <div className="relative flex items-start" onClick={(e) => e.stopPropagation()}>
              <div
                className="absolute left-0 w-px bg-zinc-700/50"
                style={{ top: 0, bottom: '50%' }}
              />
              <div
                className="absolute left-0 h-px bg-zinc-700/50"
                style={{ top: '1.25rem', width: 10 }}
              />
              <button
                onClick={() => setIsAddingSubtask(true)}
                className="ml-3 mt-1.5 flex items-center gap-2 text-zinc-500 dark:text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 hover:bg-zinc-800/30 rounded text-xs font-medium"
              >
                <Plus className="w-3 h-3" /> Add Subtask
              </button>
            </div>
          )}
        </div>
      )}

      {/* Portaled so the card's hover transform doesn't trap the fixed overlay, and wrapped so
          clicks inside the modal don't bubble (via React's tree) into the card's open/drag handlers */}
      {isConfirmDeleteOpen && typeof document !== 'undefined' && createPortal(
        <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <ConfirmDeleteModal
            isOpen={isConfirmDeleteOpen}
            onClose={() => setIsConfirmDeleteOpen(false)}
            onConfirm={handleDelete}
            title="Delete Task"
            itemName={task.title}
          />
        </div>,
        document.body
      )}
    </div>
  );
});


