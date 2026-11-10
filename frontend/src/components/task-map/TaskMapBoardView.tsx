import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { TaskMapItem, TaskMapOption, taskMapApi, createEmptyUserBlock } from '@/api/taskMap';
import { tasksApi } from '@/api/tasks';
import { TaskMapStatusDropdown } from './TaskMapStatusDropdown';
import { TaskDescriptionButton } from './TaskDescriptionButton';
import { UserRoleBadge } from './UserRoleBadge';
import { CardStatusDropdown, CardPriorityDropdown, TaskTimeProgressSlot, computeElapsed, isStaleLiveSession } from './TaskMapCardControls';
import { TaskMapInProgressDropCard } from './TaskMapInProgressDropCard';
import { ColumnClientDropdown } from './ColumnClientDropdown';
import { ColumnSubStatusDropdown, matchesSubStatusFilter } from './ColumnSubStatusDropdown';

export function doesProgressMatchUser(progMaName?: string | null, userName?: string | null): boolean {
  if (!progMaName || !userName) return false;
  const cleanMa = progMaName.trim().toLowerCase();
  const cleanUser = userName.trim().toLowerCase();
  if (cleanMa === cleanUser) return true;
  const maParts = cleanMa.split(/\s+/);
  const userParts = cleanUser.split(/\s+/);
  if (maParts.some((p) => p.length >= 3 && userParts.includes(p))) return true;
  if (cleanUser.includes(cleanMa) || cleanMa.includes(cleanUser)) return true;
  return false;
}

