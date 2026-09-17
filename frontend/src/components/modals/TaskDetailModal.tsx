import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, User, Flag, CircleDashed, CheckSquare, Link2, ListTodo, Paperclip, Check, ChevronRight, ChevronDown, ChevronLeft, Folder, Pencil, Lock, Unlock, Send, ThumbsUp, SmilePlus, MessageSquare, Plus, AlignLeft, CornerDownRight, CheckCircle2, Circle, ImageIcon, File, Share2 } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
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
import { spacesApi } from '@/api/spaces';
import { SubtasksSection } from './SubtasksSection';
import { ChecklistsSection } from './ChecklistsSection';
import { AuditSection } from './AuditSection';
import { AttachmentsGrid } from './AttachmentsGrid';

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

export const ALL_STATUSES = [
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

export const STATUS_COLORS: Record<string, string> = {
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

function LazyMarkdownImage({ src, alt, onPreview }: { src: string; alt?: string; onPreview: (src: string) => void }) {
  const [loaded, setLoaded] = useState(false);

  if (!loaded) {
    return (
      <span 
        className="mt-2 mb-2 inline-flex items-center justify-center w-[200px] h-[150px] bg-zinc-900 border border-zinc-700/50 rounded-lg cursor-pointer hover:border-zinc-500 transition-colors group relative"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setLoaded(true);
        }}
      >
        <ImageIcon className="w-10 h-10 text-zinc-500 opacity-50" />
        <span className="absolute inset-0 bg-zinc-900/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-[2px] rounded-lg">
          <span className="text-xs font-medium text-white bg-black/60 px-2 py-1 rounded-md">Click to load image</span>
        </span>
      </span>
    );
  }

  return (
    <span className="mt-2 mb-2 inline-block relative group cursor-pointer" onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onPreview(src);
    }}>
      <img
        src={src}
        alt={alt}
        className="max-w-[200px] max-h-[150px] object-cover rounded-lg"
      />
      <span className="absolute inset-0 bg-zinc-900/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-[2px] rounded-lg pointer-events-none">
        <span className="text-xs font-medium text-white bg-black/60 px-2 py-1 rounded-md">Click to preview</span>
      </span>
    </span>
  );
}

