import React, { useState } from 'react';
import { TaskMapItem, TaskMapOption, taskMapApi } from '@/api/taskMap';
import { TaskMapStatusDropdown } from './TaskMapStatusDropdown';
import { TaskDescriptionButton } from './TaskDescriptionButton';
import { Flag, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { getPriorityConfig } from '@/lib/priority';
import { getAssigneeAvatarColor, CustomCircleDot, CustomCircleDotted } from '@/lib/taskTokens';
import { isProjectManagerOrAdmin } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';
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
  currentShift: string;
  onStatusChange: (taskId: string, newStatuses: string[]) => void;
  onOptionsUpdated: () => void;
  onOpenDetail: (task: TaskMapItem) => void;
  onDataRefresh: () => void;
}

const getDotColor = (status?: string) => {
  if (!status) return '#3b82f6';
  const up = status.toUpperCase();
  const hexMap: Record<string, string> = {
    'IN PROGRESS': '#D04A7C',
    'IN_PROGRESS': '#D04A7C',
    PENDING: '#D29A2A',
    REVISION: '#5B6BD6',
    WAITING: '#D9534F',
    'IN REVIEW': '#D97B3A',
    IN_REVIEW: '#D97B3A',
    CHECKING: '#A35DB8',
    CRM: '#22A3AE',
    CLOSED: '#2FA37A',
    DONE: '#2FA37A',
    KYC: '#3A8F55',
    'PIN BOARD': '#1F8A6E',
    'ON-HOLD': '#8A8F98',
  };
  return hexMap[up] || '#3b82f6';
};

// Priority ranking for user columns:
// 1. Instruction -> 2. Designers -> 3. UI/UX -> 4. Funnel -> 5. Auditor -> 6. Other
export function getUserRolePriority(roles: string[] = [], isAudit = false): {
  priority: number;
  label: string;
  badgeClass: string;
} {
  const rolesLower = (roles || []).map((r) => (r || '').toLowerCase());

  // 1. Instruction
  if (rolesLower.some((r) => r.includes('instruction'))) {
    return {
      priority: 1,
      label: 'Instruction',
      badgeClass: 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60',
    };
  }

  // 2. Designers (Design, Motion Graphics) without UI/UX
  if (
    rolesLower.some((r) => r.includes('design') || r.includes('motion graphic')) &&
    !rolesLower.some((r) => r.includes('ui') || r.includes('ux'))
  ) {
    return {
      priority: 2,
      label: 'Designer',
      badgeClass: 'bg-pink-950/70 text-pink-300 border-pink-800/60',
    };
  }

  // 3. UI/UX (UI UX Auditor, UI/UX Designer)
  if (rolesLower.some((r) => r.includes('ui') || r.includes('ux'))) {
    return {
      priority: 3,
      label: 'UI/UX',
      badgeClass: 'bg-cyan-950/70 text-cyan-300 border-cyan-800/60',
    };
  }

  // 4. Funnel (Funnel Auditor, Funnel Builder, Funnel Strategist)
  if (rolesLower.some((r) => r.includes('funnel'))) {
    return {
      priority: 4,
      label: 'Funnel',
      badgeClass: 'bg-amber-950/70 text-amber-300 border-amber-800/60',
    };
  }

  // 5. Generic Auditor if marked isAudit
  if (isAudit) {
    return {
      priority: 5,
      label: 'Auditor',
      badgeClass: 'bg-purple-950/70 text-purple-300 border-purple-800/60',
    };
  }

  // 6. Normal Team Members / Developers
  return {
    priority: 6,
    label: '',
    badgeClass: 'bg-zinc-800 text-zinc-400 border-zinc-700/60',
  };
}

