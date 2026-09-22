import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { BlockEditor } from '../ui/BlockEditor';
import { Subtask, Task, Priority } from '@/lib/types';
import { tasksApi } from '@/api/tasks';
import { canUserEditTask } from '@/lib/permissions';
import { Check, CheckCircle2, Circle, Plus, User, Flag, Calendar, X, ChevronLeft, ChevronRight, MessageSquare, ListChecks, ArrowUpRight, ExternalLink, AlignLeft, CheckSquare, Send, CircleDashed, ChevronUp, ChevronDown, ShieldCheck } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addMonths, subMonths, eachDayOfInterval, isSameMonth, isSameDay, isToday } from 'date-fns';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { toast } from '@/lib/toast';
import { ALL_STATUSES, STATUS_COLORS } from './TaskDetailModal';
import { getRequiredAudits } from './AuditSection';

interface SubtasksSectionProps {
  task: Task;
  onUpdateTask: (task: Task) => void;
  users?: any[];
  addingSubtask: boolean;
  setAddingSubtask: (val: boolean) => void;
  socket?: any;
  currentUser?: any;
  onOpenSubtask?: (subtask: Subtask) => void;
  listStatuses?: any[];
  teams?: any[];
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
  taskId,
  canEditTask

}: {
  subtask: Subtask;
  onSave: (id: string, desc: string) => void;
  socket?: any;
  currentUser?: any;
  listId?: string;
  taskId?: string;
  canEditTask?: boolean;
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

  const handleStartEditing = (e?: React.SyntheticEvent) => {
    if (e) e.stopPropagation();
    if (editingUser || subtask.completed || !canEditTask) return; // Locked by someone else, completed, or no edit permission
    setIsEditing(true);
    setExpanded(true);
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
    const sanitizedDesc = (desc === '<p></p>' || desc === '<p><br></p>') ? '' : desc;
    if (sanitizedDesc !== (subtask.description || '')) onSave(subtask.id, sanitizedDesc);
    if (socket && listId && taskId) {
      socket.emit('subtask_editing_stop', {
        listId,
        taskId,
        subtaskId: subtask.id,
        description: sanitizedDesc,
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
      <div 
        onClick={!isEditing ? handleStartEditing : undefined}
        onFocus={!isEditing ? handleStartEditing : undefined}
        className={`flex flex-col gap-1.5 px-2 py-1 rounded-md transition-colors group/desc-wrapper ${isEditing ? 'bg-zinc-800/80 ring-1 ring-zinc-700 cursor-text' : `hover:bg-zinc-800/50 ${subtask.completed ? 'cursor-default' : 'cursor-text'}`}`}
      >
        <div className="flex items-start gap-1.5 min-w-0">
          <div className="flex-1 flex flex-col gap-1 min-w-0">
            <div className={`relative ${!isEditing && desc.length > 60 && !expanded ? 'max-h-[60px] overflow-hidden' : ''}`}>
              <BlockEditor
                content={desc}
                onChange={(val) => {
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
                editable={!editingUser && !subtask.completed && !!canEditTask}
              />
              
              {!isEditing && desc.length > 60 && !expanded && (
                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-zinc-900/50 to-transparent pointer-events-none" />
              )}
            </div>

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
          className="z-[200] w-[260px] p-3 bg-[#0f0f0f] border border-zinc-800 rounded-xl shadow-2xl outline-none"
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
  onAddCommentLocally,
  canEditTask,
  listStatuses,
  teams = [],
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
  onAddCommentLocally?: (subtaskId: string, comments: any[]) => void;
  canEditTask?: boolean;
  listStatuses?: any[];
  teams?: any[];
}) {
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [cardHeight, setCardHeight] = useState<number | undefined>(undefined);
  const resizeRef = useRef<HTMLDivElement>(null);
  const priorityColor = subtask.priority ? PRIORITY_COLORS[subtask.priority] ?? 'text-zinc-400' : 'text-zinc-600';

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleVal, setTitleVal] = useState(subtask.title);
  const [activeTab, setActiveTab] = useState<'checklist' | 'comments' | 'audit'>('comments');
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Multi-assignee derived value
  const currentAssignees: any[] = useMemo(() => {
    const s = subtask as any;
    if (s.assignees && s.assignees.length > 0) return s.assignees;
    if (s.User) return [s.User];
    if (s.assignee) return [s.assignee];
    return [];
  }, [subtask.assignees]);

  const isUserAssigned = (userId: string) => currentAssignees.some((u) => u.id === userId);

  const handleToggleAssignee = (u: any) => {
    const s = subtask as any;
    const latestAssignees: any[] = s.assignees || (s.User ? [s.User] : (s.assignee ? [s.assignee] : []));
    const isAssigned = latestAssignees.some(a => a.id === u.id);
    const updatedAssignees = isAssigned
      ? latestAssignees.filter((a) => a.id !== u.id)
      : [...latestAssignees, u];

    const updatedIds = updatedAssignees.map((a) => a.id);
    subtask.assignees = updatedAssignees;
    subtask.assigneeIds = updatedIds;
    onUpdate(subtask.id, { assigneeIds: updatedIds, assignees: updatedAssignees } as any);
  };

  const handleClearAllAssignees = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    subtask.assignees = [];
    subtask.assigneeIds = [];
    onUpdate(subtask.id, { assigneeIds: [], assignees: [] } as any);
    setAssigneeOpen(false);
  };

  useEffect(() => {
    setTitleVal(subtask.title);
  }, [subtask.title]);

  // Fetch comments when tab is active and not yet loaded
  useEffect(() => {
    let cancelled = false;
    if (activeTab === 'comments' && subtask.comments === undefined && taskId && subtask.id) {
      tasksApi.getComments(taskId, subtask.id)
        .then(res => {
          if (!cancelled && res?.comments && onAddCommentLocally) {
            onAddCommentLocally(subtask.id, res.comments);
          }
        })
        .catch(err => console.error('Failed to load subtask comments:', err));
    }
    return () => { cancelled = true; };
  }, [activeTab, subtask.comments, taskId, subtask.id, onAddCommentLocally]);

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
    if (!commentText.trim() || !currentUser?.id || !taskId) return;
    setIsSubmittingComment(true);
    try {
      await tasksApi.addComment(taskId!, commentText.trim(), currentUser.id, listId, [], undefined, subtask.id);
      setCommentText('');
      
      const commentsRes = await tasksApi.getComments(taskId!, subtask.id);
      if (commentsRes?.comments) {
        onUpdate(subtask.id, { comments: commentsRes.comments });
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to add comment');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleToggleItem = async (checklistId: string, itemId: string, completed: boolean) => {
    if (canEditTask === false) return;
    if (!subtask.checklists) return;
    const newChecklists = subtask.checklists.map((c: any) => {
      if (c.id === checklistId) {
        return { ...c, items: c.items.map((i: any) => i.id === itemId ? { ...i, completed } : i) };
      }
      return c;
    });
    onUpdate(subtask.id, { checklists: newChecklists });
    try {
      await tasksApi.updateChecklistItem(subtask.id, checklistId, itemId, { completed });
    } catch (e) {
      console.error(e);
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
                  if (subtask.completed) return;
                  setIsEditingTitle(true);
                }}
                className={`text-[14px] font-bold truncate transition-colors ${subtask.completed ? 'text-zinc-600 line-through cursor-not-allowed' : 'text-zinc-100 hover:text-white cursor-pointer hover:underline decoration-zinc-500 underline-offset-2'}`}
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
            
            <div className="inline-flex items-center gap-1.5 h-6 px-2 bg-zinc-800/50 rounded-md text-[10px] text-zinc-400 max-w-[150px] shrink-0 truncate">
              {currentAssignees.length > 0 ? (
                <>
                  <div className="flex items-center -space-x-1.5">
                    {currentAssignees.slice(0, 2).map((u) => (
                      <div key={u.id} className="relative ring-1 ring-[#141416] rounded-full shrink-0">
                        {u.avatarUrl ? (
                          <img src={u.avatarUrl} alt={u.name} className="w-3.5 h-3.5 rounded-full object-cover" />
                        ) : (
                          <div className="w-3.5 h-3.5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[8px] font-bold">
                            {(u.name || 'U').substring(0, 2).toUpperCase()}
                          </div>
                        )}
                      </div>
                    ))}
                    {currentAssignees.length > 2 && (
                      <div className="relative ring-1 ring-[#141416] rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-[7px] font-bold h-3.5 w-3.5 flex items-center justify-center shrink-0">
                        +{currentAssignees.length - 2}
                      </div>
                    )}
                  </div>
                  {currentAssignees.length === 1 && (
                    <span className="truncate">{currentAssignees[0].name}</span>
                  )}
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
          className="p-1 hover:bg-zinc-800/80 rounded-md text-zinc-500 hover:text-zinc-300 transition-colors shrink-0 ml-2 cursor-pointer"
          title={isCollapsed ? "Expand subtask" : "Collapse subtask"}
        >
          <ChevronUp className={`w-4 h-4 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : 'rotate-0'}`} />
        </button>
      </div>

      {/* Row 2: 3-column Layout mimicking main task but fluid */}
      <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-in-out ${isCollapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}>
        <div className="overflow-hidden">
          <div className="flex items-stretch gap-4 w-full min-h-[250px] max-h-[300px]">
        {/* Column 1: Properties Stack — icon + pill rows */}
        <div className="flex flex-col shrink-0 gap-2 pt-1 w-auto min-w-[140px]">
          {/* Status row */}
          <div className="flex items-center gap-3">
            {subtask.completed
              ? <CheckCircle2 className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              : <CircleDashed className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            }
            <Popover.Root open={statusOpen && !!canEditTask} onOpenChange={setStatusOpen}>
              <Popover.Trigger asChild>
            {(() => {
              const statusName = subtask.status ? subtask.status : (subtask.completed ? 'CLOSED' : 'PENDING');
              const statusObj = listStatuses?.find((s: any) => (s.name || s.title || s.status) === statusName);
              const hasCustomColor = !!statusObj?.color;
              const defaultClasses = STATUS_COLORS[subtask.status || ''] ?? (subtask.completed ? 'bg-emerald-600/15 text-emerald-400 hover:bg-emerald-600/25' : 'bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700/60');
              
              return (
                <div
                  title={subtask.completed ? 'Done — click to reopen' : 'Open — click to change status'}
                  onClick={() => { if (canEditTask) setStatusOpen(true); }}
                  style={hasCustomColor ? { backgroundColor: statusObj.color } : {}}
                  className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium select-none cursor-pointer w-fit ${hasCustomColor ? 'text-white hover:brightness-110' : defaultClasses}`}
                >
                  <span className="uppercase">{statusName.replace('_', ' ')}</span>
                  <ChevronRight className="w-3 h-3 opacity-60 ml-0.5" />
                </div>
              );
            })()}
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content className="z-[200] w-48 p-1.5 bg-[#121212] border border-zinc-800 rounded-md shadow-xl outline-none" align="start" sideOffset={4}>
                  <div className="max-h-60 overflow-y-auto custom-scrollbar flex flex-col gap-0.5 pr-1">
                    {((listStatuses && listStatuses.length > 0) ? listStatuses.map((s: any) => typeof s === 'string' ? s : (s.name || s.status || s.title || '')) : ALL_STATUSES).map((s: string) => (
                      <div
                        key={s}
                        onClick={() => {
                          if (!canEditTask) return;
                          const isFinal = s.toLowerCase() === 'closed' || s.toLowerCase() === 'done' || s.toLowerCase() === 'completed';
                          onUpdate(subtask.id, { status: s, completed: isFinal });
                          setStatusOpen(false);
                        }}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer text-xs transition-colors ${subtask.status === s ? 'bg-blue-500/10 text-blue-400' : 'text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100'}`}
                      >
                        {(() => {
                          const customObj = listStatuses?.find((ls: any) => (ls.name || ls.status || ls.title) === s);
                          if (customObj?.color) {
                            return <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: customObj.color }} />;
                          }
                          return <div className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[s] ? STATUS_COLORS[s].split(' ')[0] : 'bg-zinc-500'}`} />;
                        })()}
                        {s}
                        {s === subtask.status && <Check className="w-3 h-3 ml-auto opacity-70" />}
                      </div>
                    ))}
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>

          {/* Assignees row */}
          <div className="flex items-center gap-3">
            <User className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <div className="flex items-center gap-1.5">
              <Popover.Root>
                <Popover.Trigger asChild>
                  {(subtask.assigneeRoleRestrictions && subtask.assigneeRoleRestrictions.length > 0) ? (
                    <div className={`flex items-center cursor-pointer transition-all duration-300 hover:scale-105 active:scale-95 ${!canEditTask ? 'opacity-50 pointer-events-none' : ''}`}>
                      {subtask.assigneeRoleRestrictions.map((role: string, i: number) => {
                        const colors = ['bg-purple-500', 'bg-red-500', 'bg-emerald-500', 'bg-blue-500', 'bg-amber-500', 'bg-pink-500'];
                        const bgColor = colors[i % colors.length];
                        return (
                          <div 
                            key={role} 
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-[#18181b] ${i > 0 ? '-ml-2.5' : ''} shadow-sm relative z-[${10-i}] ${bgColor} transition-transform`}
                            title={role}
                          >
                            {role.substring(0, 2).toUpperCase()}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <button disabled={!canEditTask} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700/50 text-zinc-400 hover:text-zinc-200 text-[11px] cursor-pointer transition-colors select-none whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed">
                      <Plus className="w-3 h-3 shrink-0" />
                      Assign Role
                    </button>
                  )}
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content className="z-[200] w-52 p-1 bg-[#121212] border border-zinc-800 rounded-lg shadow-2xl outline-none" sideOffset={4} align="start">
                    <div className="max-h-[220px] overflow-y-auto custom-scrollbar p-1">
                      <p className="text-[10px] text-zinc-500 px-2 py-1 uppercase tracking-wide font-medium">Restrict assignees to roles</p>
                      {(!teams || teams.length === 0) && (
                        <div className="px-2 py-1.5 text-xs text-zinc-500">No teams found.</div>
                      )}
                      {(teams || []).map((team: any) => (
                        <div key={team.id} className="mb-2">
                          {(() => {
                            const teamRoles = team.teamRoles || [];
                            const current = subtask.assigneeRoleRestrictions || [];
                            const hasRoles = teamRoles.length > 0;
                            const allSelected = hasRoles && teamRoles.every((r: any) => current.includes(r.name));
                            const someSelected = hasRoles && teamRoles.some((r: any) => current.includes(r.name));
                            
                            return (
                              <div 
                                onClick={() => {
                                  if (!hasRoles || !canEditTask) return;
                                  let next = [...current];
                                  if (allSelected) {
                                    next = next.filter(r => !teamRoles.find((tr: any) => tr.name === r));
                                  } else {
                                    const toAdd = teamRoles.filter((tr: any) => !next.includes(tr.name)).map((tr: any) => tr.name);
                                    next = [...next, ...toAdd];
                                  }
                                  onUpdate(subtask.id, { assigneeRoleRestrictions: next } as any);
                                }}
                                className={`flex items-center gap-2 px-2 py-1 text-[10px] font-semibold tracking-wide uppercase bg-zinc-800/30 ${hasRoles && canEditTask ? 'cursor-pointer hover:bg-zinc-800/50 hover:text-zinc-200 transition-colors' : ''} ${someSelected ? 'text-indigo-400' : 'text-zinc-400'} ${!canEditTask ? 'opacity-50 pointer-events-none' : ''}`}
                              >
                                {hasRoles && (
                                  <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${allSelected ? 'bg-indigo-600 border-indigo-500' : someSelected ? 'bg-indigo-900/50 border-indigo-500' : 'border-zinc-500 bg-[#1a1a20]'}`}>
                                    {allSelected && <Check className="w-2.5 h-2.5 text-white" />}
                                    {!allSelected && someSelected && <div className="w-1.5 h-0.5 bg-indigo-400 rounded-full" />}
                                  </div>
                                )}
                                <span>{team.name}</span>
                              </div>
                            );
                          })()}
                          {(!team.teamRoles || team.teamRoles.length === 0) && (
                            <div className="px-2 py-1 text-[10px] text-zinc-500 italic">No roles</div>
                          )}
                          {team.teamRoles && team.teamRoles.length > 0 && (
                            <div className="flex flex-col ml-[15px] pl-3 py-0.5 border-l border-zinc-700/50 mt-1 mb-1 relative">
                              {team.teamRoles.map((role: any) => {
                                const selected = (subtask.assigneeRoleRestrictions || []).includes(role.name);
                                return (
                                  <div
                                    key={role.id}
                                    onClick={() => {
                                      if (!canEditTask) return;
                                      const current = subtask.assigneeRoleRestrictions || [];
                                      const next = selected
                                        ? current.filter((r: string) => r !== role.name)
                                        : [...current, role.name];
                                      onUpdate(subtask.id, { assigneeRoleRestrictions: next } as any);
                                    }}
                                    className={`flex items-center gap-2 cursor-pointer px-1 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 rounded-md transition-colors ${!canEditTask ? 'opacity-50 pointer-events-none' : ''}`}
                                  >
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${selected ? 'bg-indigo-600 border-indigo-500' : 'border-zinc-600'}`}>
                                      {selected && <Check className="w-2.5 h-2.5 text-white" />}
                                    </div>
                                    <span className="truncate">{role.name}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>

              <Popover.Root open={assigneeOpen} onOpenChange={(open) => { if (!subtask.completed) setAssigneeOpen(open); }}>
              <Popover.Trigger asChild>
                <div
                  title={currentAssignees.map((u) => u.name).join(', ')}
                  className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] select-none w-fit transition-all ${
                    subtask.completed
                      ? 'bg-zinc-800/40 text-zinc-600 cursor-not-allowed grayscale'
                      : 'cursor-pointer bg-zinc-800/50 hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {currentAssignees.length > 0 ? (
                    <>
                      <div className="flex items-center -space-x-1.5">
                        {currentAssignees.slice(0, 2).map((u) => (
                          <div key={u.id} className="relative ring-2 ring-[#121212] rounded-full shrink-0">
                            {u.avatarUrl ? (
                              <img src={u.avatarUrl} alt={u.name} className="w-4 h-4 rounded-full object-cover shrink-0" />
                            ) : (
                              <div className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[7px] font-bold">
                                {(u.name || 'U').substring(0, 2).toUpperCase()}
                              </div>
                            )}
                          </div>
                        ))}
                        {currentAssignees.length > 2 && (
                          <div className="relative ring-2 ring-[#121212] rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-[8px] font-bold h-4 w-4 flex items-center justify-center shrink-0">
                            +{currentAssignees.length - 2}
                          </div>
                        )}
                      </div>
                      {currentAssignees.length === 1 && (
                        <span className="truncate max-w-[90px]">{currentAssignees[0].name}</span>
                      )}
                    </>
                  ) : (
                    <><Plus className="w-3.5 h-3.5 shrink-0" /><span>Assign</span></>
                  )}
                </div>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  className="z-[200] w-72 p-0 bg-[#121212] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden outline-none"
                  side="bottom"
                  align="start"
                  sideOffset={8}
                >
                  <Command className="flex h-full w-full flex-col overflow-hidden bg-transparent">
                    <div className="flex items-center border-b border-zinc-800/60 px-3">
                      <Command.Input 
                        placeholder="Search assignee..." 
                        className="flex h-9 w-full rounded-md bg-transparent py-3 text-[13px] outline-none placeholder:text-zinc-500 text-zinc-200"
                        autoFocus
                      />
                    </div>
                    <Command.List className="max-h-[300px] overflow-y-auto p-1.5 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                      <Command.Empty className="py-4 text-center text-sm text-zinc-500">
                        No user found.
                      </Command.Empty>
                      {currentAssignees.length > 0 && (
                        <Command.Item
                          value="clear all unassigned none"
                          onSelect={() => handleClearAllAssignees()}
                          className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none data-[selected=true]:bg-zinc-800 text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 mb-1 border-b border-zinc-800/40"
                        >
                          <div className="w-5 h-5 rounded-full border border-dashed border-zinc-600 flex items-center justify-center text-[10px] text-zinc-400 mr-2 shrink-0">
                            <X className="w-3 h-3" />
                          </div>
                          <span>Clear all assignees</span>
                        </Command.Item>
                      )}
                      {users?.map((u: any) => {
                        const isAssigned = isUserAssigned(u.id);
                        const initials = (u.name || 'U').substring(0, 2).toUpperCase();
                        const role = u.primaryRole || u.secondaryRole || '';
                        const avatarColors = ['bg-violet-600','bg-blue-600','bg-emerald-600','bg-rose-600','bg-amber-600','bg-cyan-600','bg-fuchsia-600'];
                        const avatarBg = avatarColors[(u.name || '').charCodeAt(0) % avatarColors.length];
                        return (
                          <Command.Item
                            key={u.id}
                            value={`${u.name} ${u.email} ${role}`}
                            onSelect={() => handleToggleAssignee(u)}
                            className="relative flex cursor-pointer select-none items-center rounded-md px-2.5 py-2 outline-none hover:bg-zinc-800/60 text-zinc-300 gap-2.5"
                          >
                            {u.avatarUrl ? (
                              <img src={u.avatarUrl} className="w-8 h-8 rounded-full shrink-0 object-cover" alt="" />
                            ) : (
                              <div className={`w-8 h-8 rounded-full ${avatarBg} flex items-center justify-center text-[11px] font-bold text-white shrink-0`}>
                                {initials}
                              </div>
                            )}
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="truncate text-zinc-100 text-[13px] font-medium">{u.name}</span>
                              {role && <span className="truncate text-[10px] text-zinc-500 uppercase tracking-wide font-medium">{role}</span>}
                            </div>
                            <div className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center transition-all ml-1 ${isAssigned ? 'bg-indigo-600' : 'border border-zinc-700'}`}>
                              {isAssigned && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                            </div>
                          </Command.Item>
                        );
                      })}
                    </Command.List>
                  </Command>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            {currentAssignees.length > 0 && !subtask.completed && (
              <button
                onClick={handleClearAllAssignees}
                className="p-0.5 text-zinc-600 hover:text-zinc-300 transition-colors cursor-pointer shrink-0"
                title="Clear assignee"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            </div>
          </div>

          {/* Priority row */}
          <div className="flex items-center gap-3">
            <Flag className={`w-3.5 h-3.5 shrink-0 ${subtask.priority ? priorityColor : 'text-zinc-500'}`} />
            <Popover.Root open={priorityOpen} onOpenChange={(open) => { if (!subtask.completed) setPriorityOpen(open); }}>
              <Popover.Trigger asChild>
                <div
                  title={subtask.completed ? 'Locked' : (subtask.priority ? subtask.priority.toLowerCase() : 'No priority')}
                  className={`inline-flex items-center h-7 px-2.5 rounded-md text-[11px] select-none w-fit transition-all ${
                    subtask.completed
                      ? 'bg-zinc-800/40 cursor-not-allowed opacity-60'
                      : 'cursor-pointer bg-zinc-800/50 hover:bg-zinc-700/50'
                  }`}
                >
                  <span className={`capitalize ${subtask.priority ? priorityColor : 'text-zinc-500'}`}>
                    {subtask.priority?.toLowerCase() || 'Empty'}
                  </span>
                </div>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  className="z-[200] w-36 p-1.5 bg-[#0f0f0f] border border-zinc-800 rounded-xl shadow-2xl outline-none"
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
        <div className="flex-1 flex flex-col min-w-0 border-l border-r border-zinc-800/60 px-4">
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
              canEditTask={canEditTask}
            />
          </div>
        </div>

        {/* Column 3: Checklists & Comments (Right) */}
        <div className="w-[320px] flex flex-col shrink-0">
          {/* Internal Tabs */}
          <div className="flex items-center gap-4 border-b border-zinc-800/60 mb-4 shrink-0">
            <button
              onClick={() => setActiveTab('audit')}
              className={`pb-2 text-[10px] font-bold uppercase tracking-wider transition-colors relative cursor-pointer ${activeTab === 'audit' ? 'text-zinc-200' : 'text-zinc-500 hover:text-zinc-400'}`}
            >
              <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Audit</span>
              {activeTab === 'audit' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-full" />}
            </button>
            <button
              onClick={() => setActiveTab('checklist')}
              className={`pb-2 text-[10px] font-bold uppercase tracking-wider transition-colors relative cursor-pointer ${activeTab === 'checklist' ? 'text-zinc-200' : 'text-zinc-500 hover:text-zinc-400'}`}
            >
              <span className="flex items-center gap-1.5"><CheckSquare className="w-3.5 h-3.5" /> Checklist</span>
              {activeTab === 'checklist' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-full" />}
            </button>
            <button
              onClick={() => setActiveTab('comments')}
              className={`pb-2 text-[10px] font-bold uppercase tracking-wider transition-colors relative cursor-pointer ${activeTab === 'comments' ? 'text-zinc-200' : 'text-zinc-500 hover:text-zinc-400'}`}
            >
              <span className="flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Comments</span>
              {activeTab === 'comments' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-full" />}
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden pb-2">
            {activeTab === 'checklist' && (
              <div className="flex-1 flex flex-col relative h-full">
                <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col pb-2 pr-1 space-y-4">
                  {subtask.checklists && subtask.checklists.filter((c: any) => !c.name.toLowerCase().includes('audit')).length > 0 ? (
                    subtask.checklists.filter((c: any) => !c.name.toLowerCase().includes('audit')).map((checklist: any) => {
                      const canCheck = true; // Subtask checks are allowed by default for standard checklists

                      return (
                        <div key={checklist.id} className="flex flex-col gap-1.5">
                          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">{checklist.name}</div>
                          {checklist.items?.map((item: any) => (
                            <div 
                              key={item.id} 
                              className={`flex items-start gap-2 group/item ${!canCheck ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                              onClick={() => {
                                if (canCheck) handleToggleItem(checklist.id, item.id, !item.completed);
                              }}
                              title={!canCheck ? "Only Auditors can tick Audit Checklists" : undefined}
                            >
                              <div className={`mt-0.5 w-3 h-3 rounded-[3px] border flex items-center justify-center shrink-0 transition-colors ${item.completed ? 'bg-blue-600 border-blue-600' : 'border-zinc-600 group-hover/item:border-zinc-400'}`}>
                                {item.completed && <Check className="w-2.5 h-2.5 text-white" />}
                              </div>
                              <span className={`text-[11px] leading-snug break-words ${item.completed ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>
                                {item.text}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center">
                      <div className="w-10 h-10 rounded-full bg-zinc-800/50 flex items-center justify-center mb-2">
                        <ListChecks className="w-4 h-4 text-zinc-400" />
                      </div>
                      <h3 className="text-[13px] font-medium text-zinc-300 mb-1">No Checklist</h3>
                      <p className="text-[11px] text-zinc-500 mb-4 max-w-[160px] leading-relaxed">
                        Break this subtask down into smaller steps.
                      </p>
                      <button onClick={() => onOpenSubtask(subtask)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium rounded-lg transition-colors shadow-sm cursor-pointer">
                        Create Checklist
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'audit' && (
              <div className="flex-1 flex flex-col relative h-full">
                <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col pb-2 pr-1 space-y-4">
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Audit Items</div>
                    {getRequiredAudits(subtask.title).map((text, idx) => {
                      const auditChecklist = subtask.checklists?.find((c: any) => c.name.toLowerCase() === 'audit');
                      const item = auditChecklist?.items?.find((i: any) => i.text.toLowerCase() === text.toLowerCase());
                      const isCompleted = !!item?.completed;

                      const roles = [currentUser?.primaryRole, currentUser?.secondaryRole, currentUser?.tertiaryRole, currentUser?.minorRole]
                        .map(r => r?.toLowerCase() || '');
                      const isAdmin = currentUser?.systemRole === 'ADMIN';

                      let canCheck = isAdmin;
                      let requiredRole = "";
                      if (!canCheck) {
                        if (text === 'UI UX Audit') {
                          canCheck = roles.some(r => r.includes('ui/ux') || r.includes('ui ux') || r.includes('ui-ux'));
                          requiredRole = "UI/UX";
                        } else if (text === 'Design Audit') {
                          canCheck = roles.some(r => r.includes('design'));
                          requiredRole = "Designer";
                        } else if (text === 'Funnel Audit') {
                          canCheck = roles.some(r => r.includes('funnel') || r.includes('backend'));
                          requiredRole = "Funnel/Backend";
                        }
                      }

                      const handleToggleAuditItem = async () => {
                        if (!canCheck) return;
                        
                        let targetChecklistId = auditChecklist?.id;
                        let newChecklists = [...(subtask.checklists || [])];

                        try {
                          if (!targetChecklistId) {
                            const res = await tasksApi.createChecklist(taskId!, { name: 'Audit', subtaskId: subtask.id });
                            targetChecklistId = res.checklist.id;
                            newChecklists.push(res.checklist);
                            onUpdate(subtask.id, { checklists: newChecklists });
                          }

                          if (!item) {
                            const res = await tasksApi.createChecklistItem(taskId!, targetChecklistId!, { text });
                            const updatedItem = await tasksApi.updateChecklistItem(taskId!, targetChecklistId!, res.item.id, { completed: true });
                            newChecklists = newChecklists.map((c: any) => c.id === targetChecklistId ? { ...c, items: [...(c.items || []), updatedItem.item] } : c);
                            onUpdate(subtask.id, { checklists: newChecklists });
                          } else {
                            const newCompleted = !isCompleted;
                            newChecklists = newChecklists.map((c: any) => c.id === targetChecklistId ? { ...c, items: c.items.map((i: any) => i.id === item.id ? { ...i, completed: newCompleted } : i) } : c);
                            onUpdate(subtask.id, { checklists: newChecklists });
                            await tasksApi.updateChecklistItem(taskId!, targetChecklistId!, item.id, { completed: newCompleted });
                          }
                        } catch (e) {
                          console.error(e);
                        }
                      };

                      return (
                        <div 
                          key={idx} 
                          className={`flex items-start gap-2 group/item ${!canCheck ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                          onClick={handleToggleAuditItem}
                          title={!canCheck ? `Only ${requiredRole || 'Admins'} can check this item` : undefined}
                        >
                          <div className={`mt-0.5 w-3 h-3 rounded-[3px] border flex items-center justify-center shrink-0 transition-colors ${isCompleted ? 'bg-emerald-600 border-emerald-600' : 'border-zinc-600 group-hover/item:border-zinc-400'}`}>
                            {isCompleted && <Check className="w-2.5 h-2.5 text-white" />}
                          </div>
                          <span className={`text-[11px] leading-snug break-words ${isCompleted ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>
                            {text}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'comments' && (
              <div className="flex-1 flex flex-col relative h-full">
                <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col pb-2 pr-1 space-y-3 min-h-[120px]">
                  {subtask.comments && subtask.comments.length > 0 ? (
                    subtask.comments.map((comment: any) => (
                      <div key={comment.id} className="flex gap-2">
                        {comment.user?.avatarUrl ? (
                          <img src={comment.user.avatarUrl} alt="" className="w-5 h-5 rounded-full shrink-0" />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-bold shrink-0">
                            {comment.user?.name?.charAt(0).toUpperCase() || 'U'}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[11px] font-medium text-zinc-300 truncate">{comment.user?.name || 'Unknown'}</span>
                            <span className="text-[9px] text-zinc-500 shrink-0">{new Date(comment.createdAt).toLocaleDateString()}</span>
                          </div>
                          <p className="text-[11px] text-zinc-400 leading-relaxed break-words">{comment.content}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center">
                      <div className="w-10 h-10 rounded-full bg-zinc-800/50 flex items-center justify-center mb-2">
                        <MessageSquare className="w-4 h-4 text-zinc-400" />
                      </div>
                      <h3 className="text-[13px] font-medium text-zinc-300 mb-1">No Comments</h3>
                      <p className="text-[11px] text-zinc-500 mb-4 max-w-[150px] leading-relaxed">
                        Be the first to share your thoughts.
                      </p>
                    </div>
                  )}
                </div>

                {/* Inline Comment Input */}
                <div className="pt-3 border-t border-zinc-800/60 mt-auto shrink-0 pb-1">
                  <form onSubmit={handleAddComment} className="relative flex items-center">
                    <input
                      type="text"
                      value={commentText}
                      disabled={subtask.completed}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder={subtask.completed ? "Locked" : "Write a comment..."}
                      className="w-full bg-[#18181b] border border-zinc-800 focus:border-zinc-700 rounded-lg pl-3 pr-[70px] py-2 text-[11px] text-zinc-200 placeholder:text-zinc-500 outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <button
                      type="submit"
                      disabled={!commentText.trim() || isSubmittingComment || subtask.completed}
                      className="absolute right-1 flex items-center justify-center gap-1.5 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:bg-transparent disabled:text-zinc-600 text-zinc-300 text-[10px] font-medium rounded transition-colors cursor-pointer"
                    >
                      <Send className="w-3 h-3" />
                      {isSubmittingComment ? '...' : 'Send'}
                    </button>
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

export function SubtasksSection({ task, onUpdateTask, users, addingSubtask, setAddingSubtask, socket, currentUser, onOpenSubtask, listStatuses, teams }: SubtasksSectionProps & { onOpenSubtask?: (subtask: Subtask) => void }) {
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [isSubmittingSubtask, setIsSubmittingSubtask] = useState(false);
  const [showAllSubtasks, setShowAllSubtasks] = useState(false);
  // Local optimistic state — seeded from task.subtasks
  const [localSubtasks, setLocalSubtasks] = useState<Subtask[]>(task.subtasks || []);
  // Ref always holds the latest localSubtasks so async callbacks never read stale state
  const localSubtasksRef = useRef<Subtask[]>(localSubtasks);
  useEffect(() => { localSubtasksRef.current = localSubtasks; }, [localSubtasks]);

  const canEditTask = true;

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
      // Resolve assignees objects from users list when assigneeIds changes
      if ('assigneeIds' in data && Array.isArray((data as any).assigneeIds)) {
        const ids = (data as any).assigneeIds as string[];
        const found = users?.filter((u: any) => ids.includes(u.id)) ?? [];
        (merged as any).assignees = found;
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
      const updated = localSubtasksRef.current.map(s => s.id === subtaskId ? { ...s, ...resSubtask } : s);
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
    if (!newSubtaskTitle.trim() || isSubmittingSubtask) { setAddingSubtask(false); return; }
    setIsSubmittingSubtask(true);
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
    } finally {
      setIsSubmittingSubtask(false);
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
              listStatuses={listStatuses}
              listId={task.listId}
              taskId={task.id}
              commentCount={subtask.comments?.length || 0}
              onAddCommentLocally={(subtaskId, comments) => {
                const currentLocal = localSubtasksRef.current;
                const optimisticSubtasks = currentLocal.map(s => s.id === subtaskId ? { ...s, comments } : s);
                setLocalSubtasks(optimisticSubtasks);
                onUpdateTask({ ...task, subtasks: optimisticSubtasks });
              }}
              canEditTask={canEditTask}
              teams={teams}
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
                disabled={isSubmittingSubtask}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddSubtask();
                  }
                  if (e.key === 'Escape') setAddingSubtask(false);
                }}
                onBlur={() => newSubtaskTitle && !isSubmittingSubtask ? handleAddSubtask() : setAddingSubtask(false)}
                autoFocus={addingSubtask}
                placeholder={isSubmittingSubtask ? "Adding..." : "Add a new subtask..."}
                className="bg-transparent border-none outline-none text-sm text-zinc-200 placeholder:text-zinc-600 w-full focus:ring-0 p-0 disabled:opacity-50"
              />
            </div>
          )}
        </div>


      </div>

    </>
  );
}