function LazyMarkdownVideo({ src, onPreview }: { src: string; onPreview: (src: string) => void }) {
  const [loaded, setLoaded] = useState(false);

  if (!loaded) {
    return (
      <span 
        className="mt-2 mb-2 inline-flex items-center justify-center w-[200px] h-[150px] bg-zinc-900 border border-zinc-700/50 rounded-lg cursor-pointer hover:border-zinc-500 transition-colors group relative"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setLoaded(true);
        }}
      >
        <File className="w-10 h-10 text-zinc-500 opacity-50" />
        <span className="absolute inset-0 bg-zinc-900/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-[2px] rounded-lg">
          <span className="text-xs font-medium text-white bg-black/60 px-2 py-1 rounded-md">Click to load video</span>
        </span>
      </span>
    );
  }

  return (
    <span className="mt-2 mb-2 inline-block relative group" onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onPreview(src);
    }}>
      <video
        src={src}
        className="max-w-[200px] max-h-[150px] object-cover rounded-lg bg-black/50"
      />
    </span>
  );
}

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
  const router = useRouter();
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [comment, setComment] = useState('');
  const [activities, setActivities] = useState<any[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [dbUsers, setDbUsers] = useState<UserModel[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [activeSubtask, setActiveSubtask] = useState<any>(() => {
    if (typeof window !== 'undefined' && task?.subtasks) {
      const url = new URL(window.location.href);
      const subtaskId = url.searchParams.get('subtask');
      if (subtaskId) {
        return task.subtasks.find((s: any) => s.id === subtaskId) || null;
      }
    }
    return null;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !task) return;
    const url = new URL(window.location.href);
    if (activeSubtask) {
      if (url.searchParams.get('subtask') !== activeSubtask.id) {
        url.searchParams.set('subtask', activeSubtask.id);
        router.replace(url.pathname + url.search, { scroll: false });
      }
    } else {
      if (url.searchParams.has('subtask')) {
        url.searchParams.delete('subtask');
        router.replace(url.pathname + url.search, { scroll: false });
      }
    }
  }, [activeSubtask, task]);

  const [editingUser, setEditingUser] = useState<string | null>(null); // Name of user currently editing
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [isCheckLocked, setIsCheckLocked] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [localDescription, setLocalDescription] = useState(task?.description || '');
  const [localTitle, setLocalTitle] = useState(task?.title || '');
  // State for handling attachments
  const [attachments, setAttachments] = useState<any[]>(() => {
    const existing = task?.attachments || [];
    const desc = task?.description || '';
    const oldAttachments: any[] = [];
    
    const divRegex = /<div[^>]*data-type="attachment-block"[^>]*>/g;
    let match;
    let count = 0;
    while ((match = divRegex.exec(desc)) !== null) {
      const tag = match[0];
      const urlMatch = tag.match(/data-url="([^"]+)"/);
      const nameMatch = tag.match(/data-name="([^"]+)"/);
      const typeMatch = tag.match(/data-mime-type="([^"]+)"/);
      if (urlMatch) {
        oldAttachments.push({
          id: `old-${count++}`,
          fileName: nameMatch ? nameMatch[1] : 'attachment',
          fileUrl: urlMatch[1],
          fileKey: urlMatch[1],
          fileSize: 0,
          mimeType: typeMatch ? typeMatch[1] : 'image/jpeg',
        });
      }
    }
    
    const imgRegex = /<img[^>]*src="([^"]+)"[^>]*>/g;
    while ((match = imgRegex.exec(desc)) !== null) {
      const tag = match[0];
      const url = match[1];
      if (!oldAttachments.find(a => a.fileUrl === url)) {
        const altMatch = tag.match(/alt="([^"]+)"/);
        oldAttachments.push({
          id: `old-img-${count++}`,
          fileName: altMatch ? altMatch[1] : 'image.png',
          fileUrl: url,
          fileKey: url,
          fileSize: 0,
          mimeType: 'image/jpeg',
        });
      }
    }
    return [...existing, ...oldAttachments];
  });
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isActivityExpanded, setIsActivityExpanded] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);
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
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [showEmojiPickerFor, setShowEmojiPickerFor] = useState<string | null>(null);

  const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀'];

  const markdownComponents = React.useMemo(() => ({
    a: (props: any) => {
      const { node, ...rest } = props;
      const href = rest.href || '';
      if (href.match(/\.(mp4|webm|ogg|mov)$/i)) {
        return <LazyMarkdownVideo src={href} onPreview={setLightboxImage} />;
      }
      if (href.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
        return <LazyMarkdownImage src={href} alt="attachment" onPreview={setLightboxImage} />;
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
      return (
        <a {...rest} className="text-blue-400 hover:underline hover:text-blue-300" target="_blank" rel="noopener noreferrer">
          {rest.children}
        </a>
      );
    },
    img: (props: any) => {
      const { node, ...rest } = props;
      return <LazyMarkdownImage src={rest.src} alt={rest.alt || "attachment"} onPreview={setLightboxImage} />;
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

  // Task edits are open to all
  const canEditTask = true;
  
  // Assignment is restricted by the column's role restrictions
  const canAssignTask = React.useMemo(() => {
    return canUserMoveTask(task, listStatuses, currentUser, workspaceRoles).allowed;
  }, [task, currentUser, listStatuses, workspaceRoles]);

  const assignableUsers = React.useMemo(() => {
    return dbUsers;
  }, [dbUsers]);

  // Fetch persistent activities and comments from DB
  const loadActivities = useCallback(async () => {
    if (!task?.id) return;
    try {
      setLoadingActivities(true);
      const [actRes, commentRes] = await Promise.all([
        tasksApi.getActivities(task.id),
        tasksApi.getComments(task.id),
      ]);
      if (!isMountedRef.current) return;
      if (actRes?.activities) setActivities(actRes.activities);
      if (commentRes?.comments) setRichComments(commentRes.comments);
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
    if (task) {
      setLocalDescription(task.description || '');
      
      const existing = task.attachments || [];
      const desc = task.description || '';
      const oldAttachments: any[] = [];
      
      const divRegex = /<div[^>]*data-type="attachment-block"[^>]*>/g;
      let match;
      let count = 0;
      while ((match = divRegex.exec(desc)) !== null) {
        const tag = match[0];
        const urlMatch = tag.match(/data-url="([^"]+)"/);
        const nameMatch = tag.match(/data-name="([^"]+)"/);
        const typeMatch = tag.match(/data-mime-type="([^"]+)"/);
        if (urlMatch) {
          oldAttachments.push({
            id: `old-${count++}`,
            fileName: nameMatch ? nameMatch[1] : 'attachment',
            fileUrl: urlMatch[1],
            fileKey: urlMatch[1],
            fileSize: 0,
            mimeType: typeMatch ? typeMatch[1] : 'image/jpeg',
          });
        }
      }
      
      const imgRegex = /<img[^>]*src="([^"]+)"[^>]*>/g;
      while ((match = imgRegex.exec(desc)) !== null) {
        const tag = match[0];
        const url = match[1];
        if (!oldAttachments.find(a => a.fileUrl === url)) {
          const altMatch = tag.match(/alt="([^"]+)"/);
          oldAttachments.push({
            id: `old-img-${count++}`,
            fileName: altMatch ? altMatch[1] : 'image.png',
            fileUrl: url,
            fileKey: url,
            fileSize: 0,
            mimeType: 'image/jpeg',
          });
        }
      }
      
      setAttachments([...existing, ...oldAttachments]);
      setEditingUser(null);
    }
  }, [task]);

  useEffect(() => {
    if (task?.listId && (!listStatuses || listStatuses.length === 0)) {
      spacesApi.getList(task.listId).then((res: any) => {
        if (res?.list?.statuses) {
          setInternalListStatuses(res.list.statuses);
        }
      }).catch((err: any) => console.error(err));
    } else if (listStatuses && listStatuses.length > 0) {
      setInternalListStatuses(listStatuses);
    }
  }, [task?.listId, listStatuses]);

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
    const sanitizedDesc = (localDescription === '<p></p>' || localDescription === '<p><br></p>') ? '' : localDescription;
    
    if (sanitizedDesc !== task?.description && task) {
      tasksApi.updateTask(task.id, {
        description: sanitizedDesc,
        currentListId: task.listId,
        userId: currentUser?.id,
      }).catch(err => console.error('Failed to save description:', err));

      if (onUpdateTask) {
        onUpdateTask({ ...task, description: sanitizedDesc });
      }
    }

    if (socket && task) {
      socket.emit('task_editing_stop', {
        listId: task.listId,
        taskId: task.id,
        description: sanitizedDesc,
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
          // If real ID already exists, skip
          if (prev.some(a => a.id === data.activity.id)) return prev;
          // If an optimistic entry of the same type exists, replace it with the real one
          // (this happens on the acting client who already has an optimistic placeholder)
          const typePrefix = data.activity.type === 'status_change' ? 'optimistic-status'
            : data.activity.type === 'assignment' ? 'optimistic-assign'
            : data.activity.type === 'priority_change' ? 'optimistic-priority'
            : null;
          if (typePrefix) {
            const optimisticIdx = prev.findIndex(
              a => typeof a.id === 'string' && a.id.startsWith(typePrefix)
            );
            if (optimisticIdx !== -1) {
              const updated = [...prev];
              updated[optimisticIdx] = data.activity;
              return updated;
            }
          }
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
  const [internalListStatuses, setInternalListStatuses] = useState<any[]>(listStatuses || []);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showApiSettings, setShowApiSettings] = useState(false);
  const editorRef = useRef<any>(null);

  // Focus trap and esc handler activity panel
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
    if (!task) return;

    if (newStatus.toLowerCase() === 'checking') {
      const auditChecklists = (task.checklists || []).filter(c => c.name.toLowerCase().includes('audit'));
      for (const c of auditChecklists) {
        if (c.items && c.items.some(i => !i.completed)) {
          toast.error(`Cannot move to ${newStatus}: Audit checklist "${c.name}" is not fully completed.`);
          return;
        }
      }
    }

    const oldStatus = task.status;
    if (onStatusChange) onStatusChange(newStatus);
    else task.status = newStatus;

    // Optimistically append activity to local feed immediately
    const optimisticId = `optimistic-status-${Date.now()}`;
    const optimisticActivity = {
      id: optimisticId,
      type: 'status_change',
      author: currentUser?.name || 'Someone',
      oldStatus,
      newStatus,
      date: new Date(),
      user: currentUser,
    };
    setActivities(prev => [...prev, optimisticActivity]);

    try {
      const res = await tasksApi.moveTask(task.id, newStatus, task.listId, currentUser?.id);
      if (res?.activity) {
        // Replace optimistic entry with real one from server
        setActivities(prev => prev.map(a => a.id === optimisticId ? res.activity : a));
      }
      toast.success(`Moved to ${newStatus}`);
    } catch (err: any) {
      // Rollback optimistic activity on error
      setActivities(prev => prev.filter(a => a.id !== optimisticId));
      toast.error(err.message || 'Failed to move task');
    }
  };

  const handleStatusClick = () => {
    const statuses = (internalListStatuses && internalListStatuses.length > 0)
      ? internalListStatuses.map(s => typeof s === 'string' ? s : (s.name || s.status || s.title || ''))
      : ALL_STATUSES;
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
    async (taskToUpdate: Task, updatedIds: string[], primaryAssignee: UserModel | null, updatedAssignees: UserModel[]) => {
      // Optimistically append activity to local feed immediately
      const optimisticId = `optimistic-assign-${Date.now()}`;
      const names = updatedAssignees.length > 0 ? updatedAssignees.map(u => u.name).join(', ') : 'Unassigned';
      const optimisticActivity = {
        id: optimisticId,
        type: 'assignment',
        author: currentUser?.name || 'Someone',
        assigneeName: names,
        assignees: updatedAssignees.map(u => u.name),
        date: new Date(),
        user: currentUser,
      };
      setActivities(prev => [...prev, optimisticActivity]);

      try {
        await tasksApi.updateTask(taskToUpdate.id, {
          assigneeIds: updatedIds,
          assigneeId: primaryAssignee?.id || null,
          currentListId: taskToUpdate.listId,
          userId: currentUser?.id,
        });
        // Server will emit task_activity via socket for the other account
        // Don't reload activities here — optimistic update is sufficient for local user
      } catch (err: any) {
        // Rollback on error
        setActivities(prev => prev.filter(a => a.id !== optimisticId));
        console.error('[TaskDetailModal] Failed to persist assignees:', err);
      }
    },
    [currentUser, setActivities]
  );

  const handleToggleAssignee = (user: UserModel) => {
    if (!task) return;
    
    // Always read from the mutated task object to survive rapid clicks within the same render cycle
    const latestAssignees = task.assignees || (task.assignee ? [task.assignee] : []);
    
    const isAssigned = latestAssignees.some(u => u.id === user.id);
    const updatedAssignees = isAssigned
      ? latestAssignees.filter((u) => u.id !== user.id)
      : [...latestAssignees, user];

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
    // Mutate the original object directly so rapid subsequent clicks before re-render see the latest state
    task.assignees = updatedAssignees;
    task.assigneeIds = updatedIds;
    task.assignee = primaryAssignee;
    task.assigneeId = primaryAssignee?.id || null;

    if (onUpdateTask) {
      onUpdateTask(updatedTask);
    }

    // 2. Debounced remote persistence (batches rapid toggles into one clean request)
    if (assigneeDebounceRef.current) {
      clearTimeout(assigneeDebounceRef.current);
    }
    assigneeDebounceRef.current = setTimeout(() => {
      persistAssignees(updatedTask, updatedIds, primaryAssignee, updatedAssignees);
    }, 50);
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

    task.assignees = [];
    task.assigneeIds = [];
    task.assignee = null;
    task.assigneeId = null;

    if (onUpdateTask) {
      onUpdateTask(updatedTask);
    }
    setIsAssigneeOpen(false);

    persistAssignees(updatedTask, [], null, []);
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

    // Optimistically append activity immediately
    const optimisticId = `optimistic-priority-${Date.now()}`;
    const optimisticActivity = {
      id: optimisticId,
      type: 'priority_change',
      author: currentUser?.name || 'Someone',
      oldPriority,
      newPriority: p,
      date: new Date(),
      user: currentUser,
    };
    setActivities(prev => [...prev, optimisticActivity]);

    try {
      await tasksApi.updateTask(task.id, {
        priority: p,
        currentListId: task.listId,
        userId: currentUser?.id,
      });
      toast.success(`Priority set to ${p}`);
    } catch (err: any) {
      // Rollback on error
      setActivities(prev => prev.filter(a => a.id !== optimisticId));
      toast.error(err.message || 'Failed to update priority');
    }
  };

  const handleAddComment = async () => {
    const trimmed = comment.trim();
    if (!trimmed && stagedFiles.length === 0) return;
    if (!task) return;
    if (isUploading || isSubmittingComment) return;

    setIsSubmittingComment(true);
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
      setIsSubmittingComment(false);
    }
  };

  const handleDescriptionFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        setIsUploading(true);
        const res = await uploadApi.uploadFile(file, 'attachments');
        if (res && res.url) {
          const payload = {
            fileName: file.name,
            fileUrl: res.url,
            fileKey: res.name || file.name,
            fileSize: file.size,
            mimeType: file.type,
          };
          
          const tempId = 'temp-' + Date.now();
          const newAtt = { id: tempId, ...payload };
          setAttachments((prev) => [...prev, newAtt]);

          try {
            const { attachment } = await tasksApi.createTaskAttachment(task.id, payload);
            setAttachments((prev) => prev.map(a => a.id === tempId ? attachment : a));
            if (onUpdateTask) onUpdateTask({ ...task, attachments: [...attachments, attachment] });
          } catch(err) {
            console.error('Failed to save to DB, keeping optimistic:', err);
            // It will stay in UI at least, so we don't lose it if DB is down
          }
        }
      } catch (err: any) {
        console.error('Failed to upload file:', err);
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
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
        dbUsers={dbUsers}
        onUpdateTask={onUpdateTask}
        setActiveSubtask={setActiveSubtask}
        permission={permission}
        listStatuses={internalListStatuses}
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
            <button
              onClick={onClose}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors mr-2 cursor-pointer"
              title="Go Back"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {task.list ? (
              <div className="flex items-center gap-2 text-xs text-zinc-400 font-medium">
                {task.list.space && (
                  <>
                    <button 
                      onClick={() => router.push(`/spaces/${task.list?.space?.id}`)}
                      className="flex items-center gap-1.5 hover:text-zinc-200 transition-colors cursor-pointer"
                    >
                      <div className="w-4 h-4 rounded bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
                        <span className="text-[9px] font-bold text-indigo-400">{task.list.space.name.charAt(0).toUpperCase()}</span>
                      </div>
                      <span className="truncate max-w-[120px]">{task.list.space.name}</span>
                    </button>
                    <span className="text-zinc-700">/</span>
                  </>
                )}

                {task.list.folder && (
                  <>
                    <button 
                      onClick={() => router.push(`/folders/${task.list?.folder?.id}`)}
                      className="flex items-center gap-1.5 hover:text-zinc-200 transition-colors cursor-pointer"
                    >
                      <Folder className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate max-w-[120px]">{task.list.folder.name}</span>
                    </button>
                    <span className="text-zinc-700">/</span>
                  </>
                )}

                <button 
                  onClick={() => router.push(`/lists/${task.list?.id}`)}
                  className="flex items-center gap-1.5 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  <ListTodo className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate max-w-[150px]">{task.list.name}</span>
                </button>
                <span className="text-zinc-700">/</span>
                <span className="truncate max-w-[150px] text-zinc-200">{task.title || 'Untitled'}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs animate-pulse opacity-50 cursor-default">
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded bg-zinc-800 shrink-0" />
                  <div className="w-16 h-3 bg-zinc-800 rounded" />
                </div>
                <span className="text-zinc-800">/</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-3.5 h-3.5 rounded bg-zinc-800 shrink-0" />
                  <div className="w-16 h-3 bg-zinc-800 rounded" />
                </div>
                <span className="text-zinc-800">/</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-3.5 h-3.5 rounded bg-zinc-800 shrink-0" />
                  <div className="w-20 h-3 bg-zinc-800 rounded" />
                </div>
              </div>
            )}

          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');
                const path = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '';
                const link = baseUrl ? `${baseUrl}${path}` : window.location.href;
                navigator.clipboard.writeText(link);
                toast.success('Link copied to clipboard');
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 text-[11px] font-medium rounded-lg border border-zinc-700/50 transition-colors cursor-pointer mr-2"
            >
              <Share2 className="w-3.5 h-3.5 text-zinc-400" />
              Share
            </button>
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

              <div className="mb-8 group w-fit">
                {isEditingTitle ? (
                  <input
                    autoFocus
                    type="text"
                    value={localTitle}
                    onChange={(e) => setLocalTitle(e.target.value)}
                    onBlur={() => {
                      setIsEditingTitle(false);
                      handleTitleBlur();
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    className="text-2xl font-bold bg-[#18181b] border border-zinc-700 focus:border-zinc-500 focus:outline-none w-[400px] transition-colors rounded px-2 py-1 -ml-2 text-zinc-100"
                  />
                ) : (
                  <h1
                    onClick={() => { if (canEditTask) setIsEditingTitle(true); }}
                    className={`text-2xl font-bold cursor-pointer hover:bg-zinc-800/50 rounded px-2 py-1 -ml-2 transition-colors flex items-center group w-fit ${(task.status === 'Closed' || task.status === 'CLOSED' || task.status === 'DONE') ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}
                  >
                    {localTitle}
                    <Pencil className="w-4 h-4 ml-3 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </h1>
                )}
              </div>

              {/* Properties Stack — row layout */}
              <div className="flex flex-col gap-2 mb-8 mt-1">

                {/* Status Row */}
                <div className="flex items-center gap-3 min-h-[32px]">
                  <div className="flex items-center gap-2 w-28 shrink-0">
                    {(() => {
                      const isClosed = task.status === 'Closed' || task.status === 'CLOSED' || task.status === 'DONE';
                      return isClosed ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-zinc-500" /> : <CircleDashed className="w-3.5 h-3.5 shrink-0 text-zinc-500" />;
                    })()}
                    <span className="text-[12px] text-zinc-500">Status</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(() => {
                      const statusName = task.status || 'No Status';
                      const statusObj = internalListStatuses?.find(s => (s.name || s.title || s.status) === statusName);
                      const hasCustomColor = !!statusObj?.color;
                      const defaultClasses = STATUS_COLORS[task.status] ?? 'bg-zinc-800/50 text-zinc-400';

                      return (
                        <div
                          style={hasCustomColor ? { backgroundColor: statusObj.color } : {}}
                          className={`inline-flex items-center h-7 rounded-md text-[11px] font-medium select-none transition-colors ${hasCustomColor ? 'text-white' : defaultClasses} cursor-pointer hover:brightness-110`}
                        >
                          <span className="px-2.5 uppercase">{statusName}</span>
                          <div className="h-4 w-[1px] bg-white/20" />
                          <Popover.Root open={isStatusOpen} onOpenChange={setIsStatusOpen}>
                            <Popover.Trigger asChild>
                              <div 
                                title="Change Status"
                                onClick={() => setIsStatusOpen(true)}
                                className="flex items-center gap-1.5 px-2.5 h-full hover:brightness-110 cursor-pointer"
                              >
                                <ChevronDown className="w-3.5 h-3.5 opacity-80" />
                              </div>
                            </Popover.Trigger>
                            <Popover.Portal>
                              <Popover.Content className="z-[200] w-48 p-1.5 bg-[#121212] border border-zinc-800 rounded-md shadow-xl outline-none" align="start" sideOffset={4}>
                                <div className="max-h-60 overflow-y-auto custom-scrollbar flex flex-col gap-0.5 pr-1">
                                  {((internalListStatuses && internalListStatuses.length > 0) ? internalListStatuses.map(s => typeof s === 'string' ? s : (s.name || s.status || s.title || '')) : ALL_STATUSES).map(s => (
                                    <div
                                      key={s}
                                      onClick={() => {
                                        handleStatusChangeAction(s);
                                        setIsStatusOpen(false);
                                      }}
                                      className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${task.status === s ? 'bg-blue-500/10 text-blue-400' : 'text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100'}`}
                                    >
                                      {(() => {
                                        const customObj = internalListStatuses?.find(ls => (ls.name || ls.status || ls.title) === s);
                                        if (customObj?.color) {
                                          return <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: customObj.color }} />;
                                        }
                                        return <div className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[s] ? STATUS_COLORS[s].split(' ')[0] : 'bg-zinc-500'}`} />;
                                      })()}
                                      {s}
                                      {s === task.status && <Check className="w-3 h-3 ml-auto opacity-70" />}
                                    </div>
                                  ))}
                                </div>
                              </Popover.Content>
                            </Popover.Portal>
                          </Popover.Root>

                          <div 
                            title="Move to next status"
                            className="flex items-center justify-center h-full px-1.5 border-l border-white/20 hover:brightness-110 cursor-pointer"
                            onClick={handleStatusClick}
                          >
                            <ChevronRight className="w-3.5 h-3.5 transition-opacity opacity-80 hover:opacity-100" />
                          </div>
                        </div>
                      );
                    })()}

                    <div className="flex items-center gap-1.5 shrink-0 ml-1">
                      <button
                        onClick={() => handleStatusChangeAction('Closed')}
                        title="Mark as Closed"
                        className="w-7 h-7 rounded flex items-center justify-center transition-colors shadow-sm border bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-emerald-600 hover:border-emerald-600 hover:text-white cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                </div>

                {/* Assignees Row */}
                <div className="flex items-center gap-3 min-h-[32px]">
                  <div className="flex items-center gap-2 w-28 shrink-0">
                    <User className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                    <span className="text-[12px] text-zinc-500">Assignees</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Add role button (Assign Team) — moved to left of Assign */}
                    <Popover.Root>
                      <Popover.Trigger asChild>
                        {(task.assigneeRoleRestrictions && task.assigneeRoleRestrictions.length > 0) ? (
                          <div className={`flex items-center cursor-pointer transition-all duration-300 hover:scale-105 active:scale-95 ${!canAssignTask ? 'opacity-50 pointer-events-none' : ''}`}>
                            {task.assigneeRoleRestrictions.map((role, i) => {
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
                          <button disabled={!canAssignTask} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700/50 text-zinc-400 hover:text-zinc-200 text-[11px] cursor-pointer transition-colors select-none whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed">
                            <Plus className="w-3 h-3" />
                            Assign Team
                            {!canAssignTask && <Lock className="w-3 h-3 ml-0.5 shrink-0" />}
                          </button>
                        )}
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content className="z-[200] w-52 p-1 bg-[#121212] border border-zinc-800 rounded-lg shadow-2xl outline-none" sideOffset={4} align="start">
                          <div className="max-h-[220px] overflow-y-auto custom-scrollbar p-1">
                            <p className="text-[10px] text-zinc-500 px-2 py-1 uppercase tracking-wide font-medium">Restrict assignees to roles</p>
                            {workspaceRoles.map(role => {
                              const selected = (task.assigneeRoleRestrictions || []).includes(role.name);
                              return (
                                <div
                                  key={role.id}
                                  onClick={() => {
                                    const current = task.assigneeRoleRestrictions || [];
                                    const next = selected
                                      ? current.filter(r => r !== role.name)
                                      : [...current, role.name];
                                    task.assigneeRoleRestrictions = next;
                                    const updatedTask = { ...task, assigneeRoleRestrictions: next };
                                    if (onUpdateTask) onUpdateTask(updatedTask);
                                    tasksApi.updateTask(task.id, { assigneeRoleRestrictions: next } as any);
                                  }}
                                  className="flex items-center gap-2 cursor-pointer px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 rounded-md transition-colors"
                                >
                                  <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${selected ? 'bg-indigo-600 border-indigo-500' : 'border-zinc-600'}`}>
                                    {selected && <Check className="w-2.5 h-2.5 text-white" />}
                                  </div>
                                  {role.name}
                                </div>
                              );
                            })}
                          </div>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                    <Popover.Root open={isAssigneeOpen && canAssignTask} onOpenChange={(open) => canAssignTask && setIsAssigneeOpen(open)}>
                      <Popover.Trigger asChild>
                        <div
                          title={currentAssignees.map((u) => u.name).join(', ')}
                          className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md transition-colors text-[11px] select-none w-fit ${
                            canAssignTask 
                              ? 'cursor-pointer bg-zinc-800/50 hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-200' 
                              : 'cursor-not-allowed bg-zinc-800/20 text-zinc-500 opacity-70'
                          }`}
                        >
                          {currentAssignees.length > 0 ? (
                            <>
                              <div className="flex items-center -space-x-1.5">
                                {currentAssignees.slice(0, 2).map((u) => (
                                  <div key={u.id} className="relative ring-2 ring-[#121212] rounded-full shrink-0" title={u.name}>
                                    {u.avatarUrl ? (
                                      <img src={u.avatarUrl} alt={u.name} className="w-5 h-5 rounded-full object-cover" />
                                    ) : (
                                      <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-[9px] text-white font-bold">
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
                                <span className="truncate max-w-[100px]">{currentAssignees[0].name}</span>
                              )}
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5 shrink-0" />
                              <span>Assign</span>
                              {!canAssignTask && <Lock className="w-3 h-3 ml-0.5 shrink-0" />}
                            </>
                          )}
                        </div>
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content
                          className="z-[200] w-72 p-0 bg-[#121212] border border-zinc-800 rounded-md shadow-2xl outline-none overflow-hidden"
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

                              {assignableUsers.map((u) => {
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
                                        <img src={u.avatarUrl} alt={u.name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                                      ) : (
                                        <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] text-white font-bold shrink-0">
                                          {(u.name || 'U').substring(0, 2).toUpperCase()}
                                        </div>
                                      )}
                                      <div className="flex flex-col truncate">
                                        <span className="truncate text-xs font-medium text-zinc-200">{u.name}</span>
                                        <span className="truncate text-[10px] text-zinc-500">{u.primaryRole || u.email}</span>
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
                    {currentAssignees.length > 0 && canEditTask && (
                      <button
                        onClick={handleClearAllAssignees}
                        title="Clear all assignees"
                        className="p-1 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 rounded transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}

                  </div>
                </div>






                {/* Priority Row */}
                <div className="flex items-center gap-3 min-h-[32px]">
                  <div className="flex items-center gap-2 w-28 shrink-0">
                    <Flag className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                    <span className="text-[12px] text-zinc-500">Priority</span>
                  </div>
                  <Popover.Root open={isPriorityOpen && canEditTask} onOpenChange={setIsPriorityOpen}>
                    <Popover.Trigger asChild>
                      <div className="inline-flex items-center gap-1.5 h-7 px-2.5 cursor-pointer bg-zinc-800/50 hover:bg-zinc-700/50 rounded-md transition-colors text-[11px] select-none w-fit">
                        {(() => {
                          const priorityColor = task.priority ? (PRIORITY_COLORS[task.priority]?.split(' ')[0] ?? 'text-zinc-400') : 'text-zinc-500';
                          return (
                            <span className={`capitalize ${priorityColor}`}>
                              {task.priority?.toLowerCase() || 'Empty'}
                            </span>
                          );
                        })()}
                      </div>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content className="z-[200] w-56 p-1 bg-[#0f0f0f] border border-zinc-800 rounded-xl shadow-2xl outline-none" side="bottom" align="start" sideOffset={4}>
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



              <div className="mt-8 relative group mb-8">
                <div className="flex items-center justify-between mb-4 shrink-0">
                  <span className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                    <AlignLeft className="w-5 h-5" />
                    Description
                  </span>
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
                  className={`relative p-2 -mx-2 rounded-lg transition-colors hover:bg-zinc-800/20 cursor-text`}
                  onFocus={(e) => { if (canEditTask) handleStartEditing(); else e.target.blur(); }}
                  onClick={() => handleStartEditing()}
                >
                  <BlockEditor
                    content={localDescription}
                    onChange={handleDescChange}
                    onBlur={handleDescBlur}
                    editable={!editingUser}
                    onEditorReady={(editor) => { editorRef.current = editor; }}
                  />

                  {(!localDescription || localDescription === '<p></p>' || localDescription === '<p><br></p>') && (
                    <div className="absolute top-2 left-2 text-sm text-zinc-500 italic pointer-events-none">
                      Add description...
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
                listStatuses={internalListStatuses}
              />

              {(!task.subtasks || task.subtasks.length === 0) && !addingSubtask && (
                <div className="mt-4 mb-2 max-w-md">
                  <button onClick={() => setAddingSubtask(true)} className="flex items-center gap-3 text-zinc-400 hover:text-zinc-200 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors w-full text-left text-sm font-medium cursor-pointer">
                    <Plus className="w-4 h-4 shrink-0" /> Add subtask
                  </button>
                </div>
              )}

              {/* Action Buttons (Notes, Attachments, etc) */}
              <div className="mt-2 flex flex-col gap-2 w-full">
                <AuditSection
                  task={task}
                  title={task.title}
                  users={dbUsers || []}
                  checklists={task.checklists || []}
                  currentUser={currentUser}
                  onUpdateChecklists={(checklists) => {
                    if (onUpdateTask) onUpdateTask({ ...task, checklists });
                  }}
                />
                <ChecklistsSection
                  task={task}
                  users={dbUsers || []}
                  checklists={task.checklists || []}
                  currentUser={currentUser}
                  onUpdateChecklists={(checklists) => {
                    if (onUpdateTask) onUpdateTask({ ...task, checklists });
                  }}
                />
                <input type="file" ref={fileInputRef} className="hidden" onChange={handleDescriptionFileChange} />
                <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="flex items-center gap-3 text-zinc-400 hover:text-zinc-200 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors w-full text-left text-sm font-medium cursor-pointer disabled:opacity-50">
                  <Paperclip className="w-4 h-4 shrink-0" /> {isUploading ? 'Uploading...' : 'Attach file or image'}
                </button>
                <AttachmentsGrid
                  attachments={attachments}
                  onDelete={async (id) => {
                    await tasksApi.deleteTaskAttachment(task.id, id);
                    setAttachments(prev => prev.filter(a => a.id !== id));
                    if (onUpdateTask) onUpdateTask({ ...task, attachments: attachments.filter(a => a.id !== id) });
                  }}
                />
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
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1">{act.author || 'Someone'}</span>
                                    {act.subtaskTitle ? (
                                      <>changed status of subtask <span className="font-medium text-zinc-300 px-1">{act.subtaskTitle}</span></>
                                    ) : (
                                      <>changed status from <span className="font-medium text-zinc-300 px-1">{act.oldStatus}</span></>
                                    )}
                                    {' '}to <span className="text-blue-400 font-medium bg-blue-500/10 px-1 rounded">{act.newStatus}</span>
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
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1">{act.author || 'Someone'}</span> assigned{' '}
                                    {act.subtaskTitle ? (
                                      <>to subtask <span className="text-zinc-300 font-medium px-1">{act.subtaskTitle}</span>:{' '}</>
                                    ) : (
                                      <>to{' '}</>
                                    )}
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
                                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitReply(comment.id); } }}
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
                  disabled={isSubmittingComment}
                  className="w-full bg-[#121212] border border-zinc-800 rounded-lg pl-4 pr-12 py-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 resize-none h-[80px] custom-scrollbar disabled:opacity-50"
                  placeholder={isSubmittingComment ? "Posting comment..." : "Write a comment... (Press Enter to post)"}
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
  dbUsers,
  onUpdateTask,
  setActiveSubtask,
  permission,
  listStatuses,
}: {
  subtask: any;
  parentTask: any;
  onClose: () => void;
  currentUser?: any;
  socket?: any;
  dbUsers?: any[];
  onUpdateTask?: (task: any) => void;
  setActiveSubtask?: (st: any) => void;
  permission?: { allowed: boolean; reason?: string };
  listStatuses?: any[];
}) {
  const router = useRouter();
  const [richComments, setRichComments] = useState<any[]>([]);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localDesc, setLocalDesc] = useState(subtask.description || '');
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [localTitle, setLocalTitle] = useState(subtask.title || '');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [isActivityExpanded, setIsActivityExpanded] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<any>(null);
  // Task edits are open to all
  const canEditTask = true;
  const canAssignTask = permission?.allowed ?? true;

  const handleDescriptionFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        setIsUploading(true);
        const res = await uploadApi.uploadFile(file, 'attachments');
        if (res && res.url) {
          const payload = {
            fileName: file.name,
            fileUrl: res.url,
            fileKey: res.name || file.name,
            fileSize: file.size,
            mimeType: file.type,
          };
          const { attachment } = await tasksApi.createTaskAttachment(subtask.id, payload);
          const updatedSubtask = { ...subtask, attachments: [...(subtask.attachments || []), attachment] };
          if (setActiveSubtask) setActiveSubtask(updatedSubtask);
          if (onUpdateTask) {
            const newSubtasks = parentTask.subtasks?.map((st: any) => st.id === updatedSubtask.id ? updatedSubtask : st) || [];
            onUpdateTask({ ...parentTask, subtasks: newSubtasks });
          }
        }
      } catch (err: any) {
        console.error('Failed to upload file:', err);
      } finally {
        setIsUploading(false);
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const [activityWidth, setActivityWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);
  const [isCheckLocked, setIsCheckLocked] = useState(false);

  const handleStatusChangeAction = async (newStatus: string) => {
    if (!subtask || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const isCompleted = newStatus === 'Closed' || newStatus === 'CLOSED' || newStatus === 'DONE';
      const updatedSubtask = { ...subtask, status: newStatus, completed: isCompleted };

      if (setActiveSubtask) setActiveSubtask(updatedSubtask);
      if (onUpdateTask) {
        const newSubtasks = parentTask.subtasks?.map((st: any) => st.id === updatedSubtask.id ? updatedSubtask : st) || [];
        onUpdateTask({ ...parentTask, subtasks: newSubtasks });
      }

      await tasksApi.updateSubtask(parentTask.id, subtask.id, { status: newStatus, completed: isCompleted });
    } catch (err) {
      console.error('Failed to update subtask status', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = document.body.clientWidth - e.clientX;
      if (newWidth > 250 && newWidth < 800) {
        setActivityWidth(newWidth);
      }
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    setLocalDesc(subtask.description || '');
    setLocalTitle(subtask.title || '');
  }, [subtask.description, subtask.title]);

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
    const sanitizedDesc = (localDesc === '<p></p>' || localDesc === '<p><br></p>') ? '' : localDesc;
    if (sanitizedDesc !== subtask.description) {
      tasksApi.updateSubtask(parentTask.id, subtask.id, { description: sanitizedDesc }).catch(err => console.error(err));
    }
    if (socket) {
      socket.emit('task_editing_stop', {
        listId: parentTask.listId,
        taskId: subtask.id,
        description: sanitizedDesc,
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

  const handleCommentFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setStagedFiles(prev => [...prev, file]);
    }
    if (commentFileInputRef.current) {
      commentFileInputRef.current.value = '';
    }
  };

  const handleAddComment = async () => {
    const trimmed = comment.trim();
    if (!trimmed && stagedFiles.length === 0) return;
    if (!currentUser?.id || isSubmitting || isUploading) return;

    setIsSubmitting(true);
    try {
      let content = trimmed;
      if (stagedFiles.length > 0) {
        setIsUploading(true);
        for (const file of stagedFiles) {
          const res = await uploadApi.uploadFile(file, 'comment');
          if (file.type.startsWith('image/')) {
            content += (content ? '\n' : '') + `![${file.name}](${res.url})`;
          } else {
            content += (content ? '\n' : '') + `[${file.name}](${res.url})`;
          }
        }
        setIsUploading(false);
      }

      await tasksApi.addComment(parentTask.id, content, currentUser.id, parentTask.listId, [], undefined, subtask.id);
      setComment('');
      setStagedFiles([]);
      const res = await tasksApi.getComments(parentTask.id, subtask.id);
      if (res?.comments) setRichComments(res.comments);

      // Reflect comment count in the parent task modal's SubtasksSection
      const updatedSubtask = { ...subtask, comments: [...(subtask.comments || []), { id: Date.now().toString() }] };
      if (setActiveSubtask) setActiveSubtask(updatedSubtask);
      if (onUpdateTask) {
        const newSubtasks = parentTask.subtasks?.map((st: any) => st.id === updatedSubtask.id ? updatedSubtask : st) || [];
        onUpdateTask({ ...parentTask, subtasks: newSubtasks });
      }
    } catch (err) {
      console.error('Failed to post comment:', err);
      setIsUploading(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTitleBlur = () => {
    if (localTitle !== subtask.title) {
      if (onUpdateTask) {
        const updatedSubtask = { ...subtask, title: localTitle };
        if (setActiveSubtask) setActiveSubtask(updatedSubtask);
        const newSubtasks = parentTask.subtasks?.map((st: any) => st.id === updatedSubtask.id ? updatedSubtask : st) || [];
        onUpdateTask({ ...parentTask, subtasks: newSubtasks });
      }
      tasksApi.updateSubtask(parentTask.id, subtask.id, { title: localTitle }).catch(err => console.error(err));
    }
  };

  const assignee = subtask.assignee;

  return (
    <div
      className="w-full h-full bg-[#121212] flex flex-col overflow-hidden cursor-default"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60 bg-[#18181b] shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors mr-2 cursor-pointer"
            title="Go Back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {parentTask.list ? (
            <div className="flex items-center gap-2 text-xs text-zinc-400 font-medium">
              {parentTask.list.space && (
                <>
                  <button 
                    onClick={() => router.push(`/spaces/${parentTask.list?.space?.id}`)}
                    className="flex items-center gap-1.5 hover:text-zinc-200 transition-colors cursor-pointer"
                  >
                    <div className="w-4 h-4 rounded bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
                      <span className="text-[9px] font-bold text-indigo-400">{parentTask.list.space.name.charAt(0).toUpperCase()}</span>
                    </div>
                    <span className="truncate max-w-[120px]">{parentTask.list.space.name}</span>
                  </button>
                  <span className="text-zinc-700">/</span>
                </>
              )}
              {parentTask.list.folder && (
                <>
                  <button 
                    onClick={() => router.push(`/folders/${parentTask.list?.folder?.id}`)}
                    className="flex items-center gap-1.5 hover:text-zinc-200 transition-colors cursor-pointer"
                  >
                    <Folder className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate max-w-[120px]">{parentTask.list.folder.name}</span>
                  </button>
                  <span className="text-zinc-700">/</span>
                </>
              )}
              <button 
                onClick={() => router.push(`/lists/${parentTask.list?.id}`)}
                className="flex items-center gap-1.5 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                <ListTodo className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate max-w-[150px]">{parentTask.list.name}</span>
              </button>
              <span className="text-zinc-700">/</span>
              <span className="truncate max-w-[150px] text-zinc-400">{parentTask.title || 'Untitled'}</span>
              <span className="text-zinc-700">/</span>
              <span className="truncate max-w-[150px] text-zinc-200">{subtask.title || 'Untitled'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs animate-pulse opacity-50 cursor-default">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-zinc-800 shrink-0" />
                <div className="w-16 h-3 bg-zinc-800 rounded" />
              </div>
              <span className="text-zinc-800">/</span>
              <div className="flex items-center gap-1.5">
                <div className="w-3.5 h-3.5 rounded bg-zinc-800 shrink-0" />
                <div className="w-16 h-3 bg-zinc-800 rounded" />
              </div>
              <span className="text-zinc-800">/</span>
              <div className="flex items-center gap-1.5">
                <div className="w-3.5 h-3.5 rounded bg-zinc-800 shrink-0" />
                <div className="w-20 h-3 bg-zinc-800 rounded" />
              </div>
              <span className="text-zinc-800">/</span>
              <div className="w-24 h-3 bg-zinc-800 rounded" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Action buttons could go here */}
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              toast.success('Link copied to clipboard');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 text-[11px] font-medium rounded-lg border border-zinc-700/50 transition-colors cursor-pointer mr-2"
          >
            <Share2 className="w-3.5 h-3.5 text-zinc-400" />
            Share
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content area: Split layout matching main task */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left Panel: Details & Description */}
        <div className="flex-1 overflow-y-auto border-r border-zinc-800/60 custom-scrollbar">
          <div className="p-8">
            <div className="flex items-center gap-1.5 text-[13px] text-zinc-500 mb-2 cursor-pointer hover:text-zinc-300 transition-colors" onClick={onClose}>
              Subtask of
              <div className="flex items-center gap-1.5 ml-1 text-zinc-300">
                {(parentTask.completed || parentTask.status === 'DONE' || parentTask.status === 'CLOSED' || parentTask.status === 'Closed') && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                )}
                {parentTask.title}
              </div>
            </div>

            <div className="flex items-center gap-2 mb-8 group w-fit">
              <CornerDownRight className="w-5 h-5 text-zinc-500 shrink-0" />
              {isEditingTitle ? (
                <input
                  autoFocus
                  type="text"
                  value={localTitle}
                  onChange={(e) => setLocalTitle(e.target.value)}
                  onBlur={() => {
                    setIsEditingTitle(false);
                    handleTitleBlur();
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  className="text-2xl font-bold bg-[#18181b] border border-zinc-700 focus:border-zinc-500 focus:outline-none w-[400px] transition-colors rounded px-2 py-1 -ml-2 text-zinc-100"
                />
              ) : (
                <h1 
                  onClick={() => { if (canEditTask) setIsEditingTitle(true); }}
                  className={`text-2xl font-bold cursor-pointer hover:bg-zinc-800/50 rounded px-2 py-1 -ml-2 transition-colors flex items-center group w-fit ${(subtask.status === 'Closed' || subtask.status === 'CLOSED' || subtask.completed) ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}
                >
                  {localTitle}
                  <Pencil className="w-4 h-4 ml-3 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </h1>
              )}
            </div>
            
            {/* Properties Stack — row layout */}
            <div className="flex flex-col gap-2 mb-8 mt-1">

              {/* Status Row */}
              <div className="flex items-center gap-3 min-h-[32px]">
                <div className="flex items-center gap-2 w-28 shrink-0">
                  {(() => {
                    const isClosed = subtask.completed || subtask.status === 'Closed' || subtask.status === 'CLOSED' || subtask.status === 'DONE';
                    return isClosed ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-zinc-500" /> : <CircleDashed className="w-3.5 h-3.5 shrink-0 text-zinc-500" />;
                  })()}
                  <span className="text-[12px] text-zinc-500">Status</span>
                </div>
                  {(() => {
                    const statusName = subtask.status || 'No Status';
                    const statusObj = listStatuses?.find((s: any) => (s.name || s.title || s.status) === statusName);
                    const hasCustomColor = !!statusObj?.color;
                    const defaultClasses = STATUS_COLORS[subtask.status] ?? 'bg-zinc-800/50 text-zinc-400';

                    return (
                      <div
                        style={hasCustomColor ? { backgroundColor: statusObj.color } : {}}
                        className={`inline-flex items-center h-7 rounded-md text-[11px] font-medium select-none transition-colors ${hasCustomColor ? 'text-white' : defaultClasses} cursor-pointer hover:brightness-110`}
                      >
                        <span className="px-2.5 uppercase">{statusName}</span>
                        <div className="h-4 w-[1px] bg-white/20" />
                        <Popover.Root open={isStatusOpen} onOpenChange={setIsStatusOpen}>
                          <Popover.Trigger asChild>
                            <div 
                              title="Change Status"
                              onClick={() => setIsStatusOpen(true)}
                              className="flex items-center gap-1.5 px-2.5 h-full hover:brightness-110 cursor-pointer"
                            >
                              <ChevronDown className="w-3.5 h-3.5 opacity-80" />
                            </div>
                          </Popover.Trigger>
                          <Popover.Portal>
                            <Popover.Content className="z-[200] w-48 p-1.5 bg-[#121212] border border-zinc-800 rounded-md shadow-xl outline-none" align="start" sideOffset={4}>
                              <div className="max-h-60 overflow-y-auto custom-scrollbar flex flex-col gap-0.5 pr-1">
                                {((listStatuses && listStatuses.length > 0) ? listStatuses.map((s: any) => typeof s === 'string' ? s : (s.name || s.status || s.title || '')) : ALL_STATUSES).map((s: string) => (
                                  <div
                                    key={s}
                                    onClick={() => {
                                      tasksApi.updateSubtask(parentTask.id, subtask.id, { 
                                        status: s,
                                        completed: s.toLowerCase() === 'done' || s.toLowerCase() === 'completed' || s.toLowerCase() === 'closed'
                                      }).catch(err => console.error(err));
                                      if (setActiveSubtask) {
                                        setActiveSubtask({ ...subtask, status: s, completed: s.toLowerCase() === 'done' || s.toLowerCase() === 'completed' || s.toLowerCase() === 'closed' });
                                      }
                                      setIsStatusOpen(false);
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
                    );
                  })()}

                  <button
                    onClick={() => {
                      tasksApi.updateSubtask(parentTask.id, subtask.id, { status: 'Closed', completed: true }).catch(err => console.error(err));
                      if (setActiveSubtask) setActiveSubtask({ ...subtask, status: 'Closed', completed: true });
                    }}
                    title="Mark as Closed"
                    className="w-7 h-7 rounded flex items-center justify-center transition-colors shadow-sm border bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-emerald-600 hover:border-emerald-600 hover:text-white cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>



              {/* Assignees Row */}
              <div className="flex items-center gap-3 min-h-[32px]">
                <div className="flex items-center gap-2 w-28 shrink-0">
                  <User className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                  <span className="text-[12px] text-zinc-500">Assignees</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Popover.Root>
                    <Popover.Trigger asChild>
                      {(subtask.assigneeRoleRestrictions && subtask.assigneeRoleRestrictions.length > 0) ? (
                        <div className={`flex items-center cursor-pointer transition-all duration-300 hover:scale-105 active:scale-95 ${!canAssignTask ? 'opacity-50 pointer-events-none' : ''}`}>
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
                        <button disabled={!canAssignTask} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700/50 text-zinc-400 hover:text-zinc-200 text-[11px] cursor-pointer transition-colors select-none whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed">
                          <Plus className="w-3 h-3 shrink-0" />
                          Assign Team
                        </button>
                      )}
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content className="z-[200] w-52 p-1 bg-[#121212] border border-zinc-800 rounded-lg shadow-2xl outline-none" sideOffset={4} align="start">
                        <div className="max-h-[220px] overflow-y-auto custom-scrollbar p-1">
                          <p className="text-[10px] text-zinc-500 px-2 py-1 uppercase tracking-wide font-medium">Restrict assignees to roles</p>
                          <p className="text-[10px] text-zinc-400 px-2 py-1">Not implemented for subtasks</p>
                        </div>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>

                  <div className="inline-flex items-center gap-1.5 h-7 px-2.5 cursor-pointer bg-zinc-800/50 hover:bg-zinc-700/50 rounded-md transition-colors text-[11px] text-zinc-400 hover:text-zinc-200 select-none w-fit">
                    {assignee ? (
                      <>
                        {assignee.avatarUrl ? (
                          <img src={assignee.avatarUrl} alt={assignee.name} className="w-5 h-5 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-[9px] text-white font-bold shrink-0">
                            {(assignee.name || 'U').substring(0, 2).toUpperCase()}
                          </div>
                        )}
                        <span className="truncate max-w-[100px]">{assignee.name}</span>
                      </>
                    ) : (
                      <><Plus className="w-3.5 h-3.5 shrink-0" /><span>Assign</span></>
                    )}
                  </div>
                </div>
              </div>

              {/* Priority Row */}
              <div className="flex items-center gap-3 min-h-[32px]">
                <div className="flex items-center gap-2 w-28 shrink-0">
                  <Flag className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                  <span className="text-[12px] text-zinc-500">Priority</span>
                </div>
                <div className="inline-flex items-center gap-1.5 h-7 px-2.5 cursor-pointer bg-zinc-800/50 hover:bg-zinc-700/50 rounded-md transition-colors text-[11px] select-none w-fit">
                  {(() => {
                    const priorityColor = subtask.priority ? (PRIORITY_COLORS[subtask.priority]?.split(' ')[0] ?? 'text-zinc-400') : 'text-zinc-500';
                    return (
                      <span className={`capitalize ${priorityColor}`}>
                        {subtask.priority?.toLowerCase() || 'Empty'}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Description */ }
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
      className="flex-1 relative group hover:bg-zinc-800/20 rounded-lg p-2 -mx-2 transition-colors cursor-text"
      onFocus={(e) => { if (canEditTask) handleStartEditing(); else e.target.blur(); }}
      onClick={() => handleStartEditing()}
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
        onBlur={() => {
          if (onUpdateTask) {
            const newSubtasks = parentTask.subtasks?.map((st: any) => st.id === subtask.id ? { ...st, description: localDesc } : st) || [];
            onUpdateTask({ ...parentTask, subtasks: newSubtasks });
          }
          if (socket && subtask) {
            socket.emit('task_editing_end', {
              listId: parentTask.listId,
              taskId: subtask.id,
              userName: currentUser?.name || 'Someone',
            });
          }
          setEditingUser(null);
        }}
        editable={!editingUser}
        onEditorReady={(editor) => { editorRef.current = editor; }}
      />

      {(!localDesc || localDesc === '<p></p>' || localDesc === '<p><br></p>') && (
        <div className="absolute top-2 left-2 text-sm text-zinc-500 italic pointer-events-none">
          Add description...
        </div>
      )}
    </div>

    {/* Action Buttons (Notes, Attachments, etc) */}
    <div className="mt-8 flex flex-col gap-2 w-full">
      <AuditSection
        task={parentTask}
        title={subtask.title}
        subtaskId={subtask.id}
        users={dbUsers || []}
        checklists={subtask.checklists || []}
        currentUser={currentUser}
        onUpdateChecklists={(checklists) => {
          const updatedSubtask = { ...subtask, checklists };
          if (setActiveSubtask) setActiveSubtask(updatedSubtask);
          if (onUpdateTask) {
            const newSubtasks = parentTask.subtasks?.map((st: any) => st.id === updatedSubtask.id ? updatedSubtask : st) || [];
            onUpdateTask({ ...parentTask, subtasks: newSubtasks });
          }
        }}
      />
      <ChecklistsSection
        task={parentTask}
        subtaskId={subtask.id}
        users={dbUsers || []}
        checklists={subtask.checklists || []}
        currentUser={currentUser}
        onUpdateChecklists={(checklists) => {
          const updatedSubtask = { ...subtask, checklists };
          if (setActiveSubtask) setActiveSubtask(updatedSubtask);
          if (onUpdateTask) {
            const newSubtasks = parentTask.subtasks?.map((st: any) => st.id === updatedSubtask.id ? updatedSubtask : st) || [];
            onUpdateTask({ ...parentTask, subtasks: newSubtasks });
          }
        }}
      />

      <input type="file" ref={fileInputRef} className="hidden" onChange={handleDescriptionFileChange} />
      <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="flex items-center gap-3 text-zinc-400 hover:text-zinc-200 px-3 py-2 hover:bg-zinc-800/40 rounded-lg transition-colors w-full text-left text-sm font-medium cursor-pointer disabled:opacity-50">
        <Paperclip className="w-4 h-4 shrink-0" /> {isUploading ? 'Uploading...' : 'Attach file or image'}
      </button>
      <AttachmentsGrid
        attachments={subtask.attachments || []}
        onDelete={async (id) => {
          await tasksApi.deleteTaskAttachment(subtask.id, id);
          const updatedSubtask = { ...subtask, attachments: (subtask.attachments || []).filter((a: any) => a.id !== id) };
          if (setActiveSubtask) setActiveSubtask(updatedSubtask);
          if (onUpdateTask) {
            const newSubtasks = parentTask.subtasks?.map((st: any) => st.id === updatedSubtask.id ? updatedSubtask : st) || [];
            onUpdateTask({ ...parentTask, subtasks: newSubtasks });
          }
        }}
      />
    </div>
  </div>
          </div >
        </div >

    {/* Right Panel: Activity Log */ }
    < div className = "w-[380px] bg-[#18181b] flex flex-col border-l border-zinc-800/60 shrink-0 z-10" >
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
                const dateStr = new Date(c.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
                
                const cGroups: Record<string, { count: number; users: string[]; hasMe: boolean }> = {};
                (c.reactions || []).forEach((r: any) => {
                  if (!cGroups[r.emoji]) cGroups[r.emoji] = { count: 0, users: [], hasMe: false };
                  cGroups[r.emoji].count++;
                  cGroups[r.emoji].users.push(r.user?.name || '?');
                  if (r.userId === currentUser?.id) cGroups[r.emoji].hasMe = true;
                });
                
                return (
                  <div key={c.id} className="flex flex-col gap-2 text-sm w-full bg-[#202024] p-4 rounded-xl border border-zinc-800/60 shadow-sm">
                    <div className="flex items-center gap-3 w-full">
                      {c.user?.avatarUrl ? (
                        <img src={c.user.avatarUrl} alt={c.user?.name} className="w-8 h-8 rounded-full shrink-0 object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-indigo-600 shrink-0 flex items-center justify-center text-white text-[11px] font-bold">
                          {(c.user?.name || 'U').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 flex items-center gap-2">
                        <span className="text-zinc-200 font-medium text-[13px]">{c.user?.name || 'Someone'}</span>
                        <span className="text-[11px] text-zinc-500">{dateStr} {timeStr}</span>
                      </div>
                    </div>
                    
                    <div className="text-zinc-300 text-[13.5px] leading-relaxed max-w-full break-words prose prose-sm prose-invert prose-p:my-0 prose-a:text-blue-400 hover:prose-a:underline prose-img:rounded-md prose-img:my-2 prose-img:max-w-full w-full pl-11">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                        {c.content}
                      </ReactMarkdown>
                    </div>
                    
                    {/* Reaction pills */}
                    {Object.keys(cGroups).length > 0 && (
                      <div className="flex flex-wrap gap-1 pl-11">
                        {Object.entries(cGroups).map(([emoji, data]) => (
                          <button
                            key={emoji}
                            title={data.users.join(', ')}
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
                        className={`flex items-center justify-center w-6 h-6 rounded hover:bg-zinc-700/80 cursor-pointer transition-colors ${cGroups['👍']?.hasMe ? 'text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                        title="Like"
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="flex items-center justify-center w-6 h-6 rounded hover:bg-zinc-700/80 cursor-pointer text-zinc-500 hover:text-zinc-300 transition-colors"
                        title="React"
                      >
                        <SmilePlus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="flex items-center gap-1.5 px-2 h-6 rounded hover:bg-zinc-700/80 cursor-pointer text-zinc-500 hover:text-zinc-300 transition-colors text-[11px] font-medium ml-1"
                      >
                        <MessageSquare className="w-3 h-3" /> Reply {c.replyCount > 0 && `(${c.replyCount})`}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-4 bg-[#18181b] border-t border-zinc-800/60 shrink-0">
            <div className="relative">
              {stagedFiles.length > 0 && (
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {stagedFiles.map((file, i) => (
                    <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800/80 border border-zinc-700/50 text-xs text-zinc-300">
                      <Paperclip className="w-3 h-3 text-zinc-500" />
                      <span className="max-w-[150px] truncate">{file.name}</span>
                      <button onClick={() => setStagedFiles(prev => prev.filter((_, idx) => idx !== i))} className="p-0.5 hover:bg-zinc-700 rounded-sm ml-1 text-zinc-400 hover:text-red-400">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAddComment();
                  }
                }}
                disabled={isSubmitting}
                className="w-full bg-[#121212] border border-zinc-800 rounded-lg pl-4 pr-12 py-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 resize-none h-[80px] custom-scrollbar disabled:opacity-50"
                placeholder={isSubmitting ? "Posting comment..." : "Write a comment... (Press Enter to post)"}
              />
              <input type="file" ref={commentFileInputRef} className="hidden" onChange={handleCommentFileChange} />
              <button
                onClick={() => commentFileInputRef.current?.click()}
                disabled={isUploading}
                className="absolute right-[56px] bottom-3 p-1.5 rounded-md hover:bg-zinc-800 disabled:opacity-50 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                title="Attach file or image"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <button 
                onClick={handleAddComment}
                disabled={(!comment.trim() && stagedFiles.length === 0) || isUploading}
                className="absolute right-3 bottom-3 p-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white transition-colors cursor-pointer"
                title="Send comment"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div >
      </div >
    </div >
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
          if (res?.task) {
            setFullTask(prev => {
              if (!prev) return res.task;
              return { ...res.task, ...prev };
            });
          }
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
