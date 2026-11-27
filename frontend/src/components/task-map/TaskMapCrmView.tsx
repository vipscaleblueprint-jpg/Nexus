'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  TaskMapItem,
  TaskMapOption,
  getEffectiveTaskMapHandlerId,
  isTaskHandedOver,
  countNonOnHoldTasks,
  TASK_MAP_STATUS_COLORS,
  toCanonicalTaskStatus,
  normalizeTaskMapSubStatuses,
  matchesMarketingNameSearch,
  subscribeTaskMapSaving,
  isTaskSavingToDb,
  isTaskUnderAdmin,
  isTaskInClientDashboard,
  isDormantClientTask,
  getTaskCrmWaitingInfo,
  formatManilaTime,
  getSubStatusTransitionGuide,
  SubStatusTransitionGuide,
  findSearchedTaskLocations,
} from '@/api/taskMap';
import { tasksApi } from '@/api/tasks';
import { NexusLogoLoader } from '@/components/ui/NexusLogo';
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
  Loader2,
  Clock,
} from 'lucide-react';
import { format } from 'date-fns';
import { isCrmUser, hasCrmAccess, isProjectManagerOrAdmin, canTransitionTaskStatus, canUserEditTask, canUserMoveTask } from '@/lib/permissions';
import { UncheckedAuditsModal } from '@/components/modals/UncheckedAuditsModal';
import { SubStatusChangeGuideModal } from '@/components/modals/SubStatusChangeGuideModal';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';
import { useLiveClock } from '@/lib/liveClock';
import { TaskMapInProgressDropCard } from './TaskMapInProgressDropCard';
import { isTaskActiveInProgress, isTaskLiveWorking } from './TaskMapBoardView';
import {
  CardStatusDropdown,
  CardPriorityDropdown,
  ColumnPriorityDropdown,
  TaskTimeProgressSlot,
  matchesPriorityFilter,
  matchesSearchFilter,
  sortTasksUrgentFirst,
  hexToRgba,
  resolveSubStatusColor,
  resolveTaskStatusColor,
} from './TaskMapCardControls';
import { ColumnClientDropdown } from './ColumnClientDropdown';
import { ColumnSubStatusDropdown, matchesSubStatusFilter } from './ColumnSubStatusDropdown';
import {
  ColumnFollowUpDropdown,
  CrmFollowUpFilter,
  CrmFollowUpSort,
  matchesCrmFollowUpFilter,
  sortCrmSentTasks,
} from './ColumnFollowUpDropdown';
import { useHorizontalScroll } from '@/lib/useHorizontalScroll';
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
  allAvailablePool?: TaskMapItem[];
  allTasks?: TaskMapItem[];
  options: TaskMapOption[];
  allUsers?: any[];
  shiftUsers?: any[];
  onStatusChange: (taskId: string, newStatuses: string[]) => void;
  onOptionsUpdated: () => void;
  onOpenDetail: (task: TaskMapItem) => void;
  onDataRefresh: () => void;
  onTaskUpdate?: (taskId: string, fields: Partial<TaskMapItem>) => Promise<void> | void;
  onSwitchToBoard?: () => void;
  currentShift?: string;
  selectedCustomMAs?: string[];
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

  const [isSaving, setIsSaving] = useState<boolean>(() => isTaskSavingToDb(task.id));
  useEffect(() => {
    setIsSaving(isTaskSavingToDb(task.id));
    return subscribeTaskMapSaving(() => {
      setIsSaving(isTaskSavingToDb(task.id));
    });
  }, [task.id]);

  return (
    <div
      ref={setNodeRef}
      {...(disabled ? {} : listeners)}
      {...(disabled ? {} : attributes)}
      className={`relative touch-none transition-all duration-200 ease-out ${isDragging
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

const DroppableInProgressSlot: React.FC<{
  userId: string;
  children: React.ReactNode;
  disabled?: boolean;
}> = ({ userId, children, disabled }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `in-progress-${userId}`,
    data: {
      type: 'in-progress-slot',
      userId,
    },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      data-in-progress-dropzone="true"
      data-no-drag-scroll="true"
      className={`rounded-xl transition-colors duration-150 ${
        isOver ? 'ring-2 ring-[#22A3AE] bg-[#22A3AE]/15 shadow-lg shadow-[#22A3AE]/20' : ''
      }`}
    >
      {children}
    </div>
  );
};

export const TaskMapCrmView: React.FC<Props> = ({
  tasks = [],
  availablePool = [],
  allAvailablePool,
  allTasks,
  options = [],
  allUsers = [],
  shiftUsers = [],
  onStatusChange,
  onOptionsUpdated,
  onOpenDetail,
  onDataRefresh,
  onTaskUpdate,
  onSwitchToBoard,
  currentShift = 'ALL',
  selectedCustomMAs = [],
  clients = [],
  showAdminTasks = false,
  onToggleAdminTasks,
  search = '',
}) => {
  const currentUser = useAppStore((s) => s.currentUser);
  const userHasAccess = hasCrmAccess(currentUser);
  const boardLiveClock = useLiveClock(true);
  const isPmUser = isProjectManagerOrAdmin(currentUser);

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
  const [subStatusGuideTarget, setSubStatusGuideTarget] = useState<{
    task: TaskMapItem;
    guide: SubStatusTransitionGuide;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const boardScrollRef = useRef<HTMLDivElement>(null);
  useHorizontalScroll(boardScrollRef);

  const cleanSearch = (search || '').trim().toLowerCase();
  const isCrmMemberSearchMatch = (u: any) => {
    if (!cleanSearch || !u) return false;
    return matchesMarketingNameSearch(u, cleanSearch);
  };

  useEffect(() => {
    if (cleanSearch && boardScrollRef.current) {
      boardScrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    }
  }, [cleanSearch]);

  // Column controls: Priority filter, Sub-status filter, Follow-up filter/sort, Client filter, Admin toggle, search, pin, collapse
  const [columnPriorityFilters, setColumnPriorityFilters] = useState<Record<string, string>>({});
  const [columnSubStatusFilters, setColumnSubStatusFilters] = useState<Record<string, string>>({});
  const [columnFollowUpFilters, setColumnFollowUpFilters] = useState<Record<string, CrmFollowUpFilter>>({});
  const [columnFollowUpSorts, setColumnFollowUpSorts] = useState<Record<string, CrmFollowUpSort>>({
    'col-crm-sent': 'MOST_OVERDUE',
  });
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

  // Discover users who hold a CRM role, respecting selected shift or custom member filter
  const crmUsers = React.useMemo(() => {
    const map = new Map<string, any>();
    const isAllShifts =
      !currentShift ||
      currentShift === 'ALL' ||
      currentShift
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .includes('ALL');
    const isCustomShift = currentShift === 'CUSTOM';

    let candidates: any[];
    if (isCustomShift && selectedCustomMAs.length > 0) {
      const pool = [...(allUsers || []), ...(shiftUsers || [])];
      candidates = pool.filter((u) => u && selectedCustomMAs.includes(u.id));
    } else if (!isAllShifts && !isCustomShift) {
      candidates = [...(shiftUsers || [])];
    } else {
      candidates = [
        ...(currentUser ? [currentUser] : []),
        ...(allUsers || []),
        ...(shiftUsers || []),
      ];
    }

    for (const u of candidates) {
      if (!u || !u.id) continue;
      if (map.has(u.id)) continue;
      if (
        isCrmUser(u) ||
        (isCustomShift && selectedCustomMAs.includes(u.id)) ||
        (isAllShifts && currentUser?.id === u.id && hasCrmAccess(currentUser))
      ) {
        map.set(u.id, u);
      }
    }
    const list = Array.from(map.values());
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [allUsers, shiftUsers, currentUser, currentShift, selectedCustomMAs]);

  // Combined tasks
  const combinedTasks = React.useMemo(() => {
    const map = new Map<string, TaskMapItem>();
    for (const t of [...tasks, ...availablePool]) {
      if (!map.has(t.id)) map.set(t.id, t);
    }
    return Array.from(map.values());
  }, [tasks, availablePool]);

  // Check if a task belongs on the CRM board:
  // - CRM tasks (status == 'CRM')
  // - Sent tasks (status == 'Waiting' or 'Sent')
  // - Closed/Done tasks (with CRM markers/history)
  const isCrmStatus = (t: TaskMapItem) => {
    const s = (t.status || '').toUpperCase().trim();
    const mapStatuses = (t.taskMap?.statuses || []).map((x) =>
      x.toUpperCase().replace(/[\s_-]+/g, '')
    );
    if (
      s === 'REVISION' ||
      s === 'REVISIONS' ||
      mapStatuses.includes('REVISION') ||
      mapStatuses.includes('REVISIONS')
    ) {
      return false;
    }
    const isCrmStatusName =
      s === 'CRM' ||
      s === 'CRM NEEDED TO SEND' ||
      s === 'CRM_TO_SEND' ||
      s === 'CRM NEEDED TO FOLLOW UP' ||
      s === 'CRM_FOLLOW_UP';

    const hasCrmMarker =
      mapStatuses.includes('CRM') ||
      mapStatuses.includes('CRMNEEDEDTOSEND') ||
      mapStatuses.includes('CRMTOSEND') ||
      mapStatuses.includes('CRMNEEDEDTOFOLLOWUP') ||
      mapStatuses.includes('CRMFOLLOWUP') ||
      mapStatuses.includes('TOSEND') ||
      mapStatuses.includes('READYTOSEND') ||
      mapStatuses.includes('ASKCLIENT') ||
      mapStatuses.includes('SENT') ||
      mapStatuses.includes('SENTBUTWAITING') ||
      mapStatuses.includes('OUTREACHSENT') ||
      mapStatuses.includes('CLIENTSENT') ||
      mapStatuses.includes('FOLLOWUP');

    return (
      isCrmStatusName ||
      ((s === 'WAITING' || s === 'SENT') && isTaskInClientDashboard(t, clients)) ||
      (!(s === 'CLOSED' || s === 'DONE') && mapStatuses.includes('ASKCLIENT')) ||
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
  }, [combinedTasks, clients]);

  // Check if task is CRM completed / closed
  const isCrmCompleted = (t: TaskMapItem) => {
    const s = (t.status || '').toUpperCase().trim();
    return s === 'DONE' || s === 'CLOSED';
  };

  // Check if task is Sent (waiting for client response) - restricted strictly to active Client Dashboard clients
  const isCrmSent = (t: TaskMapItem) => {
    if (isCrmCompleted(t)) return false;
    const s = (t.status || '').toUpperCase().trim();
    if (s !== 'WAITING' && s !== 'SENT') return false;
    return isTaskInClientDashboard(t, clients);
  };

  // Check if task is assigned to a specific CRM member (strictly status CRM or Ask Client, latest assignee only)
  const isTaskAssignedToCrmMember = (task: TaskMapItem, crmMember: any) => {
    if (isCrmCompleted(task) || isCrmSent(task) || isTaskHandedOver(task)) return false;
    const s = (task.status || '').toUpperCase().trim();
    const mapStatusesNorm = (task.taskMap?.statuses || []).map((st) =>
      st.toUpperCase().replace(/[\s_-]+/g, '')
    );
    const hasAskClient = mapStatusesNorm.includes('ASKCLIENT');
    const isCrm =
      s === 'CRM' ||
      s === 'CRM NEEDED TO SEND' ||
      s === 'CRM_TO_SEND' ||
      s === 'CRM NEEDED TO FOLLOW UP' ||
      s === 'CRM_FOLLOW_UP';
    if (!isCrm && !hasAskClient) return false;

    const effectiveHandlerId = getEffectiveTaskMapHandlerId(task);
    if (effectiveHandlerId) {
      return effectiveHandlerId === crmMember.id;
    }

    // Legacy fallback: tag match when no assigneeId/PM_ASSIGNMENT is set
    const mapStatuses = (task.taskMap?.statuses || []).map((st) => st.toUpperCase().trim());
    const memberNameUpper = (crmMember.name || '').toUpperCase().trim();
    const first = memberNameUpper.split(' ')[0];
    if (mapStatuses.includes(memberNameUpper)) return true;
    if (first && mapStatuses.includes(first)) return true;
    if (mapStatuses.includes(crmMember.id.toUpperCase())) return true;

    return false;
  };

  // General CRM Pool: tasks needing client outreach / CRM / Ask Client that are not yet assigned to a specific CRM member
  const isGeneralCrmPool = (t: TaskMapItem) => {
    if (isCrmCompleted(t) || isCrmSent(t)) return false;
    const s = (t.status || '').toUpperCase().trim();
    const mapStatusesNorm = (t.taskMap?.statuses || []).map((st) =>
      st.toUpperCase().replace(/[\s_-]+/g, '')
    );
    const hasAskClient = mapStatusesNorm.includes('ASKCLIENT');
    const isCrm =
      s === 'CRM' ||
      s === 'CRM NEEDED TO SEND' ||
      s === 'CRM_TO_SEND' ||
      s === 'CRM NEEDED TO FOLLOW UP' ||
      s === 'CRM_FOLLOW_UP';
    if (!isCrm && !hasAskClient) return false;
    if (
      crmUsers.some((u) => isTaskAssignedToCrmMember(t, u)) ||
      (allUsers || []).some((u) => isCrmUser(u) && isTaskAssignedToCrmMember(t, u))
    ) {
      return false;
    }

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
    const task = (allTasks || tasks).find((t) => t.id === taskId) || combinedTasks.find((t) => t.id === taskId);
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
        (s) => !['SENT', 'SENT BUT WAITING', 'OUTREACH SENT', 'CLIENT SENT', 'WAITING'].includes(s.toUpperCase().trim())
      );
      if (!updatedStatuses.includes('CRM')) updatedStatuses.push('CRM');
      toast.info('Task moved to General CRM Pool');
      onStatusChange(taskId, updatedStatuses);
      if ((task.status || '').toUpperCase() !== 'CRM') {
        const currentTask = useAppStore.getState().tasks.find((t) => t.id === task.id) || task;
        let transitionCheck = canTransitionTaskStatus(currentTask, 'CRM');
        if (!transitionCheck.allowed && transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
          try {
            const fresh = await tasksApi.getTask(task.id);
            if (fresh?.task) {
              const freshCheck = canTransitionTaskStatus(fresh.task, 'CRM');
              if (freshCheck.allowed) {
                transitionCheck = freshCheck;
                useAppStore.getState().updateTask(fresh.task);
              }
            }
          } catch {
            // fallback
          }
        }
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
      }
      if (onTaskUpdate) {
        await onTaskUpdate(taskId, { assigneeId: null, status: 'CRM' });
      } else {
        await tasksApi.updateTask(taskId, { assigneeId: null, status: 'CRM' } as any).catch(console.error);
        onDataRefresh();
      }
    } else if (targetColumnId === 'col-crm-sent') {
      // 0. Restriction: CRM Sent is strictly for tasks within Client Dashboard (dormant clients excluded)
      if (!isTaskInClientDashboard(task, clients)) {
        toast.error('Cannot mark as Sent: only tasks within Client Dashboard can be placed in Sent (this client is dormant or not in Client Dashboard).');
        return;
      }

      // 1. Task edit permission
      const editCheck = canUserEditTask(task as any, currentUser);
      if (!editCheck.allowed) {
        toast.error(editCheck.reason || 'You do not have permission to edit this task.');
        return;
      }

      // 2. Status transition check for Waiting
      const currentTask = useAppStore.getState().tasks.find((t) => t.id === task.id) || task;
      const transitionCheck = canTransitionTaskStatus(currentTask, 'Waiting');
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
        (s) => {
          const up = s.toUpperCase().trim();
          return (
            up !== 'CRM' &&
            up !== 'TO SEND' &&
            up !== 'READY TO SEND' &&
            up !== 'ASK CLIENT' &&
            up !== 'SENT' &&
            up !== 'SENT BUT WAITING' &&
            up !== 'WAITING'
          );
        }
      );
      updatedStatuses.push('Sent but Waiting');
      toast.success('Task marked Sent but Waiting — status updated to WAITING');
      onStatusChange(taskId, updatedStatuses);
      if (onTaskUpdate) {
        await onTaskUpdate(taskId, { status: 'WAITING' });
      } else {
        await tasksApi.updateTask(taskId, { status: 'WAITING' } as any).catch(console.error);
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
      const currentTask = useAppStore.getState().tasks.find((t) => t.id === task.id) || task;
      const transitionCheck = canTransitionTaskStatus(currentTask, 'CLOSED');
      if (!transitionCheck.allowed) {
        if (transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
          window.dispatchEvent(
            new CustomEvent('task:highlight-audits', {
              detail: {
                taskId: task.id,
                targetStatus: 'CLOSED',
                uncheckedAudits: transitionCheck.uncheckedAudits,
                openSubtasks: transitionCheck.openSubtasks,
              },
            })
          );
        }
        setBlockedAuditAlert({
          isOpen: true,
          task,
          targetStatus: 'CLOSED',
          uncheckedAudits: transitionCheck.uncheckedAudits,
          openSubtasks: transitionCheck.openSubtasks,
        });
        toast.error(transitionCheck.reason || 'Cannot move task to CLOSED');
        return;
      }

      if (!updatedStatuses.includes('Outreach Sent')) updatedStatuses.push('Outreach Sent');
      toast.success('Task marked CLOSED');
      onStatusChange(taskId, updatedStatuses);
      if (onTaskUpdate) {
        await onTaskUpdate(taskId, { status: 'CLOSED' });
      } else {
        await tasksApi.updateTask(taskId, { status: 'CLOSED' } as any).catch(console.error);
      }
    } else if (targetColumnId.startsWith('col-crm-member-') || targetColumnId.startsWith('in-progress-')) {
      const memberId = targetColumnId.replace('col-crm-member-', '').replace('in-progress-', '');
      const member = crmUsers.find((u) => u.id === memberId);
      if (member) {
        const isAskClientTask =
          (task.status || '').toUpperCase().trim() !== 'CRM' &&
          (task.taskMap?.statuses || []).some(
            (s) => s.toUpperCase().replace(/[\s_-]+/g, '') === 'ASKCLIENT'
          );
        // Only assign to member, never mark as Sent but Waiting
        updatedStatuses = updatedStatuses.filter(
          (s) => !['SENT', 'SENT BUT WAITING', 'OUTREACH SENT', 'CLIENT SENT', 'WAITING'].includes(s.toUpperCase().trim())
        );
        if (isAskClientTask) {
          if (!updatedStatuses.some((s) => s.toUpperCase().replace(/[\s_-]+/g, '') === 'ASKCLIENT')) {
            updatedStatuses.push('Ask Client');
          }
          if (targetColumnId.startsWith('in-progress-')) {
            if (!updatedStatuses.includes('In progress')) {
              updatedStatuses.push('In progress');
            }
          }
          toast.success(`Task assigned to ${member.name} (Ask Client)`);
          onStatusChange(taskId, updatedStatuses);
          if (onTaskUpdate) {
            await onTaskUpdate(taskId, { assigneeId: member.id });
          } else {
            await tasksApi
              .updateTask(taskId, { assigneeId: member.id } as any)
              .catch(console.error);
          }
        } else {
          if (!updatedStatuses.includes('CRM')) updatedStatuses.push('CRM');
          if (targetColumnId.startsWith('in-progress-')) {
            if (!updatedStatuses.includes('In progress')) {
              updatedStatuses.push('In progress');
            }
          }
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
    }
  };

  const handleSelectInProgressTask = async (taskId: string, targetMemberId: string, taskOverride?: TaskMapItem) => {
    const member = crmUsers.find((u) => u.id === targetMemberId);
    if (!member) return;
    const task = (allTasks || tasks).find((t) => t.id === taskId) || combinedTasks.find((t) => t.id === taskId) || taskOverride;
    if (!task) return;

    const currentStatuses = task.taskMap?.statuses || [];
    let updatedStatuses = currentStatuses.filter(
      (s) => !['SENT', 'SENT BUT WAITING', 'OUTREACH SENT', 'CLIENT SENT', 'WAITING'].includes(s.toUpperCase().trim())
    );
    if (!updatedStatuses.includes('CRM')) updatedStatuses.push('CRM');
    if (!updatedStatuses.includes('In progress')) updatedStatuses.push('In progress');

    toast.success(`Task set In Progress for ${member.name} (CRM)`);
    onStatusChange(taskId, updatedStatuses);

    if (onTaskUpdate) {
      await onTaskUpdate(taskId, { assigneeId: member.id, status: 'CRM' });
    } else {
      await tasksApi
        .updateTask(taskId, { assigneeId: member.id, status: 'CRM' } as any)
        .catch(console.error);
    }
  };

  // Helper options for sub-status dropdown in CRM (includes 'To send', 'Sent but Waiting', 'Follow up', 'Revision', 'Closed')
  const getCrmOptions = (task: TaskMapItem): TaskMapOption[] => {
    const ls = task.list?.statuses;
    const isInClientDashboard = isTaskInClientDashboard(task, clients);
    const options: TaskMapOption[] = [
      { id: 'opt-crm-readytosend', label: 'To send', color: resolveSubStatusColor('To send', TASK_MAP_STATUS_COLORS.TO_SEND, task.list?.id, ls), textColor: '#ffffff', order: 0 },
    ];
    if (isInClientDashboard) {
      options.push({ id: 'opt-crm-sent', label: 'Sent but Waiting', color: resolveSubStatusColor('Sent but Waiting', TASK_MAP_STATUS_COLORS.SENT, task.list?.id, ls), textColor: '#ffffff', order: 1 });
    }
    options.push(
      { id: 'opt-crm-followup', label: 'Follow up', color: TASK_MAP_STATUS_COLORS.FOLLOW_UP, textColor: '#ffffff', order: 2 },
      { id: 'opt-crm-revision', label: 'Revision', color: resolveSubStatusColor('Revision', TASK_MAP_STATUS_COLORS.REVISION, task.list?.id, ls), textColor: '#ffffff', order: 3 },
      { id: 'opt-crm-closed', label: 'Closed', color: resolveSubStatusColor('Closed', TASK_MAP_STATUS_COLORS.CLOSED, task.list?.id, ls), textColor: '#ffffff', order: 4 },
      { id: 'opt-crm-handover', label: 'Hand-over', color: TASK_MAP_STATUS_COLORS.HAND_OVER, textColor: '#ffffff', order: 5 },
      { id: 'opt-crm-toreview', label: 'To Review', color: TASK_MAP_STATUS_COLORS.TO_REVIEW, textColor: '#ffffff', order: 6 }
    );
    return options;
  };

  const renderCrmCard = (task: TaskMapItem, isLiveWorking: boolean = false) => {
    const isSentWaitingCard = isCrmSent(task);
    const waitingInfo = isSentWaitingCard ? getTaskCrmWaitingInfo(task) : null;
    const showFollowUpBreathe = Boolean(waitingInfo?.rule.breathe);
    const followUpHex = waitingInfo?.rule.hex || '#71717a';
    const liveColor = resolveTaskStatusColor(
      task.status || 'CRM',
      task.listId || task.list?.id,
      task.list?.statuses
    ) || '#22A3AE';
    const showBreathe = showFollowUpBreathe || isLiveWorking;
    const breatheColor = showFollowUpBreathe ? followUpHex : liveColor;
    const displaySubStatuses = normalizeTaskMapSubStatuses(
      isSentWaitingCard ? 'WAITING' : task.status || 'CRM',
      task.taskMap?.statuses,
      { isAssigned: Boolean(getEffectiveTaskMapHandlerId(task)) }
    );

    return (
      <DraggableTaskCard key={task.id} task={task} disabled={false}>
        <div
          onClick={(e) => {
            if (e.defaultPrevented) return;
            onOpenDetail(task);
          }}
          className={`relative p-3 bg-zinc-900 not-has-[[data-card-control]:hover]:hover:bg-zinc-800/80 not-has-[[data-card-control]:hover]:hover:shadow-md active:scale-[0.99] border rounded-xl shadow-md min-h-[112px] flex items-stretch gap-3 transition-all group cursor-pointer ${
            showBreathe
              ? 'border-transparent shadow-md'
              : 'border-border not-has-[[data-card-control]:hover]:hover:border-zinc-600/80'
          }`}
          style={
            showBreathe
              ? { borderColor: hexToRgba(breatheColor, 0.4) }
              : undefined
          }
        >
          {showBreathe && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-[1px] rounded-xl border animate-border-glow-breathe"
              style={{
                borderColor: breatheColor,
                boxShadow: `0 0 0 2px ${hexToRgba(breatheColor, 0.42)}, 0 0 18px ${hexToRgba(breatheColor, 0.28)}`,
              }}
            />
          )}
          {/* Left: Task Info */}
          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
            {/* Client / List Name */}
            {isLiveWorking ? (
              <span
                className="font-bold uppercase tracking-wider flex items-center gap-1.5 truncate text-[11px] mb-1"
                style={{ color: liveColor }}
              >
                <span className="relative flex size-2 shrink-0">
                  <span
                    className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                    style={{ backgroundColor: liveColor }}
                  />
                  <span
                    className="relative inline-flex rounded-full size-2"
                    style={{ backgroundColor: liveColor }}
                  />
                </span>
                {task.list?.name || 'General'}
              </span>
            ) : (
              <div className="text-[11px] font-medium text-zinc-400 truncate max-w-[170px] mb-1">
                {task.list?.name || 'General'}
              </div>
            )}

            {/* Title */}
            <h4
              className="text-[13px] font-bold text-zinc-100 group-hover:text-white line-clamp-2 leading-snug my-0.5 h-[36px]"
              title={task.title}
            >
              {task.title}
            </h4>

            {/* Controls row: circle dot left of bulletin, priority flag (Exact Task Map parity) */}
            <div
              className="flex items-center gap-2 text-xs text-zinc-500 pt-1"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Circle Dot Status Indicator */}
              <CardStatusDropdown
                taskId={task.id}
                currentStatus={task.status || 'In progress'}
                listId={task.listId || task.list?.id}
                onSelect={async (newStatus) => {
                  const currentTask = useAppStore.getState().tasks.find((t) => t.id === task.id) || task;
                  const transitionCheck = canTransitionTaskStatus(currentTask, newStatus);
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

          {/* Right: Section where Sub-Status is (with Posted date + Days Passed / Live Time in top right corner) */}
          <div className="w-[125px] sm:w-[135px] shrink-0 flex flex-col justify-between py-0.5">
            <div className="flex justify-end items-center gap-1.5 flex-wrap">
              {waitingInfo ? (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap"
                  style={{
                    backgroundColor: hexToRgba(followUpHex, 0.16),
                    borderColor: hexToRgba(followUpHex, 0.45),
                    color: waitingInfo.daysPassed === 0 ? '#a1a1aa' : followUpHex,
                  }}
                  title={`Sent but Waiting · ${waitingInfo.daysPassed} day(s) passed (${waitingInfo.rule.label}) since ${format(new Date(waitingInfo.waitingSince), 'MMM d, yyyy')}`}
                >
                  <Clock className="size-2.5 shrink-0" />
                  <span>
                    {waitingInfo.daysPassed === 0
                      ? 'Today'
                      : waitingInfo.daysPassed === 1
                        ? '1 day'
                        : `${waitingInfo.daysPassed} days`}
                  </span>
                </span>
              ) : isLiveWorking || task.progress?.timeIn ? (
                <TaskTimeProgressSlot task={task} isLive={isLiveWorking} />
              ) : (
                <span className="text-[10px] font-medium text-zinc-500">
                  Posted {format(new Date(task.createdAt), 'MMM d')}
                </span>
              )}
            </div>

            <div
              className="w-full"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
                Sub-Status
              </span>
              <TaskMapStatusDropdown
                selectedStatuses={displaySubStatuses}
                options={getCrmOptions(task)}
                onToggleStatus={async (label, nextStatuses) => {
                  const isSelecting = (nextStatuses || []).includes(label);
                  const cleanNext = isSelecting ? [label] : [];

                  if ((label === 'Ready to Send' || label === 'To send') && isSelecting) {
                    const currentTask = useAppStore.getState().tasks.find((t) => t.id === task.id) || task;
                    let transitionCheck = canTransitionTaskStatus(currentTask, 'CRM');
                    if (!transitionCheck.allowed && transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
                      try {
                        const fresh = await tasksApi.getTask(task.id);
                        if (fresh?.task) {
                          const freshCheck = canTransitionTaskStatus(fresh.task, 'CRM');
                          if (freshCheck.allowed) {
                            transitionCheck = freshCheck;
                            useAppStore.getState().updateTask(fresh.task);
                          }
                        }
                      } catch {
                        // fallback
                      }
                    }
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
                  } else if ((label === 'Sent but Waiting' || label === 'Sent') && isSelecting) {
                    if (!isTaskInClientDashboard(task, clients)) {
                      toast.error('Cannot mark as Sent: only tasks within Client Dashboard can be placed in Sent (this client is dormant or not in Client Dashboard).');
                      return;
                    }
                    const currentTask = useAppStore.getState().tasks.find((t) => t.id === task.id) || task;
                    const transitionCheck = canTransitionTaskStatus(currentTask, 'WAITING');
                    if (!transitionCheck.allowed) {
                      if (transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
                        window.dispatchEvent(
                          new CustomEvent('task:highlight-audits', {
                            detail: {
                              taskId: task.id,
                              targetStatus: 'WAITING',
                              uncheckedAudits: transitionCheck.uncheckedAudits,
                              openSubtasks: transitionCheck.openSubtasks,
                            },
                          })
                        );
                      }
                      setBlockedAuditAlert({
                        isOpen: true,
                        task,
                        targetStatus: 'WAITING',
                        uncheckedAudits: transitionCheck.uncheckedAudits,
                        openSubtasks: transitionCheck.openSubtasks,
                      });
                      toast.error(transitionCheck.reason || 'Cannot move task to WAITING');
                      return;
                    }
                  } else if (label === 'Closed' && isSelecting) {
                    const currentTask = useAppStore.getState().tasks.find((t) => t.id === task.id) || task;
                    const transitionCheck = canTransitionTaskStatus(currentTask, 'CLOSED');
                    if (!transitionCheck.allowed) {
                      if (transitionCheck.uncheckedAudits && transitionCheck.uncheckedAudits.length > 0) {
                        window.dispatchEvent(
                          new CustomEvent('task:highlight-audits', {
                            detail: {
                              taskId: task.id,
                              targetStatus: 'CLOSED',
                              uncheckedAudits: transitionCheck.uncheckedAudits,
                              openSubtasks: transitionCheck.openSubtasks,
                            },
                          })
                        );
                      }
                      setBlockedAuditAlert({
                        isOpen: true,
                        task,
                        targetStatus: 'CLOSED',
                        uncheckedAudits: transitionCheck.uncheckedAudits,
                        openSubtasks: transitionCheck.openSubtasks,
                      });
                      toast.error(transitionCheck.reason || 'Cannot move task to CLOSED');
                      return;
                    }
                  }

                  const executeCrmSubStatusTransition = async () => {
                    if (label === 'Ready to Send' || label === 'To send') {
                      if (isSelecting) {
                        onStatusChange(task.id, cleanNext);
                        if (onTaskUpdate) {
                          await onTaskUpdate(task.id, { status: 'CRM' });
                        } else {
                          await tasksApi.updateTask(task.id, { status: 'CRM' } as any).catch(console.error);
                          onDataRefresh();
                        }
                      } else {
                        // User clicked 'Ready to Send' AGAIN in CRM -> revert misclick back to last status
                        const revertStatus = toCanonicalTaskStatus((task as any)._previousStatus || 'IN REVIEW');
                        onStatusChange(task.id, []);
                        if (onTaskUpdate) {
                          await onTaskUpdate(task.id, { status: revertStatus });
                        } else {
                          await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
                          onDataRefresh();
                        }
                        toast.info(`Reverted '${label}' — returned to ${revertStatus}`);
                      }
                    } else if (label === 'Sent but Waiting' || label === 'Sent') {
                      if (isSelecting) {
                        onStatusChange(task.id, ['Sent but Waiting']);
                        if (onTaskUpdate) {
                          await onTaskUpdate(task.id, { status: 'WAITING' });
                        } else {
                          await tasksApi.updateTask(task.id, { status: 'WAITING' } as any).catch(console.error);
                          onDataRefresh();
                        }
                        toast.success('Task marked Sent but Waiting — status updated to WAITING');
                      } else {
                        // Toggled off Sent but Waiting -> revert back to CRM
                        onStatusChange(task.id, ['To send']);
                        if (onTaskUpdate) {
                          await onTaskUpdate(task.id, { status: 'CRM' });
                        } else {
                          await tasksApi.updateTask(task.id, { status: 'CRM' } as any).catch(console.error);
                          onDataRefresh();
                        }
                        toast.info("Reverted 'Sent but Waiting' — returned to CRM");
                      }
                    } else if (label === 'Closed') {
                      if (isSelecting) {
                        onStatusChange(task.id, cleanNext);
                        if (onTaskUpdate) {
                          await onTaskUpdate(task.id, { status: 'CLOSED' });
                        } else {
                          await tasksApi.updateTask(task.id, { status: 'CLOSED' } as any).catch(console.error);
                          onDataRefresh();
                        }
                        toast.success('Task marked CLOSED');
                      } else {
                        // Toggled off Closed -> revert back to WAITING
                        onStatusChange(task.id, ['Sent but Waiting']);
                        if (onTaskUpdate) {
                          await onTaskUpdate(task.id, { status: 'WAITING' });
                        } else {
                          await tasksApi.updateTask(task.id, { status: 'WAITING' } as any).catch(console.error);
                          onDataRefresh();
                        }
                        toast.info("Reverted 'Closed' — returned to WAITING");
                      }
                    } else if (label === 'Follow up' && isSelecting) {
                      onStatusChange(task.id, cleanNext);
                      toast.warning('Task marked for Follow up');
                    } else if (label === 'Revision' || label === 'Revisions') {
                      if (isSelecting) {
                        onStatusChange(task.id, ['Revision']);
                        if (onTaskUpdate) {
                          await onTaskUpdate(task.id, { status: 'REVISION' });
                        } else {
                          await tasksApi.updateTask(task.id, { status: 'REVISION' } as any).catch(console.error);
                          onDataRefresh();
                        }
                        toast.info('Task set to Revision — returned to original MA on Task Map');
                      } else {
                        onStatusChange(task.id, ['To send']);
                        if (onTaskUpdate) {
                          await onTaskUpdate(task.id, { status: 'CRM' });
                        } else {
                          await tasksApi.updateTask(task.id, { status: 'CRM' } as any).catch(console.error);
                          onDataRefresh();
                        }
                        toast.info("Reverted 'Revision' — returned to CRM");
                      }
                    } else if (label === 'Hand-over' || label === 'Handover') {
                      if (isSelecting) {
                        if (task.progress && task.progress.timeIn && !task.progress.timeOut) {
                          task.progress.timeOut = formatManilaTime(new Date());
                        }
                        onStatusChange(task.id, ['To send']);
                        if (onTaskUpdate) {
                          await onTaskUpdate(task.id, { assigneeId: null, status: 'CRM' });
                        } else {
                          await tasksApi.updateTask(task.id, { assigneeId: null, status: 'CRM' } as any).catch(console.error);
                          onDataRefresh();
                        }
                        toast.info('Task handed over — returned to CRM Pool');
                      }
                    } else if (label === 'To Review' || label === 'To review') {
                      if (isSelecting) {
                        if (task.progress && task.progress.timeIn && !task.progress.timeOut) {
                          task.progress.timeOut = formatManilaTime(new Date());
                        }
                        onStatusChange(task.id, []);
                        if (onTaskUpdate) {
                          await onTaskUpdate(task.id, { assigneeId: null, status: 'IN REVIEW' });
                        } else {
                          await tasksApi.updateTask(task.id, { assigneeId: null, status: 'IN REVIEW' } as any).catch(console.error);
                          onDataRefresh();
                        }
                        toast.info('Task moved to Review — transferred to Auditor Map');
                      }
                    } else {
                      onStatusChange(task.id, cleanNext);
                    }
                  };

                  const guide = getSubStatusTransitionGuide(label, 'CRM_MAP', { isSelecting });
                  setSubStatusGuideTarget({
                    task,
                    guide,
                    onConfirm: executeCrmSubStatusTransition,
                  });
                }}
                onOptionsUpdated={onOptionsUpdated}
                readOnly={false}
              />
            </div>
          </div>
        </div>
      </DraggableTaskCard>
    );
  };

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
      badgeClass: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800',
      dotColor: 'bg-[#D9534F]',
      tasks: sentTasks,
    },
    {
      id: 'col-crm-closed',
      title: 'Closed',
      subtitle: 'Closed & verified tasks',
      badgeLabel: 'Closed',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
      dotColor: 'bg-[#2FA37A]',
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

  const sortedMemberCols = [...memberCols]
    .filter((col) => {
      if (isCurrentViewer(col.memberUser)) return true;
      if (!cleanSearch) return true;
      return isCrmMemberSearchMatch(col.memberUser);
    })
    .sort((colA, colB) => {
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
    ...(sentCol ? [sentCol] : []),
    ...sortedMemberCols,
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
              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
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
            const activeFollowUpFilter = columnFollowUpFilters[col.id] || 'ALL';
            const activeFollowUpSort = columnFollowUpSorts[col.id] || 'MOST_OVERDUE';
            const colClientFilter = columnClientFilters[col.id] || 'ALL';
            const colShowAdmin = columnShowAdmin[col.id] ?? showAdminTasks;
            const searchQuery = columnSearches[col.id] || '';
            const isSearchOpen = !!columnSearchOpen[col.id];

            // Apply priority, sub-status, follow-up tier, search, admin, and client filter inside column
            const visibleTasks = col.tasks.filter((t) => {
              if (!matchesPriorityFilter(t, activePriority)) return false;
              if (!matchesSubStatusFilter(t, activeSubStatus)) return false;
              if (col.id === 'col-crm-sent' && !matchesCrmFollowUpFilter(t, activeFollowUpFilter)) return false;
              if (!matchesSearchFilter(t, searchQuery)) return false;

              // Restriction: CRM Sent strictly only displays tasks within Client Dashboard
              if (col.id === 'col-crm-sent' && !isTaskInClientDashboard(t, clients)) return false;

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
                    {countNonOnHoldTasks(col.tasks)}
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
                      {countNonOnHoldTasks(col.tasks)}
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

                  {col.id === 'col-crm-sent' && (
                    <ColumnFollowUpDropdown
                      columnId={col.id}
                      tasks={col.tasks}
                      activeFilter={activeFollowUpFilter}
                      activeSort={activeFollowUpSort}
                      onSelectFilter={(cId, filter) =>
                        setColumnFollowUpFilters((prev) => ({ ...prev, [cId]: filter }))
                      }
                      onSelectSort={(cId, sort) =>
                        setColumnFollowUpSorts((prev) => ({ ...prev, [cId]: sort }))
                      }
                    />
                  )}

                  {(searchQuery || activePriority !== 'ALL' || activeSubStatus !== 'ALL' || (col.id === 'col-crm-sent' && activeFollowUpFilter !== 'ALL') || colClientFilter !== 'ALL') && (
                    <span className="text-[10px] text-zinc-400 italic">
                      ({visibleTasks.length} of {col.tasks.length})
                    </span>
                  )}
                </div>

                {/* Cards List / In Progress & Queue */}
                {col.isMember && col.memberUser ? (
                  <div data-column-body="true" className="flex-1 overflow-y-auto custom-scrollbar space-y-2 px-1.5 py-1 min-h-0">
                    {(() => {
                      const activeInProgTask = visibleTasks.find(
                        (t) =>
                          isTaskActiveInProgress(t, col.memberUser.name) ||
                          (t.progress?.timeIn && !t.progress?.timeOut && !t.progress?.isMissingTime) ||
                          (t.taskMap?.statuses || []).some((s) => s.trim().toUpperCase() === 'IN PROGRESS')
                      );
                      const queuedTasks = visibleTasks.filter((t) => t.id !== activeInProgTask?.id);
                      const isColumnLiveWorking = Boolean(
                        activeInProgTask &&
                        (isTaskLiveWorking(activeInProgTask, col.memberUser.name, boardLiveClock) ||
                          (activeInProgTask.progress?.timeIn && !activeInProgTask.progress?.timeOut && !activeInProgTask.progress?.isMissingTime))
                      );
                      const liveSlotLabel = isColumnLiveWorking && activeInProgTask
                        ? (toCanonicalTaskStatus(activeInProgTask.status) || activeInProgTask.status || 'In Progress')
                        : 'In Progress';
                      const liveSlotColor = isColumnLiveWorking && activeInProgTask
                        ? resolveTaskStatusColor(
                            liveSlotLabel,
                            activeInProgTask.listId || activeInProgTask.list?.id,
                            activeInProgTask.list?.statuses
                          )
                        : '#22A3AE';
                      const isCrmOrPm = Boolean(isPmUser || (currentUser?.id && currentUser.id === col.memberUser.id));

                      return (
                        <>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between px-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`size-2 rounded-full ${isColumnLiveWorking ? 'animate-pulse' : 'bg-zinc-600'}`}
                                  style={isColumnLiveWorking ? { backgroundColor: liveSlotColor } : undefined}
                                />
                                <span
                                  className={`text-[10px] font-bold uppercase tracking-wider ${isColumnLiveWorking ? '' : 'text-zinc-400'}`}
                                  style={isColumnLiveWorking ? { color: liveSlotColor } : undefined}
                                >
                                  {liveSlotLabel}
                                </span>
                              </div>
                            </div>

                            {activeInProgTask ? (
                              <DroppableInProgressSlot userId={col.memberUser.id} disabled={false}>
                                {renderCrmCard(activeInProgTask, isColumnLiveWorking)}
                              </DroppableInProgressSlot>
                            ) : (
                              <TaskMapInProgressDropCard
                                userId={col.memberUser.id}
                                userName={col.memberUser.name}
                                availableTasks={poolTasks}
                                allAvailableTasks={allAvailablePool}
                                allTasks={allTasks || tasks}
                                queuedTasks={queuedTasks}
                                onSelectTask={(taskId, task) => handleSelectInProgressTask(taskId, col.memberUser.id, task)}
                                disabled={false}
                                canBrowse={isCrmOrPm}
                                roleLabel="CRM member"
                              />
                            )}
                          </div>

                          {/* QUEUE SECTION */}
                          {queuedTasks.length > 0 && (
                            <div className="mt-2.5 pt-2.5 border-t border-border/80 space-y-1.5">
                              <div className="flex items-center justify-between px-1">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                                  Queue ({queuedTasks.length})
                                </span>
                              </div>
                              {sortTasksUrgentFirst(queuedTasks).map((t) => renderCrmCard(t))}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div data-column-body="true" className="flex-1 overflow-y-auto custom-scrollbar space-y-3 px-1.5 py-1 min-h-0">
                    {visibleTasks.length === 0 ? (
                      (() => {
                        const searchMatches = searchQuery.trim()
                          ? findSearchedTaskLocations(searchQuery, combinedTasks, allUsers)
                          : [];
                        return (
                          <div className="p-4 bg-zinc-900/40 border border-dashed border-zinc-800 rounded-xl min-h-[112px] flex flex-col items-center justify-center text-center transition-all hover:border-zinc-700/80 space-y-2">
                            <span className="text-xs font-semibold text-zinc-400">
                              {col.id === 'col-crm-sent'
                                ? 'No sent tasks'
                                : col.id === 'col-crm-closed'
                                  ? 'No closed tasks'
                                  : 'No CRM tasks'}
                            </span>
                            <span className="text-[11px] text-zinc-500">
                              {searchQuery || activePriority !== 'ALL'
                                ? 'No tasks match filter'
                                : col.id === 'col-crm-sent'
                                  ? 'Drop tasks here when outreach has been sent to client'
                                  : col.id === 'col-crm-closed'
                                    ? 'Closed and verified tasks appear here'
                                    : `Drop client communication tasks here to assign to ${col.title}`}
                            </span>
                            {searchMatches.length > 0 && (
                              <div className="w-full rounded-lg border border-zinc-800 bg-zinc-900/80 p-2 text-left space-y-1">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                                  Found elsewhere:
                                </p>
                                {searchMatches.map((m) => (
                                  <div key={m.taskId} className="text-[11px] leading-snug text-zinc-300">
                                    <span className="font-medium text-white">{m.title}</span>
                                    <span className="text-zinc-400"> — {m.locationText}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      (col.id === 'col-crm-sent'
                        ? sortCrmSentTasks(visibleTasks, activeFollowUpSort, sortTasksUrgentFirst)
                        : sortTasksUrgentFirst(visibleTasks)
                      ).map((task) => renderCrmCard(task))
                    )}
                  </div>
                )}
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

      {/* Sub-Status Change Guide Modal */}
      {subStatusGuideTarget && (
        <SubStatusChangeGuideModal
          isOpen={Boolean(subStatusGuideTarget)}
          onClose={() => setSubStatusGuideTarget(null)}
          onConfirm={subStatusGuideTarget.onConfirm}
          guide={subStatusGuideTarget.guide}
          taskTitle={subStatusGuideTarget.task.title}
          clientName={subStatusGuideTarget.task.progress?.client || subStatusGuideTarget.task.list?.name || ''}
          currentSubStatuses={subStatusGuideTarget.task.taskMap?.statuses || []}
          currentMainStatus={subStatusGuideTarget.task.status || ''}
        />
      )}
    </DndContext>
  );
};

