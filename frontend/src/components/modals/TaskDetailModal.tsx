import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, User, Flag, CircleDashed, CheckSquare, Link2, ListTodo, Paperclip, Check, ChevronRight, ChevronDown, Pencil, Lock, Send, ThumbsUp, SmilePlus, MessageSquare, Plus, AlignLeft } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { BlockEditor } from '../ui/BlockEditor';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { uploadApi } from '@/api/upload';
import { Task, User as UserModel, Priority } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { canUserMoveTask } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { usersApi, tasksApi } from '@/api';
import { SubtasksSection } from './SubtasksSection';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  socket?: any; // Socket instance for real-time activity
  onStatusChange?: (newStatus: string) => void;
  onUpdateTask?: (task: Task) => void;
  listStatuses?: any[];
  workspaceRoles?: any[];
}

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-zinc-400 bg-zinc-800',
  MEDIUM: 'text-blue-400 bg-blue-500/20',
  HIGH: 'text-orange-400 bg-orange-500/20',
  URGENT: 'text-red-400 bg-red-500/20',
};

const ALL_STATUSES = [
  'KYC',
  'Pin Board',
  'Daily',
  'Weekly',
  'Monthly',
  'Pending',
  'In Progress',
  'Revision',
  'Waiting',
  'In Review',
  'Checking',
  'On-Hold',
  'Closed',
];

const STATUS_COLORS: Record<string, string> = {
  KYC: 'bg-cyan-600 text-white',
  'Pin Board': 'bg-blue-600 text-white',
  PIN_BOARD: 'bg-blue-600 text-white',
  Daily: 'bg-purple-600 text-white',
  Weekly: 'bg-indigo-600 text-white',
  Monthly: 'bg-violet-600 text-white',
  Pending: 'bg-amber-600 text-white',
  PENDING: 'bg-amber-600 text-white',
  'In Progress': 'bg-blue-600 text-white',
  IN_PROGRESS: 'bg-blue-600 text-white',
  Revision: 'bg-rose-600 text-white',
  REVISION: 'bg-rose-600 text-white',
  Waiting: 'bg-orange-600 text-white',
  WAITING: 'bg-orange-600 text-white',
  'In Review': 'bg-purple-600 text-white',
  IN_REVIEW: 'bg-purple-600 text-white',
  Checking: 'bg-teal-600 text-white',
  CHECKING: 'bg-teal-600 text-white',
  'On-Hold': 'bg-zinc-700 text-zinc-300',
  ON_HOLD: 'bg-zinc-700 text-zinc-300',
  Closed: 'bg-emerald-600 text-white',
  CLOSED: 'bg-emerald-600 text-white',
  TODO: 'bg-zinc-700 text-zinc-300',
  DONE: 'bg-emerald-600 text-white',
  CANCELLED: 'bg-red-700/60 text-red-200',
};

