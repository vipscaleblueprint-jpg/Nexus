import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, MoreHorizontal, Archive, Trash2, Link2, Hash, ExternalLink, Star, Edit2, Bell, Clock, ArrowRight, Merge, Copy, RefreshCw, LayoutTemplate, Share2, Target, Play, Mail } from 'lucide-react';
import { Task } from '@/lib/types';
import { ActionMenu } from '../ui/ActionMenu';
import { KanbanCard } from './KanbanCard';

interface Props {
  status: string;
  tasks: Task[];
  customTheme?: string;
  onThemeChange?: (themeId: string) => void;
  onAddTaskClick?: (status: string) => void;
  onTaskClick?: (task: Task) => void;
}

const STATUS_LABELS: Record<string, string> = {
  // Client Details
  KYC: 'KYC',
  'Pin Board': 'Pin Board',
  PIN_BOARD: 'Pin Board',
  
  // Recurring
  Daily: 'Daily',
  Weekly: 'Weekly',
  Monthly: 'Monthly',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',

  // Workflow & Progress
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

  // Fallbacks
  TODO: 'To Do',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

const THEMES: Record<string, { badge: string; bg: string; text: string }> = {
  cyan: { badge: 'bg-cyan-500 text-black', bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
  blue: { badge: 'bg-blue-500 text-white', bg: 'bg-blue-500/10', text: 'text-blue-400' },
  indigo: { badge: 'bg-indigo-500 text-white', bg: 'bg-indigo-500/10', text: 'text-indigo-400' },
  violet: { badge: 'bg-violet-500 text-white', bg: 'bg-violet-500/10', text: 'text-violet-400' },
  purple: { badge: 'bg-purple-500 text-white', bg: 'bg-purple-500/10', text: 'text-purple-400' },
  teal: { badge: 'bg-[#00a884] text-black', bg: 'bg-teal-500/10', text: 'text-teal-400' },
  emerald: { badge: 'bg-emerald-500 text-white', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  amber: { badge: 'bg-amber-500 text-black', bg: 'bg-amber-500/10', text: 'text-amber-400' },
  orange: { badge: 'bg-orange-500 text-white', bg: 'bg-orange-500/10', text: 'text-orange-400' },
  rose: { badge: 'bg-rose-500 text-white', bg: 'bg-rose-500/10', text: 'text-rose-400' },
  zinc: { badge: 'bg-zinc-500 text-white', bg: 'bg-zinc-500/10', text: 'text-zinc-400' },
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

export function KanbanColumn({ status, tasks, customTheme, onThemeChange, onAddTaskClick, onTaskClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: {
      type: 'Column',
      status,
    },
  });

  const label = STATUS_LABELS[status] || status;
  const colors = getStatusTheme(status, customTheme);

  return (
    <div 
      className={`flex flex-col flex-shrink-0 w-[350px] max-h-[calc(100vh-180px)] rounded-2xl ${colors.bg} transition-colors border border-zinc-800/50 relative hover:z-50 focus-within:z-50`}
    >
      <div className="flex flex-col px-3 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${colors.badge}`}>
              <div className="w-2 h-2 rounded-full bg-black/70" />
              {label}
            </span>
            <span className={`${colors.text} text-sm font-semibold ml-1`}>
              {tasks.length}
            </span>
          </div>
          
          <div className={`flex items-center gap-1 ${colors.text}`}>
            <button className="p-1 hover:bg-black/5 rounded transition-colors">
              <span className="text-lg leading-none select-none -mt-1 block">‹</span>
            </button>
            <ActionMenu icon={<MoreHorizontal className="w-4 h-4" />} width="w-56">
              <div className="flex px-1 gap-1 border-b border-zinc-700/50 pb-1 mb-1">
                <button className="flex-1 flex justify-center py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs transition-colors"><Link2 className="w-3.5 h-3.5" /></button>
                <button className="flex-1 flex justify-center py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs transition-colors"><Hash className="w-3.5 h-3.5" /></button>
                <button className="flex-1 flex justify-center py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs transition-colors"><ExternalLink className="w-3.5 h-3.5" /></button>
              </div>
              <div className="px-1 space-y-0.5">
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs text-left transition-colors"><Star className="w-3.5 h-3.5" /> Favorite</button>
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs text-left transition-colors"><Edit2 className="w-3.5 h-3.5" /> Rename</button>
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs text-left transition-colors"><Bell className="w-3.5 h-3.5" /> Follow task</button>
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs text-left transition-colors"><Clock className="w-3.5 h-3.5" /> Remind me</button>
              </div>
              <div className="border-t border-zinc-700/50 my-1"></div>
              <div className="px-1 space-y-0.5">
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs text-left transition-colors"><ArrowRight className="w-3.5 h-3.5" /> Move to</button>
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs text-left transition-colors"><Plus className="w-3.5 h-3.5" /> Add to</button>
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs text-left transition-colors"><Merge className="w-3.5 h-3.5" /> Merge</button>
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs text-left transition-colors"><Copy className="w-3.5 h-3.5" /> Duplicate</button>
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs text-left transition-colors"><RefreshCw className="w-3.5 h-3.5" /> Convert to</button>
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs text-left transition-colors"><LayoutTemplate className="w-3.5 h-3.5" /> Templates</button>
              </div>
              <div className="border-t border-zinc-700/50 my-1"></div>
              <div className="px-1 space-y-0.5">
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs text-left transition-colors"><Share2 className="w-3.5 h-3.5" /> Relationships</button>
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs text-left transition-colors"><Target className="w-3.5 h-3.5" /> Task Type</button>
              </div>
              <div className="border-t border-zinc-700/50 my-1"></div>
              <div className="px-1 space-y-0.5">
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs text-left transition-colors"><Play className="w-3.5 h-3.5" /> Start timer</button>
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700 rounded text-zinc-300 text-xs text-left transition-colors"><Mail className="w-3.5 h-3.5" /> Send email to task</button>
              </div>
              <div className="border-t border-zinc-700/50 my-1"></div>
              <div className="px-1 space-y-0.5">
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white text-xs text-left transition-colors"><Archive className="w-3.5 h-3.5" /> Archive</button>
                <button className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300 text-xs text-left transition-colors"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
              </div>
              <div className="border-t border-zinc-700/50 my-1"></div>
              <div className="px-2 py-1.5 flex items-center justify-between">
                <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider">Color</span>
                <div className="flex gap-1">
                  {Object.keys(THEMES).map((t) => (
                    <button 
                      key={t} 
                      onClick={() => onThemeChange?.(t)}
                      className={`w-3.5 h-3.5 rounded-full ${THEMES[t].badge.split(' ')[0]} ${
                        (customTheme === t || (!customTheme && DEFAULT_STATUS_THEMES[status] === t)) 
                          ? 'ring-2 ring-zinc-300 ring-offset-1 ring-offset-zinc-800' 
                          : 'opacity-70 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </ActionMenu>
            <button className="p-1 hover:bg-black/5 rounded transition-colors" onClick={() => onAddTaskClick?.(status)}>
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`px-2 pb-2 flex flex-col gap-2 overflow-y-auto transition-colors custom-scrollbar ${
          isOver ? 'bg-black/5' : ''
        }`}
      >
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <KanbanCard key={task.id} task={task} onClick={onTaskClick} />
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
  );
}
