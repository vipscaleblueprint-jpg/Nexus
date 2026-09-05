import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, User, Flag, CircleDashed, CheckSquare, Link2, ListTodo, Paperclip, Check, ChevronRight, Pencil } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Task } from '@/lib/types';
import { useAppStore } from '@/lib/store';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  socket?: any; // Socket instance for real-time activity
  onStatusChange?: (newStatus: string) => void;
  onUpdateTask?: (task: Task) => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-zinc-400 bg-zinc-800',
  MEDIUM: 'text-blue-400 bg-blue-500/20',
  HIGH: 'text-orange-400 bg-orange-500/20',
  URGENT: 'text-red-400 bg-red-500/20',
};

const STATUS_COLORS: Record<string, string> = {
  TODO: 'bg-zinc-700 text-zinc-300',
  IN_PROGRESS: 'bg-blue-600 text-white',
  DONE: 'bg-emerald-600 text-white',
  CANCELLED: 'bg-red-700/60 text-red-200',
};

export function TaskDetailModal({ isOpen, onClose, task, socket, onStatusChange, onUpdateTask }: Props) {
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [comment, setComment] = useState('');
  const [activities, setActivities] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null); // Name of user currently editing
  const [localDescription, setLocalDescription] = useState(task?.description || '');

  const { currentUser } = useAppStore();

  // Keep localDescription in sync with task prop changes (e.g. from socket updates)
  useEffect(() => {
    if (!isEditing) {
      setLocalDescription(task?.description || '');
    }
  }, [task?.description, isEditing]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit],
    editable: isEditing,
    content: localDescription || '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm prose-invert prose-zinc max-w-none focus:outline-none min-h-[60px] text-zinc-300',
      },
    },
    onUpdate: ({ editor: ed }) => {
      // Broadcast live content to other users while editing
      if (!socket || !task) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        socket.emit('task_editing_content', {
          listId: task.listId,
          taskId: task.id,
          content: ed.getHTML(),
        });
      }, 150);
    },
  });

  // Update editor editable state when isEditing changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(isEditing);
    }
  }, [editor, isEditing]);

  // Sync editor content when localDescription changes and not editing
  useEffect(() => {
    if (editor && !isEditing && !editor.isFocused) {
      const currentContent = editor.getHTML();
      if (currentContent !== localDescription) {
        editor.commands.setContent(localDescription || '');
      }
    }
  }, [editor, localDescription, isEditing]);

  // Socket: listen for editing lock and description updates
  useEffect(() => {
    if (!socket || !task) return;

    const handleEditingStart = (data: { taskId: string; userName: string }) => {
      if (data.taskId === task.id && data.userName !== currentUser?.name) {
        setEditingUser(data.userName);
      }
    };

    const handleEditingStop = (data: { taskId: string; description: string }) => {
      if (data.taskId === task.id) {
        setEditingUser(null);
        setLocalDescription(data.description);
        // Also update the task via callback so the board state is synced
        if (onUpdateTask && task) {
          onUpdateTask({ ...task, description: data.description });
        }
      }
    };

    // Live content streaming: update editor as the other user types
    const handleEditingContent = (data: { taskId: string; content: string }) => {
      if (data.taskId === task.id) {
        setLocalDescription(data.content);
      }
    };

    const handleActivity = (data: any) => {
      if (data.taskId === task.id) {
        setActivities(prev => [...prev, data.activity]);
      }
    };

    socket.on('task_editing_start', handleEditingStart);
    socket.on('task_editing_stop', handleEditingStop);
    socket.on('task_editing_content', handleEditingContent);
    socket.on('task_activity', handleActivity);

    return () => {
      socket.off('task_editing_start', handleEditingStart);
      socket.off('task_editing_stop', handleEditingStop);
      socket.off('task_editing_content', handleEditingContent);
      socket.off('task_activity', handleActivity);
    };
  }, [socket, task?.id, currentUser?.name]);

  const logActivity = (activity: any) => {
    const act = { ...activity, id: Date.now(), date: new Date() };
    setActivities(prev => [...prev, act]);
    if (socket && task) {
      socket.emit('task_activity', { listId: task.listId, taskId: task.id, activity: act });
    }
  };

  // Start editing: lock the description for this user
  const handleStartEditing = useCallback(() => {
    setIsEditing(true);
    if (socket && task) {
      socket.emit('task_editing_start', {
        listId: task.listId,
        taskId: task.id,
        userName: currentUser?.name || 'Someone',
      });
    }
    // Focus the editor after a tick
    setTimeout(() => editor?.commands.focus('end'), 50);
  }, [socket, task, currentUser, editor]);

  // Stop editing: save and unlock
  const handleStopEditing = useCallback(() => {
    if (!editor || !task) return;
    const html = editor.getHTML();
    setIsEditing(false);
    setLocalDescription(html);

    // Persist to DB
    if (onUpdateTask) {
      onUpdateTask({ ...task, description: html });
    }

    // Broadcast stop + new description to other users
    if (socket) {
      socket.emit('task_editing_stop', {
        listId: task.listId,
        taskId: task.id,
        description: html,
      });
    }
  }, [editor, task, onUpdateTask, socket]);

  const [isAssigneeOpen, setIsAssigneeOpen] = useState(false);
  const [isPriorityOpen, setIsPriorityOpen] = useState(false);
  
  // Resizable activity panel
  const [activityWidth, setActivityWidth] = useState(450);
  const isResizing = useRef(false);

  const startResizing = React.useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
  }, []);

  const stopResizing = React.useCallback(() => {
    isResizing.current = false;
    document.body.style.cursor = 'default';
  }, []);

  const resize = React.useCallback((e: MouseEvent) => {
    if (isResizing.current) {
      const newWidth = document.body.clientWidth - e.clientX;
      if (newWidth > 300 && newWidth < 800) {
        setActivityWidth(newWidth);
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  if (!isOpen || !task) return null;

  const handleStatusClick = () => {
    const statuses = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
    const currentIndex = statuses.indexOf(task.status || 'TODO');
    const nextIndex = (currentIndex + 1) % statuses.length;
    const newStatus = statuses[nextIndex];
    if (onStatusChange) onStatusChange(newStatus);
    
    // Log activity
    logActivity({
      type: 'status_change',
      author: currentUser?.name || 'You',
      oldStatus: task.status,
      newStatus: newStatus,
    });
  };

  const handleAddComment = () => {
    if (!comment.trim()) return;
    logActivity({
      type: 'comment',
      author: currentUser?.name || 'You',
      text: comment.trim(),
    });
    setComment('');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      logActivity({
        type: 'attachment',
        author: currentUser?.name || 'You',
        fileName: file.name,
      });
    }
  };

  return (
    <div 
      className="w-full h-full bg-[#121212] flex flex-col overflow-hidden"
      onClick={e => e.stopPropagation()}
    >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60 shrink-0 bg-[#18181b]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 font-mono">Task ID: {task.id.slice(0, 8)}</span>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={onClose} 
              className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content area: Split layout */}
        <div className="flex flex-1 overflow-hidden">
          
          {/* Left Panel: Details & Description */}
          <div className="flex-1 overflow-y-auto border-r border-zinc-800/60 custom-scrollbar">
            <div className="p-8">
              
              <h1 className="text-2xl font-bold text-zinc-100 mb-8">{task.title}</h1>
              
              {/* Properties Grid */}
              <div className="flex flex-col gap-5 mb-10 w-full max-w-sm">
                
                {/* Status */}
                <div className="grid grid-cols-[120px_1fr] items-center">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <CircleDashed className="w-4 h-4" />
                    <span className="text-sm font-medium">Status</span>
                  </div>
                  <div className="flex items-center">
                    <div className={`flex items-center rounded-sm overflow-hidden ${STATUS_COLORS[task.status] ?? 'bg-zinc-700 text-zinc-300'}`}>
                      <span className="text-[11px] font-bold px-2.5 py-1 uppercase tracking-wide cursor-default">
                        {task.status.replace('_', ' ')}
                      </span>
                      <div className="w-[1px] h-3 bg-black/20" />
                      <button 
                        onClick={handleStatusClick}
                        title="Next status"
                        className="px-1.5 py-1 hover:bg-black/10 transition-colors flex items-center justify-center cursor-pointer"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {task.status !== 'DONE' && (
                      <button
                        onClick={() => {
                          if (onStatusChange) onStatusChange('DONE');
                          logActivity({ type: 'status_change', author: currentUser?.name || 'You', oldStatus: task.status, newStatus: 'DONE' });
                        }}
                        title="Mark as Closed"
                        className="w-5 h-5 ml-1.5 rounded-sm bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center transition-colors shadow-sm cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Assignees */}
                <div className="grid grid-cols-[120px_1fr] items-center">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <User className="w-4 h-4" />
                    <span className="text-sm font-medium">Assignees</span>
                  </div>
                  <div>
                    <Popover.Root open={isAssigneeOpen} onOpenChange={setIsAssigneeOpen}>
                      <Popover.Trigger asChild>
                        <div className="cursor-pointer inline-flex items-center hover:bg-zinc-800/50 p-1 -ml-1 rounded transition-colors">
                          {task.assignee ? (
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] text-white font-bold shrink-0">
                                {task.assignee.name?.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-sm text-zinc-300">{task.assignee.name}</span>
                            </div>
                          ) : (
                            <span className="text-sm text-zinc-500 border border-dashed border-zinc-700 px-2.5 py-1 rounded-sm">Empty</span>
                          )}
                        </div>
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content className="z-50 w-56 p-0 bg-[#121212] border border-zinc-800 rounded-md shadow-xl outline-none overflow-hidden" align="start" sideOffset={4}>
                          <Command className="flex flex-col bg-transparent">
                            <Command.Input placeholder="Search assignee..." className="flex h-10 w-full bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-500 border-b border-zinc-800/60 text-zinc-200" />
                            <Command.List className="max-h-[200px] overflow-y-auto p-1.5 custom-scrollbar">
                              <Command.Empty className="py-4 text-center text-sm text-zinc-500">No assignee found.</Command.Empty>
                              {[{ id: '1', name: 'Aaron' }, { id: '2', name: 'Jenesia Red' }, { id: '3', name: 'Kelly Riley' }].map(u => (
                                <Command.Item
                                  key={u.id}
                                  value={u.name}
                                  onSelect={() => { 
                                    if (onUpdateTask) onUpdateTask({ ...task, assignee: u as any });
                                    else task.assignee = u as any;
                                    setIsAssigneeOpen(false);
                                  }}
                                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-zinc-800 data-[selected=true]:text-zinc-100 text-zinc-300 hover:bg-zinc-800"
                                >
                                  <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-[9px] text-white font-bold mr-2">
                                    {u.name.charAt(0).toUpperCase()}
                                  </div>
                                  {u.name}
                                </Command.Item>
                              ))}
                            </Command.List>
                          </Command>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  </div>
                </div>

                {/* Priority */}
                <div className="grid grid-cols-[120px_1fr] items-center">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <Flag className="w-4 h-4" />
                    <span className="text-sm font-medium">Priority</span>
                  </div>
                  <div>
                    <Popover.Root open={isPriorityOpen} onOpenChange={setIsPriorityOpen}>
                      <Popover.Trigger asChild>
                        <div className="cursor-pointer inline-flex items-center hover:bg-zinc-800/50 p-1 -ml-1 rounded transition-colors">
                          {task.priority ? (
                            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-sm uppercase ${PRIORITY_COLORS[task.priority] ?? 'text-zinc-400 bg-zinc-800'}`}>
                              {task.priority}
                            </span>
                          ) : (
                            <span className="text-sm text-zinc-500 border border-dashed border-zinc-700 px-2.5 py-1 rounded-sm">Empty</span>
                          )}
                        </div>
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content className="z-50 w-40 p-1.5 bg-[#121212] border border-zinc-800 rounded-md shadow-xl outline-none" align="start" sideOffset={4}>
                          {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map(p => (
                            <div
                              key={p}
                              onClick={() => {
                                if (onUpdateTask) onUpdateTask({ ...task, priority: p as any });
                                else task.priority = p as any;
                                setIsPriorityOpen(false);
                              }}
                              className="cursor-pointer flex items-center px-2 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 rounded-sm"
                            >
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${PRIORITY_COLORS[p]}`}>{p}</span>
                            </div>
                          ))}
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  </div>
                </div>

              </div>

              {/* Description */}
              <div className="mt-8 relative group">
                {/* Edit button + lock indicator */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Description</span>
                  <div className="flex items-center gap-2">
                    {editingUser && (
                      <span className="text-xs text-amber-400/80 flex items-center gap-1.5 animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                        {editingUser} is editing...
                      </span>
                    )}
                    {isEditing ? (
                      <button
                        onClick={handleStopEditing}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Save
                      </button>
                    ) : (
                      <button
                        onClick={handleStartEditing}
                        disabled={!!editingUser}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-800 disabled:hover:text-zinc-300 cursor-pointer"
                        title={editingUser ? `${editingUser} is currently editing` : 'Edit description'}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                    )}
                  </div>
                </div>

                <div 
                  className={`relative p-2 -ml-2 rounded-lg transition-colors ${isEditing ? 'bg-zinc-800/40 ring-1 ring-zinc-700/50' : 'hover:bg-zinc-800/20'} ${!isDescExpanded ? 'max-h-[250px] overflow-hidden' : ''}`}
                  onClick={() => isEditing && editor?.commands.focus()}
                >
                  <EditorContent editor={editor} />
                  
                  {!editor?.getText() && !isEditing && (
                    <div className="absolute top-2 left-2 text-sm text-zinc-500 italic pointer-events-none">
                      Add description...
                    </div>
                  )}

                  {!isDescExpanded && (editor?.getText().length || 0) > 300 && (
                    <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#121212] to-transparent pointer-events-none" />
                  )}
                </div>
                {(editor?.getText().length || 0) > 300 && (
                  <button 
                    onClick={() => setIsDescExpanded(!isDescExpanded)}
                    className="mt-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1 bg-zinc-800/50 hover:bg-zinc-800 px-2 py-1 rounded"
                  >
                    <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isDescExpanded ? '-rotate-90' : 'rotate-90'}`} />
                    {isDescExpanded ? 'Collapse' : 'Expand'}
                  </button>
                )}
              </div>

              {/* Action Buttons (Notes, Attachments, etc) */}
              <div className="mt-12 flex flex-col gap-2 max-w-md">
                <button className="flex items-center gap-3 text-zinc-400 hover:text-zinc-200 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors w-full text-left text-sm font-medium cursor-pointer">
                  <CheckSquare className="w-4 h-4 shrink-0" /> Add subtask
                </button>
                <button className="flex items-center gap-3 text-zinc-400 hover:text-zinc-200 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors w-full text-left text-sm font-medium cursor-pointer">
                  <Link2 className="w-4 h-4 shrink-0" /> Relate items or add dependencies
                </button>
                <button className="flex items-center gap-3 text-zinc-400 hover:text-zinc-200 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors w-full text-left text-sm font-medium cursor-pointer">
                  <ListTodo className="w-4 h-4 shrink-0" /> Create checklist
                </button>
                <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-3 text-zinc-400 hover:text-zinc-200 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors w-full text-left text-sm font-medium cursor-pointer">
                  <Paperclip className="w-4 h-4 shrink-0" /> Attach file
                </button>
              </div>
              
            </div>
          </div>

          {/* Resizer */}
          <div 
            className="w-1 bg-zinc-800/30 hover:bg-indigo-500 cursor-col-resize shrink-0 transition-colors z-10"
            onMouseDown={startResizing}
          />

          {/* Right Panel: Activity */}
          <div style={{ width: activityWidth }} className="flex-shrink-0 bg-[#18181b] flex flex-col border-l border-zinc-800/60">
            <div className="px-6 py-5 border-b border-zinc-800/60 shrink-0 flex items-center justify-between">
              <h3 className="font-semibold text-sm text-zinc-200">Activity</h3>
              <div className="flex gap-3">
                <span className="text-zinc-500 text-xs">Created {new Date(task.createdAt || Date.now()).toLocaleDateString()}</span>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              <div className="space-y-6">
                
                {/* Mock Activity Items in ClickUp style */}
                <div className="flex gap-4 text-sm text-zinc-400 items-start">
                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
                  <div className="flex-1 leading-snug">
                    <span className="text-zinc-200 font-medium">System</span> created this task
                  </div>
                  <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                    {new Date(task.createdAt || Date.now()).toLocaleDateString()}
                  </span>
                </div>

                {activities.map(act => {
                  if (act.type === 'status_change') {
                    return (
                      <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start">
                        <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
                        <div className="flex-1 leading-snug">
                          <span className="text-zinc-200 font-medium">{act.author || 'Someone'}</span> changed status from 
                          <span className="inline-block w-2 h-2 rounded-sm bg-zinc-600 mx-1.5"/>{act.oldStatus || 'TODO'} to 
                          <span className="inline-block w-2 h-2 rounded-sm bg-blue-500 mx-1.5"/>{act.newStatus}
                        </div>
                        <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                          {new Date(act.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  }
                  if (act.type === 'comment') {
                    return (
                      <div key={act.id} className="flex gap-3 text-sm items-start">
                        <div className="w-7 h-7 rounded-full bg-indigo-600 shrink-0 flex items-center justify-center text-white text-xs font-bold">
                          {(act.author || 'U').charAt(0)}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-zinc-200 font-medium">{act.author || 'Someone'}</span>
                            <span className="text-[10px] text-zinc-500">{new Date(act.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div className="text-zinc-300 bg-zinc-800/40 p-2.5 rounded-lg border border-zinc-700/50 inline-block">
                            {act.text}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  if (act.type === 'attachment') {
                    return (
                      <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start">
                        <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
                        <div className="flex-1 leading-snug">
                          <span className="text-zinc-200 font-medium">{act.author}</span> attached a file: 
                          <span className="text-indigo-400 ml-1">{act.fileName}</span>
                        </div>
                        <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                          Just now
                        </span>
                      </div>
                    );
                  }
                  return null;
                })}
                
              </div>
            </div>

            {/* Comment Input */}
            <div className="p-5 border-t border-zinc-800/60 shrink-0 bg-[#18181b]">
              <div className="relative">
                <textarea 
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleAddComment();
                    }
                  }}
                  className="w-full bg-[#121212] border border-zinc-800 rounded-lg pl-4 pr-12 py-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 resize-none h-[80px] custom-scrollbar"
                  placeholder="Write a comment... (Press Enter to post)"
                />
                <button 
                  onClick={handleAddComment}
                  disabled={!comment.trim()}
                  className="absolute right-3 bottom-3 p-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white transition-colors"
                >
                  <span className="text-xs font-bold">Post</span>
                </button>
              </div>
            </div>
          </div>
          
        </div>
    </div>
  );
}
