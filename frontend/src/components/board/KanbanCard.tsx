import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task } from '@/lib/types';
import { CheckSquare, Calendar, User, Flag, GripVertical, AlignLeft, CircleDashed } from 'lucide-react';

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-zinc-400 bg-zinc-800',
  MEDIUM: 'text-blue-400 bg-blue-500/20',
  HIGH: 'text-orange-400 bg-orange-500/20',
  URGENT: 'text-red-400 bg-red-500/20',
};

interface Props {
  task: Task;
  isOverlay?: boolean;
  onClick?: (task: Task) => void;
}

export function KanbanCard({ task, isOverlay, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: {
      type: 'Task',
      task,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="bg-zinc-800/60 rounded-xl p-3.5 border border-transparent shadow-none"
      >
        <div className="opacity-0 pointer-events-none flex flex-col gap-3">
          <div className="pr-6">
            <h4 className="text-[13px] font-semibold text-zinc-200 mb-0.5 leading-tight">
              {task.title}
            </h4>
            <p className="text-[11px] text-zinc-500">
              In {task.listId || 'List'}
            </p>
          </div>
          <div className="flex flex-col gap-2.5 mt-1">
            <div className="flex items-center gap-2 text-[12px]"><AlignLeft className="w-3.5 h-3.5" /></div>
            <div className="flex items-center gap-2 text-[12px]"><User className="w-3.5 h-3.5" /></div>
            <div className="flex items-center gap-2 text-[12px]"><Calendar className="w-3.5 h-3.5" /></div>
            <div className="flex items-center gap-2 text-[12px]"><Flag className="w-3.5 h-3.5" /></div>
            <div className="flex items-center gap-2 text-[12px]"><CircleDashed className="w-3.5 h-3.5" /></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick && onClick(task)}
      className={`bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 rounded-xl p-3.5 group relative shadow-sm cursor-grab active:cursor-grabbing flex flex-col gap-3 transition-all duration-300 ease-out hover:scale-[1.01] hover:shadow-lg hover:shadow-black/20 ${
        isOverlay ? 'rotate-2 scale-105 shadow-xl shadow-black/40 cursor-grabbing' : ''
      }`}
    >
      <div className="pr-6">
        <h4 className="text-[13px] font-semibold text-zinc-200 mb-0.5 truncate leading-tight">
          {task.title}
        </h4>
        <p className="text-[11px] text-zinc-500">
          In {task.listId || 'List'}
        </p>
      </div>

      <div className="flex flex-col gap-2.5 mt-1">
        <div className="flex items-center gap-2 text-[12px] text-zinc-500">
          <AlignLeft className="w-3.5 h-3.5" />
        </div>

        <div className="flex items-center gap-2 text-[12px] text-zinc-500">
          <User className="w-3.5 h-3.5" />
          <span>{task.assignee ? task.assignee.name : '-'}</span>
        </div>

        <div className="flex items-center gap-2 text-[12px] text-zinc-500">
          <Calendar className="w-3.5 h-3.5" />
          <span>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '-'}</span>
        </div>

        <div className="flex items-center gap-2 text-[12px] text-zinc-500">
          <Flag className="w-3.5 h-3.5" />
          <span className={task.priority ? PRIORITY_COLORS[task.priority] : ''}>
            {task.priority || '-'}
          </span>
        </div>

        <div className="flex items-center gap-2 text-[12px] text-zinc-400 font-medium">
          <CircleDashed className="w-3.5 h-3.5" />
          <span>{task.status || 'Status'}</span>
        </div>
      </div>
    </div>
  );
}