// Sort helper: In progress on top -> Urgent tasks -> High priority -> Remaining tasks
const isTaskInProgress = (task: TaskMapItem) => {
  const s = (task.status || '').toUpperCase().replace(/[\s_-]+/g, '');
  if (s === 'INPROGRESS') return true;
  const customStatuses = task.taskMap?.statuses || [];
  return customStatuses.some(
    (cs) => cs.toUpperCase().replace(/[\s_-]+/g, '') === 'INPROGRESS'
  );
};

const isTaskUrgent = (task: TaskMapItem) => {
  const p = (task.priority || '').toUpperCase();
  if (p === 'URGENT') return true;
  const customStatuses = task.taskMap?.statuses || [];
  return customStatuses.some(
    (cs) => cs.toUpperCase().includes('URGENT')
  );
};

const isTaskHigh = (task: TaskMapItem) => {
  const p = (task.priority || '').toUpperCase();
  return p === 'HIGH';
};

const sortColumnTasks = (items: TaskMapItem[]) => {
  return [...items].sort((a, b) => {
    const inProgA = isTaskInProgress(a) ? 1 : 0;
    const inProgB = isTaskInProgress(b) ? 1 : 0;
    if (inProgA !== inProgB) return inProgB - inProgA;

    const urgentA = isTaskUrgent(a) ? 1 : 0;
    const urgentB = isTaskUrgent(b) ? 1 : 0;
    if (urgentA !== urgentB) return urgentB - urgentA;

    const highA = isTaskHigh(a) ? 1 : 0;
    const highB = isTaskHigh(b) ? 1 : 0;
    if (highA !== highB) return highB - highA;

    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });
};