export function TaskDetailModalContent({
  isOpen,
  onClose,
  task,
  socket,
  onStatusChange,
  onUpdateTask,
  listStatuses = [],
  workspaceRoles = [],
}: Props) {
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [comment, setComment] = useState('');
  const [activities, setActivities] = useState<any[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [dbUsers, setDbUsers] = useState<UserModel[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [activeSubtask, setActiveSubtask] = useState<any>(null);
  const [editingUser, setEditingUser] = useState<string | null>(null); // Name of user currently editing
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [localDescription, setLocalDescription] = useState(task?.description || '');
  const [localTitle, setLocalTitle] = useState(task?.title || '');
  const [isActivityExpanded, setIsActivityExpanded] = useState(false);
  const assigneeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mentions
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [mentionedUsers, setMentionedUsers] = useState<{ id: string; name: string }[]>([]);

  // Comments with reactions + replies
  const [richComments, setRichComments] = useState<any[]>([]);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [showEmojiPickerFor, setShowEmojiPickerFor] = useState<string | null>(null);

  const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀'];

  const markdownComponents = React.useMemo(() => ({
    a: (props: any) => {
      const { node, ...rest } = props;
      const href = rest.href || '';
      if (href.match(/\.(mp4|webm|ogg|mov)$/i)) {
        return (
          <span className="mt-2 mb-2 inline-block">
            <video 
              src={href} 
              className="max-w-[200px] max-h-[150px] object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity bg-black/50"
              onClick={(e) => {
                e.preventDefault();
                setLightboxImage(href);
              }}
            ></video>
          </span>
        );
      }
      if (href.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
        return (
          <span className="mt-2 mb-2 inline-block">
            <img 
              src={href} 
              alt="attachment" 
              className="max-w-[200px] max-h-[150px] object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity" 
              onClick={(e) => {
                e.preventDefault();
                setLightboxImage(href);
              }}
            />
          </span>
        );
      }
      if (href.startsWith('mention://')) {
        const userId = href.replace('mention://', '');
        return (
          <a 
            href={`/profile/${userId}`} 
            onClick={(e) => {
              // Just a dummy action for now, usually navigates to user profile
              e.stopPropagation();
            }}
            className="bg-blue-500/10 text-blue-400 hover:text-blue-300 font-medium px-1 rounded hover:underline cursor-pointer"
          >
            {rest.children}
          </a>
        );
      }
      return <a {...rest} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{rest.children}</a>;
    },
    img: (props: any) => {
      const { node, ...rest } = props;
      return (
        <span className="mt-2 mb-2 inline-block">
          <img 
            {...rest}
            className="max-w-[200px] max-h-[150px] object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity" 
            onClick={(e) => {
              e.preventDefault();
              setLightboxImage(rest.src);
            }}
          />
        </span>
      );
    }
  }), []);

  const { currentUser } = useAppStore();

  // Fetch real users from DB for assignee picker
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await usersApi.getUsers();
        if (!cancelled && res?.users) {
          setDbUsers(res.users);
        }
      } catch (e) {
        console.error('Failed to load users for assignee picker:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onUpdateTaskRef = useRef(onUpdateTask);
  useEffect(() => {
    onUpdateTaskRef.current = onUpdateTask;
  }, [onUpdateTask]);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Fetch persistent activities and comments from DB
  const loadActivities = useCallback(async () => {
    if (!task?.id) return;
    try {
      setLoadingActivities(true);
      const [actRes, commentRes, taskRes] = await Promise.all([
        tasksApi.getActivities(task.id),
        tasksApi.getComments(task.id),
        tasksApi.getTask(task.id),
      ]);
      if (!isMountedRef.current) return;
      if (actRes?.activities) setActivities(actRes.activities);
      if (commentRes?.comments) setRichComments(commentRes.comments);
      if (taskRes?.task && onUpdateTaskRef.current) {
        onUpdateTaskRef.current(taskRes.task);
      }
    } catch (err) {
      console.error('Failed to load task data:', err);
    } finally {
      if (isMountedRef.current) setLoadingActivities(false);
    }
  }, [task?.id]);

  const handleToggleReaction = async (commentId: string, emoji: string) => {
    if (!task?.id || !currentUser?.id) return;
    try {
      const res = await tasksApi.toggleCommentReaction(task.id, commentId, emoji, currentUser.id);
      setRichComments(prev => prev.map(c => {
        if (c.id === commentId) return { ...c, reactions: res.reactions };
        // also check replies
        return { ...c, replies: c.replies?.map((r: any) => r.id === commentId ? { ...r, reactions: res.reactions } : r) };
      }));
      setShowEmojiPickerFor(null);
    } catch (err) { console.error('Reaction failed:', err); }
  };

  const handleSubmitReply = async (parentCommentId: string) => {
    if (!replyText.trim() || !task?.id || !currentUser?.id || isSubmittingReply) return;
    setIsSubmittingReply(true);
    try {
      await tasksApi.addComment(task.id, replyText.trim(), currentUser.id, undefined, [], parentCommentId);
      setReplyText('');
      setReplyingToId(null);
      // Refresh comments
      const res = await tasksApi.getComments(task.id);
      if (res?.comments) setRichComments(res.comments);
    } catch (err) { 
      console.error('Reply failed:', err); 
    } finally {
      setIsSubmittingReply(false);
    }
  };

  useEffect(() => {
    if (isOpen && task?.id) {
      loadActivities();
    }
  }, [isOpen, task?.id, loadActivities]);

  // Keep localDescription in sync with task prop changes (e.g. from socket updates)
  useEffect(() => {
    setLocalDescription(task?.description || '');
  }, [task?.description]);

  // Keep localTitle in sync with task prop changes
  useEffect(() => {
    setLocalTitle(task?.title || '');
  }, [task?.title]);

  const handleTitleBlur = () => {
    const trimmed = localTitle.trim();
    if (!trimmed) { setLocalTitle(task?.title || ''); return; }
    if (trimmed !== task?.title && task) {
      tasksApi.updateTask(task.id, {
        title: trimmed,
        currentListId: task.listId,
        userId: currentUser?.id,
      }).catch(err => console.error('Failed to save title:', err));
      if (onUpdateTask) onUpdateTask({ ...task, title: trimmed });
    }
  };

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDescChange = (html: string) => {
    setLocalDescription(html);
    if (socket && task) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        socket.emit('task_editing_content', {
          listId: task.listId,
          taskId: task.id,
          content: html,
        });
      }, 150);
    }
  };

  const handleDescBlur = () => {
    if (localDescription !== task?.description && task) {
      tasksApi.updateTask(task.id, {
        description: localDescription,
        currentListId: task.listId,
        userId: currentUser?.id,
      }).catch(err => console.error('Failed to save description:', err));
      
      if (onUpdateTask) {
        onUpdateTask({ ...task, description: localDescription });
      }
    }
      
    if (socket && task) {
      socket.emit('task_editing_stop', {
        listId: task.listId,
        taskId: task.id,
        description: localDescription,
      });
    }
  };

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
        setActivities(prev => {
          if (prev.some(a => a.id === data.activity.id)) return prev;
          return [...prev, data.activity];
        });
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
    if (socket && task) {
      socket.emit('task_editing_start', {
        listId: task.listId,
        taskId: task.id,
        userName: currentUser?.name || 'Someone',
      });
    }
  }, [socket, task, currentUser]);

  const [isAssigneeOpen, setIsAssigneeOpen] = useState(false);
  const [isPriorityOpen, setIsPriorityOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  
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

  const permission = canUserMoveTask(task, listStatuses, currentUser, workspaceRoles);

  const handleStatusChangeAction = async (newStatus: string) => {
    if (!permission.allowed) {
      toast.error(permission.reason || 'You do not have permission to move tasks from this status');
      return;
    }
    if (!task) return;

    const oldStatus = task.status;
    if (onStatusChange) onStatusChange(newStatus);
    else task.status = newStatus;

    try {
      const res = await tasksApi.moveTask(task.id, newStatus, task.listId, currentUser?.id);
      if (res?.activity) {
        setActivities(prev => {
          if (prev.some(a => a.id === res.activity.id)) return prev;
          return [...prev, res.activity];
        });
      } else {
        loadActivities();
      }
      toast.success(`Moved to ${newStatus}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to move task');
    }
  };

  const handleStatusClick = () => {
    const statuses = ALL_STATUSES;
    const currentIndex = statuses.indexOf(task.status || 'Pending');
    const nextIndex = (currentIndex + 1) % statuses.length;
    const newStatus = statuses[nextIndex];
    handleStatusChangeAction(newStatus);
  };

  const currentAssignees: UserModel[] = (task?.assignees && task.assignees.length > 0)
    ? task.assignees
    : (task?.assignee ? [task.assignee] : []);

  const isUserAssigned = (userId: string) => currentAssignees.some((u) => u.id === userId);

  const persistAssignees = useCallback(
    async (taskToUpdate: Task, updatedIds: string[], primaryAssignee: UserModel | null) => {
      try {
        await tasksApi.updateTask(taskToUpdate.id, {
          assigneeIds: updatedIds,
          assigneeId: primaryAssignee?.id || null,
          currentListId: taskToUpdate.listId,
          userId: currentUser?.id,
        });
        loadActivities();
      } catch (err: any) {
        console.error('Failed to persist assignees:', err);
      }
    },
    [currentUser?.id, loadActivities]
  );

  const handleToggleAssignee = (user: UserModel) => {
    if (!task) return;
    const isAssigned = isUserAssigned(user.id);
    const updatedAssignees = isAssigned
      ? currentAssignees.filter((u) => u.id !== user.id)
      : [...currentAssignees, user];

    const updatedIds = updatedAssignees.map((u) => u.id);
    const primaryAssignee = updatedAssignees.length > 0 ? updatedAssignees[0] : null;

    const updatedTask: Task = {
      ...task,
      assignees: updatedAssignees,
      assigneeIds: updatedIds,
      assignee: primaryAssignee,
      assigneeId: primaryAssignee?.id || null,
    };

    // 1. Instant local update (0ms lag, immediate visual feedback)
    if (onUpdateTask) {
      onUpdateTask(updatedTask);
    } else {
      task.assignees = updatedAssignees;
      task.assigneeIds = updatedIds;
      task.assignee = primaryAssignee;
      task.assigneeId = primaryAssignee?.id || null;
    }

    // 2. Debounced remote persistence (batches rapid toggles into one clean request)
    if (assigneeDebounceRef.current) {
      clearTimeout(assigneeDebounceRef.current);
    }
    assigneeDebounceRef.current = setTimeout(() => {
      persistAssignees(updatedTask, updatedIds, primaryAssignee);
    }, 400);
  };

  const handleClearAllAssignees = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!task) return;

    if (assigneeDebounceRef.current) {
      clearTimeout(assigneeDebounceRef.current);
    }

    const updatedTask: Task = {
      ...task,
      assignees: [],
      assigneeIds: [],
      assignee: null,
      assigneeId: null,
    };

    if (onUpdateTask) {
      onUpdateTask(updatedTask);
    } else {
      task.assignees = [];
      task.assigneeIds = [];
      task.assignee = null;
      task.assigneeId = null;
    }
    setIsAssigneeOpen(false);

    persistAssignees(updatedTask, [], null);
  };

  const handlePriorityChange = async (p: Priority) => {
    if (!task) return;
    const oldPriority = task.priority;
    if (onUpdateTask) {
      onUpdateTask({ ...task, priority: p });
    } else {
      task.priority = p;
    }
    setIsPriorityOpen(false);

    try {
      await tasksApi.updateTask(task.id, {
        priority: p,
        currentListId: task.listId,
        userId: currentUser?.id,
      });
      loadActivities();
      toast.success(`Priority set to ${p}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update priority');
    }
  };

  const handleAddComment = async () => {
    const trimmed = comment.trim();
    if (!trimmed && stagedFiles.length === 0) return;
    if (!task) return;
    
    setIsUploading(true);
    let finalComment = trimmed;
    
    try {
      if (stagedFiles.length > 0) {
        for (const file of stagedFiles) {
          const res = await uploadApi.uploadFile(file, 'comments');
          if (file.type.startsWith('image/')) {
            finalComment += `\n\n![${file.name}](${res.url})`;
          } else if (file.type.startsWith('video/')) {
            finalComment += `\n\n<video controls src="${res.url}" class="w-full max-w-[250px] rounded-md mt-2"></video>`;
          } else {
            finalComment += `\n\n[${file.name}](${res.url})`;
          }
        }
      }

      if (!finalComment.trim()) {
        setIsUploading(false);
        return;
      }

      const res = await tasksApi.addComment(
        task.id,
        finalComment,
        currentUser?.id || '',
        task.listId,
        mentionedUsers.map(u => u.id)
      );
      
      setComment('');
      setStagedFiles([]);
      setMentionedUsers([]);

      if (res?.activity) {
        setActivities(prev => {
          if (prev.some(a => a.id === res.activity.id)) return prev;
          return [...prev, res.activity];
        });
      }
      // Always reload to get fresh richComments + reactions
      loadActivities();
    } catch (err: any) {
      toast.error(err.message || 'Failed to post comment');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDescriptionFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        setIsUploading(true);
        const res = await uploadApi.uploadFile(file, 'description');
        let newContent = '';
        if (file.type.startsWith('image/')) {
          newContent = `<img src="${res.url}" />`;
        } else {
          newContent = `<a href="${res.url}" target="_blank" class="text-blue-400 hover:underline">${file.name}</a>`;
        }
        
        const updatedDesc = localDescription ? localDescription + '<br/>' + newContent : newContent;
        setLocalDescription(updatedDesc);
        
        if (socket && task.listId) {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          socket.emit('task_editing_content', {
            listId: task.listId,
            taskId: task.id,
            content: updatedDesc,
          });
          if (onUpdateTask) {
            onUpdateTask({ ...task, description: updatedDesc });
          }
        }
        toast.success('File attached');
      } catch (err: any) {
        toast.error(err.message || 'Failed to attach file');
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleCommentFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setStagedFiles(prev => [...prev, file]);
    }
    if (commentFileInputRef.current) {
      commentFileInputRef.current.value = '';
    }
  };
  if (activeSubtask) {
    return (
      <SubtaskDetailView
        subtask={activeSubtask}
        parentTask={task}
        onClose={() => setActiveSubtask(null)}
        currentUser={currentUser}
        socket={socket}
      />
    );
  }

  return (
    <>
      <div 
      className="w-full h-full bg-[#121212] flex flex-col overflow-hidden cursor-default"
      onClick={e => e.stopPropagation()}
    >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60 shrink-0 bg-[#18181b]">
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500 font-mono">Task ID: {task.id.slice(0, 8)}</span>
            <button
              onClick={() => {
                const url = task.listId
                  ? `${window.location.origin}/lists/${task.listId}?task=${task.id}`
                  : `${window.location.origin}/tasks/${task.id}`;
                navigator.clipboard.writeText(url);
                setCopiedLink(true);
                setTimeout(() => setCopiedLink(false), 2000);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-md text-xs transition-colors border border-zinc-700/50 cursor-pointer"
            >
              <Link2 className="w-3.5 h-3.5 text-purple-400" />
              <span>{copiedLink ? 'Copied Link!' : 'Copy Link'}</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={onClose} 
              className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white transition-colors cursor-pointer"
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
              
              <input
                type="text"
                value={localTitle}
                onChange={(e) => setLocalTitle(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                className="text-2xl font-bold text-zinc-100 mb-8 bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-zinc-500 focus:outline-none w-full transition-colors cursor-text rounded-sm px-0.5"
              />
              
              {/* Properties Grid */}
              <div className="flex flex-col gap-5 mb-10 w-full max-w-sm">
                
                {/* Status */}
                <div className="grid grid-cols-[120px_1fr] items-center">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <CircleDashed className="w-4 h-4" />
                    <span className="text-sm font-medium">Status</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center">
                      <div className={`flex items-center rounded-sm overflow-hidden ${STATUS_COLORS[task.status] ?? 'bg-zinc-700 text-zinc-300'}`}>
                        <span className="text-[11px] font-bold px-2.5 py-1 uppercase tracking-wide cursor-default flex items-center gap-1">
                          {task.status.replace('_', ' ')}
                          {!permission.allowed && <Lock className="w-3 h-3 text-amber-300 ml-0.5" />}
                        </span>
                        <div className="w-[1px] h-3 bg-black/20" />
                        <button 
                          onClick={handleStatusClick}
                          title={!permission.allowed ? (permission.reason || 'Status transition restricted') : 'Next status'}
                          className={`px-1.5 py-1 transition-colors flex items-center justify-center ${
                            !permission.allowed
                              ? 'opacity-50 cursor-not-allowed hover:bg-transparent'
                              : 'hover:bg-black/10 cursor-pointer'
                          }`}
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {task.status !== 'DONE' && (
                        <button
                          onClick={() => handleStatusChangeAction('DONE')}
                          title={!permission.allowed ? (permission.reason || 'Status transition restricted') : 'Mark as Closed'}
                          className={`w-5 h-5 ml-1.5 rounded-sm flex items-center justify-center transition-colors shadow-sm ${
                            !permission.allowed
                              ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed opacity-60'
                              : 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {!permission.allowed && (
                      <p className="text-[10px] text-amber-400/90 leading-tight">
                        🔒 {permission.reason}
                      </p>
                    )}
                  </div>
                </div>

                {/* Assignees */}
                <div className="grid grid-cols-[120px_1fr] items-center">
                  <div className="flex items-center gap-2 text-zinc-500">
                    <User className="w-4 h-4" />
                    <span className="text-sm font-medium">Assignees</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Popover.Root open={isAssigneeOpen} onOpenChange={setIsAssigneeOpen}>
                      <Popover.Trigger asChild>
                        <div
                          title={currentAssignees.map((u) => u.name).join(', ')}
                          className="group/assignee cursor-pointer inline-flex items-center gap-2 hover:bg-zinc-800/60 px-2 py-1 -ml-2 rounded-md transition-colors border border-transparent hover:border-zinc-700/50"
                        >
                          {currentAssignees.length > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="flex items-center -space-x-1.5">
                                {currentAssignees.slice(0, 2).map((u) => (
                                  <div key={u.id} className="relative ring-2 ring-[#121212] rounded-full shrink-0" title={u.name}>
                                    {u.avatarUrl ? (
                                      <img
                                        src={u.avatarUrl}
                                        alt={u.name}
                                        className="w-6 h-6 rounded-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] text-white font-bold">
                                        {(u.name || 'U').charAt(0).toUpperCase()}
                                      </div>
                                    )}
                                  </div>
                                ))}
                                {currentAssignees.length > 2 && (
                                  <div className="relative ring-2 ring-[#121212] rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] font-bold px-1.5 h-6 flex items-center justify-center shrink-0">
                                    +{currentAssignees.length - 2}
                                  </div>
                                )}
                              </div>
                              {currentAssignees.length === 1 && (
                                <span className="text-xs text-zinc-300 max-w-[120px] truncate">
                                  {currentAssignees[0].name}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-zinc-500 border border-dashed border-zinc-700 px-2.5 py-1 rounded-sm hover:border-zinc-500 hover:text-zinc-400 transition-colors">
                              Empty
                            </span>
                          )}
                        </div>
                      </Popover.Trigger>
                      {currentAssignees.length > 0 && (
                        <button
                          onClick={handleClearAllAssignees}
                          title="Clear all assignees"
                          className="p-1 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 rounded transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <Popover.Portal>
                        <Popover.Content
                          className="z-50 w-72 p-0 bg-[#121212] border border-zinc-800 rounded-md shadow-2xl outline-none overflow-hidden"
                          align="start"
                          sideOffset={4}
                        >
                          <Command className="flex flex-col bg-transparent">
                            <Command.Input
                              placeholder="Search assignee..."
                              className="flex h-10 w-full bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-500 border-b border-zinc-800/60 text-zinc-200"
                            />
                            <Command.List className="max-h-[260px] overflow-y-auto p-1.5 custom-scrollbar">
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
                                    ✕
                                  </div>
                                  <span>Clear all assignees</span>
                                </Command.Item>
                              )}

                              {dbUsers.map((u) => {
                                const assigned = isUserAssigned(u.id);
                                return (
                                  <Command.Item
                                    key={u.id}
                                    value={`${u.name} ${u.email}`}
                                    onSelect={() => handleToggleAssignee(u)}
                                    className="relative flex cursor-pointer select-none items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300"
                                  >
                                    <div className="flex items-center gap-2 truncate min-w-0">
                                      {u.avatarUrl ? (
                                        <img
                                          src={u.avatarUrl}
                                          alt={u.name}
                                          className="w-6 h-6 rounded-full object-cover shrink-0"
                                        />
                                      ) : (
                                        <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[9px] text-white font-bold shrink-0">
                                          {u.name.charAt(0).toUpperCase()}
                                        </div>
                                      )}
                                      <div className="flex flex-col truncate">
                                        <span className="truncate text-xs font-medium text-zinc-200">
                                          {u.name}
                                        </span>
                                        <span className="truncate text-[10px] text-zinc-500">
                                          {u.primaryRole || u.email}
                                        </span>
                                      </div>
                                    </div>
                                    {assigned && (
                                      <div className="w-5 h-5 rounded-full bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0 ml-2">
                                        <Check className="w-3.5 h-3.5" />
                                      </div>
                                    )}
                                  </Command.Item>
                                );
                              })}
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
                          {(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as Priority[]).map(p => (
                            <div
                              key={p}
                              onClick={() => handlePriorityChange(p)}
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

              <div className="mt-8 relative group">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Description</span>
                  <div className="flex items-center gap-2">
                    {editingUser && (
                      <span className="text-xs text-amber-400/80 flex items-center gap-1.5 animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                        {editingUser} is editing...
                      </span>
                    )}
                  </div>
                </div>

                <div 
                  className={`relative p-2 -ml-2 rounded-lg transition-colors hover:bg-zinc-800/20 cursor-text`}
                  onFocus={handleStartEditing}
                  onClick={() => handleStartEditing()}
                >
                  <BlockEditor 
                    content={localDescription}
                    onChange={handleDescChange}
                    onBlur={handleDescBlur}
                    editable={!editingUser}
                  />
                  
                  {!localDescription && (
                    <div className="absolute top-2 left-2 text-sm text-zinc-500 italic pointer-events-none">
                      Write a text...
                    </div>
                  )}
                </div>
              </div>

              <SubtasksSection 
                task={task} 
                onUpdateTask={(updatedTask) => {
                  if (onUpdateTask) onUpdateTask(updatedTask);
                }} 
                users={dbUsers} 
                addingSubtask={addingSubtask}
                setAddingSubtask={setAddingSubtask}
                socket={socket}
                currentUser={currentUser}
                onOpenSubtask={(subtask) => setActiveSubtask(subtask)}
              />

              {/* Action Buttons (Notes, Attachments, etc) */}
              <div className="mt-8 flex flex-col gap-2 max-w-md">
                {(!task.subtasks || task.subtasks.length === 0) && !addingSubtask && (
                  <button onClick={() => setAddingSubtask(true)} className="flex items-center gap-3 text-zinc-400 hover:text-zinc-200 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors w-full text-left text-sm font-medium cursor-pointer">
                    <Plus className="w-4 h-4 shrink-0" /> Add subtask
                  </button>
                )}
                <button className="flex items-center gap-3 text-zinc-400 hover:text-zinc-200 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors w-full text-left text-sm font-medium cursor-pointer">
                  <Link2 className="w-4 h-4 shrink-0" /> Relate items or add dependencies
                </button>
                <button className="flex items-center gap-3 text-zinc-400 hover:text-zinc-200 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors w-full text-left text-sm font-medium cursor-pointer">
                  <ListTodo className="w-4 h-4 shrink-0" /> Create checklist
                </button>
                <input type="file" ref={fileInputRef} className="hidden" onChange={handleDescriptionFileChange} />
                <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="flex items-center gap-3 text-zinc-400 hover:text-zinc-200 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors w-full text-left text-sm font-medium cursor-pointer disabled:opacity-50">
                  <Paperclip className="w-4 h-4 shrink-0" /> {isUploading ? 'Uploading...' : 'Attach file or image'}
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
              <div className="space-y-5">
                
                {/* Initial Creation item */}
                <div className="flex gap-4 text-sm text-zinc-400 items-start">
                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
                  <div className="flex-1 leading-snug">
                    <span className="text-zinc-200 font-medium">{task.creator?.name || 'System'}</span> created this task
                  </div>
                  <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                    {new Date(task.createdAt || Date.now()).toLocaleDateString()}
                  </span>
                </div>
                
                {/* Sort activities oldest to newest */}
                {(() => {
                  const sorted = [...activities].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                  
                  // Separate comments from non-comments
                  const comments = sorted.filter(a => a.type === 'comment');
                  const otherActivities = sorted.filter(a => a.type !== 'comment');

                  return (
                    <>
                      {/* Render other activities with Show More logic */}
                      {otherActivities.length > 0 && (
                        <>
                          {otherActivities.length > 3 && (
                            <button 
                              onClick={() => setIsActivityExpanded(!isActivityExpanded)}
                              className="flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors w-full py-2"
                            >
                              {isActivityExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              {isActivityExpanded ? 'Show less' : `Show more (${otherActivities.length - 3} older updates)`}
                            </button>
                          )}
                          {(isActivityExpanded ? otherActivities : otherActivities.slice(-3)).map(act => {
                            const timeStr = new Date(act.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            if (act.type === 'status_change') {
                              return (
                                <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                  <div className="flex-1 leading-snug">
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1">{act.author || 'Someone'}</span> changed status from <span className="font-medium text-zinc-300 px-1">{act.oldStatus}</span> to <span className="text-blue-400 font-medium bg-blue-500/10 px-1 rounded">{act.newStatus}</span>
                                  </div>
                                  <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                    {timeStr}
                                  </span>
                                </div>
                              );
                            }
                            if (act.type === 'assignment') {
                              return (
                                <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
                                  <div className="flex-1 leading-snug">
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1">{act.author || 'Someone'}</span> assigned to{' '}
                                    <span className="text-purple-400 font-medium">{act.assigneeName}</span>
                                  </div>
                                  <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                    {timeStr}
                                  </span>
                                </div>
                              );
                            }
                            if (act.type === 'priority_change') {
                              return (
                                <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                  <div className="flex-1 leading-snug">
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1">{act.author || 'Someone'}</span> changed priority to{' '}
                                    <span className="text-amber-400 font-medium">{act.newPriority}</span>
                                  </div>
                                  <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                    {timeStr}
                                  </span>
                                </div>
                              );
                            }
                            if (act.type === 'attachment') {
                              return (
                                <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
                                  <div className="flex-1 leading-snug">
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1">{act.author || 'Someone'}</span> attached a file:{' '}
                                    <span className="text-indigo-400 ml-1">{act.fileName}</span>
                                  </div>
                                  <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                    {timeStr}
                                  </span>
                                </div>
                              );
                            }
                            return null;
                          })}
                        </>
                      )}

                      {/* Rich comments with reactions + replies */}
                      {richComments.map(c => {
                        const timeStr = new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        // Group reactions by emoji
                        const reactionGroups: Record<string, { count: number; users: string[]; hasMe: boolean }> = {};
                        (c.reactions || []).forEach((r: any) => {
                          if (!reactionGroups[r.emoji]) reactionGroups[r.emoji] = { count: 0, users: [], hasMe: false };
                          reactionGroups[r.emoji].count++;
                          reactionGroups[r.emoji].users.push(r.user?.name || '?');
                          if (r.userId === currentUser?.id) reactionGroups[r.emoji].hasMe = true;
                        });

                        const renderComment = (comment: any, isReply = false) => {
                          const cTimeStr = new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                          const cGroups: Record<string, { count: number; users: string[]; hasMe: boolean }> = {};
                          (comment.reactions || []).forEach((r: any) => {
                            if (!cGroups[r.emoji]) cGroups[r.emoji] = { count: 0, users: [], hasMe: false };
                            cGroups[r.emoji].count++;
                            cGroups[r.emoji].users.push(r.user?.name || '?');
                            if (r.userId === currentUser?.id) cGroups[r.emoji].hasMe = true;
                          });
                          return (
                            <div key={comment.id} className={`flex flex-col gap-2 text-sm w-full bg-[#202024] p-4 rounded-xl border border-zinc-800/60 shadow-sm ${isReply ? 'ml-6 mt-2 bg-[#1a1a1e]' : ''}`}>
                              <div className="flex items-center gap-3 w-full">
                                {comment.user?.avatarUrl ? (
                                  <img src={comment.user.avatarUrl} alt={comment.user.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-indigo-600 shrink-0 flex items-center justify-center text-white text-[11px] font-bold">
                                    {(comment.user?.name || 'U').charAt(0).toUpperCase()}
                                  </div>
                                )}
                                <div className="flex-1 flex items-center gap-2">
                                  <span className="text-zinc-200 font-medium text-[13px]">{comment.user?.name || 'Someone'}</span>
                                  <span className="text-[11px] text-zinc-500">{new Date(comment.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} {cTimeStr}</span>
                                </div>
                              </div>
                              <div className="text-zinc-300 text-[13.5px] leading-relaxed max-w-full break-words prose prose-sm prose-invert prose-p:my-0 prose-a:text-blue-400 hover:prose-a:underline prose-img:rounded-md prose-img:my-2 prose-img:max-w-full w-full pl-11">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={markdownComponents}>
                                  {(() => {
                                    let text = comment.content || '';
                                    dbUsers.forEach(u => {
                                      if (text.includes(`@${u.name}`)) {
                                        text = text.replace(new RegExp(`@${u.name}`, 'g'), `[@${u.name}](mention://${u.id})`);
                                      }
                                    });
                                    return text;
                                  })()}
                                </ReactMarkdown>
                              </div>
                              {/* Reaction pills */}
                              {Object.keys(cGroups).length > 0 && (
                                <div className="flex flex-wrap gap-1 pl-11">
                                  {Object.entries(cGroups).map(([emoji, data]) => (
                                    <button
                                      key={emoji}
                                      title={data.users.join(', ')}
                                      onClick={() => handleToggleReaction(comment.id, emoji)}
                                      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] border transition-colors cursor-pointer ${data.hasMe ? 'bg-indigo-600/20 border-indigo-500/60 text-indigo-300 hover:bg-indigo-600/30' : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-400 hover:border-zinc-500 hover:bg-zinc-700/50'}`}
                                    >
                                      {emoji} <span className="font-medium">{data.count}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {/* Action row */}
                              <div className="flex items-center gap-1 mt-1 pl-11 relative">
                                <button
                                  onClick={() => handleToggleReaction(comment.id, '👍')}
                                  className={`flex items-center justify-center w-6 h-6 rounded hover:bg-zinc-700/80 cursor-pointer transition-colors ${cGroups['👍']?.hasMe ? 'text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                                  title="Like"
                                >
                                  <ThumbsUp className="w-3.5 h-3.5" />
                                </button>
                                <div className="relative">
                                  <button
                                    onClick={() => setShowEmojiPickerFor(showEmojiPickerFor === comment.id ? null : comment.id)}
                                    className="flex items-center justify-center w-6 h-6 rounded hover:bg-zinc-700/80 cursor-pointer text-zinc-500 hover:text-zinc-300 transition-colors"
                                    title="React"
                                  >
                                    <SmilePlus className="w-3.5 h-3.5" />
                                  </button>
                                  {showEmojiPickerFor === comment.id && (
                                    <div className="absolute bottom-8 left-0 bg-[#202024] border border-zinc-700 rounded-lg shadow-xl p-2 flex gap-1 z-50">
                                      {QUICK_EMOJIS.map(e => (
                                        <button key={e} onClick={() => handleToggleReaction(comment.id, e)} className="text-lg hover:scale-125 cursor-pointer transition-transform p-0.5">
                                          {e}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {!isReply && (
                                  <button
                                    onClick={() => setReplyingToId(replyingToId === comment.id ? null : comment.id)}
                                    className="flex items-center gap-1.5 px-2 h-6 rounded hover:bg-zinc-700/80 cursor-pointer text-zinc-500 hover:text-zinc-300 transition-colors text-[11px] font-medium ml-1"
                                  >
                                    <MessageSquare className="w-3 h-3" /> Reply {comment.replyCount > 0 && `(${comment.replyCount})`}
                                  </button>
                                )}
                              </div>
                              {/* Reply input */}
                              {!isReply && replyingToId === comment.id && (
                                <div className="pl-11 flex gap-2 mt-1">
                                  <input
                                    value={replyText}
                                    onChange={e => setReplyText(e.target.value)}
                                    disabled={isSubmittingReply}
                                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitReply(comment.id); }}}
                                    placeholder="Write a reply..."
                                    className="flex-1 bg-zinc-800/60 border border-zinc-700/60 rounded-md px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-indigo-500/60 transition-colors disabled:opacity-50"
                                  />
                                  <button onClick={() => handleSubmitReply(comment.id)} disabled={isSubmittingReply || !replyText.trim()} className="p-1.5 bg-indigo-600 hover:bg-indigo-700 rounded-md text-white transition-colors disabled:opacity-50 disabled:hover:bg-indigo-600">
                                    <Send className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                              {/* Replies */}
                              {!isReply && comment.replies?.length > 0 && (
                                <div className="pl-4 flex flex-col gap-2 mt-1 border-l-2 border-zinc-800">
                                  {comment.replies.map((r: any) => renderComment(r, true))}
                                </div>
                              )}
                            </div>
                          );
                        };

                        return renderComment(c);
                      })}
                    </>
                  );
                })()}
                
              </div>
            </div>

            {/* Comment Input */}
            <div className="p-5 border-t border-zinc-800/60 shrink-0 bg-[#18181b] flex flex-col gap-2">
              {stagedFiles.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-1">
                  {stagedFiles.map((file, idx) => {
                    const isImage = file.type.startsWith('image/');
                    const isVideo = file.type.startsWith('video/');
                    const previewUrl = (isImage || isVideo) ? URL.createObjectURL(file) : null;
                    return (
                      <div key={idx} className="relative group flex items-center justify-center bg-zinc-800/80 rounded-md border border-zinc-700/50 w-16 h-16 shrink-0 overflow-hidden">
                        {isImage && previewUrl ? (
                          <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
                        ) : isVideo && previewUrl ? (
                          <video src={previewUrl} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[10px] text-zinc-400 font-mono truncate px-1">{file.name.slice(-6)}</span>
                        )}
                        <button 
                          onClick={() => setStagedFiles(prev => prev.filter((_, i) => i !== idx))}
                          className="absolute -top-1 -right-1 p-0.5 bg-red-500 hover:bg-red-600 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="relative">
                {showMentionMenu && (
                  <div className="absolute bottom-full left-0 mb-2 w-64 bg-[#202024] border border-zinc-700/60 rounded-md shadow-xl overflow-hidden z-[100]">
                    <div className="p-2 border-b border-zinc-800/60 text-xs font-medium text-zinc-400">
                      People
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {dbUsers.filter(u => u.name?.toLowerCase().includes(mentionSearch.toLowerCase())).map(u => (
                        <div
                          key={u.id}
                          className="flex items-center gap-2 p-2 hover:bg-[#5f5ce6]/20 cursor-pointer text-sm text-zinc-200"
                          onClick={() => {
                            const before = comment.substring(0, mentionStartIndex);
                            const after = comment.substring(comment.length);
                            setComment(`${before}@${u.name} `);
                            setShowMentionMenu(false);
                            if (!mentionedUsers.some(m => m.id === u.id)) {
                              setMentionedUsers(prev => [...prev, { id: u.id, name: u.name }]);
                            }
                          }}
                        >
                          {u.avatarUrl ? (
                            <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px] font-bold">
                              {(u.name || '?').substring(0, 2).toUpperCase()}
                            </div>
                          )}
                          <span>{u.name}</span>
                        </div>
                      ))}
                      {dbUsers.filter(u => u.name?.toLowerCase().includes(mentionSearch.toLowerCase())).length === 0 && (
                        <div className="p-3 text-sm text-zinc-500 text-center">No users found</div>
                      )}
                    </div>
                  </div>
                )}
                <textarea 
                  value={comment}
                  onChange={e => {
                    const val = e.target.value;
                    setComment(val);
                    
                    // Mention logic
                    const cursorPosition = e.target.selectionStart;
                    const textBeforeCursor = val.substring(0, cursorPosition);
                    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
                    
                    if (lastAtIndex !== -1 && !textBeforeCursor.substring(lastAtIndex).includes(' ')) {
                      setShowMentionMenu(true);
                      setMentionSearch(textBeforeCursor.substring(lastAtIndex + 1));
                      setMentionStartIndex(lastAtIndex);
                    } else {
                      setShowMentionMenu(false);
                    }
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleAddComment();
                    }
                  }}
                  className="w-full bg-[#121212] border border-zinc-800 rounded-lg pl-4 pr-12 py-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 resize-none h-[80px] custom-scrollbar"
                  placeholder="Write a comment... (Press Enter to post)"
                />
                <input type="file" ref={commentFileInputRef} className="hidden" onChange={handleCommentFileChange} />
                <button
                  onClick={() => commentFileInputRef.current?.click()}
                  disabled={isUploading}
                  className="absolute right-[56px] bottom-3 p-1.5 rounded-md hover:bg-zinc-800 disabled:opacity-50 text-zinc-400 hover:text-zinc-200 transition-colors"
                  title="Attach file or image"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <button 
                  onClick={handleAddComment}
                  disabled={!comment.trim() || isUploading}
                  className="absolute right-3 bottom-3 p-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white transition-colors"
                  title="Send comment"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
          
        </div>
      </div>
    
      {/* Lightbox Modal */}
      {lightboxImage && (
        <div 
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm cursor-pointer"
          onClick={() => setLightboxImage(null)}
        >
          <button 
            className="absolute top-6 right-6 p-2 rounded-full bg-black/50 text-white hover:bg-white/20 transition-colors"
            onClick={() => setLightboxImage(null)}
          >
            <X className="w-6 h-6" />
          </button>
          {lightboxImage.match(/\.(mp4|webm|ogg|mov)$/i) ? (
            <video 
              controls 
              autoPlay
              src={lightboxImage} 
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl cursor-default" 
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <img 
              src={lightboxImage} 
              alt="Expanded view" 
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl cursor-default" 
              onClick={e => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </>
  );
}

// ─── Subtask Detail View (Replaces Parent View) ─────────────────────────────
function SubtaskDetailView({
  subtask,
  parentTask,
  onClose,
  currentUser,
  socket,
}: {
  subtask: any;
  parentTask: any;
  onClose: () => void;
  currentUser?: any;
  socket?: any;
}) {
  const [richComments, setRichComments] = useState<any[]>([]);
  const [comment, setComment] = useState('');
  const [localDesc, setLocalDesc] = useState(subtask.description || '');
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [isActivityExpanded, setIsActivityExpanded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalDesc(subtask.description || '');
  }, [subtask.description]);

  useEffect(() => {
    if (!socket || !subtask) return;

    const handleEditingStart = (data: { taskId: string; userName: string }) => {
      if (data.taskId === subtask.id && data.userName !== currentUser?.name) {
        setEditingUser(data.userName);
      }
    };
    
    const handleEditingStop = (data: { taskId: string; description: string }) => {
      if (data.taskId === subtask.id) {
        setEditingUser(null);
        setLocalDesc(data.description);
      }
    };

    const handleEditingContent = (data: { taskId: string; content: string }) => {
      if (data.taskId === subtask.id) {
        setLocalDesc(data.content);
      }
    };

    socket.on('task_editing_start', handleEditingStart);
    socket.on('task_editing_stop', handleEditingStop);
    socket.on('task_editing_content', handleEditingContent);

    return () => {
      socket.off('task_editing_start', handleEditingStart);
      socket.off('task_editing_stop', handleEditingStop);
      socket.off('task_editing_content', handleEditingContent);
    };
  }, [socket, subtask?.id, currentUser?.name]);

  const handleStartEditing = () => {
    if (socket && subtask) {
      socket.emit('task_editing_start', {
        listId: parentTask.listId,
        taskId: subtask.id,
        userName: currentUser?.name || 'Someone',
      });
    }
  };

  const handleDescBlur = () => {
    if (localDesc !== subtask.description) {
      tasksApi.updateTask(subtask.id, { description: localDesc }).catch(err => console.error(err));
    }
    if (socket) {
      socket.emit('task_editing_stop', {
        listId: parentTask.listId,
        taskId: subtask.id,
        description: localDesc,
      });
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const commentRes = await tasksApi.getComments(parentTask.id, subtask.id);
        if (commentRes?.comments) setRichComments(commentRes.comments);
      } catch (err) {
        console.error('Failed to load comments:', err);
      }
    };
    load();
  }, [parentTask.id, subtask.id]);

  const handleAddComment = async () => {
    const trimmed = comment.trim();
    if (!trimmed || !currentUser?.id) return;
    try {
      await tasksApi.addComment(parentTask.id, trimmed, currentUser.id, parentTask.listId, [], undefined, subtask.id);
      setComment('');
      const res = await tasksApi.getComments(parentTask.id, subtask.id);
      if (res?.comments) setRichComments(res.comments);
    } catch (err) {
      console.error('Failed to post comment:', err);
    }
  };

  const assignee = subtask.assignee;

  return (
    <div
      className="w-full h-full bg-[#0f0f11] flex flex-col overflow-hidden cursor-default"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60 bg-[#18181b] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[14px] text-purple-400 font-medium flex items-center gap-2">
            <span className="text-zinc-500 font-normal">Subtask of</span>
            <div className="flex items-center gap-1.5 text-zinc-300 hover:text-white transition-colors cursor-pointer" onClick={onClose}>
              <CheckSquare className="w-4 h-4 text-emerald-500" />
              {parentTask.title}
            </div>
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content area: Split layout matching main task */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Panel: Details & Description */}
        <div className="flex-1 overflow-y-auto border-r border-zinc-800/60 custom-scrollbar">
          <div className="p-8">
            <h1 className="text-2xl font-bold text-zinc-100 mb-8">{subtask.title}</h1>
            
            {/* Properties Grid */}
            <div className="flex flex-col gap-5 mb-10 w-full max-w-sm">
              
              {/* Status */}
              <div className="grid grid-cols-[120px_1fr] items-center">
                <div className="flex items-center gap-2 text-zinc-500">
                  <CircleDashed className="w-4 h-4" />
                  <span className="text-sm font-medium">Status</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center">
                    <div className={`flex items-center rounded-sm overflow-hidden bg-indigo-600 text-white`}>
                      <span className="text-[11px] font-bold px-2.5 py-1 uppercase tracking-wide flex items-center gap-1">
                        {subtask.completed ? 'DONE' : subtask.status || 'OPEN'}
                      </span>
                      <div className="w-[1px] h-3 bg-black/20" />
                      <button className="px-1.5 py-1 transition-colors flex items-center justify-center hover:bg-black/10 cursor-pointer">
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <button className="w-5 h-5 ml-1.5 rounded-sm flex items-center justify-center transition-colors shadow-sm bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Assignee */}
              <div className="grid grid-cols-[120px_1fr] items-center">
                <div className="flex items-center gap-2 text-zinc-500">
                  <User className="w-4 h-4" />
                  <span className="text-sm font-medium">Assignee</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="group/assignee cursor-pointer inline-flex items-center gap-2 hover:bg-zinc-800/60 px-2 py-1 -ml-2 rounded-md transition-colors border border-transparent hover:border-zinc-700/50">
                    {assignee ? (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center -space-x-1.5">
                          <div className="relative ring-2 ring-[#121212] rounded-full shrink-0">
                            {assignee.avatarUrl ? (
                              <img src={assignee.avatarUrl} alt={assignee.name} className="w-6 h-6 rounded-full object-cover" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] text-white font-bold">
                                {assignee.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-zinc-300 max-w-[120px] truncate">{assignee.name}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-500 border border-dashed border-zinc-700 px-2.5 py-1 rounded-sm hover:border-zinc-500 hover:text-zinc-400 transition-colors">
                        Unassigned
                      </span>
                    )}
                  </div>
                  {assignee && (
                    <button className="p-1 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 rounded transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Priority */}
              <div className="grid grid-cols-[120px_1fr] items-center">
                <div className="flex items-center gap-2 text-zinc-500">
                  <Flag className="w-4 h-4" />
                  <span className="text-sm font-medium">Priority</span>
                </div>
                <div>
                  <div className="cursor-pointer inline-flex items-center hover:bg-zinc-800/50 p-1 -ml-1 rounded transition-colors">
                    {subtask.priority ? (
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-sm uppercase ${PRIORITY_COLORS[subtask.priority] ?? 'text-zinc-400 bg-zinc-800'}`}>
                        {subtask.priority}
                      </span>
                    ) : (
                      <span className="text-sm text-zinc-500 border border-dashed border-zinc-700 px-2.5 py-1 rounded-sm hover:border-zinc-500 hover:text-zinc-400 transition-colors">
                        Empty
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="mb-12">
              <div className="flex items-center justify-between mb-4 shrink-0">
                <span className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                  <AlignLeft className="w-5 h-5" />
                  Description
                </span>
                {editingUser && (
                  <span className="text-xs text-amber-400/80 flex items-center gap-1.5 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                    {editingUser} is editing...
                  </span>
                )}
              </div>
              
              <div 
                className="flex-1 relative group hover:bg-zinc-800/20 rounded-lg p-2 -mx-2 transition-colors"
                onFocus={handleStartEditing}
              >
                <BlockEditor 
                  content={localDesc}
                  onChange={(html) => {
                    setLocalDesc(html);
                    if (socket && subtask) {
                      if (debounceRef.current) clearTimeout(debounceRef.current);
                      debounceRef.current = setTimeout(() => {
                        socket.emit('task_editing_content', {
                          listId: parentTask.listId,
                          taskId: subtask.id,
                          content: html,
                        });
                      }, 150);
                    }
                  }}
                  onBlur={handleDescBlur}
                  editable={!editingUser}
                />
                
                {!localDesc && (
                  <div className="absolute top-2 left-2 text-sm text-zinc-500 italic pointer-events-none">
                    Add description...
                  </div>
                )}
              </div>
              
              {/* Action Buttons (Notes, Attachments, etc) */}
              <div className="mt-8 flex flex-col gap-2 max-w-md">
                <button className="flex items-center gap-3 text-zinc-400 hover:text-zinc-200 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors w-full text-left text-sm font-medium cursor-pointer">
                  <Link2 className="w-4 h-4 shrink-0" /> Relate items or add dependencies
                </button>
                <button className="flex items-center gap-3 text-zinc-400 hover:text-zinc-200 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors w-full text-left text-sm font-medium cursor-pointer">
                  <ListTodo className="w-4 h-4 shrink-0" /> Create checklist
                </button>
                <button className="flex items-center gap-3 text-zinc-400 hover:text-zinc-200 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors w-full text-left text-sm font-medium cursor-pointer disabled:opacity-50">
                  <Paperclip className="w-4 h-4 shrink-0" /> Attach file or image
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel: Activity Log */}
        <div className="w-[380px] bg-[#18181b] flex flex-col border-l border-zinc-800/60 shrink-0 z-10">
          <div className="px-6 py-5 border-b border-zinc-800/60 shrink-0 flex items-center justify-between">
            <h3 className="font-semibold text-sm text-zinc-200">Activity</h3>
            <div className="flex gap-3">
              <span className="text-zinc-500 text-xs">Created {new Date(subtask.createdAt || Date.now()).toLocaleDateString()}</span>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <div className="space-y-5">
              
              {/* Initial Creation item */}
              <div className="flex gap-4 text-sm text-zinc-400 items-start">
                <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
                <div className="flex-1 leading-snug">
                  <span className="text-zinc-200 font-medium">{subtask.creator?.name || 'System'}</span> created this subtask
                </div>
                <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                  {new Date(subtask.createdAt || Date.now()).toLocaleDateString()}
                </span>
              </div>
              
              {/* Rich comments with reactions + replies */}
              {richComments.map(c => {
                const timeStr = new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={c.id} className="flex gap-4 text-sm text-zinc-400 items-start">
                    {c.user?.avatarUrl ? (
                      <img src={c.user.avatarUrl} alt={c.user?.name} className="mt-1 w-6 h-6 rounded-full shrink-0 object-cover" />
                    ) : (
                      <div className="mt-1 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[9px] font-bold shrink-0">
                        {(c.user?.name || 'U').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-zinc-200 font-medium text-sm">{c.user?.name || 'Someone'}</span>
                        <span className="text-xs text-zinc-500">{timeStr}</span>
                      </div>
                      <div className="text-zinc-300 bg-zinc-800/40 border border-zinc-700/50 rounded-lg p-3 text-sm leading-relaxed mt-1 prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                          {c.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-4 bg-[#18181b] border-t border-zinc-800/60">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
                placeholder="Write a comment..."
                className="flex-1 bg-[#121212] border border-zinc-700/50 rounded-lg px-3 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 transition-colors"
              />
              <button
                onClick={handleAddComment}
                disabled={!comment.trim()}
                className="p-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white transition-colors disabled:opacity-40 disabled:hover:bg-indigo-600 cursor-pointer shadow-sm"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TaskDetailModal(props: Props) {
  const [fullTask, setFullTask] = useState<Task | null>(props.task);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (props.isOpen && props.task?.id) {
      setFullTask(props.task);
      const loadFull = async () => {
        setIsLoading(true);
        try {
          const res = await tasksApi.getTask(props.task!.id);
          if (res?.task) setFullTask(res.task);
        } catch (err) {
          console.error(err);
        } finally {
          setIsLoading(false);
        }
      };
      loadFull();
    } else if (!props.isOpen) {
      setFullTask(null);
    }
  }, [props.isOpen, props.task?.id]);

  useEffect(() => {
    if (props.isOpen && props.task && fullTask && props.task.id === fullTask.id) {
       setFullTask(prev => ({ ...prev!, ...props.task! }));
    }
  }, [props.task]);

  const handleUpdateTask = (updatedTask: Task) => {
    setFullTask(updatedTask);
    if (props.onUpdateTask) props.onUpdateTask(updatedTask);
  };

  if (!props.isOpen && !fullTask) return null;

  return (
    <TaskDetailModalContent 
      {...props} 
      task={fullTask} 
      onUpdateTask={handleUpdateTask} 
    />
  );
}
