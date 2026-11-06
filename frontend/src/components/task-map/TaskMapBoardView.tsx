import React, { useState, useRef, useEffect } from 'react';
import { TaskMapItem, TaskMapOption, taskMapApi } from '@/api/taskMap';
import { TaskMapStatusDropdown } from './TaskMapStatusDropdown';
import { TaskDescriptionButton } from './TaskDescriptionButton';
import { Flag, CheckCircle2, ChevronLeft, ChevronRight, ChevronsRight, ChevronDown, Check, Building2, Search, Shield } from 'lucide-react';
import { format } from 'date-fns';
import { getPriorityConfig } from '@/lib/priority';
import { getAssigneeAvatarColor, CustomCircleDot, CustomCircleDotted, resolveUsersFromRoleRestrictions } from '@/lib/taskTokens';
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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const counts = getColumnPriorityCounts(tasks);
  const currentKey = activeFilter || 'ALL';

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
      ref={dropdownRef}
      className="relative inline-block text-left shrink-0"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer shadow-xs select-none ${details.btnClass}`}
        title={details.label ? `Filtered by ${details.label}` : "Filter by priority"}
      >
        <Flag className={`size-3 shrink-0 ${details.flagClass}`} />
        {details.label && <span className="font-semibold">{details.label}</span>}
        {details.count > 0 && (
          <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${details.badgeClass}`}>
            {details.count}
          </span>
        )}
        <ChevronDown
          className={`size-3 text-zinc-400 shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-40 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5 text-zinc-200 z-50 animate-in fade-in zoom-in-95 duration-100">
          {/* All */}
          <button
            type="button"
            onClick={() => {
              onSelectFilter(columnId, 'ALL');
              setIsOpen(false);
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
                  currentKey === 'URGENT' ? 'bg-red-900/50 text-red-300' : 'bg-zinc-800/80 text-zinc-400'
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
                  currentKey === 'HIGH' ? 'bg-amber-900/50 text-amber-300' : 'bg-zinc-800/80 text-zinc-400'
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
                  currentKey === 'NORMAL' ? 'bg-blue-900/50 text-blue-300' : 'bg-zinc-800/80 text-zinc-400'
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
                  currentKey === 'LOW' ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-800/80 text-zinc-400'
                }`}
              >
                {counts.LOW}
              </span>
              {currentKey === 'LOW' && <Check className="size-3.5 text-zinc-400" />}
            </div>
          </button>

          {currentKey !== 'ALL' && (
            <>
              <div className="h-px bg-zinc-800 my-1" />
              <button
                type="button"
                onClick={() => {
                  onSelectFilter(columnId, 'ALL');
                  setIsOpen(false);
                }}
                className="w-full flex items-center justify-center py-1 text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 rounded-md transition-colors cursor-pointer"
              >
                Reset to All
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

interface ColumnClientDropdownProps {
  tasks: TaskMapItem[];
  clients?: Array<{ id: string; name: string; count: number }>;
  showAdmin: boolean;
  onToggleAdmin: () => void;
  selectedClients: string[] | 'ALL';
  onSelectClients: (clients: string[] | 'ALL') => void;
  isTaskUnderAdmin: (task: TaskMapItem) => boolean;
}

const ColumnClientDropdown: React.FC<ColumnClientDropdownProps> = ({
  tasks,
  clients,
  showAdmin,
  onToggleAdmin,
  selectedClients,
  onSelectClients,
  isTaskUnderAdmin,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Compute distinct clients and task counts
  // 1. Seed from clients prop (all lists under "Client Dashboard" in the sidebar)
  // 2. Count matching active tasks in availablePool (Pending or Revision)
  const { clientsList, adminCount, totalClientCount } = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();

    // Seed all clients from "Client Dashboard"
    for (const c of clients || []) {
      map.set(c.id, { id: c.id, name: c.name, count: 0 });
    }

    let admin = 0;
    let clientTotal = 0;

    for (const t of tasks) {
      const s = (t.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      const mapStatuses = (t.taskMap?.statuses || []).map((x: string) =>
        x.trim().toUpperCase().replace(/[\s_-]+/g, '')
      );
      const isExcluded =
        s === 'WAITING' ||
        s === 'DAILY' ||
        s === 'WEEKLY' ||
        s === 'MONTHLY' ||
        s === 'RECURRING' ||
        !!(t as any)?.recurringConfig ||
        mapStatuses.some((st: string) =>
          ['WAITING', 'DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING'].includes(st)
        );
      if (isExcluded) continue;
      const isPending = s === 'PENDING' || mapStatuses.includes('PENDING');
      const isRevision = s === 'REVISION' || mapStatuses.includes('REVISION');
      if (!isPending && !isRevision) continue;

      if (isTaskUnderAdmin(t)) {
        admin++;
      } else {
        const id = t.list?.id || (t.list?.name ? `name-${t.list.name}` : 'general');
        const name = t.list?.name || 'General';
        clientTotal++;
        const existing = map.get(id);
        if (existing) {
          existing.count++;
        } else {
          map.set(id, { id, name, count: 1 });
        }
      }
    }

    const sortedClients = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    return {
      clientsList: sortedClients,
      adminCount: admin,
      totalClientCount: clientTotal,
    };
  }, [tasks, clients, isTaskUnderAdmin]);

  // Are all clients checked?
  const allClientsChecked =
    selectedClients === 'ALL' ||
    (Array.isArray(selectedClients) && selectedClients.length === clientsList.length);

  // Check if a client is selected
  const isClientChecked = (id: string, name: string) => {
    if (selectedClients === 'ALL') return true;
    return selectedClients.includes(id) || selectedClients.includes(name);
  };

  // Filter clients by search
  const filteredClients = clientsList.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  // Count currently matching tasks
  const matchingCount = React.useMemo(() => {
    let count = 0;
    if (showAdmin) count += adminCount;
    if (selectedClients === 'ALL') {
      count += totalClientCount;
    } else {
      for (const c of clientsList) {
        if (isClientChecked(c.id, c.name)) {
          count += c.count;
        }
      }
    }
    return count;
  }, [showAdmin, adminCount, selectedClients, totalClientCount, clientsList]);

  // In default, admin is unchecked (hidden) and all clients are checked
  const isFiltered = showAdmin || !allClientsChecked;

  const getButtonDetails = () => {
    if (!isFiltered) {
      return {
        label: '',
        btnClass:
          'bg-card hover:bg-zinc-800/60 text-zinc-300 border-zinc-800 hover:border-zinc-700',
        badgeClass: 'bg-zinc-800/80 text-zinc-400 border border-zinc-700/60',
        iconClass: 'text-blue-400',
      };
    }

    let label = 'Filtered';
    if (showAdmin && Array.isArray(selectedClients) && selectedClients.length === 0) {
      label = 'Admin only';
    } else if (!showAdmin && Array.isArray(selectedClients) && selectedClients.length === 1) {
      const match = clientsList.find((c) => isClientChecked(c.id, c.name));
      if (match) label = match.name;
    } else if (showAdmin && Array.isArray(selectedClients) && selectedClients.length === 1) {
      const match = clientsList.find((c) => isClientChecked(c.id, c.name));
      if (match) label = `${match.name} + Admin`;
    }

    return {
      label,
      btnClass: 'bg-blue-950/70 hover:bg-blue-950 text-blue-200 border-blue-700/80 shadow-sm',
      badgeClass: 'bg-black/40 text-blue-300',
      iconClass: 'text-blue-400',
    };
  };

  const details = getButtonDetails();

  const handleToggleAllClients = () => {
    if (allClientsChecked) {
      onSelectClients([]);
    } else {
      onSelectClients('ALL');
    }
  };

  const handleToggleClient = (clientId: string) => {
    if (selectedClients === 'ALL') {
      const remaining = clientsList.map((c) => c.id).filter((id) => id !== clientId);
      onSelectClients(remaining);
    } else {
      const current = new Set(selectedClients);
      if (current.has(clientId)) {
        current.delete(clientId);
      } else {
        current.add(clientId);
      }
      const arr = Array.from(current);
      if (arr.length === clientsList.length) {
        onSelectClients('ALL');
      } else {
        onSelectClients(arr);
      }
    }
  };

  const handleSelectOnlyClient = (clientId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectClients([clientId]);
  };

  const handleReset = () => {
    onSelectClients('ALL');
    if (showAdmin) onToggleAdmin();
    setSearchQuery('');
  };

  return (
    <div
      ref={dropdownRef}
      className="relative inline-block text-left shrink-0"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer shadow-xs select-none ${details.btnClass}`}
        title={
          details.label
            ? `Filtered by: ${details.label}`
            : 'Filter by Client & Admin (All Clients & Admins visible)'
        }
      >
        <Building2 className={`size-3 shrink-0 ${details.iconClass}`} />
        {details.label && <span className="font-semibold max-w-[80px] truncate">{details.label}</span>}
        {matchingCount > 0 && (
          <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${details.badgeClass}`}>
            {matchingCount}
          </span>
        )}
        <ChevronDown
          className={`size-3 text-zinc-400 shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-60 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl p-1.5 flex flex-col gap-1 text-zinc-200 z-50 animate-in fade-in zoom-in-95 duration-100">
          {/* Search if > 4 clients */}
          {clientsList.length > 4 && (
            <div className="px-1.5 py-0.5 relative">
              <Search className="size-3 text-zinc-500 absolute left-3.5 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search clients..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-7 pr-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                autoFocus
              />
            </div>
          )}

          {/* Master Options: All Clients & Admin Tasks */}
          <div className="flex flex-col gap-0.5">
            {/* All Clients Option */}
            <button
              type="button"
              onClick={handleToggleAllClients}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                allClientsChecked
                  ? 'bg-blue-600/15 text-blue-200 font-semibold'
                  : 'text-zinc-300 hover:bg-zinc-800/60'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                    allClientsChecked
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'border-zinc-700 bg-zinc-900 text-transparent'
                  }`}
                >
                  <Check className="size-2.5" />
                </div>
                <Building2 className="size-3 text-blue-400 shrink-0" />
                <span className="truncate">All Clients</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800/80 text-zinc-400 shrink-0">
                {totalClientCount}
              </span>
            </button>

            {/* Admin Tasks Option */}
            <button
              type="button"
              onClick={onToggleAdmin}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                showAdmin
                  ? 'bg-purple-950/60 text-purple-200 border border-purple-800/60 font-semibold'
                  : 'text-zinc-400 hover:bg-zinc-800/60'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                    showAdmin
                      ? 'bg-purple-600 border-purple-500 text-white'
                      : 'border-zinc-700 bg-zinc-900 text-transparent'
                  }`}
                >
                  <Check className="size-2.5" />
                </div>
                <Shield className="size-3 text-purple-400 shrink-0" />
                <span className="truncate">Admin Tasks</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-950/80 text-purple-300 border border-purple-800/40 shrink-0">
                {adminCount}
              </span>
            </button>
          </div>

          <div className="h-px bg-zinc-800/80 my-0.5" />

          {/* List of individual clients */}
          <div className="max-h-52 overflow-y-auto custom-scrollbar flex flex-col gap-0.5">
            {filteredClients.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic text-center py-2">
                No clients found
              </p>
            ) : (
              filteredClients.map((client) => {
                const checked = isClientChecked(client.id, client.name);
                return (
                  <div
                    key={client.id}
                    onClick={() => handleToggleClient(client.id)}
                    className={`group w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                      checked
                        ? 'bg-zinc-800/60 text-zinc-100 font-medium'
                        : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          checked
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'border-zinc-700 bg-zinc-900 text-transparent'
                        }`}
                      >
                        <Check className="size-2.5" />
                      </div>
                      <span className="truncate">{client.name}</span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* 'Only' button visible on group hover */}
                      <button
                        type="button"
                        onClick={(e) => handleSelectOnlyClient(client.id, e)}
                        className="opacity-0 group-hover:opacity-100 px-1 py-0.2 text-[9px] text-zinc-400 hover:text-blue-300 hover:bg-blue-950/60 rounded transition-all cursor-pointer"
                        title={`Show only ${client.name}`}
                      >
                        only
                      </button>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800/80 text-zinc-400">
                        {client.count}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Reset button if filtered */}
          {isFiltered && (
            <>
              <div className="h-px bg-zinc-800/80 my-0.5" />
              <button
                type="button"
                onClick={handleReset}
                className="w-full flex items-center justify-center py-1 text-[11px] text-blue-400 hover:text-blue-300 hover:bg-blue-950/40 rounded-md transition-colors cursor-pointer font-medium"
              >
                Reset to All
              </button>
            </>
          )}
        </div>
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
}) => {
  const currentUser = useAppStore((s) => s.currentUser);
  const workspaceUsers = useAppStore((s) => s.workspaceUsers) || [];
  const workspaceTeams = useAppStore((s) => s.workspaceTeams) || [];
  const isPmUser = isProjectManagerOrAdmin(currentUser);

  const [activeDragTask, setActiveDragTask] = useState<TaskMapItem | null>(null);
  const [localShowAdmin, setLocalShowAdmin] = useState(false);
  const [selectedClients, setSelectedClients] = useState<string[] | 'ALL'>('ALL');
  const [columnPriorityFilters, setColumnPriorityFilters] = useState<Record<string, string>>({});
  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<ActionErrorInfo | null>(null);

  const toggleCollapseColumn = (columnId: string) => {
    setCollapsedColumns((prev) => ({
      ...prev,
      [columnId]: !prev[columnId],
    }));
  };

  const handleSelectPriorityFilter = (columnId: string, filter: string) => {
    setColumnPriorityFilters((prev) => ({
      ...prev,
      [columnId]: filter,
    }));
  };

  const effectiveShowAdmin = showAdminTasks !== undefined ? showAdminTasks : localShowAdmin;

  // Helper to check if a task is under Admin folder
  const isTaskUnderAdmin = (task: TaskMapItem) => {
    if (task.isAdminTask) return true;
    const folderName = (task.list?.folder?.name || '').toLowerCase();
    const listName = (task.list?.name || '').toLowerCase();
    return folderName === 'admin' || folderName.includes('admin') || listName === 'admin';
  };

  // Filter tasks by Admin and Client visibility (default: both checked) and strictly only show Pending and Revision statuses
  const displayPool = React.useMemo(() => {
    return availablePool.filter((t) => {
      const s = (t.status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      const mapStatuses = (t.taskMap?.statuses || []).map((x: string) =>
        x.trim().toUpperCase().replace(/[\s_-]+/g, '')
      );
      const isExcluded =
        s === 'WAITING' ||
        s === 'DAILY' ||
        s === 'WEEKLY' ||
        s === 'MONTHLY' ||
        s === 'RECURRING' ||
        !!(t as any)?.recurringConfig ||
        mapStatuses.some((st: string) =>
          ['WAITING', 'DAILY', 'WEEKLY', 'MONTHLY', 'RECURRING'].includes(st)
        );
      if (isExcluded) return false;
      const isPending = s === 'PENDING' || mapStatuses.includes('PENDING');
      const isRevision = s === 'REVISION' || mapStatuses.includes('REVISION');
      if (!isPending && !isRevision) return false;

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
      if (!effectiveShowAdmin && isTaskUnderAdmin(task)) return;
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
    if (!effectiveShowAdmin && isTaskUnderAdmin(task)) return;
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
    .filter(([id]) => {
      // If Custom shift is selected and specific MAs are chosen, filter by them
      if (currentShift === 'CUSTOM' && selectedCustomMAs.length > 0) {
        return selectedCustomMAs.includes(id);
      }
      return true;
    })
    .sort(([idA, colA], [idB, colB]) => {
      const isCurA = isCurrentViewer(colA.user);
      const isCurB = isCurrentViewer(colB.user);

      if (isCurA && !isCurB) return -1;
      if (!isCurA && isCurB) return 1;

      return (colA.user.name || '').localeCompare(colB.user.name || '', undefined, { sensitivity: 'base' });
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
      const targetUser = getUserProfile(targetUserId);
      const draggedTask =
        (active.data.current?.task as TaskMapItem) ||
        tasks.find((t) => t.id === taskId) ||
        availablePool.find((t) => t.id === taskId);
      const requiredRoles = draggedTask?.assigneeRoleRestrictions || [];

      // Validate required role restrictions matching TaskDetailModal
      if (requiredRoles.length > 0 && targetUser?.systemRole !== 'ADMIN') {
        const isFit =
          resolveUsersFromRoleRestrictions(requiredRoles, [targetUser], workspaceTeams).length > 0;
        if (!isFit) {
          const userName = targetUser?.name || 'This user';
          const rolesStr = requiredRoles.join(', ');
          toast.error(`${userName} is not fit for this task (requires role: ${rolesStr})`);
          setActionError({
            title: 'Invalid Task Assignment',
            action: `Assigning "${draggedTask?.title || 'task'}" to ${userName}`,
            message: `${userName} is not fit for this task. This task requires a team member with the role: ${rolesStr}.`,
            troubleshooting: [
              `Assign this task to a team member qualified with the "${rolesStr}" role.`,
              `Or update the task's team role restrictions if ${userName} should handle it.`,
            ],
          });
          return;
        }
      }

      try {
        await taskMapApi.assignTask(taskId, targetUserId);
        toast.success(`Task assigned to ${targetUser.name || 'user'}`);
        onDataRefresh();
      } catch (err: any) {
        toast.error(err.message || 'Failed to assign task');
        if (err.message && err.message.includes('not fit for the task')) {
          const userName = targetUser?.name || 'User';
          const rolesStr = (draggedTask?.assigneeRoleRestrictions || []).join(', ');
          setActionError({
            title: 'Invalid Task Assignment',
            action: `Assigning "${draggedTask?.title || 'task'}" to ${userName}`,
            message: err.message,
            troubleshooting: [
              `Assign this task to a team member qualified with the "${rolesStr}" role.`,
              `Or update the task's team role restrictions if ${userName} should handle it.`,
            ],
          });
        }
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

  // Unified Status Presets: pure statuses only (no Upwork, no PM names)
  const getUnifiedTaskMapOptions = (task: TaskMapItem, _user?: any): TaskMapOption[] => {
    const list: TaskMapOption[] = [
      { id: 'opt-status-avail', label: 'Available Task', color: '#1d4ed8', textColor: '#ffffff', order: 0 },
      { id: 'opt-status-sent', label: 'Sent', color: '#15803d', textColor: '#ffffff', order: 1 },
      { id: 'opt-status-tosend', label: 'To send', color: '#b91c1c', textColor: '#ffffff', order: 2 },
      { id: 'opt-status-followup', label: 'Follow up', color: '#fbcfe8', textColor: '#831843', order: 3 },
      { id: 'opt-status-donereview', label: 'Done Review', color: '#99f6e4', textColor: '#134e4a', order: 4 },
      { id: 'opt-status-revision', label: 'Revision', color: '#e9d5ff', textColor: '#581c87', order: 5 },
      { id: 'opt-status-inprog', label: 'In progress', color: '#ca8a04', textColor: '#fef08a', order: 6 },
      { id: 'opt-status-notstarted', label: 'Not started', color: '#52525b', textColor: '#f4f4f5', order: 7 },
      { id: 'opt-status-done', label: 'Done', color: '#166534', textColor: '#dcfce7', order: 8 },
      { id: 'opt-status-toreview', label: 'To review', color: '#1d4ed8', textColor: '#dbeafe', order: 9 },
      { id: 'opt-status-handedover', label: 'Handed-over/Ready for Next Steps', color: '#e9d5ff', textColor: '#581c87', order: 10 },
    ];

    // Ensure any currently selected statuses on this task are also present so user can toggle them off
    (task.taskMap.statuses || []).forEach((st: string) => {
      const up = (st || '').toUpperCase().trim();
      const isUpwork = up.startsWith('UPWORK');
      const isPmName = up === 'CHE' || up === 'PAU' || up === 'HAN' || up.includes('PM');
      const isUrgent = up === 'URGENT';
      if (!isUpwork && !isPmName && !isUrgent && !list.some((o) => o.label.toLowerCase() === st.toLowerCase())) {
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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-5 px-6 pb-6 overflow-x-auto custom-scrollbar h-full min-h-[480px] select-none">
        {/* 1. Available Tasks Pool Column (Matches Image 1) */}
        {(() => {
          const isCollapsed = !!collapsedColumns['available'];
          const availableFilter = columnPriorityFilters['available'] || 'ALL';
          const filteredDisplayPool = displayPool.filter((t) =>
            matchesPriorityFilter(t, availableFilter)
          );

          if (isCollapsed) {
            return (
              <DroppableColumn
                key="available-pool-collapsed"
                id="available-pool"
                className="w-12 shrink-0 flex flex-col items-center py-4 bg-card/90 border border-border rounded-2xl shadow-xl h-[calc(100vh-140px)] transition-all cursor-pointer hover:border-blue-500/50"
              >
                <button
                  type="button"
                  onClick={() => toggleCollapseColumn('available')}
                  className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/60 mb-3 cursor-pointer"
                  title="Expand Available tasks"
                >
                  <ChevronRight className="size-4 text-blue-400" />
                </button>
                <span className="size-2.5 rounded-full bg-[#0099ff] mb-2 shrink-0" />
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 mb-4">
                  {displayPool.length}
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

          return (
            <DroppableColumn
              id="available-pool"
              className="w-[370px] shrink-0 flex flex-col bg-card/90 border border-border rounded-2xl p-4 shadow-xl h-[calc(100vh-140px)]"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-2 border-b border-border mb-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => toggleCollapseColumn('available')}
                    className="p-1 -ml-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-md cursor-pointer transition-colors"
                    title="Collapse column"
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>
                  <span className="size-2 rounded-full bg-[#0099ff] shrink-0" />
                  <h3 className="text-sm font-bold text-zinc-100 truncate">Available tasks</h3>
                </div>

                {/* Top Right: Filter for Client & Admin tasks & Priority dropdown */}
                <div className="flex items-center gap-1.5 shrink-0">
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
                </div>
              </div>

              <p className="text-xs text-zinc-400 mb-2.5 leading-relaxed">
                Revision and pending tasks waiting for Project Manager assignment.
              </p>

              {/* Cards List */}
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1">
                {filteredDisplayPool.length === 0 ? (
                  <p className="text-xs text-zinc-600 italic text-center py-12">
                    {displayPool.length > 0
                      ? 'No tasks match the selected priority filter.'
                      : 'No revision or pending tasks in the pool.'}
                  </p>
                ) : (
                  sortColumnTasks(filteredDisplayPool).map((task) => {
                    const priorityConfig = getPriorityConfig(task.priority);
                    const isClosed =
                      (task.status || '').toUpperCase() === 'CLOSED' ||
                      (task.status || '').toUpperCase() === 'DONE';

                    return (
                      <DraggableTaskCard
                        key={task.id}
                        task={task}
                        disabled={!isPmUser}
                      >
                        <div className="p-3 bg-zinc-900 border border-border hover:border-zinc-700 rounded-xl shadow-md min-h-[94px] flex items-stretch gap-3 transition-all group">
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
                              <span
                                className="shrink-0 flex items-center"
                                title={task.status || 'In progress'}
                              >
                                {isClosed ? (
                                  <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                                ) : (task.status || '').toUpperCase() === 'KYC' ? (
                                  <CustomCircleDotted className="size-3.5 text-emerald-600 shrink-0" />
                                ) : (
                                  <CustomCircleDot
                                    className="size-3.5 shrink-0"
                                    style={{ color: getDotColor(task.status) }}
                                  />
                                )}
                              </span>

                              {/* Bulletin Icon - click shows task description */}
                              <TaskDescriptionButton
                                description={task.description}
                                taskTitle={task.title}
                              />

                              {/* Priority Flag and Label */}
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
                                selectedStatuses={task.taskMap.statuses || []}
                                options={getUnifiedTaskMapOptions(task)}
                                onToggleStatus={(label, nextStatuses) => {
                                  const next =
                                    nextStatuses ||
                                    ((task.taskMap.statuses || []).includes(label)
                                      ? (task.taskMap.statuses || []).filter(
                                          (s) => s !== label
                                        )
                                      : [...(task.taskMap.statuses || []), label]);
                                  onStatusChange(task.id, next);
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
        })()}

        {/* 2. User Shift Columns (Matches Image 1 & 4) */}
        {sortedUserColumns.map(([userId, { user, tasks: userTasks }]) => {
          const initials = (user.name || 'U').substring(0, 2).toUpperCase();
          const avatarBg = getAssigneeAvatarColor(user.name || 'U');
          const isCollapsed = !!collapsedColumns[userId];
          const userFilter = columnPriorityFilters[userId] || 'ALL';
          const filteredUserTasks = userTasks.filter((t) =>
            matchesPriorityFilter(t, userFilter)
          );

          if (isCollapsed) {
            return (
              <DroppableColumn
                key={userId}
                id={`user-${userId}`}
                className="w-12 shrink-0 flex flex-col items-center py-4 bg-card/90 border border-zinc-800/80 rounded-2xl shadow-xl h-[calc(100vh-140px)] transition-all cursor-pointer hover:border-zinc-700"
              >
                <button
                  type="button"
                  onClick={() => toggleCollapseColumn(userId)}
                  className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/60 mb-3 cursor-pointer"
                  title={`Expand ${user.name}`}
                >
                  <ChevronRight className="size-4 text-zinc-400" />
                </button>
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
              className="w-[370px] shrink-0 flex flex-col bg-card/90 border border-zinc-800/80 rounded-2xl p-4 shadow-xl h-[calc(100vh-140px)]"
            >
              {/* User Column Header */}
              {(() => {
                const roleInfo = getUserRolePriority(user.roles || [], user.isAudit);

                return (
                  <div className="flex items-center justify-between pb-2.5 border-b border-zinc-800/70 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => toggleCollapseColumn(userId)}
                        className="p-1 -ml-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 rounded-md cursor-pointer transition-colors"
                        title="Collapse column"
                      >
                        <ChevronLeft className="size-3.5" />
                      </button>
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
                    <div className="shrink-0">
                      <ColumnPriorityDropdown
                        columnId={userId}
                        tasks={userTasks}
                        activeFilter={userFilter}
                        onSelectFilter={handleSelectPriorityFilter}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Tasks in Step Order */}
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1">
                {filteredUserTasks.length === 0 ? (
                  <p className="text-xs text-zinc-600 italic text-center py-12">
                    {userTasks.length > 0
                      ? 'No tasks match the selected priority filter.'
                      : 'No tasks assigned for this shift.'}
                  </p>
                ) : (
                  sortColumnTasks(filteredUserTasks).map((task) => {
                    const priorityConfig = getPriorityConfig(task.priority);
                    const isClosed =
                      (task.status || '').toUpperCase() === 'CLOSED' ||
                      (task.status || '').toUpperCase() === 'DONE';

                    return (
                      <DraggableTaskCard key={task.id} task={task} disabled={!isPmUser}>
                        <div className="p-3 bg-zinc-900 border border-zinc-800/90 hover:border-zinc-700 rounded-xl shadow-sm min-h-[94px] flex items-stretch gap-3 transition-all group">
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
                              <span
                                className="shrink-0 flex items-center"
                                title={task.status || 'In progress'}
                              >
                                {isClosed ? (
                                  <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                                ) : (task.status || '').toUpperCase() === 'KYC' ? (
                                  <CustomCircleDotted className="size-3.5 text-emerald-600 shrink-0" />
                                ) : (
                                  <CustomCircleDot
                                    className="size-3.5 shrink-0"
                                    style={{ color: getDotColor(task.status) }}
                                  />
                                )}
                              </span>

                              {/* Bulletin Icon - click shows task description */}
                              <TaskDescriptionButton
                                description={task.description}
                                taskTitle={task.title}
                              />

                              {/* Priority Flag and Label */}
                              <span className="flex items-center gap-1 font-medium text-[11px]">
                                <Flag className={`size-3 ${priorityConfig.iconColor}`} />
                                <span className={priorityConfig.color}>
                                  {priorityConfig.label}
                                </span>
                              </span>
                            </div>
                          </div>

                          {/* SEPARATOR: Vertical line between task info and statuses */}
                          <div className="w-px bg-zinc-800/80 self-stretch my-0.5 shrink-0" />

                          {/* RIGHT: Section where Sub-Status is (with Posted date in top right corner) */}
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
                                selectedStatuses={task.taskMap.statuses || []}
                                options={getUnifiedTaskMapOptions(task, user)}
                                onToggleStatus={(label, nextStatuses) => {
                                  const next =
                                    nextStatuses ||
                                    ((task.taskMap.statuses || []).includes(label)
                                      ? (task.taskMap.statuses || []).filter(
                                          (s) => s !== label
                                        )
                                      : [...(task.taskMap.statuses || []), label]);
                                  onStatusChange(task.id, next);
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
            <div className="w-[340px] rotate-2 scale-105 p-3 bg-card border border-blue-500/80 rounded-xl shadow-2xl shadow-black/80 ring-1 ring-blue-500/50 flex items-stretch gap-3 pointer-events-none cursor-grabbing">
              {/* Left: Task Info */}
              <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                <div className="text-[11px] font-medium text-zinc-400 truncate max-w-[190px] mb-1">
                  {activeDragTask.list?.name || 'General'}
                </div>
                <h4 className="text-[13px] font-bold text-white line-clamp-2 leading-snug my-0.5">
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
                  <span className="text-[10px] font-medium text-zinc-500">
                    Posted {format(new Date(activeDragTask.createdAt), 'MMM d')}
                  </span>
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