// ---------------------------------------------------------------------------
// Draggable Card Wrapper
// ---------------------------------------------------------------------------
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
      className={`touch-none ${isDragging ? 'opacity-30' : ''} ${disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
    >
      {children}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Droppable Column Wrapper
// ---------------------------------------------------------------------------
const DroppableColumn: React.FC<{
  id: string;
  children: React.ReactNode;
  className?: string;
}> = ({ id, children, className }) => {
  const { setNodeRef, isOver } = useDroppable({
    id,
  });

  return (
    <div
      ref={setNodeRef}
      className={`${className || ''} ${isOver ? 'ring-2 ring-blue-500/50' : ''}`}
    >
      {children}
    </div>
  );
};

export const TaskMapBoardView: React.FC<Props> = ({
  tasks = [],
  availablePool = [],
  options = [],
  allUsers = [],
  shiftUsers = [],
  currentShift,
  onStatusChange,
  onOptionsUpdated,
  onOpenDetail,
  onDataRefresh,
}) => {
  const currentUser = useAppStore((s) => s.currentUser);
  const workspaceUsers = useAppStore((s) => s.workspaceUsers) || [];
  const isPmUser = isProjectManagerOrAdmin(currentUser);

  const [activeDragTask, setActiveDragTask] = useState<TaskMapItem | null>(null);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Helper to find full user profile
  const getUserProfile = (userId: string, fallbackUser?: any) => {
    const fromShift = shiftUsers.find((u) => u.id === userId);
    if (fromShift) return fromShift;
    const fromAll = allUsers.find((u) => u.id === userId);
    if (fromAll) return fromAll;
    const fromStore = workspaceUsers.find((u) => u.id === userId);
    if (fromStore) return fromStore;
    if (currentUser?.id === userId) return currentUser;
    return fallbackUser || { id: userId, name: fallbackUser?.name || 'User' };
  };

  // Helper to check if a task is closed (never show to users on Task Map)
  const isClosedTask = (task: TaskMapItem) => {
    if (task.isClosed) return true;
    const s = (task.status || '').toUpperCase().replace(/[\s_-]+/g, '');
    if (
      s === 'CLOSED' ||
      s === 'DONE' ||
      s === 'COMPLETE' ||
      s === 'COMPLETED' ||
      s === 'RESOLVED' ||
      s === 'CANCELLED'
    ) {
      return true;
    }
    const customStatuses = task.taskMap?.statuses || [];
    return customStatuses.some(
      (cs) => cs.toUpperCase() === 'DONE' || cs.toUpperCase() === 'CLOSED'
    );
  };

  // Group non-pool tasks by assignee
  const poolIds = new Set(availablePool.map((p) => p.id));
  const userColumnsMap: Record<string, { user: any; tasks: TaskMapItem[] }> = {};

  // 1. Populate ONLY configured shift members so users not on this shift are NOT shown
  shiftUsers.forEach((u) => {
    userColumnsMap[u.id] = {
      user: getUserProfile(u.id, u),
      tasks: [],
    };
  });

  // Fallback ONLY if shiftUsers has not been configured/loaded
  if (shiftUsers.length === 0) {
    tasks.forEach((task) => {
      if (poolIds.has(task.id) || isClosedTask(task)) return;
      const u = task.assignee || (task.assignees && task.assignees[0]);
      const userId = u?.id;
      if (!userId || userId === 'unassigned') return;
      if (!userColumnsMap[userId]) {
        userColumnsMap[userId] = {
          user: getUserProfile(userId, u),
          tasks: [],
        };
      }
    });
  }

  // 2. Add non-closed tasks strictly to the users on this shift
  tasks.forEach((task) => {
    if (poolIds.has(task.id)) return;
    if (isClosedTask(task)) return; // Don't show closed task to users!

    const u = task.assignee || (task.assignees && task.assignees[0]);
    const userId = u?.id;
    if (!userId || userId === 'unassigned') return;

    if (userColumnsMap[userId]) {
      userColumnsMap[userId].tasks.push(task);
    }
  });

  // 3. Sort columns:
  // Prioritize Instruction first -> Designers -> UI/UX -> Funnel -> Auditor -> Other
  const sortedUserColumns = Object.entries(userColumnsMap).sort(([idA, colA], [idB, colB]) => {
    const roleA = getUserRolePriority(colA.user?.roles || [], colA.user?.isAudit);
    const roleB = getUserRolePriority(colB.user?.roles || [], colB.user?.isAudit);

    if (roleA.priority !== roleB.priority) {
      return roleA.priority - roleB.priority;
    }

    return (colA.user.name || '').localeCompare(colB.user.name || '');
  });

  // DnD Handlers
  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as TaskMapItem;
    if (!task) return;

    const isFromAvailable = poolIds.has(task.id);
    if (isFromAvailable && !isPmUser) {
      toast.error('Only Project Managers and Admins can assign tasks from the Available column');
      return;
    }

    setActiveDragTask(task);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragTask(null);

    if (!over) return;

    const taskId = active.id as string;
    const targetColumnId = over.id as string;
    const isFromAvailable = poolIds.has(taskId);

    if (isFromAvailable && !isPmUser) {
      toast.error('Only Project Managers and Admins can assign tasks from the Available column');
      return;
    }

    // Dropped on a user column: assign task to that user
    if (targetColumnId.startsWith('user-')) {
      const targetUserId = targetColumnId.replace('user-', '');
      try {
        await taskMapApi.assignTask(taskId, targetUserId);
        const targetUser = getUserProfile(targetUserId);
        toast.success(`Task assigned to ${targetUser.name || 'user'}`);
        onDataRefresh();
      } catch (err: any) {
        toast.error(err.message || 'Failed to assign task');
      }
    } else if (targetColumnId === 'available-pool') {
      // Unassign task to available pool (PMs only)
      if (!isPmUser) {
        toast.error('Only Project Managers can move tasks to the Available column');
        return;
      }
      try {
        await taskMapApi.assignTask(taskId, null);
        toast.success('Task moved to available pool');
        onDataRefresh();
      } catch (err: any) {
        toast.error(err.message || 'Failed to move task');
      }
    }
  };

  // Image 1 Status Presets (Available Tasks / PM-only)
  const getAvailableTaskOptions = (task: TaskMapItem): TaskMapOption[] => {
    const list: TaskMapOption[] = [
      { id: 'opt-avail-1', label: 'Available Task', color: '#1d4ed8', textColor: '#ffffff', order: 0 },
      { id: 'opt-avail-2', label: 'Sent', color: '#15803d', textColor: '#ffffff', order: 1 },
      { id: 'opt-avail-3', label: 'To send', color: '#b91c1c', textColor: '#ffffff', order: 2 },
      { id: 'opt-avail-4', label: 'Follow up', color: '#fbcfe8', textColor: '#831843', order: 3 },
      { id: 'opt-avail-5', label: 'Done Review', color: '#99f6e4', textColor: '#134e4a', order: 4 },
      { id: 'opt-avail-6', label: 'Revision', color: '#e9d5ff', textColor: '#581c87', order: 5 },
      { id: 'opt-avail-7', label: 'CHE', color: '#f87171', textColor: '#ffffff', order: 6 },
      { id: 'opt-avail-8', label: 'PAU', color: '#7e22ce', textColor: '#ffffff', order: 7 },
      { id: 'opt-avail-9', label: 'HAN', color: '#facc15', textColor: '#713f12', order: 8 },
      { id: 'opt-avail-10', label: 'URGENT TASK', color: '#991b1b', textColor: '#fee2e2', order: 9 },
    ];

    // Dynamic Upwork PM options: Upwork + username for PMs
    const pms = allUsers.filter((u: any) => {
      if (u.systemRole === 'ADMIN') return true;
      const r = (u.roles || []).join(' ').toLowerCase();
      if (r.includes('pm') || r.includes('project manager') || r.includes('team lead') || r.includes('senior')) return true;
      const n = (u.name || '').toUpperCase();
      return n.includes('HAN') || n.includes('CHE') || n.includes('PAU');
    });

    const pmNames = pms.length > 0 ? Array.from(new Set(pms.map((p: any) => p.name.toUpperCase()))) : ['HANNAH', 'CHE', 'PAU'];
    pmNames.forEach((pmName: string, idx: number) => {
      const label = `UPWORK | ${pmName}`;
      let color = '#3b82f6';
      let textColor = '#ffffff';
      if (pmName.includes('PAU')) {
        color = '#7e22ce';
      } else if (pmName.includes('CHE')) {
        color = '#f87171';
      } else if (pmName.includes('HAN')) {
        color = '#facc15';
        textColor = '#713f12';
      }
      list.push({
        id: `opt-avail-upwork-${idx}`,
        label,
        color,
        textColor,
        order: 10 + idx,
      });
    });

    // Ensure any currently selected statuses on this task are also present so the PM can see and remove them
    (task.taskMap.statuses || []).forEach((st: string) => {
      if (!list.some((o) => o.label.toLowerCase() === st.toLowerCase())) {
        const isUpwork = st.toUpperCase().startsWith('UPWORK');
        list.push({
          id: `opt-cur-${st}`,
          label: st,
          color: isUpwork ? '#7f1d1d' : '#3f3f46',
          textColor: '#ffffff',
          order: 99,
        });
      }
    });

    return list;
  };

  // Image 2 Status Presets (Normal Member Tasks)
  const getUserTaskOptions = (task: TaskMapItem, user: any): TaskMapOption[] => {
    const list: TaskMapOption[] = [
      { id: 'opt-user-1', label: 'Not started', color: '#52525b', textColor: '#f4f4f5', order: 0 },
      { id: 'opt-user-2', label: 'In progress', color: '#ca8a04', textColor: '#fef08a', order: 1 },
      { id: 'opt-user-3', label: 'Done', color: '#166534', textColor: '#dcfce7', order: 2 },
      { id: 'opt-user-4', label: 'URGENT', color: '#991b1b', textColor: '#fee2e2', order: 3 },
      { id: 'opt-user-5', label: 'To review', color: '#1d4ed8', textColor: '#dbeafe', order: 4 },
      { id: 'opt-user-6', label: 'SENT', color: '#bbf7d0', textColor: '#14532d', order: 5 },
      { id: 'opt-user-7', label: 'Handed-over/Ready for Next Steps', color: '#e9d5ff', textColor: '#581c87', order: 7 },
    ];

    // Dynamic Upwork + username: e.g. "UPWORK | SHEMUEL" (NOT "UPWORK ACTIVE"!)
    const targetName = (user?.name || task.assignee?.name || currentUser?.name || 'User').toUpperCase();
    const upworkLabel = `UPWORK | ${targetName}`;

    list.splice(6, 0, {
      id: `opt-user-upwork-${targetName}`,
      label: upworkLabel,
      color: '#7f1d1d',
      textColor: '#fee2e2',
      order: 6,
    });

    // Ensure any currently selected statuses on this task are also present so the user/PM can see and remove them
    (task.taskMap.statuses || []).forEach((st: string) => {
      if (!list.some((o) => o.label.toLowerCase() === st.toLowerCase())) {
        const isUpwork = st.toUpperCase().startsWith('UPWORK');
        list.push({
          id: `opt-cur-${st}`,
          label: st,
          color: isUpwork ? '#7f1d1d' : '#3f3f46',
          textColor: '#ffffff',
          order: 99,
        });
      }
    });

    return list;
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-5 px-6 pb-6 overflow-x-auto custom-scrollbar h-full min-h-[480px] select-none">
        {/* 1. Available Tasks Pool Column (Matches Image 1) */}
        <DroppableColumn
          id="available-pool"
          className="w-[370px] shrink-0 flex flex-col bg-[#0d121c]/90 border border-[#1e2a40] rounded-2xl p-4 shadow-xl h-[calc(100vh-140px)]"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-1.5">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#0099ff]" />
              <h3 className="text-sm font-bold text-zinc-100">Available tasks</h3>
            </div>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#172554] text-[#60a5fa] border border-[#1e3a8a]">
              {availablePool.length}
            </span>
          </div>

          <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
            Revision and pending tasks waiting for Project Manager assignment.
          </p>

          {/* Cards List */}
          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1">
            {availablePool.length === 0 ? (
              <p className="text-xs text-zinc-600 italic text-center py-12">
                No revision or pending tasks in the pool.
              </p>
            ) : (
              sortColumnTasks(availablePool).map((task) => {
                const priorityConfig = getPriorityConfig(task.priority);
                const isClosed = (task.status || '').toUpperCase() === 'CLOSED' || (task.status || '').toUpperCase() === 'DONE';

                return (
                  <DraggableTaskCard
                    key={task.id}
                    task={task}
                    disabled={!isPmUser}
                  >
                    <div className="p-3 bg-[#13161f] border border-[#232936] hover:border-[#384259] rounded-xl shadow-md min-h-[94px] flex items-stretch gap-3 transition-all group">
                      {/* Left: Task Info (Task title only in title line, circle dot beside bulletin below) */}
                      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                        {/* Client Name */}
                        <div className="text-[11px] font-medium text-zinc-400 truncate max-w-[190px] mb-1">
                          {task.list?.name || 'General'}
                        </div>

                        {/* Title only - zero icons beside it */}
                        <h4
                          onClick={() => onOpenDetail(task)}
                          className="text-[13px] font-bold text-zinc-100 group-hover:text-white cursor-pointer line-clamp-2 leading-snug hover:underline my-0.5"
                          title={task.title}
                        >
                          {task.title}
                        </h4>

                        {/* Controls row: circle dot left of bulletin, priority flag */}
                        <div className="flex items-center gap-2 text-xs text-zinc-500 pt-1">
                          {/* Circle Dot Status Indicator */}
                          <span className="shrink-0 flex items-center" title={task.status || 'In progress'}>
                            {isClosed ? (
                              <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                            ) : (task.status || '').toUpperCase() === 'KYC' ? (
                              <CustomCircleDotted className="size-3.5 text-emerald-600 shrink-0" />
                            ) : (
                              <CustomCircleDot className="size-3.5 shrink-0" style={{ color: getDotColor(task.status) }} />
                            )}
                          </span>

                          {/* Bulletin Icon - click shows task description */}
                          <TaskDescriptionButton description={task.description} taskTitle={task.title} />

                          {/* Priority Flag and Label */}
                          <span className="flex items-center gap-1 font-medium text-[11px]">
                            <Flag className={`size-3 ${priorityConfig.iconColor}`} />
                            <span className={priorityConfig.color}>{priorityConfig.label}</span>
                          </span>
                        </div>
                      </div>

                      {/* Separator */}
                      <div className="w-px bg-zinc-800/80 self-stretch my-0.5 shrink-0" />

                      {/* Right: Section where Set Status is (with Posted date in top right corner) */}
                      <div className="w-[125px] sm:w-[135px] shrink-0 flex flex-col justify-between py-0.5">
                        <div className="flex justify-end items-center">
                          <span className="text-[10px] font-medium text-zinc-500">
                            Posted {format(new Date(task.createdAt), 'MMM d')}
                          </span>
                        </div>

                        <div className="w-full">
                          <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
                            Set Status
                          </span>
                          <TaskMapStatusDropdown
                            selectedStatuses={task.taskMap.statuses || []}
                            options={getAvailableTaskOptions(task)}
                            onToggleStatus={(label) => {
                              if (!isPmUser) {
                                toast.error('Only Project Managers can modify statuses on Available Tasks');
                                return;
                              }
                              const current = task.taskMap.statuses || [];
                              const next = current.includes(label)
                                ? current.filter((s) => s !== label)
                                : [...current, label];
                              onStatusChange(task.id, next);
                            }}
                            onOptionsUpdated={onOptionsUpdated}
                            readOnly={!isPmUser}
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

        {/* 2. User Shift Columns (Matches Image 1 & 4) */}
        {sortedUserColumns.map(([userId, { user, tasks: userTasks }]) => {
          const initials = (user.name || 'U').substring(0, 2).toUpperCase();
          const avatarBg = getAssigneeAvatarColor(user.name || 'U');

          return (
            <DroppableColumn
              key={userId}
              id={`user-${userId}`}
              className="w-[370px] shrink-0 flex flex-col bg-[#111216]/90 border border-zinc-800/80 rounded-2xl p-4 shadow-xl h-[calc(100vh-140px)]"
            >
              {/* User Column Header */}
              {(() => {
                const roleInfo = getUserRolePriority(user.roles || [], user.isAudit);

                return (
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-800/70 mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt={user.name}
                          className="size-7 rounded-full object-cover border border-zinc-700/80 shrink-0"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div
                          className={`size-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm shrink-0 ${avatarBg}`}
                        >
                          {initials}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-bold text-zinc-100 truncate">
                          {user.name}
                        </span>
                        {roleInfo.label ? (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${roleInfo.badgeClass}`}
                          >
                            {roleInfo.label}
                          </span>
                        ) : user.isAudit ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-950/70 text-purple-300 border border-purple-800/60 shrink-0">
                            Auditor
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span className="text-xs text-zinc-400 font-medium">
                      {userTasks.length} {userTasks.length === 1 ? 'task' : 'tasks'}
                    </span>
                  </div>
                );
              })()}

              {/* Tasks in Step Order */}
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1">
                {userTasks.length === 0 ? (
                  <p className="text-xs text-zinc-600 italic text-center py-12">
                    No tasks assigned for this shift.
                  </p>
                ) : (
                  sortColumnTasks(userTasks).map((task) => {
                    const priorityConfig = getPriorityConfig(task.priority);
                    const isClosed = (task.status || '').toUpperCase() === 'CLOSED' || (task.status || '').toUpperCase() === 'DONE';

                    return (
                      <DraggableTaskCard key={task.id} task={task} disabled={!isPmUser}>
                        <div className="p-3 bg-[#18191e] border border-zinc-800/90 hover:border-zinc-700 rounded-xl shadow-sm min-h-[94px] flex items-stretch gap-3 transition-all group">
                          {/* LEFT: Task Info (Title only in title line, circle dot beside bulletin below) */}
                          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                            {/* Client Name */}
                            <div className="text-[11px] font-medium text-zinc-400 truncate max-w-[190px] mb-1">
                              {task.list?.name || 'General'}
                            </div>

                            {/* Title only - zero icons beside it */}
                            <h4
                              onClick={() => onOpenDetail(task)}
                              className="text-[13px] font-bold text-zinc-100 group-hover:text-white cursor-pointer line-clamp-2 leading-snug hover:underline my-0.5"
                              title={task.title}
                            >
                              {task.title}
                            </h4>

                            {/* Controls row: circle dot left of bulletin, priority flag */}
                            <div className="flex items-center gap-2 text-xs text-zinc-500 pt-1">
                              {/* Circle Dot Status Indicator */}
                              <span className="shrink-0 flex items-center" title={task.status || 'In progress'}>
                                {isClosed ? (
                                  <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                                ) : (task.status || '').toUpperCase() === 'KYC' ? (
                                  <CustomCircleDotted className="size-3.5 text-emerald-600 shrink-0" />
                                ) : (
                                  <CustomCircleDot className="size-3.5 shrink-0" style={{ color: getDotColor(task.status) }} />
                                )}
                              </span>

                              {/* Bulletin Icon - click shows task description */}
                              <TaskDescriptionButton description={task.description} taskTitle={task.title} />

                              {/* Priority Flag and Label */}
                              <span className="flex items-center gap-1 font-medium text-[11px]">
                                <Flag className={`size-3 ${priorityConfig.iconColor}`} />
                                <span className={priorityConfig.color}>{priorityConfig.label}</span>
                              </span>
                            </div>
                          </div>

                          {/* SEPARATOR: Vertical line between task info and statuses */}
                          <div className="w-px bg-zinc-800/80 self-stretch my-0.5 shrink-0" />

                          {/* RIGHT: Section where Set Status is (with Posted date in top right corner) */}
                          <div className="w-[125px] sm:w-[135px] shrink-0 flex flex-col justify-between py-0.5">
                            <div className="flex justify-end items-center">
                              <span className="text-[10px] font-medium text-zinc-500">
                                Posted {format(new Date(task.createdAt), 'MMM d')}
                              </span>
                            </div>

                            <div className="w-full">
                              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
                                Set Status
                              </span>
                              <TaskMapStatusDropdown
                                selectedStatuses={task.taskMap.statuses || []}
                                options={getUserTaskOptions(task, user)}
                                onToggleStatus={(label) => {
                                  const canEdit = isPmUser || currentUser?.id === user.id || currentUser?.id === task.assigneeId;
                                  if (!canEdit) {
                                    toast.error('Only the assigned user or Project Managers can update this task');
                                    return;
                                  }
                                  const current = task.taskMap.statuses || [];
                                  const next = current.includes(label)
                                    ? current.filter((s) => s !== label)
                                    : [...current, label];
                                  onStatusChange(task.id, next);
                                }}
                                onOptionsUpdated={onOptionsUpdated}
                                readOnly={!isPmUser && currentUser?.id !== user.id && currentUser?.id !== task.assigneeId}
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

      {/* Drag Overlay Preview */}
      <DragOverlay>
        {activeDragTask ? (
          <div className="p-3.5 bg-[#18191e] border border-blue-500/80 rounded-xl shadow-2xl w-[320px] pointer-events-none opacity-90">
            <span className="text-xs text-zinc-400 font-medium block mb-1">
              {activeDragTask.list?.name || 'General'}
            </span>
            <h4 className="text-sm font-bold text-white truncate">
              {activeDragTask.title}
            </h4>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
