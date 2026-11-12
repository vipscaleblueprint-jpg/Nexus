'use client';

import React, { useState, useEffect, useRef } from 'react';
import { TaskMapItem, TaskMapOption } from '@/api/taskMap';
import { tasksApi } from '@/api/tasks';
import { TaskMapStatusDropdown } from './TaskMapStatusDropdown';
import { TaskDescriptionButton } from './TaskDescriptionButton';
import { UserRoleBadge } from './UserRoleBadge';
import {
  UserCheck,
  Pin,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Lock,
  ArrowLeft,
} from 'lucide-react';
import { format } from 'date-fns';
import { isCrmUser, hasCrmAccess, canTransitionTaskStatus, canUserEditTask, canUserMoveTask } from '@/lib/permissions';
import { UncheckedAuditsModal } from '@/components/modals/UncheckedAuditsModal';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';
import {
  CardStatusDropdown,
  CardPriorityDropdown,
  ColumnPriorityDropdown,
  matchesPriorityFilter,
  matchesSearchFilter,
} from './TaskMapCardControls';
import { ColumnClientDropdown } from './ColumnClientDropdown';
import { ColumnSubStatusDropdown, matchesSubStatusFilter } from './ColumnSubStatusDropdown';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';

interface Props {
  tasks: TaskMapItem[];
  availablePool: TaskMapItem[];
  options: TaskMapOption[];
  allUsers?: any[];
  shiftUsers?: any[];
  onStatusChange: (taskId: string, newStatuses: string[]) => void;
  onOptionsUpdated: () => void;
  onOpenDetail: (task: TaskMapItem) => void;
  onDataRefresh: () => void;
  onTaskUpdate?: (taskId: string, fields: Partial<TaskMapItem>) => Promise<void> | void;
  onSwitchToBoard?: () => void;
  clients?: Array<{ id: string; name: string; count?: number }>;
  showAdminTasks?: boolean;
  onToggleAdminTasks?: () => void;
  search?: string;
}

// Draggable Card Wrapper
const DraggableTaskCard: React.FC<{
  task: TaskMapItem;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ task, disabled = false, children }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...(disabled ? {} : listeners)}
      {...(disabled ? {} : attributes)}
      className={`touch-none transition-all duration-200 ease-out ${isDragging
        ? 'opacity-25 scale-[0.98] border border-dashed border-[#22A3AE] rounded-xl bg-zinc-900/40 pointer-events-none'
        : disabled
          ? 'cursor-default'
          : 'cursor-grab active:cursor-grabbing hover:scale-[1.01]'
        }`}
    >
      {children}
    </div>
  );
};

// Droppable Column Wrapper
const DroppableColumn: React.FC<{
  id: string;
  children: React.ReactNode;
  className?: string;
}> = ({ id, children, className }) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`${className || ''} transition-all duration-200 ${isOver ? 'ring-2 ring-[#22A3AE]/70 bg-cyan-950/25 shadow-xl shadow-cyan-950/40 scale-[1.005]' : ''
        }`}
    >
      {children}
    </div>
  );
};

