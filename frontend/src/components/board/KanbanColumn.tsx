import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, MoreHorizontal, Archive, Trash2, Link2, Hash, ExternalLink, Star, Edit2, Bell, Clock, ArrowRight, Merge, Copy, RefreshCw, LayoutTemplate, Share2, Target, Play, Mail, Lock } from 'lucide-react';
import { Task } from '@/lib/types';
import { ActionMenu } from '../ui/ActionMenu';
import { KanbanCard } from './KanbanCard';
import { EditColumnModal } from '../modals/EditColumnModal';

interface Props {
  status: string;
  tasks: Task[];
  isCollapsed: boolean;
  collapsedGroupCount?: number;
  isCollapsedGroupLeader?: boolean;
  onToggleCollapse: () => void;
  customTheme?: string;
  onThemeChange?: (themeId: string) => void;
  onAddTaskClick?: (status: string) => void;
  onTaskClick?: (task: Task) => void;
  allowedRoles?: string[];
  onRoleChange?: (allowedRoles: string[]) => void;
  onUpdateColumn?: (status: string, data: { name?: string; color?: string; allowedRoles?: string[] }) => Promise<void> | void;
  roleMap?: Record<string, string>;
  onRename?: (newName: string) => void;
  isColumnRestrictedForUser?: boolean;
  columnRestrictionReason?: string;
}

