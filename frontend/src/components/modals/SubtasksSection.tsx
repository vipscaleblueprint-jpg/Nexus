import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Subtask, Task, Priority } from '@/lib/types';
import { tasksApi } from '@/api/tasks';
import { Check, CheckCircle2, Circle, Plus, User, Flag, Calendar, X, ChevronLeft, ChevronRight, MessageSquare, ListChecks, ArrowUpRight, ExternalLink, AlignLeft, CheckSquare, Send, CircleDashed, ChevronUp, ChevronDown } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addMonths, subMonths, eachDayOfInterval, isSameMonth, isSameDay, isToday } from 'date-fns';
import * as Popover from '@radix-ui/react-popover';
import { toast } from '@/lib/toast';

interface SubtasksSectionProps {
  task: Task;
  onUpdateTask: (task: Task) => void;
  users?: any[];
  addingSubtask: boolean;
  setAddingSubtask: (val: boolean) => void;
  socket?: any;
  currentUser?: any;
}

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-zinc-400',
  MEDIUM: 'text-blue-400',
  HIGH: 'text-orange-400',
  URGENT: 'text-red-400',
};

// Subcomponent for description to avoid hook-in-loop issues
function SubtaskDescription({
  subtask,
  onSave,
  socket,
  currentUser,
  listId,
  taskId
}: {
  subtask: Subtask;
  onSave: (id: string, desc: string) => void;
  socket?: any;
  currentUser?: any;
  listId?: string;
  taskId?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [desc, setDesc] = useState(subtask.description || '');
  const [expanded, setExpanded] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing && !editingUser) {
      setDesc(subtask.description || '');
    }
  }, [subtask.description, isEditing, editingUser]);

  useEffect(() => {
    if (!socket || !subtask.id) return;

    const handleStart = (data: any) => {
      if (data.subtaskId === subtask.id && data.userName !== currentUser?.name) {
        setEditingUser(data.userName);
      }
    };
    const handleStop = (data: any) => {
      if (data.subtaskId === subtask.id) {
        setEditingUser(null);
        if (data.description !== undefined && data.userName !== currentUser?.name) {
          setDesc(data.description);
        }
      }
    };
    const handleContent = (data: any) => {
      if (data.subtaskId === subtask.id && data.userName !== currentUser?.name) {
        setDesc(data.content);
      }
    };

    socket.on('subtask_editing_start', handleStart);
    socket.on('subtask_editing_stop', handleStop);
    socket.on('subtask_editing_content', handleContent);

    return () => {
      socket.off('subtask_editing_start', handleStart);
      socket.off('subtask_editing_stop', handleStop);
      socket.off('subtask_editing_content', handleContent);
    };
  }, [socket, subtask.id, currentUser?.name]);

  const handleStartEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (editingUser) return; // Locked by someone else
    setIsEditing(true);
    if (socket && listId && taskId) {
      socket.emit('subtask_editing_start', {
        listId,
        taskId,
        subtaskId: subtask.id,
        userName: currentUser?.name || 'Someone'
      });
    }
  };

  const handleStopEditing = () => {
    setIsEditing(false);
    if (desc !== (subtask.description || '')) onSave(subtask.id, desc);
    if (socket && listId && taskId) {
      socket.emit('subtask_editing_stop', {
        listId,
        taskId,
        subtaskId: subtask.id,
        description: desc,
        userName: currentUser?.name
      });
    }
  };

  const handleTextareaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    target.style.height = 'auto';
    target.style.height = `${target.scrollHeight}px`;
  };

  return (
    <div className="w-full relative group/desc-inner min-w-0">
      <div className={`flex flex-col gap-1.5 px-2 py-1 rounded-md transition-colors group/desc-wrapper ${isEditing ? 'bg-zinc-800/80 ring-1 ring-zinc-700' : 'hover:bg-zinc-800/50'}`}>
        <div className="flex items-start gap-1.5 min-w-0">
          <div className="flex-1 flex flex-col gap-1 min-w-0">
            {isEditing ? (
              <textarea
                autoFocus
                value={desc}
                onInput={handleTextareaInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setDesc(val);
                  if (socket && listId && taskId) {
                    socket.emit('subtask_editing_content', {
                      listId,
                      taskId,
                      subtaskId: subtask.id,
                      content: val,
                      userName: currentUser?.name
                    });
                  }
                }}
                onBlur={handleStopEditing}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') handleStopEditing(); }}
                className="w-full bg-transparent text-xs text-zinc-300 leading-relaxed resize-none focus:outline-none m-0 p-0 overflow-hidden"
                placeholder="Write a text..."
                style={{ height: 'auto', minHeight: '20px' }}
                ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
              />
            ) : (
              <p
                className={`text-xs leading-relaxed break-words cursor-text min-h-[16px] ${expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'} ${editingUser ? 'text-zinc-500' : (!desc ? 'text-zinc-500 italic opacity-0 group-hover/desc-inner:opacity-100' : 'text-zinc-300 group-hover/desc-wrapper:text-zinc-200')} transition-colors`}
                onClick={handleStartEditing}
              >
                {desc || 'Write a text...'}
              </p>
            )}

            {desc.length > 60 && !editingUser && !isEditing && (
              <button
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                className="text-zinc-500 hover:text-zinc-300 text-[10px] font-semibold self-start hover:underline mt-0.5 cursor-pointer"
              >
                {expanded ? 'See less' : 'See more'}
              </button>
            )}
          </div>
        </div>
        {editingUser && !isEditing && (
          <div className="self-start flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded text-[10px] font-medium animate-pulse ml-5">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            {editingUser} typing...
          </div>
        )}
      </div>
    </div>
  );
}