import { Flag, CheckCircle2, ChevronLeft, ChevronRight, ChevronsRight, ChevronDown, Check, Building2, Search, Shield, Pin, X, Infinity as InfinityIcon, Sparkles, CornerDownRight, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { getPriorityConfig } from '@/lib/priority';
import { getAssigneeAvatarColor, CustomCircleDot, CustomCircleDotted } from '@/lib/taskTokens';
import { isProjectManagerOrAdmin } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';
import { ActionErrorModal, ActionErrorInfo } from '@/components/modals/ActionErrorModal';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
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
  showAdminTasks?: boolean;
  onToggleAdminTasks?: () => void;
  selectedCustomMAs?: string[];
  clients?: Array<{ id: string; name: string; count: number }>;
  onTaskUpdate?: (taskId: string, fields: Partial<TaskMapItem>) => Promise<void> | void;
  isHistory?: boolean;
  search?: string;
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

export const isTaskLiveWorking = (task: TaskMapItem, userName?: string, now = new Date()): boolean => {
  const isClosed =
    (task.status || '').toUpperCase() === 'CLOSED' || (task.status || '').toUpperCase() === 'DONE';
  if (isClosed) return false;
  const statuses = (task.taskMap?.statuses || []).map((s) => s.toUpperCase().trim());
  if (statuses.includes('CLOSED') || statuses.includes('DONE')) return false;

  // Synthetic assumption block representing assistant's open shift input
  if (task.isAssumptionBlock && task.progress?.timeIn && !task.progress?.timeOut && !task.progress?.isMissingTime) {
    return true;
  }

  const isMyProg = doesProgressMatchUser(task.progress?.maName, userName);
  const prog = isMyProg ? task.progress : null;
  if (!prog?.timeIn || prog?.timeOut || prog?.isMissingTime) return false;
  if (isStaleLiveSession(prog.timeIn, prog.date, now)) return false;
  return true;
};

export const isTaskActiveInProgress = (task: TaskMapItem, userName?: string): boolean => {
  const isClosed =
    (task.status || '').toUpperCase() === 'CLOSED' || (task.status || '').toUpperCase() === 'DONE';
  if (isClosed) return false;
  const statuses = (task.taskMap?.statuses || []).map((s) => s.toUpperCase().trim());
  if (statuses.includes('CLOSED') || statuses.includes('DONE')) return false;

  // 0. Active synthetic assumption block strictly takes the In Progress slot
  if (task.isAssumptionBlock) return true;

  // 1. Worker isolation: check if user clocked in to this task and has not clocked out (and not stale)
  if (isTaskLiveWorking(task, userName)) return true;

  // 2. Task status or custom status is In progress
  // Guard: if this task holds an unclosed session for this user that is STALE, it cannot act as active in progress
  if (isTaskInProgress(task)) {
    const isMyProg = doesProgressMatchUser(task.progress?.maName, userName);
    if (isMyProg && task.progress?.timeIn && isStaleLiveSession(task.progress.timeIn, task.progress.date)) {
      return false;
    }
    return true;
  }

  return false;
};

const isTaskUrgent = (task: TaskMapItem) => {
  const p = (task.priority || '').toUpperCase();
  if (p === 'URGENT') return true;
  const customStatuses = task.taskMap?.statuses || [];
  if (customStatuses.some((cs) => cs.toUpperCase().includes('URGENT'))) return true;
  if (((task as any).tags || []).some((tag: any) => (tag?.name || tag || '').toUpperCase().includes('URGENT'))) return true;
  if ((task.title || '').toUpperCase().includes('[URGENT]')) return true;
  return false;
};

const isTaskHigh = (task: TaskMapItem) => {
  const p = (task.priority || '').toUpperCase();
  return p === 'HIGH';
};

const isTaskOnHold = (t: TaskMapItem) => {
  const s = (t.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (s === 'ONHOLD' || s.includes('HOLD')) return true;
  const customStatuses = t.taskMap?.statuses || [];
  return customStatuses.some((cs: string) => {
    const up = (cs || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
    return up === 'ONHOLD' || up.includes('HOLD');
  });
};

const sortAvailablePoolTasks = (items: TaskMapItem[]) => {
  return [...items].sort((a, b) => {
    // 0. On-hold tasks go to the MOST BOTTOM per user requirement
    const holdA = isTaskOnHold(a) ? 1 : 0;
    const holdB = isTaskOnHold(b) ? 1 : 0;
    if (holdA !== holdB) return holdA - holdB;

    // 1. ALWAYS prioritize urgent tasks first in the Available Tasks column
    const urgentA = isTaskUrgent(a) ? 1 : 0;
    const urgentB = isTaskUrgent(b) ? 1 : 0;
    if (urgentA !== urgentB) return urgentB - urgentA;

    // 2. High priority next
    const highA = isTaskHigh(a) ? 1 : 0;
    const highB = isTaskHigh(b) ? 1 : 0;
    if (highA !== highB) return highB - highA;

    // 3. In progress (if any)
    const inProgA = isTaskInProgress(a) ? 1 : 0;
    const inProgB = isTaskInProgress(b) ? 1 : 0;
    if (inProgA !== inProgB) return inProgB - inProgA;

    // 4. Newer tasks first
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });
};

const sortColumnTasks = (items: TaskMapItem[], userName?: string) => {
  return [...items].sort((a, b) => {
    // 0. Active synthetic assumption block strictly on top
    const isAssumpA = a.isAssumptionBlock ? 1 : 0;
    const isAssumpB = b.isAssumptionBlock ? 1 : 0;
    if (isAssumpA !== isAssumpB) return isAssumpB - isAssumpA;

    // 1. Live actively working task (Time In, no Time Out) strictly on top
    const isLiveA = isTaskLiveWorking(a, userName) ? 1 : 0;
    const isLiveB = isTaskLiveWorking(b, userName) ? 1 : 0;
    if (isLiveA !== isLiveB) return isLiveB - isLiveA;

    // 2. Active in-progress task next
    const inProgA = isTaskActiveInProgress(a, userName) ? 1 : 0;
    const inProgB = isTaskActiveInProgress(b, userName) ? 1 : 0;
    if (inProgA !== inProgB) return inProgB - inProgA;

    // 3. Most recently updated progress (e.g. latest sheet input)
    const progTimeA = a.progress?.updatedAt ? new Date(a.progress.updatedAt).getTime() : 0;
    const progTimeB = b.progress?.updatedAt ? new Date(b.progress.updatedAt).getTime() : 0;
    if (progTimeA !== progTimeB) return progTimeB - progTimeA;

    // 4. Urgent
    const urgentA = isTaskUrgent(a) ? 1 : 0;
    const urgentB = isTaskUrgent(b) ? 1 : 0;
    if (urgentA !== urgentB) return urgentB - urgentA;

    // 5. High priority
    const highA = isTaskHigh(a) ? 1 : 0;
    const highB = isTaskHigh(b) ? 1 : 0;
    if (highA !== highB) return highB - highA;

    // 6. Newer tasks
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });
};

// ---------------------------------------------------------------------------
// Draggable Card Wrapper (Matches KanbanBoard animations & ghosting)
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
      className={`touch-none transition-all duration-200 ease-out ${
        isDragging
          ? 'opacity-25 scale-[0.98] border border-dashed border-zinc-700 rounded-xl bg-zinc-900/40 pointer-events-none'
          : disabled
          ? 'cursor-default'
          : 'cursor-grab active:cursor-grabbing hover:scale-[1.01]'
      }`}
    >
      {children}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Droppable Column Wrapper (Matches KanbanBoard drop zone highlighting)
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
      className={`${className || ''} transition-all duration-200 ${
        isOver ? 'ring-2 ring-blue-500/70 bg-blue-950/25 shadow-xl shadow-blue-950/40 scale-[1.005]' : ''
      }`}
    >
      {children}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Card Cut-Out Snapping Placeholder
// Appears in target column when dragging a task across/different columns
// ---------------------------------------------------------------------------
const CardCutoutPlaceholder: React.FC<{
  task: TaskMapItem;
  targetName: string;
  isUnassign?: boolean;
}> = ({ task, targetName, isUnassign }) => {
  return (
    <div className="p-3 bg-blue-500/10 border-2 border-dashed border-blue-400/90 rounded-xl min-h-[112px] flex items-stretch gap-3 transition-all duration-150 ring-2 ring-blue-500/25 shadow-xl shadow-blue-950/50 animate-pulse my-1 pointer-events-none select-none">
      {/* Left: Ghost task info */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-400 truncate max-w-[200px] mb-1">
            <Sparkles className="size-3 text-blue-400 shrink-0" />
            <span className="truncate">{task.list?.name || 'General'}</span>
          </div>
          <h4 className="text-[13px] font-bold text-white/95 line-clamp-2 leading-snug my-0.5 h-[36px]">
            {task.title}
          </h4>
        </div>
        <div className="flex items-center gap-1.5 pt-1 text-[11px] font-bold text-blue-300">
          <CornerDownRight className="size-3.5 text-blue-400 shrink-0" />
          <span>Snap here → {targetName}</span>
        </div>
      </div>

      {/* Right: Snap Target Stencil */}
      <div className="w-[110px] shrink-0 border-l border-blue-500/30 pl-2.5 flex flex-col justify-between py-0.5">
        <div className="text-[10px] text-blue-400/80 font-mono text-right font-medium">
          SNAPPING
        </div>
        <div className="w-full py-1.5 px-2 rounded-lg bg-blue-500/25 border border-blue-400/50 text-center text-[10px] font-bold text-blue-200 uppercase tracking-wider shadow-xs">
          {isUnassign ? 'Return to Pool' : 'Assign to Queue'}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Column Priority Filter Helpers & Dropdown
// ---------------------------------------------------------------------------
const matchesPriorityFilter = (task: TaskMapItem, filter: string) => {
  if (!filter || filter === 'ALL') return true;
  const p = (task.priority || '').toUpperCase();
  if (filter === 'URGENT') {
    return isTaskUrgent(task);
  }
  if (filter === 'HIGH') {
    return isTaskHigh(task);
  }
  if (filter === 'NORMAL') {
    return p === 'NORMAL' || p === 'MEDIUM';
  }
  if (filter === 'LOW') {
    return p === 'LOW';
  }
  return true;
};

const matchesSearchFilter = (task: TaskMapItem, query?: string) => {
  if (!query || !query.trim()) return true;
  const q = query.trim().toLowerCase();
  const title = (task.title || '').toLowerCase();
  const clientName = (task.list?.name || '').toLowerCase();
  const folderName = (task.list?.folder?.name || '').toLowerCase();
  const desc = (task.description || '').toLowerCase();
  const statuses = (task.taskMap?.statuses || []).map((s: string) => (s || '').toLowerCase());
  return (
    title.includes(q) ||
    clientName.includes(q) ||
    folderName.includes(q) ||
    desc.includes(q) ||
    statuses.some((s: string) => s.includes(q))
  );
};

const getColumnPriorityCounts = (items: TaskMapItem[]) => {
  const counts = { ALL: items.length, URGENT: 0, HIGH: 0, NORMAL: 0, LOW: 0 };
  for (const t of items) {
    const p = (t.priority || '').toUpperCase();
    if (isTaskUrgent(t)) counts.URGENT++;
    else if (isTaskHigh(t)) counts.HIGH++;
    else if (p === 'NORMAL' || p === 'MEDIUM') counts.NORMAL++;
    else if (p === 'LOW') counts.LOW++;
  }
  return counts;
};

const ColumnPriorityDropdown: React.FC<{
  columnId: string;
  tasks: TaskMapItem[];
  activeFilter: string;
  onSelectFilter: (columnId: string, filter: string) => void;
}> = ({ columnId, tasks, activeFilter, onSelectFilter }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const counts = getColumnPriorityCounts(tasks);
  const currentKey = activeFilter || 'ALL';

  const calcPos = (rect: DOMRect) => {
    const width = 160;
    const height = 220;
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 10) {
      top = Math.max(10, rect.top - height - 4);
    }
    // Open to the right away from the sidebar!
    let left = rect.left;
    if (left + width > window.innerWidth - 10) {
      left = Math.max(10, window.innerWidth - width - 10);
    }
    return { top, left };
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) {
      setIsOpen(false);
      setCoords(null);
      return;
    }
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const pos = calcPos(rect);
    setCoords(pos);
    setIsOpen(true);
  };

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setCoords(null);
      }
    };
    const handleScrollOrResize = (e?: Event) => {
      // Don't close if the scroll happened inside the portal dropdown itself
      if (e && dropdownRef.current && dropdownRef.current.contains(e.target as Node)) return;
      setIsOpen(false);
      setCoords(null);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  const getDisplayDetails = () => {
    switch (currentKey) {
      case 'URGENT':
        return {
          label: 'Urgent',
          flagClass: 'text-red-400',
          btnClass: 'bg-red-950/70 hover:bg-red-950 text-red-200 border-red-700/80',
          badgeClass: 'bg-black/40 text-red-300',
          count: counts.URGENT,
        };
      case 'HIGH':
        return {
          label: 'High',
          flagClass: 'text-amber-400',
          btnClass: 'bg-amber-950/70 hover:bg-amber-950 text-amber-200 border-amber-700/80',
          badgeClass: 'bg-black/40 text-amber-300',
          count: counts.HIGH,
        };
      case 'NORMAL':
        return {
          label: 'Normal',
          flagClass: 'text-blue-400',
          btnClass: 'bg-blue-950/70 hover:bg-blue-950 text-blue-200 border-blue-700/80',
          badgeClass: 'bg-black/40 text-blue-300',
          count: counts.NORMAL,
        };
      case 'LOW':
        return {
          label: 'Low',
          flagClass: 'text-zinc-400',
          btnClass: 'bg-zinc-800 hover:bg-zinc-750 text-zinc-200 border-zinc-700',
          badgeClass: 'bg-black/40 text-zinc-300',
          count: counts.LOW,
        };
      default:
        return {
          label: '',
          flagClass: 'text-zinc-400',
          btnClass: 'bg-card hover:bg-zinc-800/60 text-zinc-300 border-zinc-800 hover:border-zinc-700',
          badgeClass: 'bg-zinc-800/80 text-zinc-400 border border-zinc-700/60',
          count: counts.ALL,
        };
    }
  };

  const details = getDisplayDetails();

  return (
    <div
      className="relative inline-block text-left shrink-0"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer shadow-xs select-none ${details.btnClass}`}
        title={details.label ? `Filtered by ${details.label}` : "Filter by priority"}
      >
        <Flag className={`size-3 shrink-0 ${details.flagClass}`} />
        {details.label && <span className="font-semibold">{details.label}</span>}
      </button>

      {isOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              zIndex: 999999,
            }}
            className="w-40 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5 text-zinc-200 animate-in fade-in zoom-in-95 duration-100"
          >
            {/* All */}
            <button
              type="button"
              onClick={() => {
                onSelectFilter(columnId, 'ALL');
                setIsOpen(false);
                setCoords(null);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                currentKey === 'ALL'
                  ? 'bg-zinc-800 text-zinc-100 font-semibold'
                  : 'text-zinc-300 hover:bg-zinc-800/60'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="size-3 text-zinc-500 shrink-0" />
                <span className="truncate">All</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800/80 text-zinc-400">
                  {counts.ALL}
                </span>
                {currentKey === 'ALL' && <Check className="size-3.5 text-blue-400" />}
              </div>
            </button>

            {/* Urgent */}
            <button
              type="button"
              onClick={() => {
                const next = currentKey === 'URGENT' ? 'ALL' : 'URGENT';
                onSelectFilter(columnId, next);
                setIsOpen(false);
                setCoords(null);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                currentKey === 'URGENT'
                  ? 'bg-red-950/60 text-red-200 border border-red-700/60 font-semibold'
                  : 'text-zinc-300 hover:bg-zinc-800/60'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="size-3 text-red-400 shrink-0" />
                <span className="truncate">Urgent</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                    currentKey === 'URGENT'
                      ? 'bg-red-900/50 text-red-300'
                      : 'bg-zinc-800/80 text-zinc-400'
                  }`}
                >
                  {counts.URGENT}
                </span>
                {currentKey === 'URGENT' && <Check className="size-3.5 text-red-400" />}
              </div>
            </button>

            {/* High */}
            <button
              type="button"
              onClick={() => {
                const next = currentKey === 'HIGH' ? 'ALL' : 'HIGH';
                onSelectFilter(columnId, next);
                setIsOpen(false);
                setCoords(null);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                currentKey === 'HIGH'
                  ? 'bg-amber-950/60 text-amber-200 border border-amber-700/60 font-semibold'
                  : 'text-zinc-300 hover:bg-zinc-800/60'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="size-3 text-amber-400 shrink-0" />
                <span className="truncate">High</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                    currentKey === 'HIGH'
                      ? 'bg-amber-900/50 text-amber-300'
                      : 'bg-zinc-800/80 text-zinc-400'
                  }`}
                >
                  {counts.HIGH}
                </span>
                {currentKey === 'HIGH' && <Check className="size-3.5 text-amber-400" />}
              </div>
            </button>

            {/* Normal */}
            <button
              type="button"
              onClick={() => {
                const next = currentKey === 'NORMAL' ? 'ALL' : 'NORMAL';
                onSelectFilter(columnId, next);
                setIsOpen(false);
                setCoords(null);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                currentKey === 'NORMAL'
                  ? 'bg-blue-950/60 text-blue-200 border border-blue-700/60 font-semibold'
                  : 'text-zinc-300 hover:bg-zinc-800/60'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="size-3 text-blue-400 shrink-0" />
                <span className="truncate">Normal</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                    currentKey === 'NORMAL'
                      ? 'bg-blue-900/50 text-blue-300'
                      : 'bg-zinc-800/80 text-zinc-400'
                  }`}
                >
                  {counts.NORMAL}
                </span>
                {currentKey === 'NORMAL' && <Check className="size-3.5 text-blue-400" />}
              </div>
            </button>

            {/* Low */}
            <button
              type="button"
              onClick={() => {
                const next = currentKey === 'LOW' ? 'ALL' : 'LOW';
                onSelectFilter(columnId, next);
                setIsOpen(false);
                setCoords(null);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                currentKey === 'LOW'
                  ? 'bg-zinc-800 text-zinc-200 border border-zinc-700 font-semibold'
                  : 'text-zinc-300 hover:bg-zinc-800/60'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Flag className="size-3 text-zinc-400 shrink-0" />
                <span className="truncate">Low</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                    currentKey === 'LOW'
                      ? 'bg-zinc-700 text-zinc-300'
                      : 'bg-zinc-800/80 text-zinc-400'
                  }`}
                >
                  {counts.LOW}
                </span>
                {currentKey === 'LOW' && <Check className="size-3.5 text-zinc-400" />}
              </div>
            </button>
          </div>,
          document.body
        )}
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
  showAdminTasks,
  onToggleAdminTasks,
  selectedCustomMAs = [],
  clients = [],
  onTaskUpdate,
  isHistory = false,
  search = '',
}) => {
  const currentUser = useAppStore((s) => s.currentUser);
  const workspaceUsers = useAppStore((s) => s.workspaceUsers) || [];
  const workspaceTeams = useAppStore((s) => s.workspaceTeams) || [];
  const upworkClients = useAppStore((s) => s.upworkClients);
  const maActiveSessions = useAppStore((s) => s.maActiveSessions);
  const isPmUser = isProjectManagerOrAdmin(currentUser);

  const boardScrollRef = useRef<HTMLDivElement>(null);

  const [activeDragTask, setActiveDragTask] = useState<TaskMapItem | null>(null);
  const [activeOverId, setActiveOverId] = useState<string | null>(null);
  const [localShowAdmin, setLocalShowAdmin] = useState(false);
  const [selectedClients, setSelectedClients] = useState<string[] | 'ALL'>('ALL');
  const [columnPriorityFilters, setColumnPriorityFilters] = useState<Record<string, string>>({});
  const [columnSubStatusFilters, setColumnSubStatusFilters] = useState<Record<string, string>>({});
  const [columnClientFilters, setColumnClientFilters] = useState<Record<string, string[] | 'ALL'>>({});
  const [columnShowAdmin, setColumnShowAdmin] = useState<Record<string, boolean>>({});
  const [columnSearches, setColumnSearches] = useState<Record<string, string>>({});
  const [columnSearchOpen, setColumnSearchOpen] = useState<Record<string, boolean>>({});
  const [pinnedColumns, setPinnedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem('nexus_taskmap_pinned_columns');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem('nexus_taskmap_collapsed_columns');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [actionError, setActionError] = useState<ActionErrorInfo | null>(null);

  // Live ticking clock to update in-progress elapsed minutes and hours
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  const togglePinColumn = (columnId: string) => {
    setPinnedColumns((prev) => {
      const next = { ...prev, [columnId]: !prev[columnId] };
      try {
        localStorage.setItem('nexus_taskmap_pinned_columns', JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save pinned columns', e);
      }
      return next;
    });
  };

  const toggleCollapseColumn = (columnId: string) => {
    setCollapsedColumns((prev) => {
      const next = { ...prev, [columnId]: !prev[columnId] };
      try {
        localStorage.setItem('nexus_taskmap_collapsed_columns', JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save collapsed columns', e);
      }
      return next;
    });
  };

  const handleResetColumn = async (colUserId: string, userName?: string) => {
    // 1. Find all tasks in this column that are not active live working
    const colTasks = tasks.filter((t) => t.assignee?.id === colUserId || (t.assignees || []).some((u) => u.id === colUserId));
    const tasksToReset = colTasks.filter((t) => {
      const s = (t.status || '').toUpperCase();
      if (s === 'CLOSED' || s === 'DONE') return false;
      return !isTaskLiveWorking(t, userName);
    });

    if (tasksToReset.length === 0) {
      toast.info(`No pending tasks to reset in ${userName || 'this'}'s column`);
      return;
    }

    // 2. Optimistically unassign and move to available pool
    for (const t of tasksToReset) {
      t.assignee = null;
      t.assigneeId = null;
      t.assignees = [];
      t.status = 'Pending';
      if (t.taskMap) {
        t.taskMap.statuses = ['Available Task'];
      }
    }

    toast.success(`Reset ${userName || 'column'}: ${tasksToReset.length} pending task(s) returned to Available tasks`);

    // 3. Persist to backend
    try {
      await taskMapApi.resetColumnTasks(colUserId, 'BOARD');
      onDataRefresh();
    } catch (err: any) {
      console.error('Failed to reset column on server:', err);
      toast.error('Failed to reset column tasks on server');
    }
  };

  const toggleColumnSearch = (columnId: string) => {
    setColumnSearchOpen((prev) => {
      const nextOpen = !prev[columnId];
      if (!nextOpen) {
        setColumnSearches((s) => {
          if (!s[columnId]) return s;
          const copy = { ...s };
          delete copy[columnId];
          return copy;
        });
      }
      return { ...prev, [columnId]: nextOpen };
    });
  };

  const handleColumnSearchChange = (columnId: string, query: string) => {
    setColumnSearches((prev) => ({
      ...prev,
      [columnId]: query,
    }));
  };

  const handleSelectPriorityFilter = (columnId: string, filter: string) => {
    setColumnPriorityFilters((prev) => ({
      ...prev,
      [columnId]: filter,
    }));
  };

  const handleSelectSubStatusFilter = (columnId: string, filter: string) => {
    setColumnSubStatusFilters((prev) => ({
      ...prev,
      [columnId]: filter,
    }));
  };

  const effectiveShowAdmin = showAdminTasks !== undefined ? showAdminTasks : localShowAdmin;

  // Helper to check if a task is under Admin folder
  const isTaskUnderAdmin = (task: TaskMapItem) => {
    if (task.isAdminTask) return true;
    const folderName = (task.list?.folder?.name || '').toLowerCase().trim();
    const listName = (task.list?.name || '').toLowerCase().trim();
    const ADMIN_LIST_NAMES = new Set([
      'admin | jenesia red',
      'harmony',
      'jenesia red',
      'jenesia red | personal',
      'snaply',
      'vip scale',
      'xfnite',
    ]);
    return folderName === 'admin' || folderName.includes('admin') || listName === 'admin' || ADMIN_LIST_NAMES.has(listName);
  };

  // Filter tasks by Admin and Client visibility (default: both checked) and include Pending, Revision, Waiting, and On-hold statuses
  const displayPool = React.useMemo(() => {
    return availablePool.filter((t) => {
      // Exclude if claimed by an active team member on this board
      const hasActiveWorker = Boolean(
        t.progress?.maName &&
        (shiftUsers.some((u) => doesProgressMatchUser(t.progress?.maName, u.name)) ||
         (allUsers && allUsers.some((u) => doesProgressMatchUser(t.progress?.maName, u.name))))
      );
      if (hasActiveWorker) return false;

      const s = (t.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      const mapStatuses = (t.taskMap?.statuses || []).map((x: string) =>
        x.trim().toUpperCase().replace(/[\s_-]+/g, '')
      );
      const isExcluded =
        s === 'DAILY' ||
        s.includes('DAILY') ||
        s === 'WEEKLY' ||
        s.includes('WEEKLY') ||
        s === 'MONTHLY' ||
        s.includes('MONTHLY') ||
        s === 'RECURRING' ||
        s.includes('RECURRING') ||
        !!(t as any)?.recurringConfig ||
        mapStatuses.some((st: string) =>
          ['DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING'].includes(st) ||
          st.includes('DAILY') ||
          st.includes('WEEKLY') ||
          st.includes('MONTHLY') ||
          st.includes('RECURRING')
        );
      if (isExcluded) return false;
      const isPending = s === 'PENDING' || mapStatuses.includes('PENDING');
      const isRevision = s === 'REVISION' || mapStatuses.includes('REVISION');
      const isWaiting = s === 'WAITING' || s.includes('WAITING') || mapStatuses.some((st: string) => st.includes('WAITING'));
      const isOnHold = s === 'ONHOLD' || s.includes('HOLD') || mapStatuses.some((st: string) => st.includes('HOLD'));
      if (!isPending && !isRevision && !isWaiting && !isOnHold) return false;

      // Admin task check
      const isAdmin = isTaskUnderAdmin(t);
      if (isAdmin) {
        return effectiveShowAdmin;
      }

      // Non-admin client task check
      if (selectedClients === 'ALL') return true;
      const clientId = t.list?.id || (t.list?.name ? `name-${t.list.name}` : 'general');
      const clientName = t.list?.name || 'General';
      return selectedClients.includes(clientId) || selectedClients.includes(clientName);
    });
  }, [availablePool, effectiveShowAdmin, selectedClients]);

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

  // Helper to check if a task has an excluded status for user shift columns:
  // User columns must not show daily, monthly, weekly, or recurring tasks UNLESS an MA is actively working on it or has logged progress!
  const isExcludedForUser = (task: TaskMapItem) => {
    // CRITICAL: If an assistant has logged progress or is actively working on this task,
    // NEVER exclude it! The worker must always see the task in their column regardless of its Weekly/Daily/Recurring status or assignee.
    if (task.progress?.timeIn || task.progress?.maName) {
      return false;
    }

    const s = (task.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
    const mapStatuses = (task.taskMap?.statuses || []).map((x: string) =>
      (x || '').trim().toUpperCase().replace(/[\s_-]+/g, '')
    );

    const isExcludedStatus = (str: string) => {
      return (
        str === 'DAILY' ||
        str.includes('DAILY') ||
        str === 'WEEKLY' ||
        str.includes('WEEKLY') ||
        str === 'MONTHLY' ||
        str.includes('MONTHLY') ||
        str === 'RECURRING' ||
        str.includes('RECURRING')
      );
    };

    return (
      isExcludedStatus(s) ||
      !!(task as any)?.recurringConfig ||
      mapStatuses.some((st: string) => isExcludedStatus(st))
    );
  };

  const userColumnsMap: Record<string, { user: any; tasks: TaskMapItem[] }> = {};

  const isSystemAccount = (u: any) => {
    const email = (u?.email || '').toLowerCase();
    const name = (u?.name || '').toLowerCase();
    return (
      email.endsWith('@system.local') ||
      name === 'clickup' ||
      name === 'vip scale' ||
      name === 'vipscale'
    );
  };

  const isAllShifts =
    !currentShift ||
    currentShift === 'ALL' ||
    currentShift
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .includes('ALL');

  // When viewing All shifts, ensure all active team members from allUsers have their own block/column!
  const baseUsers =
    isAllShifts && allUsers && allUsers.length > 0 ? allUsers : shiftUsers;

  baseUsers.forEach((u) => {
    if (!u || !u.id || isSystemAccount(u)) return;
    userColumnsMap[u.id] = {
      user: getUserProfile(u.id, u),
      tasks: [],
    };
  });

  // Ensure all users with tasks or defined in USER_ROLE_DEFINITIONS present in allUsers are also included when in ALL view
  if (isAllShifts && allUsers) {
    allUsers.forEach((u) => {
      if (!u || !u.id || isSystemAccount(u)) return;
      if (!userColumnsMap[u.id]) {
        userColumnsMap[u.id] = {
          user: getUserProfile(u.id, u),
          tasks: [],
        };
      }
    });
  }

  // Ensure any user who has active/logged worker progress on a task gets a column in userColumnsMap
  tasks.forEach((t) => {
    if (t.progress?.maName && allUsers) {
      const alreadyHasCol = Object.values(userColumnsMap).some((col) =>
        doesProgressMatchUser(t.progress?.maName, col.user.name)
      );
      if (!alreadyHasCol) {
        const matchingUser = allUsers.find(
          (u) => !isSystemAccount(u) && doesProgressMatchUser(t.progress?.maName, u.name)
        );
        if (matchingUser && !userColumnsMap[matchingUser.id]) {
          userColumnsMap[matchingUser.id] = {
            user: getUserProfile(matchingUser.id, matchingUser),
            tasks: [],
          };
        }
      }
    }
  });

  // Also ensure any user who has an active sheet session gets a column in userColumnsMap
  Object.values(maActiveSessions || {}).forEach((sess: any) => {
    if (sess?.maName && sess?.active && allUsers) {
      const alreadyHasCol = Object.values(userColumnsMap).some((col) =>
        doesProgressMatchUser(sess.maName, col.user.name)
      );
      if (!alreadyHasCol) {
        const matchingUser = allUsers.find(
          (u) => !isSystemAccount(u) && doesProgressMatchUser(sess.maName, u.name)
        );
        if (matchingUser && !userColumnsMap[matchingUser.id]) {
          userColumnsMap[matchingUser.id] = {
            user: getUserProfile(matchingUser.id, matchingUser),
            tasks: [],
          };
        }
      }
    }
  });

  const cleanSearch = (search || '').trim().toLowerCase();
  const isUserSearchMatch = (u: any) => {
    if (!cleanSearch || !u) return false;
    const name = (u.name || '').trim().toLowerCase();
    const email = (u.email || '').trim().toLowerCase();
    return name.includes(cleanSearch) || email.includes(cleanSearch);
  };

  // If search matches a user in allUsers, ensure they are present in userColumnsMap so their column appears
  if (cleanSearch && allUsers && allUsers.length > 0) {
    allUsers.forEach((u) => {
      if (!u || !u.id || isSystemAccount(u)) return;
      if (isUserSearchMatch(u) && !userColumnsMap[u.id]) {
        userColumnsMap[u.id] = {
          user: getUserProfile(u.id, u),
          tasks: [],
        };
      }
    });
  }

  // Tasks in availablePool that have active progress or are assigned to an active column must NOT be trapped in poolIds!
  const poolIds = new Set(
    availablePool
      .filter((p) => {
        const hasWorkerProgress = Boolean(
          p.progress?.maName &&
          Object.values(userColumnsMap).some((col) => doesProgressMatchUser(p.progress?.maName, col.user.name))
        );
        const hasColumnAssignee = Boolean(p.assigneeId && userColumnsMap[p.assigneeId]);
        return !hasWorkerProgress && !hasColumnAssignee;
      })
      .map((p) => p.id)
  );

  // Fallback ONLY if userColumnsMap has not been populated
  if (Object.keys(userColumnsMap).length === 0) {
    tasks.forEach((task) => {
      if (!effectiveShowAdmin && isTaskUnderAdmin(task)) return;
      if (poolIds.has(task.id) || isClosedTask(task) || isExcludedForUser(task)) return;
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

  // 2. Add non-closed, non-excluded tasks strictly to the users on this shift
  // Hide all admin tasks by default when effectiveShowAdmin is false
  tasks.forEach((task) => {
    if (!effectiveShowAdmin && isTaskUnderAdmin(task)) return;
    if (poolIds.has(task.id)) return;
    const hasProgress = Boolean(task.progress?.timeIn || task.progress?.maName);
    if (!hasProgress && (isClosedTask(task) || isExcludedForUser(task))) return;

    const u = task.assignee || (task.assignees && task.assignees[0]);
    const userId = u?.id;
    if (userId && userId !== 'unassigned') {
      if (!userColumnsMap[userId]) {
        userColumnsMap[userId] = {
          user: getUserProfile(userId, u),
          tasks: [],
        };
      }
      if (!userColumnsMap[userId].tasks.some((t) => t.id === task.id)) {
        userColumnsMap[userId].tasks.push(task);
      }
    }

    // Also: if an MA logged progress on this task (e.g. Rowel worked on Aneeka's task, or Aaron on VIP Scale task),
    // add it to that worker's column so they see their active task!
    if (task.progress?.maName) {
      const workerCol = Object.entries(userColumnsMap).find(
        ([colUserId, col]) => doesProgressMatchUser(task.progress?.maName, col.user.name)
      );
      if (workerCol && !workerCol[1].tasks.some((t) => t.id === task.id)) {
        workerCol[1].tasks.push(task);
      }
    }
  });

  // Also check tasks in availablePool that have worker progress or column assignee:
  availablePool.forEach((task) => {
    if (!effectiveShowAdmin && isTaskUnderAdmin(task)) return;
    const hasProgress = Boolean(task.progress?.timeIn || task.progress?.maName);
    if (!hasProgress && (isClosedTask(task) || isExcludedForUser(task))) return;
    if (task.progress?.maName) {
      const workerCol = Object.entries(userColumnsMap).find(
        ([colUserId, col]) => doesProgressMatchUser(task.progress?.maName, col.user.name)
      );
      if (workerCol && !workerCol[1].tasks.some((t) => t.id === task.id)) {
        workerCol[1].tasks.push(task);
      }
    } else if (task.assigneeId && userColumnsMap[task.assigneeId]) {
      if (!userColumnsMap[task.assigneeId].tasks.some((t) => t.id === task.id)) {
        userColumnsMap[task.assigneeId].tasks.push(task);
      }
    }
  });

  // 2.5 Ensure user columns reflect their latest MA schedule sheet input
  // (only if they have an active sheet session not already attached to a card)
  Object.entries(userColumnsMap).forEach(([userId, col]) => {
    const activeSessionEntry = Object.entries(maActiveSessions || {}).find(
      ([key, session]) =>
        doesProgressMatchUser(key, col.user.name) ||
        doesProgressMatchUser((session as any)?.maName, col.user.name)
    );
    const activeSession = activeSessionEntry ? (activeSessionEntry[1] as any) : null;
    const isSessionActive = Boolean(
      activeSession &&
      (activeSession.active ?? (!activeSession.timeOut && activeSession.timeIn)) &&
      !activeSession.timeOut
    );

    // Check if user already has an assigned task card actively matching this session (by taskId or active progress)
    const hasActiveAssignedTask = col.tasks.some((t) => {
      if (activeSession?.taskId && t.id === activeSession.taskId) return true;
      const isMyProg = doesProgressMatchUser(t.progress?.maName, col.user.name);
      if (!isMyProg || !t.progress?.timeIn || t.progress?.timeOut || t.progress?.isMissingTime) return false;
      // Stale sessions (>14h or past date) can never act as active assigned task
      if (isStaleLiveSession(t.progress.timeIn, t.progress.date, currentTime)) return false;
      // If the active session has a sheetRow, only match if this task actually has the same sheetRow!
      if (activeSession?.rowNumber && t.progress?.sheetRow) {
        return Number(t.progress.sheetRow) === Number(activeSession.rowNumber);
      }
      return true;
    });

    // ONLY insert an assumption block if the user has an active session from their sheet that is not attached to an existing task card!
    // Never insert a fake card if activeSession is null or inactive/timed out!
    if (isSessionActive && !hasActiveAssignedTask) {
      const rawClient = activeSession?.client;
      const effectiveClient = rawClient && rawClient.toLowerCase() !== 'general' ? rawClient : 'No client inputted';
      const rawTask = activeSession?.taskName;
      const effectiveTask = rawTask && rawTask.toLowerCase() !== 'general task' ? rawTask : 'No task inputted';

      const generalBlock = createEmptyUserBlock({
        userId,
        userName: col.user.name,
        client: effectiveClient,
        taskTitle: effectiveTask,
        day: activeSession?.date || format(currentTime, 'yyyy-MM-dd'),
        timeIn: activeSession?.timeIn || null,
        timeOut: activeSession?.timeOut || null,
        status: activeSession?.status || (activeSession?.timeOut ? 'Done' : 'In progress'),
        isUpwork: Boolean(activeSession?.isUpwork),
        rowNumber: activeSession?.rowNumber,
      });

      col.tasks.unshift(generalBlock);
    }
  });

  // 2.7 Sanitize worker column progress:
  // - Deduplicate same sheetRow: only the task with the newest updatedAt keeps the sheetRow progress.
  // - Close stale unclosed sessions: if the worker has a completed row with a later time / higher sheetRow,
  //   any older row with missing timeOut is superseded and cannot be live working.
  Object.values(userColumnsMap).forEach((col) => {
    const workerName = col.user?.name;
    if (!workerName) return;

    // Map of sheetRow -> latest task id and latest timestamp
    const rowLatestMap = new Map<number, { taskId: string; updatedAt: number }>();
    col.tasks.forEach((t) => {
      if (t.progress?.sheetRow && doesProgressMatchUser(t.progress?.maName, workerName)) {
        const row = Number(t.progress.sheetRow);
        const time = t.progress.updatedAt ? new Date(t.progress.updatedAt).getTime() : 0;
        const cur = rowLatestMap.get(row);
        if (!cur || time > cur.updatedAt) {
          rowLatestMap.set(row, { taskId: t.id, updatedAt: time });
        }
      }
    });

    // Strip duplicate/stale progress from tasks that lost the sheetRow
    col.tasks = col.tasks.map((t) => {
      if (t.progress?.sheetRow && doesProgressMatchUser(t.progress?.maName, workerName)) {
        const row = Number(t.progress.sheetRow);
        const winner = rowLatestMap.get(row);
        if (winner && winner.taskId !== t.id) {
          // Stale row progress from prior binding, strip it
          return { ...t, progress: null };
        }
      }
      return t;
    });

    // Check if worker has completed their latest shift row
    let maxCompletedRow = -1;
    col.tasks.forEach((t) => {
      if (t.progress?.sheetRow && t.progress?.timeOut && doesProgressMatchUser(t.progress?.maName, workerName)) {
        const row = Number(t.progress.sheetRow);
        if (row > maxCompletedRow) maxCompletedRow = row;
      }
    });

    // Find active session for this worker if any
    const activeSessionEntry = Object.entries(maActiveSessions || {}).find(
      ([key, session]) =>
        doesProgressMatchUser(key, workerName) ||
        doesProgressMatchUser((session as any)?.maName, workerName)
    );
    const activeSession = activeSessionEntry ? (activeSessionEntry[1] as any) : null;

    const effectiveMaxRow = Math.max(
      maxCompletedRow,
      activeSession?.rowNumber ? Number(activeSession.rowNumber) : -1
    );

    // If an older row was left unclosed (e.g. row < effectiveMaxRow has timeIn without timeOut, or stale),
    // mark its effective progress as closed or stale so it never acts as a live working session
    if (effectiveMaxRow > 0) {
      col.tasks = col.tasks.map((t) => {
        if (
          t.progress?.sheetRow &&
          Number(t.progress.sheetRow) < effectiveMaxRow &&
          t.progress.timeIn &&
          !t.progress.timeOut &&
          doesProgressMatchUser(t.progress.maName, workerName)
        ) {
          return {
            ...t,
            progress: {
              ...t.progress,
              timeOut: '11:59 PM', // Superseded unclosed session
            },
          };
        }
        return t;
      });
    }
  });

  // 3. Sort columns:
  // Prioritize the current viewing user first (showing on the right side of Available tasks),
  // then all remaining users sorted alphabetically next (A-Z)
  const curUserId = currentUser?.id;
  const curUserName = (currentUser?.name || '').trim().toLowerCase();

  const isCurrentViewer = (u: any) => {
    if (!u) return false;
    if (curUserId && u.id === curUserId) return true;
    if (curUserName && (u.name || '').trim().toLowerCase() === curUserName) return true;
    return false;
  };

  const sortedUserColumns = Object.entries(userColumnsMap)
    .filter(([id, col]) => {
      // If user search matches, always keep this MA visible!
      if (cleanSearch && isUserSearchMatch(col.user)) {
        return true;
      }
      // If Custom shift is selected and specific MAs are chosen, filter by them
      const activeShifts = (currentShift || '').toUpperCase().split(',').map((s) => s.trim());
      if (activeShifts.includes('CUSTOM') && selectedCustomMAs.length > 0) {
        return selectedCustomMAs.includes(id);
      }
      return true;
    })
    .sort(([idA, colA], [idB, colB]) => {
      const matchA = isUserSearchMatch(colA.user);
      const matchB = isUserSearchMatch(colB.user);

      // 1. Search-matching MA columns move to the most left side
      if (matchA && !matchB) return -1;
      if (!matchA && matchB) return 1;

      if (matchA && matchB) {
        const nameA = (colA.user?.name || '').trim().toLowerCase();
        const nameB = (colB.user?.name || '').trim().toLowerCase();
        const exactA = nameA === cleanSearch;
        const exactB = nameB === cleanSearch;
        if (exactA && !exactB) return -1;
        if (!exactA && exactB) return 1;

        const startA = nameA.startsWith(cleanSearch);
        const startB = nameB.startsWith(cleanSearch);
        if (startA && !startB) return -1;
        if (!startA && startB) return 1;

        const isPinnedA = !!pinnedColumns[idA];
        const isPinnedB = !!pinnedColumns[idB];
        if (isPinnedA && !isPinnedB) return -1;
        if (!isPinnedA && isPinnedB) return 1;

        return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
      }

      // 2. Pinned columns come next
      const isPinnedA = !!pinnedColumns[idA];
      const isPinnedB = !!pinnedColumns[idB];

      if (isPinnedA && !isPinnedB) return -1;
      if (!isPinnedA && isPinnedB) return 1;

      // 3. Current viewer column next
      const isCurA = isCurrentViewer(colA.user);
      const isCurB = isCurrentViewer(colB.user);

      if (isCurA && !isCurB) return -1;
      if (!isCurA && isCurB) return 1;

      // 4. Alphabetical order (A-Z)
      return (colA.user.name || '').localeCompare(colB.user.name || '', undefined, { sensitivity: 'base' });
    });

  // When search changes and matches an MA, auto-scroll to the far left so the user immediately sees the column
  useEffect(() => {
    if (cleanSearch && boardScrollRef.current) {
      boardScrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    }
  }, [cleanSearch]);

  // DnD Handlers
  const handleDragStart = (event: DragStartEvent) => {
    if (isHistory) {
      toast.info('Historical Journal is read-only. Return to today to make changes.');
      return;
    }
    const task = event.active.data.current?.task as TaskMapItem;
    if (!task) return;

    const isFromAvailable = poolIds.has(task.id);
    if (isFromAvailable && !isPmUser) {
      toast.error('Only Project Managers and Admins can assign tasks from the Available column');
      return;
    }

    setActiveDragTask(task);
    setActiveOverId(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setActiveOverId(event.over ? String(event.over.id) : null);
  };

  const handleDragCancel = () => {
    setActiveDragTask(null);
    setActiveOverId(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragTask(null);
    setActiveOverId(null);

    if (!over) return;

    const taskId = active.id as string;
    const targetColumnId = over.id as string;
    const isFromAvailable = poolIds.has(taskId);

    if (isFromAvailable && !isPmUser) {
      toast.error('Only Project Managers and Admins can assign tasks from the Available column');
      return;
    }

    // Dropped on an In Progress slot: assign task to that user AND set status to In Progress
    if (targetColumnId.startsWith('in-progress-')) {
      const targetUserId = targetColumnId.replace('in-progress-', '');
      const targetUser = getUserProfile(targetUserId);

      try {
        await taskMapApi.assignTask(taskId, targetUserId);
        if (onTaskUpdate) {
          await onTaskUpdate(taskId, { status: 'In progress', assigneeId: targetUserId });
        } else {
          await tasksApi.updateTask(taskId, { status: 'In progress', assigneeId: targetUserId } as any).catch(console.error);
        }
        onStatusChange(taskId, ['In progress']);
        toast.success(`Task set In Progress for ${targetUser?.name || 'user'}`);
        onDataRefresh();
      } catch (err: any) {
        toast.error(err.message || 'Failed to set task In Progress');
      }
      return;
    }

    // Dropped on a user column: assign task to that user
    if (targetColumnId.startsWith('user-')) {
      const targetUserId = targetColumnId.replace('user-', '');
      const targetUser = getUserProfile(targetUserId);

      try {
        await taskMapApi.assignTask(taskId, targetUserId);
        toast.success(`Task assigned to ${targetUser?.name || 'user'}`);
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

  const handleSelectInProgressTask = async (taskId: string, targetUserId: string) => {
    const targetUser = getUserProfile(targetUserId);
    try {
      await taskMapApi.assignTask(taskId, targetUserId);
      if (onTaskUpdate) {
        await onTaskUpdate(taskId, { status: 'In progress', assigneeId: targetUserId });
      } else {
        await tasksApi.updateTask(taskId, { status: 'In progress', assigneeId: targetUserId } as any).catch(console.error);
      }
      onStatusChange(taskId, ['In progress']);
      toast.success(`Task set In Progress for ${targetUser?.name || 'user'}`);
      onDataRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to set task In Progress');
    }
  };

  // Unified Status Presets: pure workflow statuses for Task Map
  // Removed: 'Not started' (pending means not started) and 'In progress' (automated).
  // Stays at in-progress main status: Hand-over (transfers to Available tasks), Paused, Ask Client (transfers to CRM Map pool).
  // Changes main status: To Review -> In Review (Auditor Map), Waiting -> Waiting (CRM Map), On-hold -> On-hold (Available tasks bottom, excluded from count).
  const getUnifiedTaskMapOptions = (task: TaskMapItem, _user?: any): TaskMapOption[] => {
    const list: TaskMapOption[] = [
      { id: 'opt-status-avail', label: 'Available Task', color: '#1d4ed8', textColor: '#ffffff', order: 0 },
      { id: 'opt-status-handover', label: 'Hand-over', color: '#a855f7', textColor: '#f3e8ff', order: 1 },
      { id: 'opt-status-paused', label: 'Paused', color: '#eab308', textColor: '#fffbeb', order: 2 },
      { id: 'opt-status-askclient', label: 'Ask Client', color: '#06b6d4', textColor: '#ecfeff', order: 3 },
      { id: 'opt-status-toreview', label: 'To Review', color: '#2563eb', textColor: '#dbeafe', order: 4 },
      { id: 'opt-status-waiting', label: 'Waiting', color: '#ef4444', textColor: '#fef2f2', order: 5 },
      { id: 'opt-status-onhold', label: 'On-hold', color: '#8A8F98', textColor: '#ffffff', order: 6 },
    ];

    const EXCLUDED_FROM_TASK_MAP = new Set([
      'NOT STARTED',
      'NOTSTARTED',
      'IN PROGRESS',
      'INPROGRESS',
      'REVISION',
      'TO SEND',
      'TOSEND',
      'SENT',
      'FOLLOW UP',
      'FOLLOWUP',
      'DONE REVIEW',
      'DONEREVIEW',
      'DONE',
    ]);

    // Ensure any currently selected statuses on this task are also present so user can toggle them off,
    // but strictly exclude Revision, To send, Sent, Follow up, Done Review, and Done from Task Map dropdown.
    (task.taskMap?.statuses || []).forEach((st: string) => {
      const up = (st || '').toUpperCase().trim();
      const norm = up.replace(/[\s_-]+/g, '');
      const isUpwork = up.startsWith('UPWORK');
      const isPmName = up === 'CHE' || up === 'PAU' || up === 'HAN' || up.includes('PM');
      const isUrgent = up === 'URGENT';
      const isExcluded = EXCLUDED_FROM_TASK_MAP.has(up) || EXCLUDED_FROM_TASK_MAP.has(norm);

      if (!isUpwork && !isPmName && !isUrgent && !isExcluded && !list.some((o) => o.label.toLowerCase() === st.toLowerCase())) {
        list.push({
          id: `opt-cur-${st}`,
          label: st,
          color: '#3f3f46',
          textColor: '#ffffff',
          order: 99,
        });
      }
    });

    return list;
  };

  const handleTaskMapSubStatusToggle = async (
    task: TaskMapItem,
    label: string,
    nextStatuses?: string[],
    user?: any
  ) => {
    if (task.isAssumptionBlock && user) {
      const isSelecting = (nextStatuses || []).includes(label);
      const cleanNext = isSelecting ? [label] : [];
      task.taskMap.statuses = cleanNext;
      useAppStore.getState().updateMaActiveSession(user.name, {
        ...(task.progress || {}),
        status: label,
      });
      return;
    }

    const isSelecting = (nextStatuses || []).includes(label);
    const cleanNext = isSelecting ? [label] : [];
    onStatusChange(task.id, cleanNext);

    const norm = label.trim().toLowerCase();

    // 1. Hand-over: stays at In progress main status, transfer to Available Tasks so PMs can reassign to other MAs
    if (norm === 'hand-over' || norm === 'handover' || norm.includes('hand-over')) {
      if (isSelecting) {
        if (onTaskUpdate) {
          await onTaskUpdate(task.id, { assigneeId: null, status: task.status || 'In progress' });
        } else {
          await tasksApi.updateTask(task.id, { assigneeId: null } as any).catch(console.error);
          onDataRefresh();
        }
        toast.info('Task handed over — transferred to Available Tasks for PM reassignment');
      }
      return;
    }

    // 2. Paused: stays at In progress main status, stays in current MA column
    if (norm === 'paused') {
      if (isSelecting) {
        toast.info('Task marked Paused');
      }
      return;
    }

    // 3. Ask Client: transfer to CRM Map pool, but stays at In progress main status
    if (norm === 'ask client' || norm === 'askclient') {
      if (isSelecting) {
        toast.info("Task marked 'Ask Client' — transferred to CRM Map pool");
      }
      return;
    }

    // 4. To Review: changes main status to In Review and transfers to Auditor Map
    if (norm === 'to review' || norm === 'to_review') {
      if (isSelecting) {
        if (onTaskUpdate) {
          await onTaskUpdate(task.id, { status: 'In Review' });
        } else {
          await tasksApi.updateTask(task.id, { status: 'In Review' } as any).catch(console.error);
          onDataRefresh();
        }
        toast.info('Task status changed to In Review — transferred to Auditor Map');
      } else {
        const revertStatus = (task as any)._previousStatus || (task.assigneeId ? 'In progress' : 'Pending');
        if (onTaskUpdate) {
          await onTaskUpdate(task.id, { status: revertStatus });
        } else {
          await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
          onDataRefresh();
        }
        toast.info(`Reverted 'To Review' — returned to ${revertStatus}`);
      }
      return;
    }

    // 5. Waiting: changes main status to Waiting and transfers to CRM Map
    if (norm === 'waiting') {
      if (isSelecting) {
        if (onTaskUpdate) {
          await onTaskUpdate(task.id, { status: 'Waiting' });
        } else {
          await tasksApi.updateTask(task.id, { status: 'Waiting' } as any).catch(console.error);
          onDataRefresh();
        }
        toast.info('Task status changed to Waiting — transferred to CRM Map');
      } else {
        const revertStatus = (task as any)._previousStatus || (task.assigneeId ? 'In progress' : 'Pending');
        if (onTaskUpdate) {
          await onTaskUpdate(task.id, { status: revertStatus });
        } else {
          await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
          onDataRefresh();
        }
        toast.info(`Reverted 'Waiting' — returned to ${revertStatus}`);
      }
      return;
    }

    // 6. On-hold: changes main status to On-hold, transfers to Available Tasks at bottom, excluded from count
    if (norm === 'on-hold' || norm === 'onhold' || norm.includes('hold')) {
      if (isSelecting) {
        if (onTaskUpdate) {
          await onTaskUpdate(task.id, { status: 'On-hold', assigneeId: null });
        } else {
          await tasksApi.updateTask(task.id, { status: 'On-hold', assigneeId: null } as any).catch(console.error);
          onDataRefresh();
        }
        toast.info('Task status changed to On-hold — moved to Available Tasks (bottom)');
      } else {
        const revertStatus = (task as any)._previousStatus || 'Pending';
        if (onTaskUpdate) {
          await onTaskUpdate(task.id, { status: revertStatus });
        } else {
          await tasksApi.updateTask(task.id, { status: revertStatus } as any).catch(console.error);
          onDataRefresh();
        }
        toast.info(`Reverted 'On-hold' — returned to ${revertStatus}`);
      }
      return;
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div ref={boardScrollRef} className="flex gap-5 px-6 pb-4 overflow-x-auto overflow-y-hidden custom-scrollbar h-full max-h-full min-h-0 select-none">
        {/* 1. Available Tasks Pool Column (Matches Image 1) */}
        {(() => {
          const isCollapsed = !!collapsedColumns['available'];
          const isPinned = !!pinnedColumns['available'];
          const isSearchOpen = !!columnSearchOpen['available'];
          const searchQuery = columnSearches['available'] || '';
          const availableFilter = columnPriorityFilters['available'] || 'ALL';
          const availableSubStatusFilter = columnSubStatusFilters['available'] || 'ALL';
          const filteredDisplayPool = displayPool.filter((t) =>
            matchesPriorityFilter(t, availableFilter) &&
            matchesSubStatusFilter(t, availableSubStatusFilter) &&
            matchesSearchFilter(t, searchQuery)
          );
          // Exclude On-hold tasks from the task number indicator per user requirement
          const availableActiveCount = displayPool.filter((t) => !isTaskOnHold(t)).length;

          if (isCollapsed) {
            return (
              <DroppableColumn
                key="available-pool-collapsed"
                id="available-pool"
                className={`w-12 shrink-0 flex flex-col items-center py-4 bg-card/90 border border-border rounded-2xl shadow-xl h-full max-h-full min-h-0 transition-all cursor-pointer hover:border-blue-500/50 ${
                  isPinned ? 'sticky left-0 z-20 ring-1 ring-blue-500/40 shadow-2xl backdrop-blur-md bg-card/95' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleCollapseColumn('available')}
                  className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/60 mb-2 cursor-pointer"
                  title="Expand Available tasks"
                >
                  <ChevronRight className="size-4 text-blue-400" />
                </button>
                {isPinned && (
                  <Pin className="size-3 text-blue-400 fill-blue-400/40 rotate-45 mb-2" />
                )}
                <span className="size-2.5 rounded-full bg-[#0099ff] mb-2 shrink-0" />
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 mb-4">
                  {availableActiveCount}
                </span>
                <span
                  onClick={() => toggleCollapseColumn('available')}
                  style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
                  className="text-xs font-bold text-zinc-300 tracking-wider whitespace-nowrap mt-2 cursor-pointer hover:text-white select-none"
                >
                  Available tasks
                </span>
              </DroppableColumn>
            );
          }

          const showAvailableCutout = Boolean(
            activeOverId === 'available-pool' &&
            activeDragTask &&
            (activeDragTask.assigneeId || !poolIds.has(activeDragTask.id))
          );

          return (
            <DroppableColumn
              id="available-pool"
              className={`w-[370px] shrink-0 flex flex-col bg-card/90 border border-border rounded-2xl p-4 shadow-xl h-full max-h-full min-h-0 ${
                isPinned ? 'sticky left-0 z-20 ring-1 ring-blue-500/40 shadow-2xl backdrop-blur-md bg-card/95' : ''
              }`}
            >
              {/* Header Top Row: Left side has dot & title; Right side has Search, Pin, and Collapse */}
              <div className="flex items-center justify-between h-9 pb-2 border-b border-border/80 mb-2">
                <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2 h-7">
                  <span className="size-2 rounded-full bg-[#0099ff] shrink-0" />
                  <h3 className="text-sm font-bold text-zinc-100 truncate">Available tasks</h3>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 shrink-0">
                    {availableActiveCount}
                  </span>
                </div>

                {/* Top Right: Collapse, Pin, Search (Search on right side) */}
                <div className="flex items-center gap-1 shrink-0 h-7">
                  <button
                    type="button"
                    onClick={() => toggleCollapseColumn('available')}
                    className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-md cursor-pointer transition-colors"
                    title="Collapse column"
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => togglePinColumn('available')}
                    className={`p-1 rounded-md transition-colors cursor-pointer ${
                      isPinned
                        ? 'text-blue-400 bg-blue-500/15 border border-blue-500/30'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                    }`}
                    title={isPinned ? 'Unpin column' : 'Pin column'}
                  >
                    <Pin className={`size-3.5 rotate-45 ${isPinned ? 'fill-blue-400/40' : ''}`} />
                  </button>

                  {isSearchOpen ? (
                    <div className="flex items-center bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-0.5 max-w-[130px] text-xs">
                      <Search className="size-3 text-zinc-400 shrink-0 mr-1" />
                      <input
                        autoFocus
                        type="text"
                        value={searchQuery}
                        onChange={(e) => handleColumnSearchChange('available', e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') toggleColumnSearch('available');
                        }}
                        placeholder="Search..."
                        className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => toggleColumnSearch('available')}
                        className="text-zinc-400 hover:text-zinc-200 ml-0.5 p-0.5 cursor-pointer"
                        title="Close search"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleColumnSearch('available')}
                      className={`p-1 rounded-md transition-colors cursor-pointer ${
                        searchQuery
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

              {/* Next Line: Filters on the left side (description of available tasks removed) */}
              <div className="flex items-center gap-1.5 justify-start mb-3">
                <ColumnClientDropdown
                  tasks={availablePool}
                  clients={clients}
                  showAdmin={effectiveShowAdmin}
                  onToggleAdmin={() => {
                    if (onToggleAdminTasks) {
                      onToggleAdminTasks();
                    } else {
                      setLocalShowAdmin(!localShowAdmin);
                    }
                  }}
                  selectedClients={selectedClients}
                  onSelectClients={setSelectedClients}
                  isTaskUnderAdmin={isTaskUnderAdmin}
                />

                <ColumnPriorityDropdown
                  columnId="available"
                  tasks={displayPool}
                  activeFilter={availableFilter}
                  onSelectFilter={handleSelectPriorityFilter}
                />

                <ColumnSubStatusDropdown
                  columnId="available"
                  tasks={displayPool}
                  activeFilter={availableSubStatusFilter}
                  onSelectFilter={handleSelectSubStatusFilter}
                />

                {searchQuery && (
                  <span className="text-[10px] text-zinc-400 italic">
                    ({filteredDisplayPool.length} of {displayPool.length})
                  </span>
                )}
              </div>

              {/* Cards List */}
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1 min-h-0">
                {showAvailableCutout && (
                  <CardCutoutPlaceholder task={activeDragTask!} targetName="Available Tasks" isUnassign />
                )}
                {filteredDisplayPool.length === 0 && !showAvailableCutout ? (
                  <p className="text-xs text-zinc-600 italic text-center py-12">
                    {displayPool.length > 0
                      ? 'No tasks match the selected priority filter.'
                      : 'No available tasks in the pool.'}
                  </p>
                ) : (
                  sortAvailablePoolTasks(filteredDisplayPool).map((task) => {
                    const priorityConfig = getPriorityConfig(task.priority);
                    const isClosed =
                      (task.status || '').toUpperCase() === 'CLOSED' ||
                      (task.status || '').toUpperCase() === 'DONE';

                    const clientName = task.progress?.client || task.list?.name || '';
                    const isClientConfiguredUpwork = upworkClients.some(
                      (c) => c.toLowerCase() === clientName.toLowerCase()
                    );
                    const hasManualUpworkTag = (task.taskMap?.statuses || []).some((s) => s.toLowerCase().startsWith('upwork'));
                    const isLauren = clientName.toLowerCase().includes('lauren');

                    // Upwork determination: Lauren is project-based (only Upwork if manually marked); otherwise check configured list/tracker/tag
                    const isUpwork = isLauren
                      ? hasManualUpworkTag
                      : Boolean(
                          isClientConfiguredUpwork ||
                          task.progress?.isUpwork ||
                          task.progress?.timeTracker?.toLowerCase().includes('upwork') ||
                          task.list?.name?.toLowerCase().includes('upwork') ||
                          hasManualUpworkTag
                        );
                    const isMissingTime = Boolean(task.progress?.isMissingTime);
                    // Only "live" when the MA actively clocked in (Time In) and has not clocked out
                    const isLive = Boolean(
                      task.progress?.timeIn &&
                      !task.progress?.timeOut &&
                      !task.progress?.isMissingTime &&
                      !isStaleLiveSession(task.progress?.timeIn, task.progress?.date, currentTime)
                    );

                    const cardBorderClass = isUpwork && isLive
                      ? 'border-white/60 ring-1 ring-white/20 shadow-[0_0_12px_rgba(255,255,255,0.08)]'
                      : isMissingTime
                      ? 'border-red-500/60 ring-1 ring-red-500/25 shadow-[0_0_12px_rgba(239,68,68,0.12)]'
                      : isLive
                      ? 'border-[#D04A7C]/80 ring-1 ring-[#D04A7C]/30 shadow-[0_0_14px_rgba(208,74,124,0.15)]'
                      : 'border-border hover:border-zinc-700 shadow-md';

                    return (
                      <DraggableTaskCard
                        key={task.id}
                        task={task}
                        disabled={!isPmUser}
                      >
                        <div className={`p-3 bg-zinc-900 border rounded-xl min-h-[112px] flex items-stretch gap-3 transition-all group ${cardBorderClass}`}>
                          {/* Left: Task Info (Task title only in title line, circle dot beside bulletin below) */}
                          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                            {/* Client Name */}
                            <div className="text-[11px] font-medium truncate max-w-[190px] mb-1 flex items-center gap-1.5">
                              {isUpwork && isLive ? (
                                <span className="text-white font-bold uppercase tracking-wider flex items-center gap-1">
                                  <span className="size-1.5 rounded-full bg-white animate-pulse shrink-0" />
                                  {task.progress?.client || task.list?.name || 'Upwork'}
                                </span>
                              ) : isLive ? (
                                <span className="text-[#D04A7C] font-semibold truncate flex items-center gap-1">
                                  <span className="size-1.5 rounded-full bg-[#D04A7C] animate-ping shrink-0" />
                                  {task.progress?.client || task.list?.name || 'General'}
                                </span>
                              ) : isMissingTime ? (
                                <span className="text-red-400 font-semibold truncate flex items-center gap-1">
                                  <span className="size-1.5 rounded-full bg-red-500 shrink-0" />
                                  {task.progress?.client || task.list?.name || 'General'}
                                </span>
                              ) : (
                                <span className="text-zinc-400 truncate">
                                  {task.progress?.client || task.list?.name || 'General'}
                                </span>
                              )}
                            </div>

                            {/* Title only - zero icons beside it */}
                            <h4
                              onClick={() => onOpenDetail(task)}
                              className="text-[13px] font-bold text-zinc-100 group-hover:text-white cursor-pointer line-clamp-2 leading-snug hover:underline my-0.5 h-[36px]"
                              title={task.title}
                            >
                              {task.title}
                            </h4>

                            {/* Controls row: circle dot left of bulletin, priority flag */}
                            <div className="flex items-center gap-2 text-xs text-zinc-500 pt-1">
                              {/* Circle Dot Status Indicator */}
                              <CardStatusDropdown
                                taskId={task.id}
                                currentStatus={task.status || 'In progress'}
                                excludeStatuses={['Revision', 'Done', 'To Send', 'Sent', 'Follow up', 'Done Review']}
                                onSelect={(newStatus: string) => {
                                  if (onTaskUpdate) {
                                    onTaskUpdate(task.id, { status: newStatus });
                                  } else {
                                    tasksApi
                                      .updateTask(task.id, { status: newStatus })
                                      .then(() => onDataRefresh())
                                      .catch((e: any) => toast.error(e.message));
                                  }
                                }}
                              />

                              {/* Bulletin Icon - click shows task description */}
                              <TaskDescriptionButton
                                description={task.description}
                                taskTitle={task.title}
                              />

                              {/* Priority Flag and Label */}
                              <CardPriorityDropdown
                                taskId={task.id}
                                priority={task.priority || 'NORMAL'}
                                onSelect={(newPriority: string) => {
                                  if (onTaskUpdate) {
                                    onTaskUpdate(task.id, { priority: newPriority });
                                  } else {
                                    tasksApi
                                      .updateTask(task.id, { priority: newPriority as any })
                                      .then(() => onDataRefresh())
                                      .catch((e: any) => toast.error(e.message));
                                  }
                                }}
                              />
                            </div>
                          </div>

                          {/* Separator */}
                          <div className="w-px bg-zinc-800/80 self-stretch my-0.5 shrink-0" />

                          {/* Right: Section where Sub-Status is (with Time Progress in top right corner) */}
                          <div className="w-[130px] sm:w-[145px] shrink-0 flex flex-col justify-between py-0.5">
                            <div className="flex justify-end items-center">
                              <TaskTimeProgressSlot task={task} now={currentTime} />
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
                                selectedStatuses={task.taskMap.statuses || []}
                                options={getUnifiedTaskMapOptions(task)}
                                onToggleStatus={(label, nextStatuses) =>
                                  handleTaskMapSubStatusToggle(task, label, nextStatuses)
                                }
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
        })()}

        {/* 2. User Shift Columns (Matches Image 1 & 4) */}
        {sortedUserColumns.map(([userId, { user, tasks: userTasks }]) => {
          const initials = (user.name || 'U').substring(0, 2).toUpperCase();
          const avatarBg = getAssigneeAvatarColor(user.name || 'U');
          const isCollapsed = !!collapsedColumns[userId];
          const isPinned = !!pinnedColumns[userId];
          const isSearchOpen = !!columnSearchOpen[userId];
          const searchQuery = columnSearches[userId] || '';
          const userPriorityFilter = columnPriorityFilters[userId] || 'ALL';
          const userSubStatusFilter = columnSubStatusFilters[userId] || 'ALL';
          const userClientFilter = columnClientFilters[userId] || 'ALL';
          const userShowAdmin = columnShowAdmin[userId] ?? effectiveShowAdmin;

          const filteredUserTasks = userTasks.filter((t) => {
            if (!matchesPriorityFilter(t, userPriorityFilter)) return false;
            if (!matchesSubStatusFilter(t, userSubStatusFilter)) return false;
            if (!matchesSearchFilter(t, searchQuery)) return false;

            // Admin task check: hide all tasks that are for the admin by default,
            // but the General Task (assumption block) representing their current admin work MUST stay visible!
            const isAdmin = isTaskUnderAdmin(t);
            if (isAdmin && !t.isAssumptionBlock && !userShowAdmin) return false;

            // Client filter check: the General Task representing the user's active schedule input is always shown in their column
            if (!t.isAssumptionBlock && userClientFilter !== 'ALL') {
              const clientId = t.list?.id || (t.list?.name ? `name-${t.list.name}` : 'general');
              const clientName = t.list?.name || 'General';
              if (!userClientFilter.includes(clientId) && !userClientFilter.includes(clientName)) {
                return false;
              }
            }
            return true;
          });

          if (isCollapsed) {
            return (
              <DroppableColumn
                key={userId}
                id={`user-${userId}`}
                className={`w-12 shrink-0 flex flex-col items-center py-4 bg-card/90 border border-zinc-800/80 rounded-2xl shadow-xl h-full max-h-full min-h-0 transition-all cursor-pointer hover:border-zinc-700 ${
                  isPinned ? 'ring-1 ring-blue-500/40 border-blue-500/30' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleCollapseColumn(userId)}
                  className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/60 mb-2 cursor-pointer"
                  title={`Expand ${user.name}`}
                >
                  <ChevronRight className="size-4 text-zinc-400" />
                </button>
                {isPinned && (
                  <Pin className="size-3 text-blue-400 fill-blue-400/40 rotate-45 mb-2" />
                )}
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name}
                    className="size-7 rounded-full object-cover border border-zinc-700/80 shrink-0 mb-2"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div
                    className={`size-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm shrink-0 mb-2 ${avatarBg}`}
                  >
                    {initials}
                  </div>
                )}
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700 mb-4">
                  {userTasks.length}
                </span>
                <span
                  onClick={() => toggleCollapseColumn(userId)}
                  style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
                  className="text-xs font-bold text-zinc-300 tracking-wider whitespace-nowrap mt-2 cursor-pointer hover:text-white select-none"
                >
                  {user.name}
                </span>
              </DroppableColumn>
            );
          }

          return (
            <DroppableColumn
              key={userId}
              id={`user-${userId}`}
              className={`w-[370px] shrink-0 flex flex-col bg-card/90 border border-zinc-800/80 rounded-2xl p-4 shadow-xl h-full max-h-full min-h-0 ${
                isPinned ? 'ring-1 ring-blue-500/30 border-blue-500/40 shadow-blue-950/20' : ''
              }`}
            >
              {/* User Column Header */}
              {(() => {
                const roleInfo = getUserRolePriority(user.roles || [], user.isAudit);

                return (
                  <>
                    {/* Header Top Row: Left side has Avatar, Name, Role; Right side has Search, Pin, and Collapse */}
                    <div className="flex items-center justify-between h-9 pb-2 border-b border-border/80 mb-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2 h-7">
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
                          <span className="text-sm font-bold text-zinc-100 truncate" title={user.name}>
                            {user.name}
                          </span>
                          <UserRoleBadge user={user} />
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700 shrink-0">
                            {userTasks.length}
                          </span>
                        </div>
                      </div>

                      {/* Top Right: Reset, Collapse, Pin, Search (Search on right side) */}
                      <div className="flex items-center gap-1 shrink-0 h-7">
                        <button
                          type="button"
                          onClick={() => handleResetColumn(userId, user.name)}
                          className="p-1 text-zinc-400 hover:text-amber-400 hover:bg-zinc-800/60 rounded-md cursor-pointer transition-colors"
                          title={`Reset ${user.name}'s column (return pending tasks to Available tasks)`}
                        >
                          <RotateCcw className="size-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleCollapseColumn(userId)}
                          className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-md cursor-pointer transition-colors"
                          title="Collapse column"
                        >
                          <ChevronLeft className="size-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => togglePinColumn(userId)}
                          className={`p-1 rounded-md transition-colors cursor-pointer ${
                            isPinned
                              ? 'text-blue-400 bg-blue-500/15 border border-blue-500/30'
                              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                          }`}
                          title={isPinned ? 'Unpin column' : 'Pin column'}
                        >
                          <Pin className={`size-3.5 rotate-45 ${isPinned ? 'fill-blue-400/40' : ''}`} />
                        </button>

                        {isSearchOpen ? (
                          <div className="flex items-center bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-0.5 max-w-[130px] text-xs">
                            <Search className="size-3 text-zinc-400 shrink-0 mr-1" />
                            <input
                              autoFocus
                              type="text"
                              value={searchQuery}
                              onChange={(e) => handleColumnSearchChange(userId, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') toggleColumnSearch(userId);
                              }}
                              placeholder="Search..."
                              className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-500 outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => toggleColumnSearch(userId)}
                              className="text-zinc-400 hover:text-zinc-200 ml-0.5 p-0.5 cursor-pointer"
                              title="Close search"
                            >
                              <X className="size-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleColumnSearch(userId)}
                            className={`p-1 rounded-md transition-colors cursor-pointer ${
                              searchQuery
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

                    {/* Next Line: Filters on the left side (Both Client and Priority filters per user) */}
                    <div className="flex items-center gap-1.5 justify-start mb-3">
                      <ColumnClientDropdown
                        tasks={userTasks}
                        clients={clients}
                        showAdmin={userShowAdmin}
                        onToggleAdmin={() =>
                          setColumnShowAdmin((prev) => ({
                            ...prev,
                            [userId]: !userShowAdmin,
                          }))
                        }
                        selectedClients={userClientFilter}
                        onSelectClients={(nextClients) =>
                          setColumnClientFilters((prev) => ({
                            ...prev,
                            [userId]: nextClients,
                          }))
                        }
                        isTaskUnderAdmin={isTaskUnderAdmin}
                      />
                      <ColumnPriorityDropdown
                        columnId={userId}
                        tasks={userTasks}
                        activeFilter={userPriorityFilter}
                        onSelectFilter={handleSelectPriorityFilter}
                      />
                      <ColumnSubStatusDropdown
                        columnId={userId}
                        tasks={userTasks}
                        activeFilter={userSubStatusFilter}
                        onSelectFilter={handleSelectSubStatusFilter}
                      />
                      {searchQuery && (
                        <span className="text-[10px] text-zinc-400 italic">
                          ({filteredUserTasks.length} of {userTasks.length})
                        </span>
                      )}
                    </div>
                  </>
                );
              })()}

              {/* Tasks in Step Order */}
              {(() => {
                const sorted = sortColumnTasks(filteredUserTasks, user.name);
                const activeInProgTask = sorted.find((t) => isTaskActiveInProgress(t, user.name));
                const queuedTasks = sorted.filter((t) => t.id !== activeInProgTask?.id);

                const renderCard = (task: TaskMapItem) => {
                  const priorityConfig = getPriorityConfig(task.priority);
                  const isClosed =
                    (task.status || '').toUpperCase() === 'CLOSED' ||
                    (task.status || '').toUpperCase() === 'DONE';

                  // Worker isolation: only display sheet progress if it was logged by THIS column's user!
                  const isMyProgress = doesProgressMatchUser(task.progress?.maName, user.name);
                  const effectiveProgress = isMyProgress ? task.progress : null;

                  const clientName = effectiveProgress?.client || task.progress?.client || task.list?.name || '';
                  const isClientConfiguredUpwork = upworkClients.some(
                    (c) => c.toLowerCase() === clientName.toLowerCase()
                  );
                  const hasManualUpworkTag = (task.taskMap?.statuses || []).some((s) => s.toLowerCase().startsWith('upwork'));
                  const isLauren = clientName.toLowerCase().includes('lauren');

                  // Upwork determination: Lauren is project-based (only Upwork if manually marked); otherwise check configured list/tracker/tag
                  const isUpwork = isLauren
                    ? hasManualUpworkTag
                    : Boolean(
                        isClientConfiguredUpwork ||
                        effectiveProgress?.isUpwork ||
                        effectiveProgress?.timeTracker?.toLowerCase().includes('upwork') ||
                        task.list?.name?.toLowerCase().includes('upwork') ||
                        hasManualUpworkTag
                      );
                  const isMissingTime = Boolean(effectiveProgress?.isMissingTime);
                  // Live working when the MA actively clocked in (Time In) and has not clocked out (and not stale)
                  // STRICT RULE: Only the single task in the In Progress slot (activeInProgTask) can EVER be Live Working!
                  const isLiveWorking = Boolean(
                    task.id === activeInProgTask?.id &&
                    effectiveProgress?.timeIn &&
                    !effectiveProgress?.timeOut &&
                    !effectiveProgress?.isMissingTime &&
                    !isStaleLiveSession(effectiveProgress?.timeIn, effectiveProgress?.date, currentTime)
                  );
                  // Only highlight tasks that are actively live working (with a counting timer)
                  const cardBorderClass = isUpwork && isLiveWorking
                    ? 'border-white/80 ring-2 ring-white/30 shadow-[0_0_18px_rgba(255,255,255,0.22)] animate-[pulse_3s_ease-in-out_infinite]'
                    : isMissingTime
                    ? 'border-red-500/60 ring-1 ring-red-500/25 shadow-[0_0_12px_rgba(239,68,68,0.12)]'
                    : isLiveWorking
                    ? 'border-[#D04A7C] ring-2 ring-[#D04A7C]/50 shadow-[0_0_20px_rgba(208,74,124,0.35)] animate-[pulse_3s_ease-in-out_infinite]'
                    : 'border-zinc-800/90 hover:border-zinc-700 shadow-sm';

                  return (
                    <DraggableTaskCard key={task.id} task={task} disabled={!isPmUser || task.isAssumptionBlock}>
                      <div className={`p-3 bg-zinc-900 border rounded-xl min-h-[112px] flex items-stretch gap-3 transition-all group ${cardBorderClass}`}>
                        {/* LEFT: Task Info (Title only in title line, circle dot beside bulletin below) */}
                        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                          {/* Client Name */}
                          {(() => {
                            const rawClientName = effectiveProgress?.client || task.list?.name || '';
                            const displayClientName = (rawClientName && rawClientName.toLowerCase() !== 'general')
                              ? rawClientName
                              : (task.isAssumptionBlock ? 'No client inputted' : 'General');
                            return (
                              <div className="text-[11px] font-medium truncate max-w-[190px] mb-1 flex items-center gap-1.5">
                                {isUpwork && isLiveWorking ? (
                                  <span className="text-white font-bold uppercase tracking-wider flex items-center gap-1.5">
                                    <span className="size-2 rounded-full bg-white animate-pulse shrink-0" />
                                    {displayClientName}
                                  </span>
                                ) : isLiveWorking ? (
                                  <span className="text-[#D04A7C] font-bold uppercase tracking-wider flex items-center gap-1.5">
                                    <span className="relative flex size-2 shrink-0">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#D04A7C] opacity-75" />
                                      <span className="relative inline-flex rounded-full size-2 bg-[#D04A7C]" />
                                    </span>
                                    {displayClientName}
                                  </span>
                                ) : isMissingTime ? (
                                  <span className="text-red-400 font-semibold truncate flex items-center gap-1">
                                    <span className="size-1.5 rounded-full bg-red-500 shrink-0" />
                                    {displayClientName}
                                  </span>
                                ) : (
                                  <span className="text-zinc-400 truncate">
                                    {displayClientName}
                                  </span>
                                )}
                              </div>
                            );
                          })()}

                          {/* Title only - zero icons beside it */}
                          <h4
                            onClick={() => task.isAssumptionBlock ? toast.info('General slot reflects schedule input from MA daily sheet.') : onOpenDetail(task)}
                            className="text-[13px] font-bold text-zinc-100 group-hover:text-white cursor-pointer line-clamp-2 leading-snug hover:underline my-0.5 h-[36px]"
                            title={task.title}
                          >
                            {task.title}
                          </h4>

                          {/* Controls row: circle dot left of bulletin, priority flag */}
                          <div className="flex items-center gap-2 text-xs text-zinc-500 pt-1">
                            {/* Circle Dot Status Indicator */}
                            <CardStatusDropdown
                              taskId={task.id}
                              currentStatus={task.status || 'In progress'}
                              excludeStatuses={['Revision', 'Done', 'To Send', 'Sent', 'Follow up', 'Done Review']}
                              onSelect={(newStatus: string) => {
                                if (task.isAssumptionBlock) {
                                  task.status = newStatus;
                                  useAppStore.getState().updateMaActiveSession(user.name, {
                                    ...(task.progress || {}),
                                    status: newStatus,
                                  });
                                  toast.success(`General slot status updated to ${newStatus}`);
                                  return;
                                }
                                if (onTaskUpdate) {
                                  onTaskUpdate(task.id, { status: newStatus });
                                } else {
                                  tasksApi
                                    .updateTask(task.id, { status: newStatus })
                                    .then(() => onDataRefresh())
                                    .catch((e: any) => toast.error(e.message));
                                }
                              }}
                            />

                            {/* Bulletin Icon - click shows task description */}
                            <TaskDescriptionButton
                              description={task.description}
                              taskTitle={task.title}
                            />

                            {/* Priority Flag and Label */}
                            <CardPriorityDropdown
                              taskId={task.id}
                              priority={task.priority || 'NORMAL'}
                              onSelect={(newPriority: string) => {
                                if (task.isAssumptionBlock) {
                                  task.priority = newPriority as any;
                                  toast.success(`Priority updated to ${newPriority}`);
                                  return;
                                }
                                if (onTaskUpdate) {
                                  onTaskUpdate(task.id, { priority: newPriority });
                                } else {
                                  tasksApi
                                    .updateTask(task.id, { priority: newPriority as any })
                                    .then(() => onDataRefresh())
                                    .catch((e: any) => toast.error(e.message));
                                }
                              }}
                            />
                          </div>
                        </div>

                        {/* SEPARATOR: Vertical line between task info and statuses */}
                        <div className="w-px bg-zinc-800/80 self-stretch my-0.5 shrink-0" />

                        {/* RIGHT: Section where Sub-Status is (with Time Progress in top right corner) */}
                        <div className="w-[130px] sm:w-[145px] shrink-0 flex flex-col justify-between py-0.5">
                          <div className="flex justify-end items-center">
                            <TaskTimeProgressSlot task={{ ...task, progress: effectiveProgress }} now={currentTime} isLive={isLiveWorking} />
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
                              selectedStatuses={task.taskMap.statuses || []}
                              options={getUnifiedTaskMapOptions(task, user)}
                              onToggleStatus={(label, nextStatuses) =>
                                handleTaskMapSubStatusToggle(task, label, nextStatuses, user)
                              }
                              onOptionsUpdated={onOptionsUpdated}
                              readOnly={false}
                            />
                          </div>
                        </div>
                      </div>
                    </DraggableTaskCard>
                  );
                };

                const showColumnCutout = Boolean(
                  activeOverId === `user-${userId}` &&
                  activeDragTask &&
                  (poolIds.has(activeDragTask.id) || !activeDragTask.assigneeId || activeDragTask.assigneeId !== userId)
                );

                return (
                  <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1 min-h-0">
                    {/* IN PROGRESS SLOT / CARD */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between px-1">
                        {(() => {
                          const isColumnLiveWorking = Boolean(
                            activeInProgTask && isTaskLiveWorking(activeInProgTask, user.name, currentTime)
                          );
                          return (
                            <>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`size-2 rounded-full ${
                                    isColumnLiveWorking ? 'bg-[#D04A7C] animate-pulse' : 'bg-zinc-600'
                                  }`}
                                />
                                <span
                                  className={`text-[10px] font-bold uppercase tracking-wider ${
                                    isColumnLiveWorking ? 'text-[#D04A7C]' : 'text-zinc-400'
                                  }`}
                                >
                                  In Progress
                                </span>
                              </div>
                              {isColumnLiveWorking && (
                                <span className="text-[10px] font-mono text-[#D04A7C] font-semibold flex items-center gap-1">
                                  <span className="size-1.5 rounded-full bg-[#D04A7C] animate-ping shrink-0" />
                                  Live Working
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </div>

                      {activeInProgTask ? (
                        renderCard(activeInProgTask)
                      ) : (
                        <TaskMapInProgressDropCard
                          userId={userId}
                          userName={user.name}
                          availableTasks={availablePool}
                          queuedTasks={queuedTasks}
                          onSelectTask={(taskId) => handleSelectInProgressTask(taskId, userId)}
                          disabled={!isPmUser && currentUser?.id !== userId}
                        />
                      )}
                    </div>

                    {/* QUEUE SECTION */}
                    {(queuedTasks.length > 0 || showColumnCutout) && (
                      <div className="pt-2 space-y-1">
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                            Queue ({queuedTasks.length + (showColumnCutout ? 1 : 0)})
                          </span>
                        </div>
                        <div className="space-y-2.5">
                          {showColumnCutout && (
                            <CardCutoutPlaceholder task={activeDragTask!} targetName={user.name} />
                          )}
                          {queuedTasks.map((t) => renderCard(t))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </DroppableColumn>
          );
        })}
      </div>

      {/* Drag Overlay Preview (High-fidelity card using board's signature drag animation) */}
      <DragOverlay
        zIndex={100}
        dropAnimation={{
          duration: 250,
          easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
        }}
      >
        {activeDragTask ? (() => {
          const priorityConfig = getPriorityConfig(activeDragTask.priority);
          const isClosed =
            (activeDragTask.status || '').toUpperCase() === 'CLOSED' ||
            (activeDragTask.status || '').toUpperCase() === 'DONE';
          const primarySubStatus =
            (activeDragTask.taskMap.statuses || [])[0] || 'Sub-Status';

          return (
            <div className="w-[340px] rotate-2 scale-105 p-3 bg-card border border-blue-500/80 rounded-xl shadow-2xl shadow-black/80 ring-1 ring-blue-500/50 flex items-stretch gap-3 min-h-[112px] pointer-events-none cursor-grabbing">
              {/* Left: Task Info */}
              <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                <div className="text-[11px] font-medium text-zinc-400 truncate max-w-[190px] mb-1">
                  {activeDragTask.list?.name || 'General'}
                </div>
                <h4 className="text-[13px] font-bold text-white line-clamp-2 leading-snug my-0.5 h-[36px]">
                  {activeDragTask.title}
                </h4>
                <div className="flex items-center gap-2 text-xs text-zinc-500 pt-1">
                  <span className="shrink-0 flex items-center">
                    {isClosed ? (
                      <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <CustomCircleDot
                        className="size-3.5 shrink-0"
                        style={{ color: getDotColor(activeDragTask.status) }}
                      />
                    )}
                  </span>
                  <span className="flex items-center gap-1 font-medium text-[11px]">
                    <Flag className={`size-3 ${priorityConfig.iconColor}`} />
                    <span className={priorityConfig.color}>
                      {priorityConfig.label}
                    </span>
                  </span>
                </div>
              </div>

              {/* Separator */}
              <div className="w-px bg-zinc-800/80 self-stretch my-0.5 shrink-0" />

              {/* Right: Sub-Status snapshot */}
              <div className="w-[125px] shrink-0 flex flex-col justify-between py-0.5">
                <div className="flex justify-end items-center">
                  <TaskTimeProgressSlot task={activeDragTask} now={currentTime} />
                </div>
                <div className="w-full">
                  <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
                    Sub-Status
                  </span>
                  <div className="px-2 py-1 text-xs rounded-md font-medium truncate bg-zinc-800 text-zinc-200 border border-zinc-700/60">
                    {primarySubStatus}
                  </div>
                </div>
              </div>
            </div>
          );
        })() : null}
      </DragOverlay>

      {/* Action Error Modal for role restriction failures & permission issues */}
      <ActionErrorModal
        isOpen={!!actionError}
        onClose={() => setActionError(null)}
        error={actionError}
      />
    </DndContext>
  );
};