export const TaskMapCrmView: React.FC<Props> = ({
  tasks = [],
  availablePool = [],
  options = [],
  allUsers = [],
  shiftUsers = [],
  onStatusChange,
  onOptionsUpdated,
  onOpenDetail,
  onDataRefresh,
  onTaskUpdate,
  onSwitchToBoard,
  clients = [],
  showAdminTasks = false,
  onToggleAdminTasks,
  search = '',
}) => {
  const currentUser = useAppStore((s) => s.currentUser);
  const userHasAccess = hasCrmAccess(currentUser);

  const [activeDragTask, setActiveDragTask] = useState<TaskMapItem | null>(null);
  const [blockedAuditAlert, setBlockedAuditAlert] = useState<{
    isOpen: boolean;
    task: TaskMapItem | null;
    targetStatus: string;
    uncheckedAudits: string[];
    openSubtasks: string[];
  }>({
    isOpen: false,
    task: null,
    targetStatus: '',
    uncheckedAudits: [],
    openSubtasks: [],
  });
  const boardScrollRef = useRef<HTMLDivElement>(null);

  const cleanSearch = (search || '').trim().toLowerCase();
  const isCrmMemberSearchMatch = (u: any) => {
    if (!cleanSearch || !u) return false;
    const name = (u.name || '').trim().toLowerCase();
    const email = (u.email || '').trim().toLowerCase();
    return name.includes(cleanSearch) || email.includes(cleanSearch);
  };

  useEffect(() => {
    if (cleanSearch && boardScrollRef.current) {
      boardScrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    }
  }, [cleanSearch]);

  // Column controls: Priority filter, Sub-status filter, Client filter, Admin toggle, search, pin, collapse
  const [columnPriorityFilters, setColumnPriorityFilters] = useState<Record<string, string>>({});
  const [columnSubStatusFilters, setColumnSubStatusFilters] = useState<Record<string, string>>({});
  const [columnClientFilters, setColumnClientFilters] = useState<Record<string, string[] | 'ALL'>>({});
  const [columnShowAdmin, setColumnShowAdmin] = useState<Record<string, boolean>>({});
  const [columnSearches, setColumnSearches] = useState<Record<string, string>>({});
  const [columnSearchOpen, setColumnSearchOpen] = useState<Record<string, boolean>>({});

  const [pinnedColumns, setPinnedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem('nexus_crm_pinned_columns');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem('nexus_crm_collapsed_columns');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const togglePinColumn = (columnId: string) => {
    setPinnedColumns((prev) => {
      const next = { ...prev, [columnId]: !prev[columnId] };
      try {
        localStorage.setItem('nexus_crm_pinned_columns', JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save pinned crm columns', e);
      }
      return next;
    });
  };

  const toggleCollapseColumn = (columnId: string) => {
    setCollapsedColumns((prev) => {
      const next = { ...prev, [columnId]: !prev[columnId] };
      try {
        localStorage.setItem('nexus_crm_collapsed_columns', JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save collapsed crm columns', e);
      }
      return next;
    });
  };

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Discover all users who hold a CRM role
  const crmUsers = React.useMemo(() => {
    const map = new Map<string, any>();
    const candidates = [
      ...(currentUser ? [currentUser] : []),
      ...(allUsers || []),
      ...(shiftUsers || []),
    ];
    for (const u of candidates) {
      if (!u || !u.id) continue;
      if (map.has(u.id)) continue;
      if (isCrmUser(u) || (currentUser?.id === u.id && hasCrmAccess(currentUser))) {
        map.set(u.id, u);
      }
    }
    const list = Array.from(map.values());
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [allUsers, shiftUsers, currentUser]);

  // Combined tasks
  const combinedTasks = React.useMemo(() => {
    const map = new Map<string, TaskMapItem>();
    for (const t of [...tasks, ...availablePool]) {
      if (!map.has(t.id)) map.set(t.id, t);
    }
    return Array.from(map.values());
  }, [tasks, availablePool]);

  // Check if a task is under Admin folder
  const isTaskUnderAdmin = (t: TaskMapItem) => {
    if (t.isAdminTask) return true;
    const fName = (t.list?.folder?.name || '').toLowerCase().trim();
    const lName = (t.list?.name || '').toLowerCase().trim();
    const ADMIN_LIST_NAMES = new Set([
      'admin | jenesia red',
      'harmony',
      'jenesia red',
      'jenesia red | personal',
      'snaply',
      'vip scale',
      'xfnite',
    ]);
    return fName === 'admin' || fName.includes('admin') || lName === 'admin' || ADMIN_LIST_NAMES.has(lName);
  };

  // Check if a task belongs on the CRM board:
  // - CRM tasks (status == 'CRM')
  // - Sent tasks (status == 'Waiting' or 'Sent')
  // - Closed/Done tasks (with CRM markers/history)
  const isCrmStatus = (t: TaskMapItem) => {
    const s = (t.status || '').toUpperCase().trim();
    const mapStatuses = (t.taskMap?.statuses || []).map((x) =>
      x.toUpperCase().replace(/[\s_-]+/g, '')
    );
    const hasCrmMarker =
      mapStatuses.includes('CRM') ||
      mapStatuses.includes('TOSEND') ||
      mapStatuses.includes('SENT') ||
      mapStatuses.includes('OUTREACHSENT') ||
      mapStatuses.includes('CLIENTSENT') ||
      mapStatuses.includes('FOLLOWUP');

    return (
      s === 'CRM' ||
      s === 'WAITING' ||
      s === 'SENT' ||
      ((s === 'CLOSED' || s === 'DONE') && hasCrmMarker)
    );
  };

  // Filter for CRM status (Admin & Client filtering applied per column)
  const filteredCrmTasks = React.useMemo(() => {
    return combinedTasks.filter((t) => {
      // CRITICAL: A task MUST have CRM/Waiting/Closed-CRM status to appear on the CRM board!
      if (!isCrmStatus(t)) return false;
      return true;
    });
  }, [combinedTasks]);

  // Check if task is CRM completed / closed
  const isCrmCompleted = (t: TaskMapItem) => {
    const s = (t.status || '').toUpperCase().trim();
    return s === 'DONE' || s === 'CLOSED';
  };

  // Check if task is Sent (waiting for client response)
  const isCrmSent = (t: TaskMapItem) => {
    if (isCrmCompleted(t)) return false;
    const s = (t.status || '').toUpperCase().trim();
    return s === 'WAITING' || s === 'SENT';
  };

  // Check if task is assigned to a specific CRM member (strictly status CRM)
  const isTaskAssignedToCrmMember = (task: TaskMapItem, crmMember: any) => {
    if (isCrmCompleted(task) || isCrmSent(task)) return false;
    // Task must be in CRM status
    const s = (task.status || '').toUpperCase().trim();
    if (s !== 'CRM') return false;

    // Direct assignee check
    if (task.assignee?.id === crmMember.id) return true;
    if ((task.assignees || []).some((u) => u.id === crmMember.id)) return true;

    // Tag match
    const mapStatuses = (task.taskMap?.statuses || []).map((s) => s.toUpperCase().trim());
    const memberNameUpper = (crmMember.name || '').toUpperCase().trim();
    const first = memberNameUpper.split(' ')[0];
    if (mapStatuses.includes(memberNameUpper)) return true;
    if (first && mapStatuses.includes(first)) return true;
    if (mapStatuses.includes(crmMember.id.toUpperCase())) return true;

    return false;
  };

  // General CRM Pool: tasks needing client outreach / CRM that are not yet assigned to a specific CRM member (strictly status CRM)
  const isGeneralCrmPool = (t: TaskMapItem) => {
    if (isCrmCompleted(t) || isCrmSent(t)) return false;
    const s = (t.status || '').toUpperCase().trim();
    if (s !== 'CRM') return false;
    if (crmUsers.some((u) => isTaskAssignedToCrmMember(t, u))) return false;

    return true;
  };

  const poolTasks = filteredCrmTasks.filter(isGeneralCrmPool);
  const sentTasks = filteredCrmTasks.filter(isCrmSent);
  const completedTasks = filteredCrmTasks.filter(
    (t) =>
      isCrmCompleted(t) &&
      ((t.status || '').toUpperCase() === 'CLOSED' ||
        (t.status || '').toUpperCase() === 'DONE' ||
        (t.taskMap?.statuses || []).some((s) => {
          const up = s.toUpperCase();
          return up.includes('CRM') || up.includes('SENT') || up.includes('OUTREACH');
        }))
  );

  // DnD Handlers
  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as TaskMapItem;
    if (!task) return;
    setActiveDragTask(task);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragTask(null);

    if (!over) return;

    const taskId = active.id as string;
    const targetColumnId = over.id as string;
    const task = combinedTasks.find((t) => t.id === taskId);
    if (!task) return;

    const currentStatuses = task.taskMap?.statuses || [];

    // Strip old CRM member tags
    let updatedStatuses = currentStatuses.filter((s) => {
      const up = s.toUpperCase().trim();
      return !crmUsers.some((u) => {
        const nameUp = (u.name || '').toUpperCase().trim();
        const first = nameUp.split(' ')[0];
        return up === nameUp || up === first || up === u.id.toUpperCase();
      });
    });

    if (targetColumnId === 'col-crm-pool') {
      updatedStatuses = updatedStatuses.filter(
        (s) => !['SENT', 'OUTREACH SENT', 'CLIENT SENT', 'WAITING'].includes(s.toUpperCase().trim())
      );
      if (!updatedStatuses.includes('CRM')) updatedStatuses.push('CRM');
      toast.info('Task moved to General CRM Pool');
      onStatusChange(taskId, updatedStatuses);
      if ((task.status || '').toUpperCase() !== 'CRM') {
        const transitionCheck = canTransitionTaskStatus(task, 'CRM');
        if (!transitionCheck.allowed) {
          if (transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
            window.dispatchEvent(
              new CustomEvent('task:highlight-audits', {
                detail: {
                  taskId: task.id,
                  targetStatus: 'CRM',
                  uncheckedAudits: transitionCheck.uncheckedAudits,
                  openSubtasks: transitionCheck.openSubtasks,
                },
              })
            );
          }
          setBlockedAuditAlert({
            isOpen: true,
            task,
            targetStatus: 'CRM',
            uncheckedAudits: transitionCheck.uncheckedAudits,
            openSubtasks: transitionCheck.openSubtasks,
          });
          toast.error(transitionCheck.reason || 'Cannot move task to CRM');
          return;
        }
        if (onTaskUpdate) {
          await onTaskUpdate(taskId, { status: 'CRM' });
        } else {
          await tasksApi.updateTask(taskId, { status: 'CRM' } as any).catch(console.error);
        }
      }
    } else if (targetColumnId === 'col-crm-sent') {
      // 1. Task edit permission
      const editCheck = canUserEditTask(task as any, currentUser);
      if (!editCheck.allowed) {
        toast.error(editCheck.reason || 'You do not have permission to edit this task.');
        return;
      }

      // 2. Status transition check for Waiting
      const transitionCheck = canTransitionTaskStatus(task, 'Waiting');
      if (!transitionCheck.allowed) {
        if (transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
          window.dispatchEvent(
            new CustomEvent('task:highlight-audits', {
              detail: {
                taskId: task.id,
                targetStatus: 'Waiting',
                uncheckedAudits: transitionCheck.uncheckedAudits,
                openSubtasks: transitionCheck.openSubtasks,
              },
            })
          );
        }
        setBlockedAuditAlert({
          isOpen: true,
          task,
          targetStatus: 'Waiting',
          uncheckedAudits: transitionCheck.uncheckedAudits,
          openSubtasks: transitionCheck.openSubtasks,
        });
        toast.error(transitionCheck.reason || 'Cannot move task to Waiting');
        return;
      }

      updatedStatuses = updatedStatuses.filter(
        (s) => s.toUpperCase() !== 'CRM' && s.toUpperCase() !== 'TO SEND'
      );
      if (!updatedStatuses.includes('Sent')) updatedStatuses.push('Sent');
      toast.success('Task marked Sent — status updated to Waiting');
      onStatusChange(taskId, updatedStatuses);
      if (onTaskUpdate) {
        await onTaskUpdate(taskId, { status: 'Waiting' });
      } else {
        await tasksApi.updateTask(taskId, { status: 'Waiting' } as any).catch(console.error);
        onDataRefresh();
      }
    } else if (targetColumnId === 'col-crm-closed' || targetColumnId === 'col-crm-completed') {
      // 1. Task edit permission
      const editCheck = canUserEditTask(task as any, currentUser);
      if (!editCheck.allowed) {
        toast.error(editCheck.reason || 'You do not have permission to edit this task.');
        return;
      }

      // 2. Status transition rulings: all subtasks closed, all required audits checked!
      const transitionCheck = canTransitionTaskStatus(task, 'Closed');
      if (!transitionCheck.allowed) {
        if (transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
          window.dispatchEvent(
            new CustomEvent('task:highlight-audits', {
              detail: {
                taskId: task.id,
                targetStatus: 'Closed',
                uncheckedAudits: transitionCheck.uncheckedAudits,
                openSubtasks: transitionCheck.openSubtasks,
              },
            })
          );
        }
        setBlockedAuditAlert({
          isOpen: true,
          task,
          targetStatus: 'Closed',
          uncheckedAudits: transitionCheck.uncheckedAudits,
          openSubtasks: transitionCheck.openSubtasks,
        });
        toast.error(transitionCheck.reason || 'Cannot move task to Closed');
        return;
      }

      if (!updatedStatuses.includes('Outreach Sent')) updatedStatuses.push('Outreach Sent');
      toast.success('Task marked Closed');
      onStatusChange(taskId, updatedStatuses);
      if (onTaskUpdate) {
        await onTaskUpdate(taskId, { status: 'Closed' });
      } else {
        await tasksApi.updateTask(taskId, { status: 'Closed' } as any).catch(console.error);
      }
    } else if (targetColumnId.startsWith('col-crm-member-')) {
      const memberId = targetColumnId.replace('col-crm-member-', '');
      const member = crmUsers.find((u) => u.id === memberId);
      if (member) {
        // Only assign to member, never mark as Sent
        updatedStatuses = updatedStatuses.filter(
          (s) => !['SENT', 'OUTREACH SENT', 'CLIENT SENT', 'WAITING'].includes(s.toUpperCase().trim())
        );
        if (!updatedStatuses.includes('CRM')) updatedStatuses.push('CRM');
        toast.success(`Task assigned to ${member.name} for CRM outreach`);
        onStatusChange(taskId, updatedStatuses);

        if (onTaskUpdate) {
          await onTaskUpdate(taskId, { assigneeId: member.id, status: 'CRM' });
        } else {
          await tasksApi
            .updateTask(taskId, { assigneeId: member.id, status: 'CRM' } as any)
            .catch(console.error);
        }
      }
    }
  };

  // Helper options for sub-status dropdown in CRM (includes 'To send', 'Sent', 'Follow up', 'Closed')
  const getCrmOptions = (task: TaskMapItem): TaskMapOption[] => [
    { id: 'opt-crm-tosend', label: 'To send', color: '#22A3AE', textColor: '#ffffff', order: 0 },
    { id: 'opt-crm-sent', label: 'Sent', color: '#f59e0b', textColor: '#ffffff', order: 1 },
    { id: 'opt-crm-followup', label: 'Follow up', color: '#38bdf8', textColor: '#ffffff', order: 2 },
    { id: 'opt-crm-closed', label: 'Closed', color: '#10b981', textColor: '#ffffff', order: 3 },
  ];

  // Assemble full columns array
  interface CrmColumnDef {
    id: string;
    title: string;
    subtitle: string;
    badgeLabel?: string;
    badgeClass?: string;
    dotColor: string;
    tasks: TaskMapItem[];
    isMember?: boolean;
    memberUser?: any;
  }

  const allColumns: CrmColumnDef[] = [
    {
      id: 'col-crm-pool',
      title: 'CRM Pool',
      subtitle: 'Incoming client outreach & communication pool',
      badgeLabel: 'Pool',
      badgeClass: 'bg-[#22A3AE]/20 text-[#22A3AE] border-[#22A3AE]/30',
      dotColor: 'bg-[#22A3AE]',
      tasks: poolTasks,
    },
    ...crmUsers.map((member) => {
      const memberTasks = filteredCrmTasks.filter((t) => isTaskAssignedToCrmMember(t, member));
      return {
        id: `col-crm-member-${member.id}`,
        title: member.name || 'CRM',
        subtitle: `Client outreach queue for ${member.name}`,
        badgeLabel: 'CRM',
        badgeClass: 'bg-[#22A3AE]/20 text-[#22A3AE] border-[#22A3AE]/30',
        dotColor: 'bg-[#22A3AE]',
        tasks: memberTasks,
        isMember: true,
        memberUser: member,
      };
    }),
    {
      id: 'col-crm-sent',
      title: 'Sent',
      subtitle: 'Outreach sent — waiting for client response',
      badgeLabel: 'Waiting',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800',
      dotColor: 'bg-amber-500',
      tasks: sentTasks,
    },
    {
      id: 'col-crm-closed',
      title: 'Closed',
      subtitle: 'Closed & verified tasks',
      badgeLabel: 'Closed',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
      dotColor: 'bg-emerald-500',
      tasks: completedTasks,
    },
  ];

  // Priority ranking & sorting for CRM member columns:
  // 1. Search-matching CRM columns move to the front
  // 2. Pinned columns come next
  // 3. Current viewing user column next (showing on the right side of CRM Pool)
  // 4. Alphabetical order (A-Z)
  const curUserId = currentUser?.id;
  const curUserName = (currentUser?.name || '').trim().toLowerCase();

  const isCurrentViewer = (u: any) => {
    if (!u) return false;
    if (curUserId && u.id === curUserId) return true;
    if (curUserName && (u.name || '').trim().toLowerCase() === curUserName) return true;
    return false;
  };

  const poolCol = allColumns.find((c) => c.id === 'col-crm-pool') || allColumns[0];
  const sentCol = allColumns.find((c) => c.id === 'col-crm-sent');
  const closedCol = allColumns.find((c) => c.id === 'col-crm-closed');
  const memberCols = allColumns.filter((c) => c.isMember);

  const sortedMemberCols = [...memberCols].sort((colA, colB) => {
    const matchA = isCrmMemberSearchMatch(colA.memberUser);
    const matchB = isCrmMemberSearchMatch(colB.memberUser);

    // 1. Search-matching CRM member columns move to the most left side
    if (matchA && !matchB) return -1;
    if (!matchA && matchB) return 1;

    // 2. Pinned columns come next
    const isPinnedA = !!pinnedColumns[colA.id];
    const isPinnedB = !!pinnedColumns[colB.id];
    if (isPinnedA && !isPinnedB) return -1;
    if (!isPinnedA && isPinnedB) return 1;

    // 3. Current viewer column next (showing on the right side of CRM Pool)
    const isCurA = isCurrentViewer(colA.memberUser);
    const isCurB = isCurrentViewer(colB.memberUser);
    if (isCurA && !isCurB) return -1;
    if (!isCurA && isCurB) return 1;

    // 4. Alphabetical order (A-Z)
    return (colA.title || '').localeCompare(colB.title || '', undefined, { sensitivity: 'base' });
  });

  const orderedColumns: CrmColumnDef[] = [
    ...(poolCol ? [poolCol] : []),
    ...sortedMemberCols,
    ...(sentCol ? [sentCol] : []),
    ...(closedCol ? [closedCol] : []),
  ];

  useEffect(() => {
    if (cleanSearch && boardScrollRef.current) {
      boardScrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    }
  }, [cleanSearch]);

  // If user does not have permission, show access restricted screen
  if (!userHasAccess) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 h-full bg-background select-none">
        <div className="max-w-md w-full bg-card border border-zinc-800 rounded-2xl p-6 shadow-2xl flex flex-col items-center text-center">
          <div className="size-12 rounded-full bg-cyan-950/80 border border-[#22A3AE]/40 flex items-center justify-center mb-4 text-[#22A3AE]">
            <Lock className="size-6" />
          </div>
          <h2 className="text-lg font-bold text-zinc-100 mb-1.5">
            Restricted Access: CRM Board
          </h2>
          <p className="text-xs text-zinc-400 mb-5 leading-relaxed">
            This board is exclusively accessible to Client Relationship Managers (CRM) and Administrators. You do not currently hold permission to access client communication workflows.
          </p>
          {onSwitchToBoard && (
            <button
              type="button"
              onClick={onSwitchToBoard}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              <ArrowLeft className="size-3.5" />
              <span>Return to Task Map</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full bg-background select-none">
        {/* Board Columns Horizontal Scroll */}
        <div ref={boardScrollRef} className="flex-1 flex gap-5 px-6 pb-4 overflow-x-auto overflow-y-hidden min-h-0 custom-scrollbar select-none">
          {orderedColumns.map((col) => {
            const isPinned = !!pinnedColumns[col.id];
            const isCollapsed = !!collapsedColumns[col.id];
            const activePriority = columnPriorityFilters[col.id] || 'ALL';
            const activeSubStatus = columnSubStatusFilters[col.id] || 'ALL';
            const colClientFilter = columnClientFilters[col.id] || 'ALL';
            const colShowAdmin = columnShowAdmin[col.id] ?? showAdminTasks;
            const searchQuery = columnSearches[col.id] || '';
            const isSearchOpen = !!columnSearchOpen[col.id];

            // Apply priority, sub-status, search, admin, and client filter inside column
            const visibleTasks = col.tasks.filter((t) => {
              if (!matchesPriorityFilter(t, activePriority)) return false;
              if (!matchesSubStatusFilter(t, activeSubStatus)) return false;
              if (!matchesSearchFilter(t, searchQuery)) return false;

              // Admin task check
              const isAdmin = isTaskUnderAdmin(t);
              if (isAdmin && !colShowAdmin) return false;

              // Client filter check
              if (colClientFilter !== 'ALL') {
                const clientId = t.list?.id || (t.list?.name ? `name-${t.list.name}` : 'general');
                const clientName = t.list?.name || 'General';
                if (!colClientFilter.includes(clientId) && !colClientFilter.includes(clientName)) {
                  return false;
                }
              }

              return true;
            });

            // Collapsed Column Bar
            if (isCollapsed) {
              return (
                <DroppableColumn
                  key={`${col.id}-collapsed`}
                  id={col.id}
                  className={`w-12 shrink-0 flex flex-col items-center py-4 bg-card/90 border border-border rounded-2xl shadow-xl h-full max-h-full min-h-0 transition-all cursor-pointer hover:border-[#22A3AE]/50 ${isPinned ? 'ring-1 ring-[#22A3AE]/40 shadow-2xl backdrop-blur-md bg-card/95' : ''
                    }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleCollapseColumn(col.id)}
                    className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/60 mb-2 cursor-pointer"
                    title="Expand column"
                  >
                    <ChevronRight className="size-4 text-[#22A3AE]" />
                  </button>

                  {isPinned && (
                    <Pin className="size-3 text-[#22A3AE] fill-[#22A3AE]/40 rotate-45 mb-2" />
                  )}

                  <span className={`size-2.5 rounded-full ${col.dotColor} mb-2 shrink-0`} />

                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#22A3AE]/20 text-[#22A3AE] border border-[#22A3AE]/30 mb-4">
                    {col.tasks.length}
                  </span>

                  <span
                    onClick={() => toggleCollapseColumn(col.id)}
                    style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
                    className="text-xs font-bold text-zinc-300 tracking-wider whitespace-nowrap mt-2 cursor-pointer hover:text-white select-none"
                  >
                    {col.title}
                  </span>
                </DroppableColumn>
              );
            }

            // Normal Expanded Column
            return (
              <DroppableColumn
                key={col.id}
                id={col.id}
                className={`w-[370px] shrink-0 flex flex-col bg-card/90 border border-border rounded-2xl p-4 shadow-xl h-full max-h-full min-h-0 ${isPinned ? 'ring-1 ring-[#22A3AE]/40 shadow-2xl backdrop-blur-md bg-card/95' : ''
                  }`}
              >
                {/* Header Top Row: Left side has dot/avatar & title & badge & count; Right side has Collapse, Pin, Search */}
                <div className="flex items-center justify-between h-9 pb-2 border-b border-border/80 mb-2">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2 h-7">
                    {col.memberUser ? (
                      col.memberUser.avatarUrl ? (
                        <img
                          src={col.memberUser.avatarUrl}
                          alt={col.title}
                          className="size-6 rounded-full object-cover shrink-0 ring-1 ring-[#22A3AE]/40"
                        />
                      ) : (
                        <div className="size-6 rounded-full bg-cyan-950/80 border border-[#22A3AE]/40 text-[#22A3AE] flex items-center justify-center text-[10px] font-bold shrink-0">
                          {(col.title || 'U').charAt(0).toUpperCase()}
                        </div>
                      )
                    ) : (
                      <span className={`size-2 rounded-full ${col.dotColor} shrink-0`} />
                    )}

                    <h3 className="text-sm font-bold text-zinc-100 truncate" title={col.title}>
                      {col.title}
                    </h3>

                    {col.memberUser ? (
                      <UserRoleBadge user={col.memberUser} />
                    ) : col.badgeLabel ? (
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 truncate ${col.badgeClass || 'bg-zinc-800 text-zinc-400 border-zinc-700'
                          }`}
                      >
                        {col.badgeLabel}
                      </span>
                    ) : null}

                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${col.badgeClass || 'bg-zinc-800 text-zinc-300 border-zinc-700'
                        }`}
                    >
                      {col.tasks.length}
                    </span>
                  </div>

                  {/* Top Right: Collapse, Pin, Search (Search on right side) */}
                  <div className="flex items-center gap-1 shrink-0 h-7">
                    <button
                      type="button"
                      onClick={() => toggleCollapseColumn(col.id)}
                      className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-md cursor-pointer transition-colors"
                      title="Collapse column"
                    >
                      <ChevronLeft className="size-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => togglePinColumn(col.id)}
                      className={`p-1 rounded-md transition-colors cursor-pointer ${isPinned
                        ? 'text-[#22A3AE] bg-[#22A3AE]/15 border border-[#22A3AE]/30'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                        }`}
                      title={isPinned ? 'Unpin column' : 'Pin column'}
                    >
                      <Pin className={`size-3.5 rotate-45 ${isPinned ? 'fill-[#22A3AE]/40' : ''}`} />
                    </button>

                    {isSearchOpen ? (
                      <div className="flex items-center bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-0.5 max-w-[130px] text-xs">
                        <Search className="size-3 text-zinc-400 shrink-0 mr-1" />
                        <input
                          autoFocus
                          type="text"
                          value={searchQuery}
                          onChange={(e) =>
                            setColumnSearches((prev) => ({ ...prev, [col.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setColumnSearchOpen((prev) => ({ ...prev, [col.id]: false }));
                            }
                          }}
                          placeholder="Search..."
                          className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-500 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setColumnSearches((prev) => ({ ...prev, [col.id]: '' }));
                            setColumnSearchOpen((prev) => ({ ...prev, [col.id]: false }));
                          }}
                          className="text-zinc-400 hover:text-zinc-200 ml-0.5 p-0.5 cursor-pointer"
                          title="Close search"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setColumnSearchOpen((prev) => ({ ...prev, [col.id]: true }))
                        }
                        className={`p-1 rounded-md transition-colors cursor-pointer ${searchQuery
                          ? 'text-blue-400 bg-blue-500/15 border border-blue-500/30'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                          }`}
                        title={searchQuery ? `Searching "${searchQuery}"` : 'Search tasks in this column'}
                      >
                        <Search className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Next Line: Filters on the left side */}
                <div className="flex items-center gap-1.5 justify-start mb-3">
                  <ColumnClientDropdown
                    tasks={col.tasks}
                    clients={clients}
                    showAdmin={colShowAdmin}
                    onToggleAdmin={() =>
                      setColumnShowAdmin((prev) => ({
                        ...prev,
                        [col.id]: !colShowAdmin,
                      }))
                    }
                    selectedClients={colClientFilter}
                    onSelectClients={(nextClients) =>
                      setColumnClientFilters((prev) => ({
                        ...prev,
                        [col.id]: nextClients,
                      }))
                    }
                    isTaskUnderAdmin={isTaskUnderAdmin}
                  />

                  <ColumnPriorityDropdown
                    columnId={col.id}
                    tasks={col.tasks}
                    activeFilter={activePriority}
                    onSelectFilter={(cId, filter) =>
                      setColumnPriorityFilters((prev) => ({ ...prev, [cId]: filter }))
                    }
                  />

                  <ColumnSubStatusDropdown
                    columnId={col.id}
                    tasks={col.tasks}
                    activeFilter={activeSubStatus}
                    onSelectFilter={(cId, filter) =>
                      setColumnSubStatusFilters((prev) => ({ ...prev, [cId]: filter }))
                    }
                  />

                  {(searchQuery || activePriority !== 'ALL' || activeSubStatus !== 'ALL' || colClientFilter !== 'ALL') && (
                    <span className="text-[10px] text-zinc-400 italic">
                      ({visibleTasks.length} of {col.tasks.length})
                    </span>
                  )}
                </div>

                {/* Cards List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 px-1.5 py-1">
                  {visibleTasks.length === 0 ? (
                    <div className="p-4 bg-zinc-900/40 border border-dashed border-zinc-800 rounded-xl min-h-[112px] flex flex-col items-center justify-center text-center transition-all hover:border-zinc-700/80">
                      <span className="text-xs font-semibold text-zinc-400">
                        {col.id === 'col-crm-sent'
                          ? 'No sent tasks'
                          : col.id === 'col-crm-closed'
                            ? 'No closed tasks'
                            : 'No CRM tasks'}
                      </span>
                      <span className="text-[11px] text-zinc-500 mt-1">
                        {searchQuery || activePriority !== 'ALL'
                          ? 'No tasks match filter'
                          : col.id === 'col-crm-sent'
                            ? 'Drop tasks here when outreach has been sent to client'
                            : col.id === 'col-crm-closed'
                              ? 'Closed and verified tasks appear here'
                              : `Drop client communication tasks here to assign to ${col.title}`}
                      </span>
                    </div>
                  ) : (
                    visibleTasks.map((task) => {
                      return (
                        <DraggableTaskCard key={task.id} task={task} disabled={false}>
                          <div className="p-3 bg-zinc-900 border border-border hover:border-zinc-700 rounded-xl shadow-md min-h-[112px] flex items-stretch gap-3 transition-all group">
                            {/* Left: Task Info */}
                            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                              {/* Client / List Name */}
                              <div className="text-[11px] font-medium text-zinc-400 truncate max-w-[170px] mb-1">
                                {task.list?.name || 'General'}
                              </div>

                              {/* Title */}
                              <h4
                                onClick={() => onOpenDetail(task)}
                                className="text-[13px] font-bold text-zinc-100 group-hover:text-white cursor-pointer line-clamp-2 leading-snug hover:underline my-0.5 h-[36px]"
                                title={task.title}
                              >
                                {task.title}
                              </h4>

                              {/* Controls row: circle dot left of bulletin, priority flag (Exact Task Map parity) */}
                              <div className="flex items-center gap-2 text-xs text-zinc-500 pt-1">
                                {/* Circle Dot Status Indicator */}
                                <CardStatusDropdown
                                  taskId={task.id}
                                  currentStatus={task.status || 'In progress'}
                                  onSelect={async (newStatus) => {
                                    const transitionCheck = canTransitionTaskStatus(task, newStatus);
                                    if (!transitionCheck.allowed) {
                                      if (transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
                                        window.dispatchEvent(
                                          new CustomEvent('task:highlight-audits', {
                                            detail: {
                                              taskId: task.id,
                                              targetStatus: newStatus,
                                              uncheckedAudits: transitionCheck.uncheckedAudits,
                                              openSubtasks: transitionCheck.openSubtasks,
                                            },
                                          })
                                        );
                                      }
                                      setBlockedAuditAlert({
                                        isOpen: true,
                                        task,
                                        targetStatus: newStatus,
                                        uncheckedAudits: transitionCheck.uncheckedAudits,
                                        openSubtasks: transitionCheck.openSubtasks,
                                      });
                                      toast.error(transitionCheck.reason || `Cannot move task to ${newStatus}`);
                                      return;
                                    }

                                    if (onTaskUpdate) {
                                      await onTaskUpdate(task.id, { status: newStatus });
                                    } else {
                                      await tasksApi
                                        .updateTask(task.id, { status: newStatus } as any)
                                        .catch(console.error);
                                      onDataRefresh();
                                    }
                                    toast.success(`Status updated to ${newStatus}`);
                                  }}
                                />

                                <TaskDescriptionButton
                                  description={task.description}
                                  taskTitle={task.title}
                                />

                                {/* Clickable Priority Flag */}
                                <CardPriorityDropdown
                                  taskId={task.id}
                                  priority={task.priority || 'NORMAL'}
                                  onSelect={async (newPriority) => {
                                    if (onTaskUpdate) {
                                      await onTaskUpdate(task.id, { priority: newPriority as any });
                                    } else {
                                      await tasksApi
                                        .updateTask(task.id, { priority: newPriority as any })
                                        .catch(console.error);
                                      onDataRefresh();
                                    }
                                    toast.success(`Priority set to ${newPriority}`);
                                  }}
                                />
                              </div>
                            </div>

                            {/* Separator */}
                            <div className="w-px bg-zinc-800/80 self-stretch my-0.5 shrink-0" />

                            {/* Right: Section where Sub-Status is (with Posted date in top right corner) */}
                            <div className="w-[125px] sm:w-[135px] shrink-0 flex flex-col justify-between py-0.5">
                              <div className="flex justify-end items-center">
                                <span className="text-[10px] font-medium text-zinc-500">
                                  Posted {format(new Date(task.createdAt), 'MMM d')}
                                </span>
                              </div>

                              <div
                                className="w-full"
                                onPointerDown={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
                                  Sub-Status
                                </span>
                                <TaskMapStatusDropdown
                                  selectedStatuses={task.taskMap?.statuses || []}
                                  options={getCrmOptions(task)}
                                  onToggleStatus={async (label, nextStatuses) => {
                                    const isSelecting = (nextStatuses || []).includes(label);
                                    const cleanNext = isSelecting ? [label] : [];

                                    if (label === 'To send') {
                                      if (isSelecting) {
                                        const transitionCheck = canTransitionTaskStatus(task, 'CRM');
                                        if (!transitionCheck.allowed) {
                                          if (transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
                                            window.dispatchEvent(
                                              new CustomEvent('task:highlight-audits', {
                                                detail: {
                                                  taskId: task.id,
                                                  targetStatus: 'CRM',
                                                  uncheckedAudits: transitionCheck.uncheckedAudits,
                                                  openSubtasks: transitionCheck.openSubtasks,
                                                },
                                              })
                                            );
                                          }
                                          setBlockedAuditAlert({
                                            isOpen: true,
                                            task,
                                            targetStatus: 'CRM',
                                            uncheckedAudits: transitionCheck.uncheckedAudits,
                                            openSubtasks: transitionCheck.openSubtasks,
                                          });
                                          toast.error(transitionCheck.reason || 'Cannot move task to CRM');
                                          return;
                                        }

                                        onStatusChange(task.id, cleanNext);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: 'CRM' });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: 'CRM' } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                      } else {
                                        // User clicked 'To send' AGAIN in CRM -> revert misclick back to last status
                                        const revertStatus = (task as any)._previousStatus || (task.assigneeId ? 'In Review' : 'To review');
                                        onStatusChange(task.id, []);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: revertStatus });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.info(`Reverted 'To send' — returned to ${revertStatus}`);
                                      }
                                    } else if (label === 'Sent') {
                                      if (isSelecting) {
                                        const transitionCheck = canTransitionTaskStatus(task, 'Waiting');
                                        if (!transitionCheck.allowed) {
                                          if (transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
                                            window.dispatchEvent(
                                              new CustomEvent('task:highlight-audits', {
                                                detail: {
                                                  taskId: task.id,
                                                  targetStatus: 'Waiting',
                                                  uncheckedAudits: transitionCheck.uncheckedAudits,
                                                  openSubtasks: transitionCheck.openSubtasks,
                                                },
                                              })
                                            );
                                          }
                                          setBlockedAuditAlert({
                                            isOpen: true,
                                            task,
                                            targetStatus: 'Waiting',
                                            uncheckedAudits: transitionCheck.uncheckedAudits,
                                            openSubtasks: transitionCheck.openSubtasks,
                                          });
                                          toast.error(transitionCheck.reason || 'Cannot move task to Waiting');
                                          return;
                                        }

                                        onStatusChange(task.id, cleanNext);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: 'Waiting' });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: 'Waiting' } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.success('Task marked Sent — status updated to Waiting');
                                      } else {
                                        // Toggled off Sent -> revert back to CRM
                                        onStatusChange(task.id, ['CRM']);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: 'CRM' });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: 'CRM' } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.info("Reverted 'Sent' — returned to CRM");
                                      }
                                    } else if (label === 'Closed') {
                                      if (isSelecting) {
                                        const transitionCheck = canTransitionTaskStatus(task, 'Closed');
                                        if (!transitionCheck.allowed) {
                                          if (transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
                                            window.dispatchEvent(
                                              new CustomEvent('task:highlight-audits', {
                                                detail: {
                                                  taskId: task.id,
                                                  targetStatus: 'Closed',
                                                  uncheckedAudits: transitionCheck.uncheckedAudits,
                                                  openSubtasks: transitionCheck.openSubtasks,
                                                },
                                              })
                                            );
                                          }
                                          setBlockedAuditAlert({
                                            isOpen: true,
                                            task,
                                            targetStatus: 'Closed',
                                            uncheckedAudits: transitionCheck.uncheckedAudits,
                                            openSubtasks: transitionCheck.openSubtasks,
                                          });
                                          toast.error(transitionCheck.reason || 'Cannot move task to Closed');
                                          return;
                                        }

                                        onStatusChange(task.id, cleanNext);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: 'Closed' });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: 'Closed' } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.success('Task marked Closed');
                                      } else {
                                        // Toggled off Closed -> revert back to Waiting
                                        onStatusChange(task.id, ['Sent']);
                                        if (onTaskUpdate) {
                                          await onTaskUpdate(task.id, { status: 'Waiting' });
                                        } else {
                                          await tasksApi.updateTask(task.id, { status: 'Waiting' } as any).catch(console.error);
                                          onDataRefresh();
                                        }
                                        toast.info("Reverted 'Closed' — returned to Waiting");
                                      }
                                    } else if (label === 'Follow up' && isSelecting) {
                                      onStatusChange(task.id, cleanNext);
                                      toast.warning('Task marked for Follow up');
                                    } else {
                                      onStatusChange(task.id, cleanNext);
                                    }
                                  }}
                                  onOptionsUpdated={onOptionsUpdated}
                                  readOnly={false}
                                />
                              </div>
                            </div>
                          </div>
                        </DraggableTaskCard>
                      );
                    })
                  )}
                </div>
              </DroppableColumn>
            );
          })}
        </div>
      </div>

      {/* Drag Overlay Preview */}
      <DragOverlay>
        {activeDragTask ? (
          <div className="p-3.5 bg-card border border-[#22A3AE]/80 rounded-xl shadow-2xl w-[320px] pointer-events-none opacity-90">
            <span className="text-xs text-zinc-400 font-medium block mb-1">
              {activeDragTask.list?.name || 'General'}
            </span>
            <h4 className="text-sm font-bold text-white truncate">
              {activeDragTask.title}
            </h4>
          </div>
        ) : null}
      </DragOverlay>

      {/* Blocked Audits / Subtasks Modal */}
      <UncheckedAuditsModal
        isOpen={blockedAuditAlert.isOpen}
        onClose={() => setBlockedAuditAlert((prev) => ({ ...prev, isOpen: false }))}
        taskTitle={blockedAuditAlert.task?.title || ''}
        targetStatus={blockedAuditAlert.targetStatus}
        uncheckedAudits={blockedAuditAlert.uncheckedAudits}
        openSubtasks={blockedAuditAlert.openSubtasks}
        onReviewAudits={() => {
          if (blockedAuditAlert.task) {
            onOpenDetail(blockedAuditAlert.task);
            if (blockedAuditAlert.uncheckedAudits && blockedAuditAlert.uncheckedAudits.length > 0) {
              const pendingHighlight = {
                taskId: blockedAuditAlert.task.id,
                targetStatus: blockedAuditAlert.targetStatus,
                uncheckedAudits: blockedAuditAlert.uncheckedAudits,
                openSubtasks: blockedAuditAlert.openSubtasks,
              };
              if (typeof window !== 'undefined') {
                (window as any).__pendingAuditHighlight = pendingHighlight;
              }
              setTimeout(() => {
                window.dispatchEvent(
                  new CustomEvent('task:highlight-audits', { detail: pendingHighlight })
                );
              }, 350);
            }
          }
        }}
        reviewButtonText={
          blockedAuditAlert.uncheckedAudits.length > 0
            ? 'Open Task & Review Audits'
            : 'Open Task & Review Subtasks'
        }
      />
    </DndContext>
  );
};