// Custom dark calendar picker — consistent with the rest of the design
function DatePickerPopover({
  value,
  onChange,
  subtaskId,
  groupClass,
}: {
  value: string | null | undefined;
  onChange: (iso: string | null) => void;
  subtaskId: string;
  groupClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => (value ? new Date(value) : new Date()));

  // Reset view when value changes externally
  useEffect(() => { if (value) setViewDate(new Date(value)); }, [value]);

  const selectedDate = value ? new Date(value) : null;

  // Build calendar grid
  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const handleSelect = (day: Date) => {
    onChange(day.toISOString());
    setOpen(false);
  };

  const handleClear = () => {
    onChange(null);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <div className={`flex items-center gap-2 px-3 py-2 h-full w-full cursor-pointer hover:bg-zinc-800/40 transition-colors text-xs min-w-0 select-none ${groupClass ?? ''}`}>
          <Calendar className={`w-3.5 h-3.5 shrink-0 ${selectedDate ? 'text-zinc-400' : 'text-zinc-600 opacity-0 group-hover:opacity-70'}`} />
          {selectedDate ? (
            <span className="text-zinc-300 text-xs">
              {format(selectedDate, 'MMM d')}
            </span>
          ) : (
            <span className="text-zinc-600 text-xs opacity-0 group-hover:opacity-60 transition-opacity">Set date</span>
          )}
        </div>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-[260px] p-3 bg-[#0f0f0f] border border-zinc-800 rounded-xl shadow-2xl outline-none"
          side="bottom"
          align="start"
          sideOffset={4}
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setViewDate(d => subMonths(d, 1))}
              className="p-1 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-zinc-200">
              {format(viewDate, 'MMMM yyyy')}
            </span>
            <button
              onClick={() => setViewDate(d => addMonths(d, 1))}
              className="p-1 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-1">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <div key={d} className="text-center text-[10px] font-medium text-zinc-600 py-1">{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {days.map(day => {
              const inMonth = isSameMonth(day, viewDate);
              const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
              const today = isToday(day);
              return (
                <button
                  key={day.toISOString()}
                  onClick={() => handleSelect(day)}
                  className={`
                    h-7 w-full rounded-md text-[11px] transition-colors font-medium
                    ${isSelected
                      ? 'bg-blue-600 text-white'
                      : today
                        ? 'bg-zinc-800 text-blue-400 ring-1 ring-blue-500/40'
                        : inMonth
                          ? 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
                          : 'text-zinc-700 hover:bg-zinc-900'
                    }
                  `}
                >
                  {format(day, 'd')}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-zinc-800/60">
            <button
              onClick={handleClear}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() => handleSelect(new Date())}
              className="text-[11px] text-blue-400 hover:text-blue-300 font-medium transition-colors"
            >
              Today
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
function SubtaskRow({
  subtask,
  users,
  onToggle,
  onUpdate,
  onOpenSubtask,
  socket,
  currentUser,
  listId,
  taskId,
  commentCount,
}: {
  subtask: Subtask;
  users?: any[];
  onToggle: (s: Subtask) => void;
  onUpdate: (id: string, data: Partial<Subtask>) => void;
  onOpenSubtask: (s: Subtask) => void;
  socket?: any;
  currentUser?: any;
  listId?: string;
  taskId?: string;
  commentCount?: number;
}) {
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [cardHeight, setCardHeight] = useState<number | undefined>(undefined);
  const resizeRef = useRef<HTMLDivElement>(null);
  const priorityColor = subtask.priority ? PRIORITY_COLORS[subtask.priority] ?? 'text-zinc-400' : 'text-zinc-600';

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleVal, setTitleVal] = useState(subtask.title);
  const [activeTab, setActiveTab] = useState<'checklist' | 'comments'>('comments');
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    setTitleVal(subtask.title);
  }, [subtask.title]);

  const handleTitleSubmit = () => {
    setIsEditingTitle(false);
    if (titleVal.trim() && titleVal !== subtask.title) {
      onUpdate(subtask.id, { title: titleVal.trim() });
    } else {
      setTitleVal(subtask.title);
    }
  };

  // Draggable resize handler
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const card = resizeRef.current;
    if (!card) return;
    const startH = card.getBoundingClientRect().height;

    const onMouseMove = (ev: MouseEvent) => {
      const newH = Math.max(80, startH + (ev.clientY - startY));
      setCardHeight(newH);
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const [commentText, setCommentText] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  const handleAddComment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!commentText.trim() || !currentUser?.id) return;
    setIsSubmittingComment(true);
    try {
      await tasksApi.addComment(subtask.id, commentText.trim(), currentUser.id);
      setCommentText('');
      toast.success('Comment added');
    } catch (err) {
      console.error(err);
      toast.error('Failed to add comment');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  return (
    <div
      ref={resizeRef}
      style={cardHeight && !isCollapsed ? { minHeight: cardHeight } : undefined}
      className="relative flex flex-col p-4 bg-[#141416] border border-zinc-800/60 rounded-xl hover:border-zinc-700/60 transition-all group group/desc"
    >

      {/* Row 1: Title and Collapse Button */}
      <div className={`flex items-center gap-2.5 shrink-0 min-w-0 max-w-full justify-between transition-all duration-300 ${isCollapsed ? 'mb-0 pb-0 border-transparent' : 'mb-4 pb-3 border-b border-zinc-800/60'}`}>
        <div className="flex items-center gap-4 shrink-0 min-w-0 flex-1">
          <div className="flex items-center min-w-0 shrink-0">
            {isEditingTitle ? (
              <input
                autoFocus
                value={titleVal}
                onChange={(e) => setTitleVal(e.target.value)}
                onBlur={handleTitleSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTitleSubmit();
                  if (e.key === 'Escape') {
                    setTitleVal(subtask.title);
                    setIsEditingTitle(false);
                  }
                }}
                className="bg-zinc-900 border border-blue-500 rounded px-1.5 py-0.5 text-[14px] font-semibold text-zinc-100 outline-none w-full max-w-[300px]"
              />
            ) : (
              <button
                onClick={() => onOpenSubtask(subtask)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setIsEditingTitle(true);
                }}
                className={`text-[14px] font-bold truncate cursor-pointer hover:underline decoration-zinc-500 underline-offset-2 transition-colors ${subtask.completed ? 'text-zinc-600 line-through' : 'text-zinc-100 hover:text-white'}`}
              >
                {subtask.title}
              </button>
            )}
          </div>

          {/* Collapsed Inline Properties */}
          <div className={`flex items-center gap-3 overflow-hidden transition-all duration-300 shrink-0 ${isCollapsed ? 'opacity-100 max-w-[500px] ml-4 border-l border-zinc-800/60 pl-4' : 'opacity-0 max-w-0 ml-0 border-transparent pl-0'}`}>
            <div className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-[10px] font-medium select-none whitespace-nowrap ${subtask.completed ? 'bg-emerald-600/15 text-emerald-400' : 'bg-zinc-800/50 text-zinc-400'}`}>
              {subtask.completed ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <CircleDashed className="w-3.5 h-3.5 shrink-0" />}
              {subtask.completed ? 'Done' : 'Open'}
            </div>
            
            <div className="inline-flex items-center gap-1.5 h-6 px-2 bg-zinc-800/50 rounded-md text-[10px] text-zinc-400 max-w-[120px] shrink-0 truncate">
              {subtask.assignee ? (
                <>
                  {subtask.assignee.avatarUrl ? (
                    <img src={subtask.assignee.avatarUrl} alt="" className="w-3.5 h-3.5 rounded-full shrink-0" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[8px] font-bold shrink-0">
                      {subtask.assignee.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="truncate">{subtask.assignee.name}</span>
                </>
              ) : (
                <>
                  <User className="w-3 h-3 shrink-0" />
                  <span>Empty</span>
                </>
              )}
            </div>

            <div className="inline-flex items-center gap-1.5 h-6 px-2 bg-zinc-800/50 rounded-md text-[10px] text-zinc-400 shrink-0 whitespace-nowrap">
              <Flag className={`w-3.5 h-3.5 shrink-0 ${priorityColor}`} />
              <span className={priorityColor}>{subtask.priority || 'Empty'}</span>
            </div>
          </div>
        </div>

        {/* Collapse Toggle Button */}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)} 
          className="p-1 hover:bg-zinc-800/80 rounded-md text-zinc-500 hover:text-zinc-300 transition-colors shrink-0 ml-2"
          title={isCollapsed ? "Expand subtask" : "Collapse subtask"}
        >
          <ChevronUp className={`w-4 h-4 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : 'rotate-0'}`} />
        </button>
      </div>

      {/* Row 2: 3-column Layout mimicking main task */}
      <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-in-out ${isCollapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}>
        <div className="overflow-hidden">
          <div className="flex-1 flex items-stretch gap-6 w-full min-h-[280px]">

        {/* Column 1: Properties (Status, Assignee, Priority) */}
        <div className="w-[200px] flex flex-col shrink-0 gap-5 overflow-y-auto custom-scrollbar pr-2 pt-2">

          {/* Status */}
          <div className="flex flex-col gap-2">
            <div className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium select-none cursor-pointer transition-colors w-fit ${subtask.completed
                ? 'bg-emerald-600/15 text-emerald-400 hover:bg-emerald-600/25'
                : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700/50'
              }`} onClick={() => onToggle(subtask)}>
              {subtask.completed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <CircleDashed className="w-3.5 h-3.5" />}
              {subtask.completed ? 'Done' : 'Open'}
            </div>
          </div>

          {/* Assignee */}
          <div className="flex flex-col gap-2">
            <Popover.Root open={assigneeOpen} onOpenChange={setAssigneeOpen}>
              <Popover.Trigger asChild>
                <div className="inline-flex items-center gap-1.5 h-7 px-2.5 cursor-pointer bg-zinc-800/50 hover:bg-zinc-700/50 rounded-md transition-colors text-[11px] text-zinc-400 hover:text-zinc-200 select-none w-fit">
                  {subtask.assignee ? (
                    <>
                      {subtask.assignee.avatarUrl ? (
                        <img src={subtask.assignee.avatarUrl} alt="" className="w-4 h-4 rounded-full shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[8px] font-bold shrink-0">
                          {subtask.assignee.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="truncate max-w-[100px]">{subtask.assignee.name}</span>
                    </>
                  ) : (
                    <>
                      <User className="w-3.5 h-3.5 shrink-0" />
                      <span>Empty</span>
                    </>
                  )}
                </div>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  className="z-50 w-56 p-1 bg-[#0f0f0f] border border-zinc-800 rounded-xl shadow-2xl outline-none"
                  side="bottom"
                  align="start"
                  sideOffset={4}
                >
                  <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-2 pt-2">Assign to</div>
                  <div className="max-h-[220px] overflow-y-auto space-y-0.5">
                    {subtask.assignee && (
                      <div
                        className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-zinc-800 rounded-lg cursor-pointer text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                        onClick={() => { onUpdate(subtask.id, { assigneeId: null }); setAssigneeOpen(false); }}
                      >
                        <X className="w-4 h-4 text-zinc-600" />
                        <span>Clear assignee</span>
                      </div>
                    )}
                    {users?.map((u: any) => (
                      <div
                        key={u.id}
                        className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-zinc-800 rounded-lg cursor-pointer text-sm text-zinc-300 hover:text-zinc-100 transition-colors"
                        onClick={() => { onUpdate(subtask.id, { assigneeId: u.id }); setAssigneeOpen(false); }}
                      >
                        {u.avatarUrl ? (
                          <img src={u.avatarUrl} className="w-5 h-5 rounded-full shrink-0" />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-bold shrink-0">
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="truncate flex-1">{u.name}</span>
                        {subtask.assignee?.id === u.id && <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
                      </div>
                    ))}
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>

          {/* Priority */}
          <div className="flex flex-col gap-2">
            <Popover.Root open={priorityOpen} onOpenChange={setPriorityOpen}>
              <Popover.Trigger asChild>
                <div className="inline-flex items-center gap-1.5 h-7 px-2.5 cursor-pointer bg-zinc-800/50 hover:bg-zinc-700/50 rounded-md transition-colors text-[11px] select-none w-fit">
                  <Flag className={`w-3.5 h-3.5 shrink-0 ${subtask.priority ? priorityColor : 'text-zinc-500'}`} />
                  <span className={`capitalize truncate ${subtask.priority ? priorityColor : 'text-zinc-500'}`}>
                    {subtask.priority?.toLowerCase() || 'Empty'}
                  </span>
                </div>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  className="z-50 w-36 p-1.5 bg-[#0f0f0f] border border-zinc-800 rounded-xl shadow-2xl outline-none"
                  side="bottom"
                  align="start"
                  sideOffset={4}
                >
                  <div className="flex flex-col gap-0.5">
                    {(['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as Priority[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => { onUpdate(subtask.id, { priority: p }); setPriorityOpen(false); }}
                        className="flex items-center gap-2.5 px-2.5 py-2 hover:bg-zinc-800 rounded-lg text-sm text-zinc-300 hover:text-zinc-100 transition-colors cursor-pointer"
                      >
                        <Flag className={`w-3.5 h-3.5 ${PRIORITY_COLORS[p]}`} />
                        <span className="capitalize">{p.toLowerCase()}</span>
                        {subtask.priority === p && <Check className="w-3.5 h-3.5 ml-auto text-blue-400" />}
                      </button>
                    ))}
                    {subtask.priority && (
                      <div
                        className="flex items-center gap-2.5 px-2.5 py-2 hover:bg-zinc-800 rounded-lg text-sm text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer border-t border-zinc-800/60 mt-1 pt-2"
                        onClick={() => { onUpdate(subtask.id, { priority: undefined }); setPriorityOpen(false); }}
                      >
                        <X className="w-4 h-4" />
                        <span>Clear</span>
                      </div>
                    )}
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        </div>

        {/* Column 2: Description (Middle) */}
        <div className="flex-1 flex flex-col min-w-[200px] border-l border-r border-zinc-800/60 px-4">
          <div className="flex items-center gap-2 mb-4 shrink-0">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
              <AlignLeft className="w-3.5 h-3.5" />
              Description
            </span>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar relative w-full pr-2">
            <SubtaskDescription
              subtask={subtask}
              onSave={(id, desc) => onUpdate(id, { description: desc })}
              socket={socket}
              currentUser={currentUser}
              listId={listId}
              taskId={taskId}
            />
          </div>
        </div>

        {/* Column 3: Checklists & Comments (Right) */}
        <div className="w-[240px] flex flex-col shrink-0">
          {/* Internal Tabs */}
          <div className="flex items-center gap-4 border-b border-zinc-800/60 mb-4 shrink-0">
            <button
              onClick={() => setActiveTab('checklist')}
              className={`pb-2 text-[10px] font-bold uppercase tracking-wider transition-colors relative ${activeTab === 'checklist' ? 'text-zinc-200' : 'text-zinc-500 hover:text-zinc-400'}`}
            >
              <span className="flex items-center gap-1.5"><CheckSquare className="w-3.5 h-3.5" /> Checklist</span>
              {activeTab === 'checklist' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-full" />}
            </button>
            <button
              onClick={() => setActiveTab('comments')}
              className={`pb-2 text-[10px] font-bold uppercase tracking-wider transition-colors relative ${activeTab === 'comments' ? 'text-zinc-200' : 'text-zinc-500 hover:text-zinc-400'}`}
            >
              <span className="flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Comments</span>
              {activeTab === 'comments' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-full" />}
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden pb-2">
            {activeTab === 'checklist' && (
              <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col items-center justify-center text-center pb-4">
                <div className="w-10 h-10 rounded-full bg-zinc-800/50 flex items-center justify-center mb-2">
                  <ListChecks className="w-4 h-4 text-zinc-400" />
                </div>
                <h3 className="text-[13px] font-medium text-zinc-300 mb-1">No Checklist</h3>
                <p className="text-[11px] text-zinc-500 mb-4 max-w-[160px] leading-relaxed">
                  Break this subtask down into smaller steps.
                </p>
                <button className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium rounded-lg transition-colors shadow-sm cursor-pointer">
                  Create Checklist
                </button>
              </div>
            )}

            {activeTab === 'comments' && (
              <div className="flex-1 flex flex-col relative h-full">
                <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col items-center justify-center text-center pb-4 min-h-[120px]">
                  <div className="w-10 h-10 rounded-full bg-zinc-800/50 flex items-center justify-center mb-2">
                    <MessageSquare className="w-4 h-4 text-zinc-400" />
                  </div>
                  <h3 className="text-[13px] font-medium text-zinc-300 mb-1">
                    {commentCount ? `${commentCount} Comment${commentCount !== 1 ? 's' : ''}` : 'No Comments'}
                  </h3>
                  <p className="text-[11px] text-zinc-500 mb-4 max-w-[150px] leading-relaxed">
                    Click the button below to view the full thread.
                  </p>
                  <button
                    onClick={() => onOpenSubtask(subtask)}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium rounded-lg transition-colors shadow-sm cursor-pointer"
                  >
                    Open Thread
                  </button>
                </div>

                {/* Inline Comment Input */}
                <div className="pt-3 border-t border-zinc-800/60 mt-auto shrink-0 pb-1">
                  <form onSubmit={handleAddComment} className="flex flex-col gap-2">
                    <input
                      type="text"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Write a comment..."
                      className="w-full bg-[#18181b] border border-zinc-800 focus:border-zinc-700 rounded-lg px-3 py-2 text-[11px] text-zinc-200 placeholder:text-zinc-500 outline-none transition-colors"
                    />
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={!commentText.trim() || isSubmittingComment}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-[11px] font-medium rounded-md transition-colors cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {isSubmittingComment ? 'Sending...' : 'Send'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

          {/* Resize handle at bottom */}
          <div
            onMouseDown={handleResizeMouseDown}
            className="absolute bottom-0 left-4 right-4 h-2 cursor-ns-resize flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <div className="w-8 h-[3px] rounded-full bg-zinc-700 hover:bg-zinc-500 transition-colors" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SubtasksSection({ task, onUpdateTask, users, addingSubtask, setAddingSubtask, socket, currentUser, onOpenSubtask }: SubtasksSectionProps & { onOpenSubtask?: (subtask: Subtask) => void }) {
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [showAllSubtasks, setShowAllSubtasks] = useState(false);
  // Local optimistic state — seeded from task.subtasks
  const [localSubtasks, setLocalSubtasks] = useState<Subtask[]>(task.subtasks || []);
  // Ref always holds the latest localSubtasks so async callbacks never read stale state
  const localSubtasksRef = useRef<Subtask[]>(localSubtasks);
  useEffect(() => { localSubtasksRef.current = localSubtasks; }, [localSubtasks]);

  // Track mount state so we never call onUpdateTask after the modal closes
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const pendingUpdates = useRef(0);

  // Re-seed from parent when task.subtasks changes (e.g. from real-time socket events)
  // BUT only if we aren't currently waiting for an optimistic update to finish!
  useEffect(() => {
    if (pendingUpdates.current === 0) {
      setLocalSubtasks(task.subtasks || []);
    }
  }, [task.subtasks]);

  const optimisticUpdate = useCallback(async (subtaskId: string, data: Partial<Subtask>) => {
    // Step 1: apply locally right away
    const currentLocal = localSubtasksRef.current;
    const optimisticSubtasks = currentLocal.map(s => {
      if (s.id !== subtaskId) return s;
      const merged = { ...s, ...data } as Subtask;
      // Resolve assignee object from users list when assigneeId changes
      if ('assigneeId' in data) {
        if (data.assigneeId === null || data.assigneeId === undefined) {
          merged.assignee = undefined;
        } else {
          const found = users?.find((u: any) => u.id === data.assigneeId);
          if (found) merged.assignee = found;
        }
      }
      return merged;
    });

    setLocalSubtasks(optimisticSubtasks);
    onUpdateTask({ ...task, subtasks: optimisticSubtasks }); // Update parent instantly

    // Step 2: persist to DB and reconcile with server response
    pendingUpdates.current++;
    try {
      const { subtask: resSubtask } = await tasksApi.updateSubtask(task.id, subtaskId, data);
      if (!isMounted.current) return; // Modal was closed — do nothing
      const updated = localSubtasksRef.current.map(s => s.id === subtaskId ? resSubtask : s);
      setLocalSubtasks(updated);
      onUpdateTask({ ...task, subtasks: updated });
    } catch (err) {
      console.error('Failed to update subtask:', err);
      if (!isMounted.current) return;
      setLocalSubtasks(task.subtasks || []);
      onUpdateTask({ ...task, subtasks: task.subtasks || [] });
    } finally {
      pendingUpdates.current = Math.max(0, pendingUpdates.current - 1);
    }
  }, [task, users, onUpdateTask]);

  const toggleSubtask = useCallback(async (subtask: Subtask) => {
    await optimisticUpdate(subtask.id, { completed: !subtask.completed });
  }, [optimisticUpdate]);

  const handleAddSubtask = async () => {
    if (!newSubtaskTitle.trim()) { setAddingSubtask(false); return; }
    try {
      const { subtask } = await tasksApi.createSubtask(task.id, {
        title: newSubtaskTitle.trim(),
        priority: 'MEDIUM',
      });
      const updated = [...localSubtasks, subtask];
      setLocalSubtasks(updated);
      onUpdateTask({ ...task, subtasks: updated });
      setNewSubtaskTitle('');
      setAddingSubtask(false);
      setShowAllSubtasks(true); // Auto-expand when adding a new subtask
    } catch (err) {
      console.error('Failed to create subtask', err);
    }
  };



  if (!localSubtasks.length && !addingSubtask) return null;

  const visibleSubtasks = showAllSubtasks ? localSubtasks : localSubtasks.slice(0, 3);

  return (
    <>
      <div className="mt-8 mb-8">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3">Subtasks</h3>

        <div className="flex flex-col gap-3">
          {/* Subtask rows */}
          {visibleSubtasks.map(subtask => (
            <SubtaskRow
              key={subtask.id}
              subtask={subtask}
              users={users}
              onToggle={toggleSubtask}
              onUpdate={optimisticUpdate}
              onOpenSubtask={(s) => {
                if (onOpenSubtask) onOpenSubtask(s);
              }}
              socket={socket}
              currentUser={currentUser}
              listId={task.listId}
              taskId={task.id}
              commentCount={subtask.comments?.length || 0}
            />
          ))}

          {localSubtasks.length > 3 && (
            <button
              onClick={() => setShowAllSubtasks(!showAllSubtasks)}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors w-fit mx-auto mt-2 mb-1"
            >
              {showAllSubtasks ? 'Show less' : `Show more (${localSubtasks.length - 3})`}
            </button>
          )}

          {/* Add new task inline input */}
          {(addingSubtask || localSubtasks.length > 0) && (
            <div className="px-4 py-3 flex items-center gap-3 border border-zinc-800/60 rounded-xl bg-[#121212]/50 border-dashed focus-within:border-zinc-700 focus-within:bg-zinc-900/40 transition-colors">
              <Plus className="w-4 h-4 text-zinc-600 shrink-0" />
              <input
                type="text"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddSubtask();
                  if (e.key === 'Escape') setAddingSubtask(false);
                }}
                onBlur={() => newSubtaskTitle ? handleAddSubtask() : setAddingSubtask(false)}
                autoFocus={addingSubtask}
                placeholder="Add a new subtask..."
                className="bg-transparent border-none outline-none text-sm text-zinc-200 placeholder:text-zinc-600 w-full focus:ring-0 p-0"
              />
            </div>
          )}
        </div>


      </div>

    </>
  );
}


