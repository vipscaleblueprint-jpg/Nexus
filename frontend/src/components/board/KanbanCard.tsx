import { useSortable } from '@dnd-kit/sortable';
import { memo, useState, useMemo, useRef, useEffect } from 'react';
import { debugLog } from './debug';
import { createPortal } from 'react-dom';
import { CSS } from '@dnd-kit/utilities';
import { Task, Subtask } from '@/lib/types';
import { CheckSquare, Calendar, User, Flag, AlignLeft, CheckCircle2, CircleDashed, Tag, Lock, CornerDownRight, ChevronDown, ChevronRight, MoreHorizontal, Plus, Pencil, X } from 'lucide-react';
import { tasksApi, usersApi } from '@/api';
import { useAppStore } from '@/lib/store';
import { toast } from '@/lib/toast';
import { PortalDropdown } from '@/components/ui/PortalDropdown';
import { canUserEditTask } from '@/lib/permissions';

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-zinc-400',
  MEDIUM: 'text-blue-400',
  HIGH: 'text-orange-400',
  URGENT: 'text-red-400',
};

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
  const [openDropdown, setOpenDropdown] = useState<'status'|'assignee'|'date'|'priority'|null>(null);
  const [dbUsers, setDbUsers] = useState<any[]>([]);
  const currentUser = useAppStore((s) => s.currentUser);

  useEffect(() => {
    let cancelled = false;
    if (openDropdown === 'assignee' && dbUsers.length === 0) {
      usersApi.getUsers().then(res => {
        if (!cancelled && res?.users) setDbUsers(res.users);
      }).catch(console.error);
    }
    return () => { cancelled = true; };
  }, [openDropdown, dbUsers.length]);

  const handleStatusChange = async (newStatus: string) => {
    if (!currentUser) return;
    try {
      await tasksApi.moveTask(task.id, newStatus, 'listId' in task ? task.listId : undefined, currentUser.id);
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
      await tasksApi.updateTask(task.id, { priority: (p || undefined) as any, userId: currentUser.id });
      toast.success(p ? `Priority set to ${p}` : 'Priority cleared');
    } catch (e: any) {
      toast.error(e.message || 'Failed to update priority');
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
    if (!t.assigneeRoleRestrictions?.length) return dbUsers;
    const requiredRoles = t.assigneeRoleRestrictions.map((r: string) => r.trim().toUpperCase());
    return dbUsers.filter((u: any) => {
      const uRoles = [u.primaryRole, u.secondaryRole, u.tertiaryRole, u.minorRole]
        .filter(Boolean).map((r: any) => r.trim().toUpperCase());
      return requiredRoles.some((req: string) => uRoles.includes(req));
    });
  }, [dbUsers, (task as any).assigneeRoleRestrictions]);

  const handleAssigneeToggle = async (user: any) => {
    if (!currentUser) return;
    const currentAssignees = assignees;
    const isAssigned = currentAssignees.some((a: any) => a.id === user.id);
    const newAssignees = isAssigned ? currentAssignees.filter((a: any) => a.id !== user.id) : [...currentAssignees, user];
    const assigneeIds = newAssignees.map(a => a.id);
    const primaryAssignee = newAssignees.length > 0 ? newAssignees[0] : null;

    setTask(prev => ({ ...prev, assignees: newAssignees, assignee: primaryAssignee, assigneeId: primaryAssignee?.id || null, assigneeIds }));

    try {
      await tasksApi.updateTask(task.id, {
        assigneeIds,
        assigneeId: primaryAssignee?.id || null,
        userId: currentUser.id,
      });
    } catch (e: any) {
      toast.error(e.message || 'Failed to update assignee');
      setTask(initialTask);
    }
  };

  const handleClearAssignees = async () => {
    if (!currentUser) return;
    
    setTask(prev => ({ ...prev, assignees: [], assignee: null, assigneeId: null, assigneeIds: [] }));
    
    try {
      await tasksApi.updateTask(task.id, {
        assigneeIds: [],
        assigneeId: null,
        userId: currentUser.id,
      });
      toast.success('Assignees cleared');
    } catch (e: any) {
      toast.error(e.message || 'Failed to clear assignees');
      setTask(initialTask);
    }
  };
  const statusTriggerRef = useRef<HTMLDivElement>(null);
  const assigneeTriggerRef = useRef<HTMLDivElement>(null);
  const dateTriggerRef = useRef<HTMLDivElement>(null);
  const priorityTriggerRef = useRef<HTMLDivElement>(null);
  const descTriggerRef = useRef<HTMLDivElement>(null);

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
      checklistTotal += c.items?.length || 0;
      checklistCompleted += c.items?.filter((i: any) => i.completed).length || 0;
    });
  }

  const breadcrumbs = 'list' in task && task.list ? `In ${task.list.space?.name || 'Space'} | ${task.list.folder?.name || 'Folder'} | ${task.list.name}` : '';
  const statusStr = ('status' in task && task.status) ? task.status : ('completed' in task && task.completed ? 'CLOSED' : 'PENDING');
  const isClosed = statusStr.toUpperCase() === 'CLOSED' || ('completed' in task && task.completed);

  // Field hover class
  const fieldHoverClass = "flex items-center gap-2 text-[11px] hover:bg-zinc-700/50 -mx-1.5 px-1.5 py-1 rounded cursor-pointer transition-colors";

  return (
    <div className="flex flex-col w-full text-left">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[13px] font-semibold text-zinc-200 leading-tight">
          {task.title}
        </h4>
      </div>

      {!isSubtask && breadcrumbs && (
        <div className="text-[11px] text-zinc-500 truncate mt-1">
          {breadcrumbs}
        </div>
      )}

      {isSubtask && breadcrumbs && (
        <div className="text-[11px] text-zinc-500 truncate mt-1">
          {breadcrumbs}
        </div>
      )}

      {/* Description Icon */}
      <div className="mt-2 relative inline-flex">
        <div
          ref={descTriggerRef}
          className={`flex items-center ${plainTextDescription ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-600 hover:text-zinc-400'} hover:bg-zinc-700/50 p-1 -ml-1 rounded cursor-pointer transition-colors`}
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
                {plainTextDescription || <span className="italic text-zinc-500">No description provided.</span>}
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
            onClick={(e) => { e.stopPropagation(); if (canEditTask) setOpenDropdown(openDropdown === 'status' ? null : 'status'); }}
          >
            {isClosed ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <CircleDashed className="w-3.5 h-3.5 text-emerald-500" />
            )}
            <span className="uppercase font-semibold">{statusStr}</span>
          </div>
          {openDropdown === 'status' && (
            <PortalDropdown triggerRef={statusTriggerRef} onClose={closeDropdown}>
              <div className="w-36 max-h-64 overflow-y-auto custom-scrollbar">
                <div className="px-2 py-1.5 text-[11px] text-zinc-500 font-semibold uppercase sticky top-0 bg-zinc-800">Change Status</div>
                {listStatuses.length > 0 ? (
                  listStatuses.map(s => (
                    <div 
                      key={s.id || s.name} 
                      className={`px-2 py-1.5 text-xs rounded cursor-pointer transition-colors font-medium ${statusStr === s.name ? 'bg-indigo-500/20 text-indigo-300' : 'text-zinc-300 hover:bg-zinc-700/50'}`} 
                      onClick={() => handleStatusChange(s.name)}
                    >
                      {s.name}
                    </div>
                  ))
                ) : (
                  ['PENDING', 'IN PROGRESS', 'COMPLETED', 'CLOSED'].map(s => (
                    <div key={s} className="px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700/50 rounded cursor-pointer transition-colors font-medium" onClick={() => handleStatusChange(s)}>
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
          <div className={`${fieldHoverClass} text-zinc-400`}>
            <CheckSquare className="w-3.5 h-3.5" />
            <span>{checklistCompleted}/{checklistTotal}</span>
          </div>
        )}

        {/* Assignees */}
        <div className="relative flex items-center group/assignee">
          <div
            ref={assigneeTriggerRef}
            className={`${fieldHoverClass} text-zinc-400 max-w-[150px]`}
            onClick={(e) => { e.stopPropagation(); if (canEditTask) setOpenDropdown(openDropdown === 'assignee' ? null : 'assignee'); }}
          >
            <User className="w-3.5 h-3.5 shrink-0" />
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
              <span>-</span>
            )}
          </div>
          {assignees.length > 0 && canEditTask && (
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
              <div className="w-48 max-h-64 overflow-y-auto custom-scrollbar">
                <div className="px-2 py-1.5 text-[11px] text-zinc-500 font-semibold uppercase sticky top-0 bg-zinc-800">Assign To</div>
                {assignableUsers.length > 0 ? (
                  assignableUsers.map(user => {
                    const isAssigned = assignees.some((a: any) => a.id === user.id);
                    return (
                      <div 
                        key={user.id} 
                        className="px-2 py-1.5 flex items-center gap-2 hover:bg-zinc-700/50 rounded cursor-pointer transition-colors"
                        onClick={() => handleAssigneeToggle(user)}
                      >
                        {user.avatarUrl ? (
                          <img src={user.avatarUrl} alt={user.name} className="w-5 h-5 rounded-full object-cover" />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-[9px] text-white font-bold">
                            {(user.name || 'U').charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className={`text-xs truncate flex-1 ${isAssigned ? 'text-indigo-400 font-semibold' : 'text-zinc-300'}`}>
                          {user.name}
                        </span>
                        {isAssigned && <CheckSquare className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                      </div>
                    );
                  })
                ) : (
                  <div className="px-2 py-2 text-xs text-zinc-400 italic">Loading assignees...</div>
                )}
              </div>
            </PortalDropdown>
          )}
        </div>

        {/* Due Date */}
        <div className="relative">
          <div
            ref={dateTriggerRef}
            className={`${fieldHoverClass} text-zinc-400`}
            onClick={(e) => { e.stopPropagation(); if (canEditTask) setOpenDropdown(openDropdown === 'date' ? null : 'date'); }}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>
              {('dueDate' in task && task.dueDate) ? new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '-'}
            </span>
          </div>
          {openDropdown === 'date' && (
            <PortalDropdown triggerRef={dateTriggerRef} onClose={closeDropdown}>
              <div className="w-48 p-2">
                <div className="text-[11px] text-zinc-500 font-semibold uppercase mb-2">Set Due Date</div>
                <div className="text-xs text-zinc-400 italic">Date picker would appear here...</div>
              </div>
            </PortalDropdown>
          )}
        </div>

        {/* Priority */}
        <div className="relative">
          <div
            ref={priorityTriggerRef}
            className={`${fieldHoverClass} text-zinc-400`}
            onClick={(e) => { e.stopPropagation(); if (canEditTask) setOpenDropdown(openDropdown === 'priority' ? null : 'priority'); }}
          >
            <Flag className="w-3.5 h-3.5" />
            <span>{('priority' in task && task.priority) ? task.priority : '-'}</span>
          </div>
          {openDropdown === 'priority' && (
            <PortalDropdown triggerRef={priorityTriggerRef} onClose={closeDropdown}>
              <div className="w-32">
                <div className="px-2 py-1.5 text-[11px] text-zinc-500 font-semibold uppercase">Set Priority</div>
                {Object.keys(PRIORITY_COLORS).map(p => (
                  <div key={p} className={`px-2 py-1.5 text-xs hover:bg-zinc-700/50 rounded cursor-pointer transition-colors font-medium ${PRIORITY_COLORS[p]}`} onClick={() => handlePriorityChange(p)}>
                    {p}
                  </div>
                ))}
                <div className="px-2 py-1.5 text-xs hover:bg-zinc-700/50 rounded cursor-pointer transition-colors font-medium text-zinc-400" onClick={() => handlePriorityChange(null)}>
                  CLEAR
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
  debugLog('KanbanCard', `Render task=${task.id}, isOverlay=${isOverlay}`);
  const [isSubtasksExpanded, setIsSubtasksExpanded] = useState(false);
  const [hasOpenDropdown, setHasOpenDropdown] = useState(false);
  const pointerPosRef = useRef<{x: number, y: number} | null>(null);

  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [isCreatingSubtask, setIsCreatingSubtask] = useState(false);

  const currentUser = useAppStore((s) => s.currentUser);
  const editCheck = useMemo(() => canUserEditTask(task as any, currentUser), [(task as any).teamAssignAccessRole, currentUser]);
  
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
        className="flex items-center gap-2 text-[11px] text-zinc-400 hover:bg-zinc-700/50 -mx-1.5 px-1.5 py-1 rounded cursor-pointer transition-colors group/subtasks"
        onClick={(e) => { e.stopPropagation(); setIsSubtasksExpanded(prev => !prev); }}
      >
        {!isSubtasksExpanded && (
          <CornerDownRight className="w-3.5 h-3.5 block group-hover/subtasks:hidden shrink-0" />
        )}
        <ChevronRight
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${
            isSubtasksExpanded ? 'rotate-90 block' : 'hidden group-hover/subtasks:block'
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
          : `bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 rounded-xl p-3.5 group relative shadow-sm flex flex-col transition-all duration-300 ease-out hover:scale-[1.01] hover:shadow-lg hover:shadow-black/20 ${
            effectivelyDisabled ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'
          } ${
            isOverlay ? 'rotate-2 scale-105 shadow-xl shadow-black/40 cursor-grabbing' : ''
          } ${hasOpenDropdown ? 'z-50' : 'z-10'}`}
      >
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
                <div className="flex-1 min-w-0 ml-3 mb-1.5 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-2.5 py-2 hover:border-zinc-600 hover:bg-zinc-800 transition-all cursor-pointer">
                  <CardContent task={{...sub, list: task.list} as any} isSubtask={true} />
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
                    className="w-full bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-500"
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
                  className="ml-3 mt-1.5 flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 hover:bg-zinc-800/30 rounded text-xs font-medium"
                >
                  <Plus className="w-3 h-3" /> Add Subtask
                </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
