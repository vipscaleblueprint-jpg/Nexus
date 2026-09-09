import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task } from '@/lib/types';
import { CheckSquare, Calendar, User, Flag, GripVertical, AlignLeft, CircleDashed, Lock } from 'lucide-react';

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
  isMoveDisabled?: boolean;
  moveLockReason?: string;
}

export function KanbanCard({ task, isOverlay, onClick, isMoveDisabled, moveLockReason }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: {
      type: 'Task',
      task,
    },
    disabled: isMoveDisabled,
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

  const hasDescription = !!task.description;
  const commentsCount = task.comments?.length || 0;
  const attachmentsCount = task.attachments?.length || 0;
  const subtasksCount = task.subtasks?.length || 0;
  const completedSubtasks = task.subtasks?.filter(s => s.completed).length || 0;
  
  let checklistTotal = 0;
  let checklistCompleted = 0;
  task.checklists?.forEach(c => {
    checklistTotal += c.items?.length || 0;
    checklistCompleted += c.items?.filter(i => i.completed).length || 0;
  });

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick && onClick(task)}
      className={`bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 rounded-xl p-3.5 group relative shadow-sm flex flex-col gap-3 transition-all duration-300 ease-out hover:scale-[1.01] hover:shadow-lg hover:shadow-black/20 ${
        isMoveDisabled ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
      } ${
        isOverlay ? 'rotate-2 scale-105 shadow-xl shadow-black/40 cursor-grabbing' : ''
      }`}
    >
      <div className="pr-6">
        <div className="flex items-center gap-1.5 mb-0.5">
          <h4 className="text-[13px] font-semibold text-zinc-200 leading-tight">
            {task.title}
          </h4>
          {isMoveDisabled && (
            <span title={moveLockReason || 'Status transition restricted'} className="text-amber-400 shrink-0">
              <Lock className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
        <p className="text-[11px] text-zinc-500">
          In {task.listId || 'List'}
        </p>
      </div>

      <div className="flex flex-col gap-2.5 mt-1">
        {/* Indicators Row */}
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-zinc-500">
          {hasDescription && (
            <div className="flex items-center gap-1" title="Has Description">
              <AlignLeft className="w-3.5 h-3.5" />
            </div>
          )}
          
          {commentsCount > 0 && (
            <div className="flex items-center gap-1" title={`${commentsCount} Comments`}>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
              <span>{commentsCount}</span>
            </div>
          )}

          {attachmentsCount > 0 && (
            <div className="flex items-center gap-1" title={`${attachmentsCount} Attachments`}>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
              <span>{attachmentsCount}</span>
            </div>
          )}

          {subtasksCount > 0 && (
            <div className="flex items-center gap-1" title={`${completedSubtasks}/${subtasksCount} Subtasks`}>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h22M3 12h22M3 17h22M3 22h22"></path></svg>
              <span>{completedSubtasks}/{subtasksCount}</span>
            </div>
          )}

          {checklistTotal > 0 && (
            <div className="flex items-center gap-1" title={`${checklistCompleted}/${checklistTotal} Checklist Items`}>
              <CheckSquare className="w-3.5 h-3.5" />
              <span>{checklistCompleted}/{checklistTotal}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-[12px] text-zinc-500 mt-1 pt-2 border-t border-zinc-700/50">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 shrink-0" />
              {task.assignees && task.assignees.length > 0 ? (
                <div className="flex items-center gap-1">
                  <div className="flex items-center -space-x-1">
                    {task.assignees.slice(0, 2).map((a) => (
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
                    {task.assignees.length > 2 && (
                      <div className="relative ring-1 ring-[#18181b] rounded-full bg-zinc-800 text-zinc-300 text-[8px] font-bold px-1 h-4 flex items-center justify-center shrink-0">
                        +{task.assignees.length - 2}
                      </div>
                    )}
                  </div>
                  <span className="truncate max-w-[110px]">
                    {task.assignees.length === 1 ? task.assignees[0].name : `${task.assignees.length} assignees`}
                  </span>
                </div>
              ) : task.assignee ? (
                <span className="truncate max-w-[110px]">{task.assignee.name}</span>
              ) : (
                <span>Unassigned</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5" />
              <span>
                {task.startDate ? new Date(task.startDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' - ' : ''}
                {task.dueDate ? new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No due date'}
              </span>
            </div>
          </div>
          
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-1">
              <Flag className="w-3.5 h-3.5" />
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${task.priority ? PRIORITY_COLORS[task.priority] : 'text-zinc-400 bg-zinc-800'}`}>
                {task.priority || 'NONE'}
              </span>
            </div>

            <div className="flex items-center gap-1 text-[11px] text-zinc-400 font-medium">
              <CircleDashed className="w-3 h-3" />
              <span>{task.status || 'Pending'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