const STATUS_LABELS: Record<string, string> = {
  KYC: 'KYC',
  'Pin Board': 'Pin Board',
  PIN_BOARD: 'Pin Board',
  
  Daily: 'Daily',
  Weekly: 'Weekly',
  Monthly: 'Monthly',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',

  Pending: 'Pending',
  PENDING: 'Pending',
  'In Progress': 'In Progress',
  IN_PROGRESS: 'In Progress',
  Revision: 'Revision',
  REVISION: 'Revision',
  Waiting: 'Waiting',
  WAITING: 'Waiting',
  'In Review': 'In Review',
  IN_REVIEW: 'In Review',
  Checking: 'Checking',
  CHECKING: 'Checking',
  'On-Hold': 'On-Hold',
  ON_HOLD: 'On-Hold',
  Closed: 'Closed',
  CLOSED: 'Closed',

  TODO: 'To Do',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

export const THEMES: Record<string, { badge: string; bg: string; text: string; scrollThumb: string }> = {
  cyan: { badge: 'bg-cyan-500 text-black', bg: 'bg-cyan-500/10', text: 'text-cyan-400', scrollThumb: '[&::-webkit-scrollbar-thumb]:bg-cyan-500/30 hover:[&::-webkit-scrollbar-thumb]:bg-cyan-500/50' },
  blue: { badge: 'bg-blue-500 text-white', bg: 'bg-blue-500/10', text: 'text-blue-400', scrollThumb: '[&::-webkit-scrollbar-thumb]:bg-blue-500/30 hover:[&::-webkit-scrollbar-thumb]:bg-blue-500/50' },
  indigo: { badge: 'bg-indigo-500 text-white', bg: 'bg-indigo-500/10', text: 'text-indigo-400', scrollThumb: '[&::-webkit-scrollbar-thumb]:bg-indigo-500/30 hover:[&::-webkit-scrollbar-thumb]:bg-indigo-500/50' },
  violet: { badge: 'bg-violet-500 text-white', bg: 'bg-violet-500/10', text: 'text-violet-400', scrollThumb: '[&::-webkit-scrollbar-thumb]:bg-violet-500/30 hover:[&::-webkit-scrollbar-thumb]:bg-violet-500/50' },
  purple: { badge: 'bg-purple-500 text-white', bg: 'bg-purple-500/10', text: 'text-purple-400', scrollThumb: '[&::-webkit-scrollbar-thumb]:bg-purple-500/30 hover:[&::-webkit-scrollbar-thumb]:bg-purple-500/50' },
  teal: { badge: 'bg-[#00a884] text-black', bg: 'bg-teal-500/10', text: 'text-teal-400', scrollThumb: '[&::-webkit-scrollbar-thumb]:bg-teal-500/30 hover:[&::-webkit-scrollbar-thumb]:bg-teal-500/50' },
  emerald: { badge: 'bg-emerald-500 text-white', bg: 'bg-emerald-500/10', text: 'text-emerald-400', scrollThumb: '[&::-webkit-scrollbar-thumb]:bg-emerald-500/30 hover:[&::-webkit-scrollbar-thumb]:bg-emerald-500/50' },
  amber: { badge: 'bg-amber-500 text-black', bg: 'bg-amber-500/10', text: 'text-amber-400', scrollThumb: '[&::-webkit-scrollbar-thumb]:bg-amber-500/30 hover:[&::-webkit-scrollbar-thumb]:bg-amber-500/50' },
  orange: { badge: 'bg-orange-500 text-white', bg: 'bg-orange-500/10', text: 'text-orange-400', scrollThumb: '[&::-webkit-scrollbar-thumb]:bg-orange-500/30 hover:[&::-webkit-scrollbar-thumb]:bg-orange-500/50' },
  rose: { badge: 'bg-rose-500 text-white', bg: 'bg-rose-500/10', text: 'text-rose-400', scrollThumb: '[&::-webkit-scrollbar-thumb]:bg-rose-500/30 hover:[&::-webkit-scrollbar-thumb]:bg-rose-500/50' },
  zinc: { badge: 'bg-zinc-500 text-white', bg: 'bg-zinc-500/10', text: 'text-zinc-400', scrollThumb: '[&::-webkit-scrollbar-thumb]:bg-zinc-500/30 hover:[&::-webkit-scrollbar-thumb]:bg-zinc-500/50' },
};

const DEFAULT_STATUS_THEMES: Record<string, string> = {
  KYC: 'cyan',
  'Pin Board': 'blue',
  PIN_BOARD: 'blue',

  Daily: 'purple',
  Weekly: 'indigo',
  Monthly: 'violet',
  DAILY: 'purple',
  WEEKLY: 'indigo',
  MONTHLY: 'violet',

  Pending: 'amber',
  PENDING: 'amber',
  'In Progress': 'blue',
  IN_PROGRESS: 'blue',
  Revision: 'rose',
  REVISION: 'rose',
  Waiting: 'orange',
  WAITING: 'orange',
  'In Review': 'purple',
  IN_REVIEW: 'purple',
  Checking: 'teal',
  CHECKING: 'teal',
  'On-Hold': 'zinc',
  ON_HOLD: 'zinc',
  Closed: 'emerald',
  CLOSED: 'emerald',

  TODO: 'teal',
  DONE: 'emerald',
  CANCELLED: 'rose',
};

const getStatusTheme = (status: string, customTheme?: string) => {
  if (customTheme && THEMES[customTheme]) return THEMES[customTheme];
  const defaultThemeId = DEFAULT_STATUS_THEMES[status] || 'zinc';
  return THEMES[defaultThemeId];
};

export function KanbanColumn({
  status,
  tasks,
  isCollapsed,
  collapsedGroupCount,
  isCollapsedGroupLeader,
  onToggleCollapse,
  customTheme,
  onThemeChange,
  onAddTaskClick,
  onTaskClick,
  allowedRoles = [],
  onRoleChange,
  onUpdateColumn,
  roleMap = {},
  onRename,
  isColumnRestrictedForUser = false,
  columnRestrictionReason,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: {
      type: 'Column',
      status,
    },
  });

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const label = STATUS_LABELS[status] || status;
  const colors = getStatusTheme(status, customTheme);
  
  const displayRoles = allowedRoles.map((r) => roleMap[r] || r);

  if (isCollapsed && collapsedGroupCount && collapsedGroupCount > 1) {
    if (isCollapsedGroupLeader) {
       return (
          <div className="flex flex-col flex-shrink-0 transition-all duration-300 ease-in-out relative hover:z-50 focus-within:z-50 overflow-hidden w-11 h-full bg-[#e3e4e4] dark:bg-zinc-800 rounded-2xl border border-zinc-300 dark:border-zinc-700">
             <button 
                className="absolute inset-0 flex flex-col items-center py-6 gap-3 transition-opacity duration-300 opacity-100 z-10 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 text-zinc-500 dark:text-zinc-400"
                onClick={onToggleCollapse}
                title={`Expand ${collapsedGroupCount} columns`}
             >
                <div className="text-xl leading-none shrink-0 opacity-80" style={{ transform: 'rotate(-90deg)' }}>
                  »
                </div>
                <span 
                   style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }} 
                   className="text-[13px] font-semibold tracking-wide whitespace-nowrap"
                >
                   {collapsedGroupCount} collapsed
                </span>
             </button>
          </div>
       );
    } else {
       return (
          <div className="flex flex-col flex-shrink-0 transition-all duration-300 ease-in-out overflow-hidden w-0 h-full p-0 m-0 border-none opacity-0 pointer-events-none" />
       );
    }
  }

  return (
    <div 
      className={`flex flex-col flex-shrink-0 transition-all duration-300 ease-in-out relative hover:z-50 focus-within:z-50 overflow-hidden ${
        isCollapsed 
          ? `w-11 h-full bg-[#141418] rounded-2xl border border-zinc-800/50` 
          : `w-[350px] max-h-full rounded-2xl ${colors.bg} border border-zinc-800/50`
      }`}
    >
      {/* ── COLLAPSED VIEW ── */}
      <button 
        className={`absolute inset-0 flex flex-col items-center py-4 gap-4 transition-opacity duration-300 ${isCollapsed ? 'opacity-100 z-10 cursor-pointer hover:brightness-125' : 'opacity-0 pointer-events-none'}`}
        onClick={onToggleCollapse}
        title={`Expand ${label}${displayRoles.length > 0 ? ` (Restricted to: ${displayRoles.join(', ')})` : ''}`}
      >
        <div className={`flex flex-col items-center rounded-full py-3 w-8 gap-3 shadow-sm ${colors.badge} h-32 shrink-0 relative`}>
          <div className="w-3.5 h-3.5 rounded-full border-2 border-current relative opacity-80 shrink-0">
            <div className="absolute inset-0 m-auto w-1 h-1 bg-current rounded-full" />
          </div>
          <span 
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }} 
            className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap"
          >
            {label}
          </span>
          {displayRoles.length > 0 && (
            <div className="mt-auto mb-1 p-1 bg-black/40 rounded-full text-amber-400" title={`Restricted to: ${displayRoles.join(', ')}`}>
              <Lock className="w-2.5 h-2.5" />
            </div>
          )}
        </div>
        <span className={`text-sm font-bold ${colors.text} shrink-0`}>
          {tasks.length}
        </span>
      </button>

      {/* ── EXPANDED VIEW ── */}
      <div className={`flex flex-col flex-1 min-h-0 transition-opacity duration-300 min-w-[350px] ${isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="flex flex-col px-3 pt-3 pb-2 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0 pr-1">
              <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 shrink-0 ${colors.badge}`}>
                <div className="w-2 h-2 rounded-full bg-black/70" />
                {label}
              </span>

              {displayRoles.length > 0 && (
                <span 
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-xs shrink-0"
                  title={`Restricted to: ${displayRoles.join(', ')} (Only these roles and Admins can move tasks out of this column)`}
                >
                  <Lock className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                  <span className="truncate max-w-[120px]">{displayRoles.join(', ')}</span>
                </span>
              )}

              <span className={`${colors.text} text-sm font-semibold ml-0.5 shrink-0`}>
                {tasks.length}
              </span>
            </div>
            
            <div className={`flex items-center gap-1 ${colors.text} shrink-0`}>
              <button 
                className="p-1 hover:bg-black/5 rounded transition-colors cursor-pointer"
                onClick={onToggleCollapse}
                title="Collapse column"
              >
                <span className="text-lg leading-none select-none -mt-1 block">‹</span>
              </button>
              <button 
                onClick={() => setIsEditModalOpen(true)}
                className="p-1 hover:bg-black/5 rounded transition-colors cursor-pointer"
                title="Edit column settings"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              <button 
                onClick={() => onAddTaskClick?.(status)}
                className="p-1 hover:bg-black/5 rounded transition-colors cursor-pointer"
                title="Add task"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div
          ref={setNodeRef}
          className={`px-2 pb-2 flex flex-col gap-2 overflow-y-auto transition-colors custom-scrollbar ${colors.scrollThumb} flex-1 min-h-0 ${
            isOver ? 'bg-black/5' : ''
          }`}
        >
          <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
            {tasks.map((task) => (
              <KanbanCard
                key={task.id}
                task={task}
                onClick={onTaskClick}
                isMoveDisabled={isColumnRestrictedForUser}
                moveLockReason={columnRestrictionReason}
              />
            ))}
          </SortableContext>
          
          <button 
            onClick={() => onAddTaskClick?.(status)}
            className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1.5 hover:bg-zinc-800/30 rounded mt-1 group"
          >
            <Plus className="w-4 h-4 opacity-70 group-hover:opacity-100" />
            <span className="text-xs font-medium">Add Task</span>
          </button>
        </div>
      </div>
      
      <EditColumnModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        status={label}
        theme={customTheme || Object.keys(THEMES).find(t => THEMES[t] === colors) || DEFAULT_STATUS_THEMES[status] || 'zinc'}
        allowedRoles={allowedRoles}
        onSave={async (data) => {
          if (onUpdateColumn) {
            await onUpdateColumn(status, data);
          } else {
            if (data.name && onRename) onRename(data.name);
            if (data.color && onThemeChange) onThemeChange(data.color);
            if (onRoleChange && data.allowedRoles) onRoleChange(data.allowedRoles);
          }
        }}
        onRename={onRename}
        onRoleChange={onRoleChange}
        onThemeChange={onThemeChange}
        onDelete={() => console.log('Delete column:', status)}
      />
    </div>
  );
}
