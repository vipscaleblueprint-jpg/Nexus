import { createPortal } from 'react-dom';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X, User, Flag, Repeat, Calendar, CircleDashed, CheckSquare, Link2, ListTodo, Paperclip, Check, ChevronRight, ChevronDown, ChevronLeft, ChevronUp, Folder, Pencil, Lock, Unlock, Send, ThumbsUp, SmilePlus, MessageSquare, Plus, AlignLeft, CornerDownRight, CheckCircle2, CircleDot, ImageIcon, File, FileText, Share2, MoreHorizontal, Trash2, ExternalLink, ShieldCheck, Loader2, Maximize2, Minimize2, Clock, AlertTriangle } from 'lucide-react';
import { validateUploadFile, formatFileSize, ATTACHMENT_SOFT_MAX_BYTES, IMAGE_SOFT_MAX_BYTES, MAX_FILES_PER_BATCH } from '@/lib/fileValidation';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { BlockEditor } from '../ui/BlockEditor';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { uploadApi } from '@/api/upload';
import { Task, User as UserModel, Priority } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { useShallow } from 'zustand/react/shallow';
import { canUserMoveTask, canTransitionTaskStatus } from '@/lib/permissions';
import { useCanSetAssignees, useAssignDeniedMessage } from '@/lib/useCanSetAssignees';
import { toast } from '@/lib/toast';
import { isNexusAuditChecklist, normalizeAuditName } from '@/lib/auditChecklist';

import { getPriorityConfig, PRIORITY_OPTIONS } from '@/lib/priority';
import { usersApi, tasksApi } from '@/api';
import { fetchListStatuses } from '@/lib/listStatusCache';
import { SubtasksSection } from './SubtasksSection';
import { ChecklistsSection } from './ChecklistsSection';
import { AuditSection } from './AuditSection';
import { AttachmentsGrid } from './AttachmentsGrid';
import { getFolderColor } from '@/components/layout/Sidebar';
import { CommentEditor, ComposerSendButton, ComposerToolButton } from '../ui/CommentEditor';
import { UserMentionChip } from '../ui/UserMentionChip';
import { triggerMentionConfetti, preloadMentionConfettiImage } from '../ui/MentionConfetti';
import { TaskMentionChip } from '../ui/TaskMentionChip';
import { LinkWithPreview } from '../ui/LinkHoverPreview';
import { commentHtmlForMarkdown, isBlankCommentHtml, trimCommentHtml, normalizeHref, rehypeLinkify, rehypeUnknownTagsToText, parseNexusTaskLink, toggleCommentChecklistItem, getNexusTaskUrl } from '@/lib/links';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { ActionErrorModal, ActionErrorInfo } from './ActionErrorModal';
import { EditCommentForm } from './EditCommentForm';
import { CommentReplyInput } from './CommentReplyInput';
import { EmojiPicker } from '../ui/EmojiPicker';
import { ImageLightboxModal } from './ImageLightboxModal';
import { FullscreenCommentModal } from './FullscreenCommentModal';
import { BlurUpImage } from '../ui/BlurUpImage';
import { CommentAttachmentCard, isAttachmentUrl, getFileExtension } from '../ui/CommentAttachmentCard';
import { extractImagesFromComments } from '@/lib/commentImages';
import { RecurrencePicker, formatTimeDisplay } from './RecurrencePicker';
import { RecurringConfig } from '@/lib/types';
import { ActivityDayDivider, getDayKey, isTodayDate } from '../ui/ActivityDayDivider';

const COMMENT_REMARK_PLUGINS = [remarkGfm];
const COMMENT_REHYPE_PLUGINS = [rehypeRaw, rehypeUnknownTagsToText, rehypeLinkify];
const keepUrl = (url: string) => url;
const uploadCommentImage = (file: File) => uploadApi.uploadFile(file, 'comments').then(res => res.url);
const copyCommentImage = (url: string) => uploadApi.uploadFromUrl(url, 'comments').then(res => res.url);
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀'];

// Parsing a comment (remark-gfm + rehype-raw) is the costly part of the feed. Memoized on its content, so typing
// in the comment box or posting another comment doesn't re-parse every comment already shown.
const CommentMarkdown = React.memo(function CommentMarkdown({
  content,
  components,
  onToggleChecklist
}: {
  content: string;
  components?: any;
  onToggleChecklist?: (itemIndex: number, checked: boolean) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  const mergedComponents = React.useMemo(() => {
    return {
      ...components,
      input: (props: any) => {
        if (props.type === 'checkbox') {
          const isChecked = Boolean(
            props.checked === true ||
            props.checked === 'checked' ||
            props.checked === '' ||
            props['data-checked'] === true ||
            props['data-checked'] === 'true'
          );
          return (
            <input
              type="checkbox"
              checked={isChecked}
              disabled={!onToggleChecklist}
              onChange={(e) => {
                e.stopPropagation();
                if (!onToggleChecklist) return;
                const target = e.target as HTMLInputElement;
                const newChecked = target.checked;
                const container = containerRef.current;
                if (!container) return;
                const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
                const clickedIndex = checkboxes.indexOf(target);
                if (clickedIndex !== -1) {
                  onToggleChecklist(clickedIndex, newChecked);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="cursor-pointer transition-transform active:scale-95"
            />
          );
        }
        if (components?.input) {
          return components.input(props);
        }
        return <input {...props} />;
      },
    };
  }, [components, onToggleChecklist]);

  return (
    <div ref={containerRef} className="comment-markdown-body w-full">
      <ReactMarkdown
        remarkPlugins={COMMENT_REMARK_PLUGINS}
        rehypePlugins={COMMENT_REHYPE_PLUGINS}
        components={mergedComponents}
        urlTransform={keepUrl}
      >
        {commentHtmlForMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
});

export const CustomCircleDotted = ({ className, style }: { className?: string, style?: React.CSSProperties }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <circle cx="12" cy="12" r="9" strokeDasharray="1 6" />
  </svg>
);

export const CustomCircleDot = ({ className, style }: { className?: string, style?: React.CSSProperties }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
  </svg>
);

const CommentSkeleton = () => (
  <div className="space-y-4 animate-pulse mt-4">
    {[1, 2, 3].map(i => (
      <div key={i} className="flex flex-col gap-3 p-4 rounded-xl border border-zinc-800/40 bg-card">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-zinc-800 shrink-0" />
          <div className="flex-1 flex flex-col gap-2 mt-1">
            <div className="h-2.5 bg-zinc-800 rounded w-1/3" />
            <div className="h-2 bg-zinc-800 rounded w-1/4" />
          </div>
        </div>
        <div className="pl-11 space-y-2 mt-1">
          <div className="h-2 bg-zinc-800 rounded w-3/4" />
          <div className="h-2 bg-zinc-800 rounded w-1/2" />
        </div>
      </div>
    ))}
  </div>
);

interface Props {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  socket?: any; // Socket instance for real-time activity
  onStatusChange?: (newStatus: string) => void;
  onUpdateTask?: (task: Task) => void;
  listStatuses?: any[];
  workspaceRoles?: any[];
  mode?: 'modal' | 'full';
  targetCommentId?: string | null;
  targetCommentText?: string | null;
  scrollToComments?: boolean;
}

export const ALL_STATUSES = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'PENDING',
  'IN PROGRESS',
  'REVISION',
  'WAITING',
  'IN REVIEW',
  'CHECKING',
  'CRM',
  'ON-HOLD',
  'CLOSED',
  'KYC',
  'PIN BOARD',
];

export const isClosedStatus = (status: any): boolean => {
  if (!status) return false;
  const name = (typeof status === 'string' ? status : (status.name || status.status || status.title || '')).trim().toUpperCase();
  const group = (typeof status === 'object' && status.groupName ? status.groupName.trim().toLowerCase() : '');
  return name === 'CLOSED' || name === 'DONE' || name === 'COMPLETED' || group === 'closed' || group === 'closed task';
};

export const sortStatusesWithClosedAndKycAtEnd = (statuses: any[]) => {
  const moveToEnd = ['ON-HOLD', 'KYC', 'PIN BOARD', 'PIN_BOARD', 'PINBOARD', 'CLOSED'];
  const nonEnd = statuses.filter(s => !moveToEnd.includes((typeof s === 'string' ? s : (s.name || s.status || s.title || '')).toUpperCase().trim()));
  const ends = statuses.filter(s => moveToEnd.includes((typeof s === 'string' ? s : (s.name || s.status || s.title || '')).toUpperCase().trim())).sort((a, b) => {
    const orderMap: Record<string, number> = {
      'ON-HOLD': 1,
      'KYC': 2,
      'PIN BOARD': 3,
      'PIN_BOARD': 3,
      'PINBOARD': 3,
      'CLOSED': 4,
    };
    const aName = (typeof a === 'string' ? a : (a.name || a.status || a.title || '')).toUpperCase().trim();
    const bName = (typeof b === 'string' ? b : (b.name || b.status || b.title || '')).toUpperCase().trim();
    return (orderMap[aName] || 99) - (orderMap[bName] || 99);
  });
  return [...nonEnd, ...ends];
};

// ---------------------------------------------------------------------------
// Module-level in-memory cache for task activities & comments.
// Lives outside the component so it persists across modal open/close cycles
// within the same browser session. Cleared on page refresh.
// TTL: 60 seconds — stale entries trigger a silent background refresh.
// ---------------------------------------------------------------------------
interface ActivityCacheEntry {
  activities: any[];
  comments: any[];
  timestamp: number;
}
export const activityCache = new Map<string, ActivityCacheEntry>();
const ACTIVITY_CACHE_TTL_MS = 60_000; // 60 seconds

// Exported so KanbanCard can prime the cache on hover (prefetch)
export function prefetchTaskActivities(taskId: string): void {
  const cached = activityCache.get(taskId);
  const cacheAge = cached ? Date.now() - cached.timestamp : Infinity;
  if (cacheAge < ACTIVITY_CACHE_TTL_MS) return; // already fresh, skip

  // Fire-and-forget — result stored in cache so modal opens with data ready
  Promise.all([
    tasksApi.getActivities(taskId).catch(() => null),
    tasksApi.getComments(taskId).catch(() => null),
  ]).then(([actRes, commentRes]) => {
    if (actRes?.activities && commentRes?.comments) {
      activityCache.set(taskId, {
        activities: actRes.activities,
        comments: commentRes.comments,
        timestamp: Date.now(),
      });
    }
  }).catch(() => {/* prefetch errors are silent */});
}

// Exported so SubtasksSection can prime the subtask cache on hover (prefetch)
export function prefetchSubtaskActivities(parentTaskId: string, subtaskId: string, subtaskTitle?: string): void {
  const cacheKey = `subtask:${subtaskId}`;
  const cached = activityCache.get(cacheKey);
  const cacheAge = cached ? Date.now() - cached.timestamp : Infinity;
  if (cacheAge < ACTIVITY_CACHE_TTL_MS) return; // already fresh, skip

  Promise.all([
    tasksApi.getActivities(parentTaskId).catch(() => null),
    tasksApi.getComments(parentTaskId, subtaskId).catch(() => null),
  ]).then(([actRes, commentRes]) => {
    if (actRes?.activities && commentRes?.comments) {
      const currentTitle = subtaskTitle || '';
      const filtered = actRes.activities.filter(
        (a: any) => a.subtaskId === subtaskId || (a.subtaskTitle && currentTitle && a.subtaskTitle.toLowerCase() === currentTitle.toLowerCase())
      );
      activityCache.set(cacheKey, {
        activities: filtered,
        comments: commentRes.comments,
        timestamp: Date.now(),
      });
    }
  }).catch(() => {/* prefetch errors are silent */});
}

export const STATUS_COLORS: Record<string, string> = {
  'KYC': 'bg-[#3A8F55] text-white',
  'PIN BOARD': 'bg-[#1F8A6E] text-white',
  'DAILY': 'bg-[#2F7BD0] text-white',
  'WEEKLY': 'bg-[#2F7BD0] text-white',
  'MONTHLY': 'bg-[#2F7BD0] text-white',
  'PENDING': 'bg-[#D29A2A] text-white',
  'IN PROGRESS': 'bg-[#D04A7C] text-white',
  'REVISION': 'bg-[#5B6BD6] text-white',
  'WAITING': 'bg-[#D9534F] text-white',
  'IN REVIEW': 'bg-[#D97B3A] text-white',
  'CHECKING': 'bg-[#A35DB8] text-white',
  'CRM': 'bg-[#22A3AE] text-white',
  'CLOSED': 'bg-[#2FA37A] text-white',
  'ON-HOLD': 'bg-[#8A8F98] text-white',

  // Fallback for capitalized formats
  'Kyc': 'bg-[#3A8F55] text-white',
  'Pin Board': 'bg-[#1F8A6E] text-white',
  'Daily': 'bg-[#2F7BD0] text-white',
  'Weekly': 'bg-[#2F7BD0] text-white',
  'Monthly': 'bg-[#2F7BD0] text-white',
  'Pending': 'bg-[#D29A2A] text-white',
  'In Progress': 'bg-[#D04A7C] text-white',
  'Revision': 'bg-[#5B6BD6] text-white',
  'Waiting': 'bg-[#D9534F] text-white',
  'In Review': 'bg-[#D97B3A] text-white',
  'Checking': 'bg-[#A35DB8] text-white',
  'Crm': 'bg-[#22A3AE] text-white',
  'Closed': 'bg-[#2FA37A] text-white',
  'On-Hold': 'bg-[#8A8F98] text-white',
};

export function getAssigneeAvatarColor(name: string) {
  const colors = [
    'bg-orange-500',
    'bg-blue-600',
    'bg-emerald-600',
    'bg-amber-500',
    'bg-violet-600',
    'bg-rose-600',
    'bg-cyan-600',
    'bg-indigo-600',
    'bg-teal-600',
    'bg-fuchsia-600',
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = (name || '').charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// Role restrictions can arrive in any casing (Galaxy sends "DEVELOPER", the team role is "Developer"),
// so every comparison goes through roleKey.
const roleKey = (role: string) => (role || '').trim().toLowerCase();

function hasRole(roles: string[], name: string): boolean {
  return roles.some((r) => roleKey(r) === roleKey(name));
}

function withoutRole(roles: string[], name: string): string[] {
  return roles.filter((r) => roleKey(r) !== roleKey(name));
}

/** One entry per role regardless of casing, spelled like its TeamRole when there is one. */
function normalizeRoles(roles: string[], teams?: any[]): string[] {
  const canonical = new Map<string, string>();
  (teams || []).forEach((team: any) => (team.teamRoles || []).forEach((tr: any) => canonical.set(roleKey(tr.name), tr.name)));
  const out = new Map<string, string>();
  roles.forEach((r) => {
    if (!out.has(roleKey(r))) out.set(roleKey(r), canonical.get(roleKey(r)) ?? r);
  });
  return [...out.values()];
}

export function resolveUsersFromRoleRestrictions(roles?: string[], users?: any[], teams?: any[]): any[] {
  if (!roles || roles.length === 0) return [];
  const teamRoleToTeamId = new Map<string, string>();
  (teams || []).forEach((team: any) => {
    (team.teamRoles || []).forEach((tr: any) => {
      teamRoleToTeamId.set(tr.name.toLowerCase(), team.id);
    });
  });

  return (users || []).filter((u: any) => {
    const userRoles = (u.roles || []) as string[];
    return roles.some((role: string) => {
      if (userRoles.map(r => r.toUpperCase()).includes(role.toUpperCase())) return true;
      const teamId = teamRoleToTeamId.get(role.toLowerCase());
      if (teamId && (u as any).teamId === teamId) return true;
      return false;
    });
  });
}

function LazyMarkdownImage({ src, alt, onPreview, isReply }: { src: string; alt?: string; onPreview: (src: string) => void; isReply?: boolean }) {
  return <BlurUpImage src={src} alt={alt} onPreview={onPreview} isReply={isReply} />;
}

function LazyMarkdownVideo({ src, onPreview }: { src: string; onPreview: (src: string) => void }) {
  const [loaded, setLoaded] = useState(false);

  if (!loaded) {
    return (
      <span
        className="mt-2 mb-2 inline-flex items-center justify-center w-[200px] h-[150px] bg-secondary border border-zinc-700/50 rounded-lg cursor-pointer hover:border-zinc-500 transition-colors group relative"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setLoaded(true);
        }}
      >
        <File className="w-10 h-10 text-zinc-500 opacity-50" />
        <span className="absolute inset-0 bg-secondary/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-[2px] rounded-lg">
          <span className="text-xs font-medium text-white bg-black/60 px-2 py-1 rounded-md">Click to load video</span>
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
      <video
        src={src}
        className="max-w-[200px] max-h-[150px] object-cover rounded-lg bg-black/50"
      />
    </span>
  );
}

const getHexColor = (color: string) => {
  const colors: Record<string, string> = {
    slate: '#64748b', gray: '#6b7280', zinc: '#71717a', neutral: '#737373', stone: '#78716c',
    red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', lime: '#84cc16',
    green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9',
    blue: '#3b82f6', indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef',
    pink: '#ec4899', rose: '#f43f5e'
  };
  return colors[color] || color;
};

// Checks whether an activity has a supported visual renderer in the timeline
const isActivityVisible = (act: any): boolean => {
  if (!act) return false;
  const t = act.type;
  if (t === 'status_change') return true;
  if (t === 'assignment' || t === 'unassignment' || t === 'add_follower' || t === 'remove_follower' || t === 'followers_change') return true;
  if (t === 'title_change') return true;
  if (t === 'priority_change') return true;
  if (t === 'create_subtask') return true;
  if (t === 'team_role_change') return true;
  if (t === 'attachment') return true;
  if (t === 'audit_item_checked' || t === 'checklist_item_checked') return true;
  return false;
};

// Builds the text after the actor's name for assignee/follower activity entries, e.g. "removed assignee: Jen".
const describeAssigneeActivity = (act: any, currentUserName?: string) => {
  const isActorMe = act.author === currentUserName;
  const toYou = (name: string) => {
    if (name === currentUserName) {
      return isActorMe ? 'yourself' : 'You';
    }
    if (name === act.author) {
      return 'themselves';
    }
    return name;
  };

  if (act.type === 'unassignment') return `removed assignee: ${toYou(act.assigneeName)}`;
  if (act.type === 'add_follower' || (act.type === 'followers_change' && (act.details?.type === 'add_follower' || act.added || act.details?.added))) {
    const followerName = act.assigneeName || act.details?.added || act.added || 'Someone';
    return `added follower: ${toYou(followerName)}`;
  }
  if (act.type === 'remove_follower' || (act.type === 'followers_change' && (act.details?.type === 'remove_follower' || act.removed || act.details?.removed))) {
    const followerName = act.assigneeName || act.details?.removed || act.removed || 'Someone';
    return `removed follower: ${toYou(followerName)}`;
  }

  // Newer assignment entries carry an explicit added/removed diff
  if (Array.isArray(act.added) || Array.isArray(act.removed)) {
    const added: string[] = (act.added || []).map(toYou);
    const removed: string[] = (act.removed || []).map(toYou);
    if (removed.length > 1 && act.assigneeName === 'Unassigned' && added.length === 0) return 'removed all assignees';
    const parts: string[] = [];
    if (added.length > 0) parts.push(`assigned to: ${added.join(', ')}`);
    if (removed.length > 0) parts.push(`${parts.length ? 'and removed' : 'removed assignee:'} ${removed.join(', ')}`);
    if (parts.length > 0) return parts.join(' ');
  }

  // Legacy entries only stored the resulting assignee list
  if (act.assigneeName === 'Unassigned') return 'removed all assignees';
  return `assigned to: ${toYou(act.assigneeName)}`;
};

/** "Leo, Aaron" vs "Aaron, Leo": same people regardless of order. */
function sameNameSet(a?: string, b?: string): boolean {
  const split = (s?: string) => (s || '').split(', ').map(n => n.trim()).filter(Boolean).sort().join('|');
  return split(a) === split(b);
}

/** Merges incoming socket/window real-time activity into activities state, replacing optimistic placeholders and deduplicating */
const mergeIncomingActivity = (prev: any[], incoming: any) => {
  if (!incoming) return prev;

  // 1. If already present by id, clean up any lingering matching optimistic placeholder and return
  const existingIdx = prev.findIndex(a => a.id === incoming.id);
  if (existingIdx !== -1) {
    return prev.filter(a => {
      if (a.id === incoming.id) return true;
      if (typeof a.id === 'string' && a.id.startsWith('optimistic-') && a.type === incoming.type) {
        if (incoming.type === 'status_change' && a.newStatus === incoming.newStatus && (a.subtaskTitle || '') === (incoming.subtaskTitle || '')) return false;
        if (incoming.type === 'priority_change' && a.newPriority === incoming.newPriority) return false;
        if (incoming.type === 'assignment' && sameNameSet(a.assigneeName, incoming.assigneeName)) return false;
        if (incoming.type === 'title_change' && a.newTitle === incoming.newTitle) return false;
      }
      return true;
    });
  }

  // 2. If an optimistic entry of the same type exists, swap it for the server's real entry
  const typePrefix = incoming.type === 'status_change' ? 'optimistic-status'
    : incoming.type === 'assignment' ? 'optimistic-assign'
    : incoming.type === 'priority_change' ? 'optimistic-priority'
    : incoming.type === 'title_change' ? 'optimistic-title'
    : null;

  if (typePrefix) {
    const optimisticIdx = prev.findIndex(a => {
      if (typeof a.id !== 'string' || !a.id.startsWith(typePrefix)) return false;
      if (incoming.type === 'title_change') return a.newTitle === incoming.newTitle;
      if (incoming.type === 'assignment') return sameNameSet(a.assigneeName, incoming.assigneeName);
      if (incoming.type === 'status_change') return a.newStatus === incoming.newStatus && (a.subtaskTitle || '') === (incoming.subtaskTitle || '');
      if (incoming.type === 'priority_change') return a.newPriority === incoming.newPriority;
      return true;
    });

    if (optimisticIdx !== -1) {
      const updated = [...prev];
      updated[optimisticIdx] = incoming;
      return updated;
    }
  }

  // 3. Deduplicate real status_change activities that have identical transitions within 15 seconds
  if (incoming.type === 'status_change') {
    const incomingTime = new Date(incoming.date || incoming.createdAt || Date.now()).getTime();
    const isDuplicate = prev.some(a =>
      a.id !== incoming.id &&
      a.type === 'status_change' &&
      a.newStatus === incoming.newStatus &&
      a.oldStatus === incoming.oldStatus &&
      (a.subtaskTitle || '') === (incoming.subtaskTitle || '') &&
      Math.abs(new Date(a.date || a.createdAt || Date.now()).getTime() - incomingTime) < 15000
    );
    if (isDuplicate) return prev;
  }

  return [...prev, incoming];
};

// Renders a rename as an inline diff: shared prefix/suffix plain, removed text struck through, added text bold.
// e.g. "Testing" -> "TestingUpdate" renders "Testing**Update**".
const TitleChangeDiff = ({ oldTitle = '', newTitle = '' }: { oldTitle?: string; newTitle?: string }) => {
  let start = 0;
  while (start < oldTitle.length && start < newTitle.length && oldTitle[start] === newTitle[start]) start++;
  let end = 0;
  while (
    end < oldTitle.length - start &&
    end < newTitle.length - start &&
    oldTitle[oldTitle.length - 1 - end] === newTitle[newTitle.length - 1 - end]
  ) end++;
  const prefix = oldTitle.slice(0, start);
  const removed = oldTitle.slice(start, oldTitle.length - end);
  const added = newTitle.slice(start, newTitle.length - end);
  const suffix = oldTitle.slice(oldTitle.length - end);
  return (
    <span className="text-zinc-300">
      {prefix}
      {removed && <span className="line-through text-zinc-500">{removed}</span>}
      {added && <span className="font-semibold text-zinc-100">{added}</span>}
      {suffix}
    </span>
  );
};

const renderTitleChangeActivity = (act: any, currentUserName?: string) => {
  const actorName = act.author === currentUserName ? 'You' : (act.author || 'Someone');
  const timeStr = new Date(act.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div key={act.id} className="flex justify-between items-center text-sm text-zinc-400 py-1">
      <div className="flex gap-2 items-center min-w-0">
        <span className="text-zinc-500 text-lg leading-none mt-[-2px]">&bull;</span>
        <span className="break-words">
          {actorName} changed name: <TitleChangeDiff oldTitle={act.oldTitle} newTitle={act.newTitle} />
        </span>
      </div>
      <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap ml-2">
        {timeStr}
      </span>
    </div>
  );
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
  mode = 'modal',
  targetCommentId,
  targetCommentText,
  scrollToComments,
}: Props) {
  const router = useRouter();
  const [isSubtasksExpanded, setIsSubtasksExpanded] = useState(true);
  const [subtasksExpandAllSignal, setSubtasksExpandAllSignal] = useState(0);
  const subtasksHeaderClickTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (subtasksHeaderClickTimerRef.current) {
        clearTimeout(subtasksHeaderClickTimerRef.current);
      }
    };
  }, []);

  const handleSubtasksHeaderClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isSubtasksExpanded) {
      setIsSubtasksExpanded(true);
      return;
    }

    if (e.detail === 2) {
      if (subtasksHeaderClickTimerRef.current) {
        clearTimeout(subtasksHeaderClickTimerRef.current);
        subtasksHeaderClickTimerRef.current = null;
      }
      setIsSubtasksExpanded(false);
      return;
    }

    if (subtasksHeaderClickTimerRef.current) {
      clearTimeout(subtasksHeaderClickTimerRef.current);
      subtasksHeaderClickTimerRef.current = null;
      setIsSubtasksExpanded(false);
      return;
    }

    subtasksHeaderClickTimerRef.current = setTimeout(() => {
      subtasksHeaderClickTimerRef.current = null;
      setSubtasksExpandAllSignal((prev) => prev + 1);
    }, 280);
  };

  const handleSubtasksHeaderDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (subtasksHeaderClickTimerRef.current) {
      clearTimeout(subtasksHeaderClickTimerRef.current);
      subtasksHeaderClickTimerRef.current = null;
    }
    setIsSubtasksExpanded(false);
  };
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [comment, setComment] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);

  // Auto-scroll the bottom of the comment being edited into view so the user doesn't have to scroll down manually
  useEffect(() => {
    if (!editingCommentId) return;
    const scrollTarget = () => {
      const el = document.getElementById(`comment-${editingCommentId}`);
      if (el) {
        const bottom = el.querySelector('[data-edit-bottom="true"]') || el;
        bottom.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };
    const t1 = setTimeout(scrollTarget, 80);
    const t2 = setTimeout(scrollTarget, 220);
    const t3 = setTimeout(scrollTarget, 450);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [editingCommentId]);
  const [commentToDelete, setCommentToDelete] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ActionErrorInfo | null>(null);
  const [editCommentText, setEditCommentText] = useState('');
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [activities, setActivities] = useState<any[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const commentEditorRef = useRef<any>(null);
  const [isUploading, setIsUploading] = useState(false);
  const initialSubtaskIdRef = useRef<string | null>(
    typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get('subtask') : null
  );
  const userClosedSubtaskRef = useRef(false);
  const hadActiveSubtaskRef = useRef(false);

  // Sync initialSubtaskIdRef if URL contains subtask on task change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlSubtask = new URL(window.location.href).searchParams.get('subtask');
      if (urlSubtask) {
        initialSubtaskIdRef.current = urlSubtask;
        userClosedSubtaskRef.current = false;
      }
    }
  }, [task?.id]);

  const [activeSubtask, setActiveSubtaskState] = useState<any>(() => {
    if (typeof window !== 'undefined' && task?.subtasks) {
      const url = new URL(window.location.href);
      const subtaskId = url.searchParams.get('subtask');
      if (subtaskId) {
        const found = task.subtasks.find((s: any) => s.id === subtaskId);
        if (found) {
          hadActiveSubtaskRef.current = true;
          initialSubtaskIdRef.current = null;
          return found;
        }
      }
    }
    return null;
  });

  const setActiveSubtask = useCallback((st: any) => {
    if (!st) {
      userClosedSubtaskRef.current = true;
      initialSubtaskIdRef.current = null;
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        if (url.searchParams.has('subtask')) {
          url.searchParams.delete('subtask');
          window.history.replaceState(null, '', url.pathname + url.search);
        }
      }
    } else {
      userClosedSubtaskRef.current = false;
      hadActiveSubtaskRef.current = true;
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        if (url.searchParams.get('subtask') !== st.id) {
          url.searchParams.set('subtask', st.id);
          window.history.replaceState(null, '', url.pathname + url.search);
        }
      }
    }
    setActiveSubtaskState(st);
  }, []);

  // Keep activeSubtask synced with task.subtasks, or resolve target subtask from URL on mount/refresh
  useEffect(() => {
    if (!task?.subtasks || task.subtasks.length === 0) return;

    if (activeSubtask) {
      const found = task.subtasks.find((s: any) => s.id === activeSubtask.id);
      if (found && found !== activeSubtask) {
        setActiveSubtaskState(found);
      }
    } else if (!userClosedSubtaskRef.current && initialSubtaskIdRef.current) {
      const targetSubtaskId = initialSubtaskIdRef.current;
      const found = task.subtasks.find((s: any) => s.id === targetSubtaskId);
      if (found) {
        hadActiveSubtaskRef.current = true;
        initialSubtaskIdRef.current = null;
        setActiveSubtaskState(found);
      }
    }
  }, [task?.subtasks, activeSubtask]);

  // Keep URL query param in sync with activeSubtask
  useEffect(() => {
    if (typeof window === 'undefined' || !task) return;
    const url = new URL(window.location.href);
    if (activeSubtask) {
      hadActiveSubtaskRef.current = true;
      if (url.searchParams.get('subtask') !== activeSubtask.id) {
        url.searchParams.set('subtask', activeSubtask.id);
        window.history.replaceState(null, '', url.pathname + url.search);
      }
    } else if (hadActiveSubtaskRef.current) {
      // ONLY clear ?subtask= when user explicitly closes an active subtask!
      initialSubtaskIdRef.current = null;
      if (url.searchParams.has('subtask')) {
        url.searchParams.delete('subtask');
        window.history.replaceState(null, '', url.pathname + url.search);
      }
    }
  }, [activeSubtask, task]);

  const setModalTitle = useAppStore(state => state.setModalTitle);
  useEffect(() => {
    if (activeSubtask?.title) {
      setModalTitle(activeSubtask.title);
    } else if (task?.title) {
      setModalTitle(task.title);
    }
  }, [activeSubtask?.title, task?.title, setModalTitle]);

  useEffect(() => {
    const handleOpenDetailInContent = (e: any) => {
      const { subtaskId } = e.detail || {};
      if (subtaskId && task?.subtasks) {
        const found = task.subtasks.find((s: any) => s.id === subtaskId);
        if (found) {
          setActiveSubtask(found);
        }
      }
    };
    window.addEventListener('open-task-detail', handleOpenDetailInContent);
    return () => window.removeEventListener('open-task-detail', handleOpenDetailInContent);
  }, [task?.subtasks]);

  const [localStatus, setLocalStatus] = useState<string>(task?.status || 'Pending');
  const lastStatusUpdateTimestampRef = useRef<number>(0);
  const localStatusRef = useRef<string>(localStatus);
  useEffect(() => {
    localStatusRef.current = localStatus;
  }, [localStatus]);

  useEffect(() => {
    if (Date.now() - lastStatusUpdateTimestampRef.current > 1500 && task?.status) {
      setLocalStatus(task.status);
    }
  }, [task?.status]);

  useEffect(() => {
    const handleWindowTaskUpdated = (e: any) => {
      const incoming = e.detail?.task;
      if (!incoming) return;
      if (task && incoming.id === task.id) {
        if (Date.now() - lastStatusUpdateTimestampRef.current > 1500 && incoming.status !== undefined) {
          setLocalStatus(incoming.status);
          if (taskRef.current) {
            taskRef.current.status = incoming.status;
          }
        }
        if (incoming.subtasks !== undefined && taskRef.current) {
          taskRef.current.subtasks = incoming.subtasks;
          if (onUpdateTaskRef.current) {
            onUpdateTaskRef.current({ ...taskRef.current, subtasks: incoming.subtasks });
          }
        }
        if (Date.now() - lastAssigneeUpdateTimestampRef.current > 1500) {
          if (incoming.assignees !== undefined) {
            setLocalAssignees(incoming.assignees);
            latestAssigneesRef.current = incoming.assignees;
          }
        }
        if (Date.now() - lastRoleUpdateTimestampRef.current > 1500) {
          if (incoming.assigneeRoleRestrictions !== undefined) {
            setLocalRoleRestrictions(incoming.assigneeRoleRestrictions);
            latestRoleRestrictionsRef.current = incoming.assigneeRoleRestrictions;
          }
        }
      }
    };
    window.addEventListener('task:updated', handleWindowTaskUpdated);
    return () => window.removeEventListener('task:updated', handleWindowTaskUpdated);
  }, [task?.id]);

  useEffect(() => {
    const handleWindowTaskActivity = (e: any) => {
      const data = e.detail;
      if (!data || !task || data.taskId !== task.id) return;
      if (data.activity) {
        setActivities((prev) => mergeIncomingActivity(prev, data.activity));
      }
    };
    window.addEventListener('task_activity', handleWindowTaskActivity);
    return () => window.removeEventListener('task_activity', handleWindowTaskActivity);
  }, [task?.id]);

  const [editingUser, setEditingUser] = useState<string | null>(null); // Name of user currently editing
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [isUploadingInline, setIsUploadingInline] = useState(false);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [isCheckLocked, setIsCheckLocked] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [localDescription, setLocalDescription] = useState(task?.description || '');
  const [localTitle, setLocalTitle] = useState(task?.title || '');
  const descContentRef = useRef<HTMLDivElement>(null);
  const [isDescOverflowing, setIsDescOverflowing] = useState(false);

  useEffect(() => {
    const checkOverflow = () => {
      if (descContentRef.current) {
        setIsDescOverflowing(descContentRef.current.scrollHeight > 160);
      }
    };
    checkOverflow();
    const observer = new ResizeObserver(checkOverflow);
    if (descContentRef.current) {
      observer.observe(descContentRef.current);
      if (descContentRef.current.firstElementChild) {
        observer.observe(descContentRef.current.firstElementChild);
      }
    }
    return () => observer.disconnect();
  }, [localDescription, isDescExpanded]);

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
  const titleTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditingTitle && titleTextareaRef.current) {
      const el = titleTextareaRef.current;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [isEditingTitle]);
  const [expandedBlocks, setExpandedBlocks] = useState<(string | number)[]>([]);
  const [collapsedDays, setCollapsedDays] = useState<Record<string, boolean>>({});
  const toggleCollapseDay = useCallback((dayKey: string) => {
    setCollapsedDays(prev => ({
      ...prev,
      [dayKey]: !prev[dayKey]
    }));
  }, []);


  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const assigneeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Assignees as they were before the current debounced batch of toggles (for the added/removed activity diff)
  const assigneeBaselineRef = useRef<UserModel[] | null>(null);

  // Mentions
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [mentionedUsers, setMentionedUsers] = useState<{ id: string; name: string }[]>([]);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const mentionListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMentionMenu || !mentionListRef.current) return;
    const container = mentionListRef.current;
    const selectedEl = container.children[mentionSelectedIndex] as HTMLElement | undefined;
    if (!selectedEl) return;

    const containerTop = container.scrollTop;
    const containerBottom = containerTop + container.clientHeight;
    const elTop = selectedEl.offsetTop;
    const elBottom = elTop + selectedEl.offsetHeight;

    if (elTop < containerTop) {
      container.scrollTop = elTop;
    } else if (elBottom > containerBottom) {
      container.scrollTop = elBottom - container.clientHeight;
    }
  }, [mentionSelectedIndex, showMentionMenu]);

  // Comments with reactions + replies
  const [richComments, setRichComments] = useState<any[]>([]);
  const commentImages = useMemo(() => {
    return extractImagesFromComments(richComments);
  }, [richComments]);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [showEmojiPickerFor, setShowEmojiPickerFor] = useState<string | null>(null);
  const [emojiPickerAnchor, setEmojiPickerAnchor] = useState<HTMLElement | null>(null);
  const [commentEmojiAnchor, setCommentEmojiAnchor] = useState<HTMLElement | null>(null);
  const activityScrollRef = useRef<HTMLDivElement>(null);

  const INITIAL_ACTIVITY_COUNT = 20;
  const ACTIVITY_BATCH_SIZE = 20;
  const [visibleActivityCount, setVisibleActivityCount] = useState(INITIAL_ACTIVITY_COUNT);
  const [isLoadingOlderActivities, setIsLoadingOlderActivities] = useState(false);
  const [prevTaskModalId, setPrevTaskModalId] = useState(task?.id);
  const [fullscreenCommentId, setFullscreenCommentId] = useState<string | null>(null);

  const activeFullscreenComment = useMemo(() => {
    if (!fullscreenCommentId) return null;
    const top = richComments.find(c => c.id === fullscreenCommentId);
    if (top) return top;
    for (const c of richComments) {
      const r = c.replies?.find((rep: any) => rep.id === fullscreenCommentId);
      if (r) return r;
    }
    return null;
  }, [fullscreenCommentId, richComments]);

  if (task?.id !== prevTaskModalId) {
    setPrevTaskModalId(task?.id);
    setVisibleActivityCount(INITIAL_ACTIVITY_COUNT);
    setIsLoadingOlderActivities(false);
    setCollapsedDays({});
    setFullscreenCommentId(null);
  }

  const otherActivities = useMemo(() => {
    const visible = activities.filter(a => a.type !== 'comment' && isActivityVisible(a));
    const seenStatusKeys = new Set<string>();
    return visible.filter(a => {
      if (a.type === 'status_change') {
        const sub = a.subtaskTitle || '';
        const isOptimistic = typeof a.id === 'string' && a.id.startsWith('optimistic-');
        if (isOptimistic && visible.some(other => typeof other.id === 'string' && !other.id.startsWith('optimistic-') && other.type === 'status_change' && (other.subtaskTitle || '') === sub && other.newStatus === a.newStatus)) {
          return false;
        }
        const time = new Date(a.date || a.createdAt || 0).getTime();
        const duplicateKey = `${sub}|${a.oldStatus || ''}->${a.newStatus || ''}|${Math.floor(time / 15000)}`;
        if (seenStatusKeys.has(duplicateKey)) return false;
        seenStatusKeys.add(duplicateKey);
      }
      return true;
    });
  }, [activities]);
  const combined = useMemo(() => [
    ...otherActivities.map(a => ({ ...a, isActivityType: true, sortDate: new Date(a.date || Date.now()).getTime() })),
    ...richComments.map(c => ({ ...c, isActivityType: false, sortDate: new Date(c.createdAt || Date.now()).getTime() }))
  ].sort((a, b) => (a.sortDate || 0) - (b.sortDate || 0)), [otherActivities, richComments]);

  const hasOlderActivities = combined.length > visibleActivityCount;
  const olderActivitiesCount = Math.max(0, combined.length - visibleActivityCount);

  const paginatedCombined = useMemo(() => {
    if (combined.length <= visibleActivityCount) return combined;
    return combined.slice(combined.length - visibleActivityCount);
  }, [combined, visibleActivityCount]);

  const isTargetingComment = Boolean(targetCommentId || targetCommentText || scrollToComments);
  const targetKey = `${targetCommentId || ''}_${targetCommentText ? targetCommentText.slice(0, 30) : ''}_${scrollToComments ? '1' : '0'}`;
  const lastTargetKeyRef = useRef('');
  const hasScrolledToTargetRef = useRef(false);

  useEffect(() => {
    if (targetKey !== lastTargetKeyRef.current) {
      lastTargetKeyRef.current = targetKey;
      hasScrolledToTargetRef.current = false;
    }
  }, [targetKey]);

  // If a target comment is older than visibleActivityCount, expand visibleActivityCount so it is rendered
  useEffect(() => {
    if ((targetCommentId || targetCommentText) && combined.length > visibleActivityCount) {
      const idx = combined.findIndex((item) => {
        if (targetCommentId && (item.id === targetCommentId || item.commentId === targetCommentId)) return true;
        if (targetCommentText) {
          const itemText = (item.text || item.content || '').toLowerCase();
          const cleanSnippet = targetCommentText.trim().toLowerCase().slice(0, 30);
          if (cleanSnippet && itemText.includes(cleanSnippet)) return true;
        }
        return false;
      });
      if (idx !== -1 && idx < combined.length - visibleActivityCount) {
        setVisibleActivityCount(combined.length);
      }
    }
  }, [targetCommentId, targetCommentText, combined, visibleActivityCount]);

  const scrollToLatestComment = useCallback(() => {
    const scroll = () => {
      if (activityScrollRef.current) {
        activityScrollRef.current.scrollTop = activityScrollRef.current.scrollHeight;
      }
    };
    scroll();
    requestAnimationFrame(scroll);
    setTimeout(scroll, 50);
    setTimeout(scroll, 150);
  }, []);

  const scrollToTargetComment = useCallback(() => {
    if (hasScrolledToTargetRef.current) return true;
    const container = activityScrollRef.current;
    if (!container) return false;

    let targetEl: HTMLElement | null = null;
    if (targetCommentId) {
      targetEl =
        document.getElementById(`comment-${targetCommentId}`) ||
        (container.querySelector(`[data-comment-id="${targetCommentId}"]`) as HTMLElement | null);
    }
    if (!targetEl && targetCommentText) {
      const lines = targetCommentText
        .split('\n')
        .map(l => l.trim().toLowerCase())
        .filter(l => l.length >= 15 && !l.includes('📅') && !l.includes('🖊') && !l.startsWith('status:') && !l.startsWith('resources:'));
      
      const snippet = (lines[0] || targetCommentText.trim().toLowerCase()).slice(0, 50);
      if (snippet) {
        const commentEls = Array.from(container.querySelectorAll<HTMLElement>('.group\\/comment')).reverse();
        for (const el of commentEls) {
          const txt = el.textContent?.toLowerCase() || '';
          if (txt.includes(snippet) || (lines.length > 1 && lines.some(line => line.length >= 20 && txt.includes(line.slice(0, 40))))) {
            targetEl = el;
            break;
          }
        }
      }
    }

    if (targetEl) {
      hasScrolledToTargetRef.current = true;
      const containerRect = container.getBoundingClientRect();
      const elRect = targetEl.getBoundingClientRect();
      const relativeTop = elRect.top - containerRect.top + container.scrollTop - 14;
      container.scrollTo({ top: Math.max(0, relativeTop), behavior: 'smooth' });

      // Clear any existing rings across all comments first so only ONE comment is highlighted
      container.querySelectorAll('.ring-indigo-500\\/80').forEach(el => {
        el.classList.remove('ring-2', 'ring-indigo-500/80');
      });

      targetEl.classList.add('ring-2', 'ring-indigo-500/80', 'transition-all', 'duration-500');
      setTimeout(() => {
        targetEl?.classList.remove('ring-2', 'ring-indigo-500/80');
      }, 3000);
      return true;
    }

    // Only if pure scrollToComments was requested without a specific target, scroll to latest
    if (!targetCommentId && !targetCommentText && scrollToComments) {
      hasScrolledToTargetRef.current = true;
      scrollToLatestComment();
      return true;
    }

    return false;
  }, [targetCommentId, targetCommentText, scrollToComments, scrollToLatestComment]);

  const hasScrolledInitiallyRef = useRef(false);
  useEffect(() => {
    hasScrolledInitiallyRef.current = false;
  }, [task?.id]);

  useEffect(() => {
    if (isTargetingComment) {
      if (hasScrolledToTargetRef.current) return;
      if (activities.length > 0 || richComments.length > 0) {
        let attempts = 0;
        const tryScroll = () => {
          if (hasScrolledToTargetRef.current) return;
          attempts++;
          const found = scrollToTargetComment();
          if (!found && attempts < 10) {
            setTimeout(tryScroll, 120);
          }
        };
        requestAnimationFrame(() => {
          setTimeout(tryScroll, 60);
        });
      }
    } else if (!hasScrolledInitiallyRef.current && (activities.length > 0 || richComments.length > 0)) {
      hasScrolledInitiallyRef.current = true;
      scrollToLatestComment();
    }
  }, [activities, richComments, isTargetingComment, scrollToTargetComment, scrollToLatestComment]);

  useEffect(() => {
    if (!activeSubtask && !hasScrolledInitiallyRef.current && !isTargetingComment) {
      scrollToLatestComment();
    }
  }, [activeSubtask, scrollToLatestComment, isTargetingComment]);

  const loadOlderActivities = useCallback(() => {
    if (!hasOlderActivities || isLoadingOlderActivities) return;
    const container = activityScrollRef.current;
    if (!container) return;

    setIsLoadingOlderActivities(true);
    const prevScrollHeight = container.scrollHeight;
    const prevScrollTop = container.scrollTop;

    setTimeout(() => {
      setVisibleActivityCount(prev => Math.min(combined.length, prev + ACTIVITY_BATCH_SIZE));
      setIsLoadingOlderActivities(false);

      requestAnimationFrame(() => {
        if (activityScrollRef.current) {
          const newScrollHeight = activityScrollRef.current.scrollHeight;
          activityScrollRef.current.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        }
      });
    }, 120);
  }, [hasOlderActivities, isLoadingOlderActivities, combined.length]);

  const handleActivityScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop } = e.currentTarget;
    if (scrollTop < 60 && hasOlderActivities && !isLoadingOlderActivities) {
      loadOlderActivities();
    }
  }, [hasOlderActivities, isLoadingOlderActivities, loadOlderActivities]);


  const createMarkdownComponents = useCallback((isReply = false) => ({
    a: (props: any) => {
      const { node, ...rest } = props;
      const href = rest.href || '';
      if (href.match(/\.(mp4|webm|ogg|mov)$/i)) {
        return <LazyMarkdownVideo src={href} onPreview={setLightboxImage} />;
      }
      if (href.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
        return <LazyMarkdownImage src={href} alt="attachment" onPreview={setLightboxImage} isReply={isReply} />;
      }
      if (href.startsWith('mention://')) {
        const userId = href.replace('mention://', '');
        return <UserMentionChip userId={userId}>{rest.children}</UserMentionChip>;
      }
      const nexus = parseNexusTaskLink(href);
      if (nexus) {
        return (
          <TaskMentionChip
            taskId={nexus.taskId}
            mentionType={nexus.isSubtask ? 'subtask' : 'task'}
            parentTaskId={nexus.subtaskId ? (task?.id || nexus.taskId) : undefined}
            initialLabel={typeof rest.children === 'string' && !rest.children.startsWith('http') ? rest.children : undefined}
          />
        );
      }
      if (isAttachmentUrl(href, typeof rest.children === 'string' ? rest.children : undefined)) {
        return (
          <CommentAttachmentCard
            href={href}
            fileName={typeof rest.children === 'string' ? rest.children : undefined}
          />
        );
      }
      return (
        <LinkWithPreview
          {...rest}
          href={normalizeHref(href)}
          className="text-blue-400 hover:bg-blue-500/15 hover:text-blue-300 rounded-sm transition-colors"
          onClick={(e) => { e.stopPropagation(); }}
        >
          {rest.children}
        </LinkWithPreview>
      );
    },
    span: (props: any) => {
      const { node, ...rest } = props;
      const dataType = rest['data-type'] || (node?.properties as any)?.dataType;
      if (dataType === 'mention') {
        const taskId = rest['data-id'] || (node?.properties as any)?.dataId;
        const mentionType = rest['data-mention-type'] || (node?.properties as any)?.dataMentionType || 'task';
        const label = rest['data-label'] || (node?.properties as any)?.dataLabel || '';
        if (taskId) {
          return (
            <TaskMentionChip
              taskId={taskId}
              mentionType={mentionType}
              initialLabel={label}
              attrs={rest}
            />
          );
        }
      }
      return <span {...rest} />;
    },
    img: (props: any) => {
      const { node, ...rest } = props;
      return <LazyMarkdownImage src={rest.src} alt={rest.alt || "attachment"} onPreview={setLightboxImage} isReply={isReply} />;
    }
  }), [task?.id]);

  const markdownComponents = React.useMemo(() => createMarkdownComponents(false), [createMarkdownComponents]);
  const replyMarkdownComponents = React.useMemo(() => createMarkdownComponents(true), [createMarkdownComponents]);

  // Select only what the modal uses, so unrelated store changes (e.g. other tasks updating) don't re-render it
  const { currentUser, workspaceUsers, workspaceUsersIndex, loadUsers, hydrateUsersFromCache, workspaceTeams, loadTeams, hydrateTeamsFromCache, allLists } = useAppStore(useShallow((s) => ({
    currentUser: s.currentUser,
    workspaceUsers: s.workspaceUsers,
    workspaceUsersIndex: s.workspaceUsersIndex,
    loadUsers: s.loadUsers,
    hydrateUsersFromCache: s.hydrateUsersFromCache,
    workspaceTeams: s.workspaceTeams,
    loadTeams: s.loadTeams,
    hydrateTeamsFromCache: s.hydrateTeamsFromCache,
    allLists: s.allLists,
  })));

  // Fetch real users from DB for assignee picker
  useEffect(() => {
    if (!currentUser) return;
    if (workspaceUsers.length === 0) {
      hydrateUsersFromCache();
      loadUsers();
    }
    if (workspaceTeams.length === 0) {
      hydrateTeamsFromCache();
      loadTeams();
    }
  }, [currentUser, workspaceUsers.length, workspaceTeams.length, hydrateUsersFromCache, loadUsers, hydrateTeamsFromCache, loadTeams]);

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

  // Only Project Managers and Admins can set Team Role and Assignees
  const canAssignTask = useCanSetAssignees();
  const assignDeniedMessage = useAssignDeniedMessage();
  // Locked triggers stay clickable so the user is told why; preventDefault stops Radix opening the popover
  const blockIfCannotAssign = (e: React.MouseEvent) => {
    if (canAssignTask) return;
    e.preventDefault();
    toast.error(assignDeniedMessage);
  };

  const [localRoleRestrictions, setLocalRoleRestrictions] = useState<string[]>(() => task?.assigneeRoleRestrictions || []);
  const latestRoleRestrictionsRef = useRef<string[]>(task?.assigneeRoleRestrictions || []);
  const lastRoleUpdateTimestampRef = useRef<number>(0);

  useEffect(() => {
    if (Date.now() - lastRoleUpdateTimestampRef.current > 1500) {
      const fromProps = task?.assigneeRoleRestrictions || [];
      setLocalRoleRestrictions(fromProps);
      latestRoleRestrictionsRef.current = fromProps;
    }
  }, [task?.assigneeRoleRestrictions]);

  const hasTeamRole = Boolean(localRoleRestrictions && localRoleRestrictions.length > 0);
  const canAssignMember = canAssignTask && hasTeamRole;

  const assignableUsers = React.useMemo(() => {
    if (!localRoleRestrictions || localRoleRestrictions.length === 0) {
      return workspaceUsers;
    }
    // Build a map of TeamRole name -> teamId for fast lookup
    const teamRoleToTeamId = new Map<string, string>();
    workspaceTeams.forEach((team: any) => {
      (team.teamRoles || []).forEach((tr: any) => {
        teamRoleToTeamId.set(tr.name.toLowerCase(), team.id);
      });
    });

    const filteredUsers = workspaceUsers.filter((u) => {
      const userRoles = (u.roles || []) as string[];
      return localRoleRestrictions.some((role) => {
        // Check generic role match (TECH, PM, AUDITOR...)
        if (userRoles.map(r => r.toUpperCase()).includes(role.toUpperCase())) return true;
        // Check TeamRole match — filter by team membership
        const teamId = teamRoleToTeamId.get(role.toLowerCase());
        if (teamId && (u as any).teamId === teamId) return true;
        return false;
      });
    });

    // Always allow the current user to assign themselves
    if (currentUser && !filteredUsers.some(u => u.id === currentUser.id)) {
      const me = workspaceUsers.find(u => u.id === currentUser.id);
      if (me) {
        filteredUsers.push(me);
      }
    }

    return filteredUsers;
  }, [workspaceUsers, workspaceTeams, localRoleRestrictions, currentUser]);


  // Fetch persistent activities and comments from DB
  // ---------------------------------------------------------------------------
  // In-memory session cache (module-level — survives re-renders, cleared on
  // page refresh). Keyed by task/parent-task ID. Entries expire after 60 s so
  // a long-open modal still eventually picks up new comments.
  // ---------------------------------------------------------------------------
  const loadActivities = useCallback(async (silent = false) => {
    if (!task?.id) return;
    const currentTaskId = task.id;
    try {
      const isSubtask = !!(task as any).parentTaskId;
      const targetId = isSubtask ? (task as any).parentTaskId : task.id;
      const subtaskId = isSubtask ? task.id : undefined;
      const cacheKey = isSubtask ? `subtask:${task.id}` : targetId;

      // ── 1. CACHE-FIRST: show cached data immediately (zero skeleton flicker) ──
      const cached = activityCache.get(cacheKey);
      const cacheAge = cached ? Date.now() - cached.timestamp : Infinity;
      const cacheValid = cacheAge < ACTIVITY_CACHE_TTL_MS;

      if (cached && cacheValid) {
        // Serve cached data right away — user sees content instantly
        const currentTitle = task.title || '';
        const cachedActivities = isSubtask
          ? cached.activities.filter((a: any) => a.subtaskId === currentTaskId || (a.subtaskTitle && currentTitle && a.subtaskTitle.toLowerCase() === currentTitle.toLowerCase()))
          : cached.activities;
        setActivities(cachedActivities);
        setRichComments(cached.comments);
        setLoadingActivities(false);
        // Fall through to background refresh below (silent)
      } else {
        // No valid cache — show skeleton only on first open
        if (!silent) setLoadingActivities(true);
      }

      setLoadError(null);

      // ── 2. BACKGROUND REFRESH: always fetch fresh data ──
      const [actRes, commentRes] = await Promise.all([
        tasksApi.getActivities(targetId),
        tasksApi.getComments(targetId, subtaskId),
      ]);
      if (!isMountedRef.current || taskRef.current?.id !== currentTaskId) return;

      const currentTitle = taskRef.current?.title || task.title || '';
      const fetchedActivities = actRes?.activities
        ? (isSubtask
            ? actRes.activities.filter((a: any) => a.subtaskId === currentTaskId || (a.subtaskTitle && currentTitle && a.subtaskTitle.toLowerCase() === currentTitle.toLowerCase()))
            : actRes.activities)
        : [];
      const fetchedComments = commentRes?.comments || [];

      // ── 3. SAVE TO CACHE ──
      if (actRes?.activities && commentRes?.comments) {
        activityCache.set(cacheKey, {
          activities: fetchedActivities,
          comments: fetchedComments,
          timestamp: Date.now(),
        });
      }

      if (actRes?.activities) {
        setActivities((prev) => {
          if (taskRef.current?.id !== currentTaskId) return prev;
          const fetchedIds = new Set(fetchedActivities.map((a: any) => a.id));
          const optimistic = prev.filter((a) => {
            if (typeof a.id !== 'string' || (!a.id.startsWith('optimistic-') && !a.id.startsWith('temp-'))) return false;
            if (a.type === 'status_change') {
              return !fetchedActivities.some((f: any) =>
                f.type === 'status_change' &&
                f.newStatus === a.newStatus &&
                (f.subtaskTitle || '') === (a.subtaskTitle || '')
              );
            }
            if (a.type === 'priority_change') {
              return !fetchedActivities.some((f: any) => f.type === 'priority_change' && f.newPriority === a.newPriority);
            }
            if (a.type === 'assignment') {
              return !fetchedActivities.some((f: any) => f.type === 'assignment' && sameNameSet(f.assigneeName, a.assigneeName));
            }
            if (a.type === 'title_change') {
              return !fetchedActivities.some((f: any) => f.type === 'title_change' && f.newTitle === a.newTitle);
            }
            const optTime = new Date(a.date || 0).getTime();
            if (optTime && Date.now() - optTime > 30000) return false;
            return true;
          });
          const recentReal = prev.filter(
            (a) =>
              !(typeof a.id === 'string' && (a.id.startsWith('optimistic-') || a.id.startsWith('temp-'))) &&
              !fetchedIds.has(a.id) &&
              (isSubtask
                ? (a.subtaskId === currentTaskId || (a.subtaskTitle && currentTitle && a.subtaskTitle.toLowerCase() === currentTitle.toLowerCase()))
                : (!a.subtaskId && (a.taskId === targetId || !a.taskId))) &&
              a.date &&
              Date.now() - new Date(a.date).getTime() < 30_000
          );

          const merged = [...fetchedActivities, ...recentReal, ...optimistic];
          return merged.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        });
      }
      if (commentRes?.comments) {
        setRichComments((prev) => {
          if (taskRef.current?.id !== currentTaskId) return prev;
          const fetchedIds = new Set(fetchedComments.map((c: any) => c.id));
          const optimistic = prev.filter(
            (c) =>
              typeof c.id === 'string' &&
              (c.id.startsWith('optimistic-') || c.id.startsWith('temp-'))
          );
          const recentReal = prev.filter(
            (c) =>
              !(typeof c.id === 'string' && (c.id.startsWith('optimistic-') || c.id.startsWith('temp-'))) &&
              !fetchedIds.has(c.id) &&
              (isSubtask ? c.subtaskId === currentTaskId : (!c.subtaskId && (c.taskId === targetId || !c.taskId))) &&
              c.createdAt &&
              Date.now() - new Date(c.createdAt).getTime() < 30_000
          );
          return [...fetchedComments, ...recentReal, ...optimistic].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        });
      }
    } catch (err: any) {
      if (taskRef.current?.id === currentTaskId) {
        console.error('Failed to load task data:', err);
        setLoadError(err?.message || String(err));
        commentsBootstrappedRef.current = null;
      }
    } finally {
      if (isMountedRef.current && taskRef.current?.id === currentTaskId) {
        setLoadingActivities(false);
      }
    }
  }, [task?.id]);

  const handleToggleReaction = async (commentId: string, emoji: string) => {
    if (!task?.id || !currentUser?.id) return;
    try {
      const targetId = (task as any).parentTaskId || task.id;
      const res = await tasksApi.toggleCommentReaction(targetId, commentId, emoji, currentUser.id);
      setRichComments(prev => prev.map(c => {
        if (c.id === commentId) return { ...c, reactions: res.reactions };
        // also check replies
        return { ...c, replies: c.replies?.map((r: any) => r.id === commentId ? { ...r, reactions: res.reactions } : r) };
      }));
      setShowEmojiPickerFor(null);
    } catch (err) { console.warn('Reaction failed:', err); }
  };

  const handleSubmitReply = async (parentCommentId: string, replyContent?: string, mentionIds?: string[]) => {
    const textToSubmit = (replyContent !== undefined ? replyContent : replyText).trim();
    if (!textToSubmit || !task?.id || !currentUser?.id) return;
    const isSubtask = !!(task as any).parentTaskId;
    const targetId = isSubtask ? (task as any).parentTaskId : task.id;
    const subtaskId = isSubtask ? task.id : undefined;
    const text = textToSubmit;
    const tempId = `temp-reply-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const withReplies = (map: (replies: any[]) => any[]) => (prev: any[]) =>
      prev.map(c => c.id === parentCommentId ? { ...c, replies: map(c.replies || []) } : c);

    // Shown in the thread at once; the saved reply replaces it when the server answers
    setRichComments(withReplies(replies => [...replies, {
      id: tempId,
      content: text,
      createdAt: new Date().toISOString(),
      userId: currentUser.id,
      user: { id: currentUser.id, name: currentUser.name || 'You', avatarUrl: (currentUser as any)?.avatarUrl },
      parentCommentId,
      reactions: [],
    }]));
    setReplyText('');
    setReplyingToId(null);
    try {
      const res = await tasksApi.addComment(targetId, text, currentUser.id, task?.listId, mentionIds || [], parentCommentId, subtaskId);
      if (res?.comment) {
        if (mentionIds && mentionIds.length > 0) {
          mentionIds.forEach(id => {
            const fullUser = workspaceUsersIndex[id];
            if (fullUser) triggerMentionConfetti(fullUser);
          });
        }
        setRichComments(withReplies(replies => replies.some(r => r.id === res.comment.id)
          ? replies.filter(r => r.id !== tempId)
          : replies.map(r => r.id === tempId ? { ...r, ...res.comment } : r)));
      }
    } catch (err: any) {
      console.warn('Reply failed:', err);
      setRichComments(withReplies(replies => replies.filter(r => r.id !== tempId)));
      toast.error(err?.message || 'Failed to post reply');
    }
  };

  const handleSaveEdit = async (commentId: string, updatedContent?: string) => {
    const contentToSave = (updatedContent !== undefined ? updatedContent : editCommentText).trim();
    if ((!contentToSave || contentToSave === '<p></p>') || !task?.id || isSubmittingEdit) return;
    setIsSubmittingEdit(true);
    try {
      const isSubtask = !!(task as any).parentTaskId;
      const targetId = isSubtask ? (task as any).parentTaskId : task.id;
      const subtaskId = isSubtask ? task.id : undefined;
      setRichComments(prev => prev.map(c => c.id === commentId ? { ...c, content: contentToSave } : c));
      setEditingCommentId(null);
      setEditCommentText('');
      await tasksApi.updateComment(targetId, commentId, contentToSave);
      const res = await tasksApi.getComments(targetId, subtaskId);
      if (res?.comments) setRichComments(res.comments);
    } catch (err) {
      console.warn('Edit failed:', err);
      toast.error('Failed to update comment');
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleToggleCommentChecklist = async (commentId: string, itemIndex: number, newChecked: boolean) => {
    if (!task?.id) return;
    const currentComment = richComments.flatMap(c => [c, ...(c.replies || [])]).find(c => c.id === commentId);
    if (!currentComment || !currentComment.content) return;

    const updatedContent = toggleCommentChecklistItem(currentComment.content, itemIndex, newChecked);
    if (updatedContent === currentComment.content) return;

    // 1. Instant local optimistic update
    setRichComments(prev => prev.map(c => {
      if (c.id === commentId) return { ...c, content: updatedContent };
      return {
        ...c,
        replies: c.replies?.map((r: any) => r.id === commentId ? { ...r, content: updatedContent } : r)
      };
    }));

    const isSubtask = !!(task as any).parentTaskId;
    const targetId = isSubtask ? (task as any).parentTaskId : task.id;

    // 2. Synchronously update local activityCache so background fetches never revert optimistic state
    const cacheKey = isSubtask ? `subtask:${task.id}` : targetId;
    const cached = activityCache.get(cacheKey);
    if (cached?.comments) {
      cached.comments = cached.comments.map((c: any) => {
        if (c.id === commentId) return { ...c, content: updatedContent };
        return {
          ...c,
          replies: c.replies?.map((r: any) => r.id === commentId ? { ...r, content: updatedContent } : r)
        };
      });
    }

    // 3. Immediately emit live websocket update so other clients and tabs sync instantly
    if (socket) {
      socket.emit('task_comment_live_update', {
        listId: task.listId,
        taskId: targetId,
        subtaskId: isSubtask ? task.id : undefined,
        commentId,
        content: updatedContent,
      });
    }

    // 4. Background DB persistence
    try {
      await tasksApi.updateComment(targetId, commentId, updatedContent, task.listId);
    } catch (err) {
      console.warn('Failed to update comment checklist item:', err);
      setRichComments(prev => prev.map(c => {
        if (c.id === commentId) return { ...c, content: currentComment.content };
        return {
          ...c,
          replies: c.replies?.map((r: any) => r.id === commentId ? { ...r, content: currentComment.content } : r)
        };
      }));
      toast.error('Failed to update checklist item');
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!task?.id) return;
    try {
      const isSubtask = !!(task as any).parentTaskId;
      const targetId = isSubtask ? (task as any).parentTaskId : task.id;
      setRichComments(prev => prev.filter(c => c.id !== commentId));
      await tasksApi.deleteComment(targetId, commentId);
    } catch (err) {
      console.warn('Delete failed:', err);
    }
  };

  // ── Reset activities and comments immediately when active task changes ────
  useEffect(() => {
    if (!task?.id) {
      setActivities([]);
      setRichComments([]);
      return;
    }
    const isSubtask = !!(task as any).parentTaskId;
    const targetId = isSubtask ? (task as any).parentTaskId : task.id;
    const cacheKey = isSubtask ? `subtask:${task.id}` : targetId;
    const cached = activityCache.get(cacheKey);
    const cacheAge = cached ? Date.now() - cached.timestamp : Infinity;
    if (cached && cacheAge < ACTIVITY_CACHE_TTL_MS) {
      const currentTitle = task.title || '';
      const cachedActivities = isSubtask
        ? cached.activities.filter((a: any) => a.subtaskId === task.id || (a.subtaskTitle && currentTitle && a.subtaskTitle.toLowerCase() === currentTitle.toLowerCase()))
        : cached.activities;
      setActivities(cachedActivities);
      setRichComments(cached.comments);
      setLoadingActivities(false);
    } else {
      setActivities([]);
      setRichComments([]);
      setLoadingActivities(true);
    }
  }, [task?.id]);

  // ── Bootstrap comments & activities ONCE per task open ──────────────────
  // After the initial load, the socket handles all new comments in real-time.
  // This ref resets whenever the task ID changes so reopening a different task
  // always triggers a fresh load.
  const commentsBootstrappedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen || !task?.id) return;
    // Only bootstrap if this task hasn't been loaded yet in this session
    if (commentsBootstrappedRef.current !== task.id) {
      commentsBootstrappedRef.current = task.id;
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
    // Only when what this derives from changes — not on every merged task object (status echoes,
    // the background full-task fetch), which reset the description and rebuilt attachments each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, task?.description, task?.attachments]);

  useEffect(() => {
    if (!currentUser) return;
    if (task?.listId && (!listStatuses || listStatuses.length === 0)) {
      const listObj = allLists.find((l: any) => l.list?.id === task.listId || l.id === task.listId);
      const cachedList = listObj?.list || listObj;
      if (cachedList?.statuses) {
        setinternalListStatuses(cachedList.statuses);
      } else {
        fetchListStatuses(task.listId).then(statuses => {
          if (statuses.length > 0) setinternalListStatuses(statuses);
        }).catch((err: any) => console.warn(err));
      }
    } else if (listStatuses && listStatuses.length > 0) {
      setinternalListStatuses(listStatuses);
    }
  }, [task?.listId, listStatuses, currentUser, allLists]);

  // Keep localTitle in sync with task prop changes
  useEffect(() => {
    setLocalTitle(task?.title || '');
  }, [task?.title]);

  const handleTitleBlur = () => {
    const trimmed = localTitle.trim();
    if (!trimmed) { setLocalTitle(task?.title || ''); return; }
    if (trimmed !== task?.title && task) {
      // Optimistic "changed name" entry; replaced by the real one when the server's task_activity arrives
      if (!(task as any).parentTaskId) {
        setActivities(prev => [...prev, {
          id: `optimistic-title-${Date.now()}`,
          type: 'title_change',
          author: currentUser?.name || 'Someone',
          oldTitle: task.title,
          newTitle: trimmed,
          date: new Date(),
          user: currentUser,
        }]);
      }
      const updatePromise = (task as any).parentTaskId
        ? tasksApi.updateSubtask((task as any).parentTaskId, task.id, { title: trimmed })
        : tasksApi.updateTask(task.id, {
          title: trimmed,
          currentListId: task.listId,
          userId: currentUser?.id,
        });
      updatePromise.catch(err => console.warn('Failed to save title:', err));
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
      const updatePromise = (task as any).parentTaskId
        ? tasksApi.updateSubtask((task as any).parentTaskId, task.id, { description: sanitizedDesc })
        : tasksApi.updateTask(task.id, {
          description: sanitizedDesc,
          currentListId: task.listId,
          userId: currentUser?.id,
        });
      updatePromise.catch(err => console.warn('Failed to save description:', err));

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

  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

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
        if (onUpdateTaskRef.current && taskRef.current) {
          onUpdateTaskRef.current({ ...taskRef.current, description: data.description });
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
      const currentTask = taskRef.current;
      if (currentTask && data.taskId === currentTask.id) {
        // If viewing a subtask, ignore activities that don't belong to this subtask
        const isSubtask = !!(currentTask as any).parentTaskId;
        if (isSubtask && data.activity.subtaskTitle && data.activity.subtaskTitle !== currentTask.title) return;

        setActivities(prev => mergeIncomingActivity(prev, data.activity));


      }
    };

    socket.on('task_editing_start', handleEditingStart);
    socket.on('task_editing_stop', handleEditingStop);
    socket.on('task_editing_content', handleEditingContent);
    socket.on('task_activity', handleActivity);

    // ── Real-time comment delivery ──────────────────────────────────────────
    // After bootstrap, new comments arrive via socket only — no polling needed.
    const handleCommentAdded = (payload: { taskId: string; comment: any; subtaskId?: string }) => {
      const currentTask = taskRef.current;
      if (!currentTask) return;
      const targetId = (currentTask as any).parentTaskId || currentTask.id;
      if (payload.taskId !== targetId) return;

      // If viewing a subtask, only show comments for this subtask
      const isSubtask = !!(currentTask as any).parentTaskId;
      if (isSubtask && payload.subtaskId !== currentTask.id) return;
      if (!isSubtask && payload.subtaskId) return;

      setRichComments(prev => {
        // If it's a reply to a comment
        if (payload.comment.parentCommentId) {
          return prev.map(c => {
            if (c.id === payload.comment.parentCommentId) {
              const replies = c.replies || [];
              if (replies.some((r: any) => r.id === payload.comment.id)) return c;
              const tempIdx = replies.findIndex((r: any) =>
                typeof r.id === 'string' && r.id.startsWith('temp-') && r.content === payload.comment.content
              );
              if (tempIdx !== -1) {
                const nextReplies = [...replies];
                nextReplies[tempIdx] = payload.comment;
                return { ...c, replies: nextReplies, replyCount: nextReplies.length };
              }
              const nextReplies = [...replies, payload.comment];
              return { ...c, replies: nextReplies, replyCount: nextReplies.length };
            }
            return c;
          });
        }

        // Deduplicate — the sender already added it optimistically
        if (prev.some(c => c.id === payload.comment.id)) return prev;
        // Replace temp placeholder if this is the acting client
        const tempIdx = prev.findIndex(c =>
          typeof c.id === 'string' && c.id.startsWith('temp-') &&
          c.content === payload.comment.content
        );
        if (tempIdx !== -1) {
          const updated = [...prev];
          updated[tempIdx] = payload.comment;
          return updated;
        }
        const nextComments = [...prev, payload.comment];
        const cacheKey = isSubtask ? `subtask:${currentTask.id}` : targetId;
        const cached = activityCache.get(cacheKey);
        if (cached?.comments && !cached.comments.some((c: any) => c.id === payload.comment.id)) {
          cached.comments = [...cached.comments, payload.comment];
        }
        return nextComments;
      });
    };

    const handleCommentUpdated = (payload: { taskId: string; comment: any }) => {
      const currentTask = taskRef.current;
      if (!currentTask) return;
      const targetId = (currentTask as any).parentTaskId || currentTask.id;
      if (payload.taskId !== targetId) return;
      setRichComments(prev =>
        prev.map(c => {
          if (c.id === payload.comment.id) return { ...c, ...payload.comment };
          return {
            ...c,
            replies: c.replies?.map((r: any) => r.id === payload.comment.id ? { ...r, ...payload.comment } : r)
          };
        })
      );
      const cacheKey = (currentTask as any).parentTaskId ? `subtask:${currentTask.id}` : targetId;
      const cached = activityCache.get(cacheKey);
      if (cached?.comments) {
        cached.comments = cached.comments.map((c: any) => {
          if (c.id === payload.comment.id) return { ...c, ...payload.comment };
          return {
            ...c,
            replies: c.replies?.map((r: any) => r.id === payload.comment.id ? { ...r, ...payload.comment } : r)
          };
        });
      }
    };

    const handleCommentDeleted = (payload: { taskId: string; commentId: string }) => {
      const currentTask = taskRef.current;
      if (!currentTask) return;
      const targetId = (currentTask as any).parentTaskId || currentTask.id;
      if (payload.taskId !== targetId) return;
      setRichComments(prev =>
        prev.filter(c => c.id !== payload.commentId).map(c => ({
          ...c,
          replies: c.replies?.filter((r: any) => r.id !== payload.commentId)
        }))
      );
      const cacheKey = (currentTask as any).parentTaskId ? `subtask:${currentTask.id}` : targetId;
      const cached = activityCache.get(cacheKey);
      if (cached?.comments) {
        cached.comments = cached.comments.filter((c: any) => c.id !== payload.commentId);
      }
    };

    const handleChecklistCreated = (payload: { taskId: string; subtaskId?: string | null; checklist: any }) => {
      const currentTask = taskRef.current;
      if (!currentTask || payload.taskId !== currentTask.id || !payload.checklist) return;

      if (!payload.subtaskId) {
        if ((currentTask.checklists || []).some((c: any) => c.id === payload.checklist.id)) return;
        const checklists = [...(currentTask.checklists || []), payload.checklist];
        const updatedTask = { ...currentTask, checklists };
        taskRef.current = updatedTask;
        if (onUpdateTaskRef.current) onUpdateTaskRef.current(updatedTask);
      } else {
        const subtasks = (currentTask.subtasks || []).map((st: any) => {
          if (st.id === payload.subtaskId) {
            if ((st.checklists || []).some((c: any) => c.id === payload.checklist.id)) return st;
            return { ...st, checklists: [...(st.checklists || []), payload.checklist] };
          }
          return st;
        });
        const updatedTask = { ...currentTask, subtasks };
        taskRef.current = updatedTask;
        if (onUpdateTaskRef.current) onUpdateTaskRef.current(updatedTask);
      }
    };

    const handleChecklistItemUpdated = (payload: { taskId: string; subtaskId?: string | null; checklistId: string; item: any }) => {
      const currentTask = taskRef.current;
      if (!currentTask || payload.taskId !== currentTask.id || !payload.item) return;

      if (!payload.subtaskId) {
        const checklists = (currentTask.checklists || []).map((c: any) => {
          if (c.id === payload.checklistId || (isNexusAuditChecklist(c) && (payload.item?.text?.startsWith('!') || ['instructions audit','design audit','ui ux audit','funnel audit'].includes(normalizeAuditName((payload.item?.text || '').replace(/^!\s*/, '')))))) {
            const hasItem = (c.items || []).some((i: any) => i.id === payload.item.id || (typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text));
            if (hasItem) {
              const items = (c.items || []).map((i: any) =>
                (i.id === payload.item.id || (typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text))
                  ? { ...i, ...payload.item }
                  : i
              );
              return { ...c, items };
            } else {
              return { ...c, items: [...(c.items || []), payload.item] };
            }
          }
          return c;
        });
        const updatedTask = { ...currentTask, checklists };
        taskRef.current = updatedTask;
        if (onUpdateTaskRef.current) onUpdateTaskRef.current(updatedTask);
      } else {
        const subtasks = (currentTask.subtasks || []).map((st: any) => {
          if (st.id === payload.subtaskId) {
            const checklists = (st.checklists || []).map((c: any) => {
              if (c.id === payload.checklistId || (isNexusAuditChecklist(c) && (payload.item?.text?.startsWith('!') || ['instructions audit','design audit','ui ux audit','funnel audit'].includes(normalizeAuditName((payload.item?.text || '').replace(/^!\s*/, '')))))) {
                const hasItem = (c.items || []).some((i: any) => i.id === payload.item.id || (typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text));
                if (hasItem) {
                  const items = (c.items || []).map((i: any) =>
                    (i.id === payload.item.id || (typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text))
                      ? { ...i, ...payload.item }
                      : i
                  );
                  return { ...c, items };
                } else {
                  return { ...c, items: [...(c.items || []), payload.item] };
                }
              }
              return c;
            });
            return { ...st, checklists };
          }
          return st;
        });
        const updatedTask = { ...currentTask, subtasks };
        taskRef.current = updatedTask;
        if (onUpdateTaskRef.current) onUpdateTaskRef.current(updatedTask);
      }
    };

    const handleChecklistItemCreated = (payload: { taskId: string; subtaskId?: string | null; checklistId: string; item: any }) => {
      const currentTask = taskRef.current;
      if (!currentTask || payload.taskId !== currentTask.id || !payload.item) return;

      if (!payload.subtaskId) {
        let found = false;
        const checklists = (currentTask.checklists || []).map((c: any) => {
          if (c.id === payload.checklistId || (isNexusAuditChecklist(c) && (payload.item?.text?.startsWith('!') || ['instructions audit','design audit','ui ux audit','funnel audit'].includes(normalizeAuditName((payload.item?.text || '').replace(/^!\s*/, '')))))) {
            found = true;
            if ((c.items || []).some((i: any) => i.id === payload.item.id)) return c;
            const tempIdx = (c.items || []).findIndex((i: any) => typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text);
            if (tempIdx !== -1) {
              const newItems = [...c.items];
              newItems[tempIdx] = payload.item;
              return { ...c, items: newItems };
            }
            return { ...c, items: [...(c.items || []), payload.item] };
          }
          return c;
        });
        const isAudit = (payload.item?.text?.startsWith('!') || ['instructions audit','design audit','ui ux audit','funnel audit'].includes(normalizeAuditName((payload.item?.text || '').replace(/^!\s*/, ''))));
        const finalChecklists = found ? checklists : [
          ...(currentTask.checklists || []),
          {
            id: payload.checklistId,
            taskId: currentTask.id,
            name: isAudit ? 'Audit' : 'Checklist',
            createdAt: new Date().toISOString(),
            items: [payload.item],
          }
        ];
        const updatedTask = { ...currentTask, checklists: finalChecklists };
        taskRef.current = updatedTask;
        if (onUpdateTaskRef.current) onUpdateTaskRef.current(updatedTask);
      } else {
        const subtasks = (currentTask.subtasks || []).map((st: any) => {
          if (st.id === payload.subtaskId) {
            let found = false;
            const checklists = (st.checklists || []).map((c: any) => {
              if (c.id === payload.checklistId || (isNexusAuditChecklist(c) && (payload.item?.text?.startsWith('!') || ['instructions audit','design audit','ui ux audit','funnel audit'].includes(normalizeAuditName((payload.item?.text || '').replace(/^!\s*/, '')))))) {
                found = true;
                if ((c.items || []).some((i: any) => i.id === payload.item.id)) return c;
                const tempIdx = (c.items || []).findIndex((i: any) => typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text);
                if (tempIdx !== -1) {
                  const newItems = [...c.items];
                  newItems[tempIdx] = payload.item;
                  return { ...c, items: newItems };
                }
                return { ...c, items: [...(c.items || []), payload.item] };
              }
              return c;
            });
            const isAudit = (payload.item?.text?.startsWith('!') || ['instructions audit','design audit','ui ux audit','funnel audit'].includes(normalizeAuditName((payload.item?.text || '').replace(/^!\s*/, ''))));
            const finalChecklists = found ? checklists : [
              ...(st.checklists || []),
              {
                id: payload.checklistId,
                taskId: currentTask.id,
                subtaskId: payload.subtaskId,
                name: isAudit ? 'Audit' : 'Checklist',
                createdAt: new Date().toISOString(),
                items: [payload.item],
              }
            ];
            return { ...st, checklists: finalChecklists };
          }
          return st;
        });
        const updatedTask = { ...currentTask, subtasks };
        taskRef.current = updatedTask;
        if (onUpdateTaskRef.current) onUpdateTaskRef.current(updatedTask);
      }
    };

    const handleChecklistItemDeleted = (payload: { taskId: string; subtaskId?: string | null; checklistId: string; itemId: string; text?: string }) => {
      const currentTask = taskRef.current;
      if (!currentTask || payload.taskId !== currentTask.id) return;

      if (!payload.subtaskId) {
        const checklists = (currentTask.checklists || []).map((c: any) => {
          if (c.id === payload.checklistId || isNexusAuditChecklist(c)) {
            const items = (c.items || []).filter((i: any) => {
              if (i.id === payload.itemId) return false;
              if (payload.text && i.text === payload.text) return false;
              return true;
            });
            return { ...c, items };
          }
          return c;
        });
        const updatedTask = { ...currentTask, checklists };
        taskRef.current = updatedTask;
        if (onUpdateTaskRef.current) onUpdateTaskRef.current(updatedTask);
      } else {
        const subtasks = (currentTask.subtasks || []).map((st: any) => {
          if (st.id === payload.subtaskId) {
            const checklists = (st.checklists || []).map((c: any) => {
              if (c.id === payload.checklistId || isNexusAuditChecklist(c)) {
                const items = (c.items || []).filter((i: any) => {
                  if (i.id === payload.itemId) return false;
                  if (payload.text && i.text === payload.text) return false;
                  return true;
                });
                return { ...c, items };
              }
              return c;
            });
            return { ...st, checklists };
          }
          return st;
        });
        const updatedTask = { ...currentTask, subtasks };
        taskRef.current = updatedTask;
        if (onUpdateTaskRef.current) onUpdateTaskRef.current(updatedTask);
      }
    };

    const handleChecklistDeleted = (payload: { taskId: string; subtaskId?: string | null; checklistId: string }) => {
      const currentTask = taskRef.current;
      if (!currentTask || payload.taskId !== currentTask.id) return;

      if (!payload.subtaskId) {
        const checklists = (currentTask.checklists || []).filter((c: any) => c.id !== payload.checklistId);
        const updatedTask = { ...currentTask, checklists };
        taskRef.current = updatedTask;
        if (onUpdateTaskRef.current) onUpdateTaskRef.current(updatedTask);
      } else {
        const subtasks = (currentTask.subtasks || []).map((st: any) => {
          if (st.id === payload.subtaskId) {
            const checklists = (st.checklists || []).filter((c: any) => c.id !== payload.checklistId);
            return { ...st, checklists };
          }
          return st;
        });
        const updatedTask = { ...currentTask, subtasks };
        taskRef.current = updatedTask;
        if (onUpdateTaskRef.current) onUpdateTaskRef.current(updatedTask);
      }
    };

    socket.on('task:comment_added', handleCommentAdded);
    socket.on('task:comment_updated', handleCommentUpdated);
    socket.on('task:comment_deleted', handleCommentDeleted);
    socket.on('task:checklist_created', handleChecklistCreated);
    socket.on('task:checklist_item_updated', handleChecklistItemUpdated);
    socket.on('task:checklist_item_created', handleChecklistItemCreated);
    socket.on('task:checklist_item_deleted', handleChecklistItemDeleted);
    socket.on('task:checklist_deleted', handleChecklistDeleted);

    return () => {
      socket.off('task_editing_start', handleEditingStart);
      socket.off('task_editing_stop', handleEditingStop);
      socket.off('task_editing_content', handleEditingContent);
      socket.off('task_activity', handleActivity);
      socket.off('task:comment_added', handleCommentAdded);
      socket.off('task:comment_updated', handleCommentUpdated);
      socket.off('task:comment_deleted', handleCommentDeleted);
      socket.off('task:checklist_created', handleChecklistCreated);
      socket.off('task:checklist_item_updated', handleChecklistItemUpdated);
      socket.off('task:checklist_item_created', handleChecklistItemCreated);
      socket.off('task:checklist_item_deleted', handleChecklistItemDeleted);
      socket.off('task:checklist_deleted', handleChecklistDeleted);
    };
  }, [socket, task?.id, currentUser?.name]);

  const logActivity = (activity: any) => {
    const act = { ...activity, id: Date.now(), date: new Date() };
    setActivities(prev => [...prev, act]);
    if (socket && task) {
      socket.emit('task_activity', { listId: task.listId, taskId: task.id, activity: act });
    }
  };

  const [isLocalEditing, setIsLocalEditing] = useState(false);

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

  const [isRoleOpen, setIsRoleOpen] = useState(false);
  const [isAssigneeOpen, setIsAssigneeOpen] = useState(false);
  const roleToAssigneeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (roleToAssigneeTimeoutRef.current) {
        clearTimeout(roleToAssigneeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setIsRoleOpen(false);
      setIsAssigneeOpen(false);
      if (roleToAssigneeTimeoutRef.current) {
        clearTimeout(roleToAssigneeTimeoutRef.current);
      }
    }
  }, [isOpen]);
  const [isPriorityOpen, setIsPriorityOpen] = useState(false);
  const [isDateOpen, setIsDateOpen] = useState(false);
  const [isRecurrenceOpen, setIsRecurrenceOpen] = useState(false);
  const [internalListStatuses, setinternalListStatuses] = useState<any[]>(listStatuses || []);

  const isInRecurringGroup = useMemo(() => {
    if (!task) return false;
    const statusUpper = (localStatus || '').toUpperCase().trim();
    if (['DAILY', 'WEEKLY', 'MONTHLY'].includes(statusUpper)) return true;
    const statusObj = (internalListStatuses || []).find((ls: any) => {
      const name = typeof ls === 'string' ? ls : (ls.name || ls.status || ls.title || '');
      return name.toUpperCase().trim() === statusUpper;
    });
    return (statusObj?.groupName || '').toUpperCase().trim() === 'RECURRING';
  }, [localStatus, internalListStatuses, task]);

  const orderedListStatuses = React.useMemo(() => {
    const sortedInternals = [...(internalListStatuses || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    const listObj = allLists.find((l: any) => l.list?.id === task?.listId || l.id === task?.listId);
    const list = listObj?.list || listObj;

    if (!list?.customGroups || list.customGroups.length === 0) {
      // Filter out legacy statuses that are just group headers
      const validStatuses = sortedInternals.filter(s => {
        if (!list?.customGroups) return true;
        const sName = (s.name || s.status || s.title || '').toUpperCase();
        return !list.customGroups.some((g: string) => g.toUpperCase() === sName);
      });
      return sortStatusesWithClosedAndKycAtEnd(validStatuses);
    }

    const finalStatuses: any[] = [];
    const processed = new Set<string>();

    list.customGroups.forEach((groupName: string) => {
      const groupStatuses = sortedInternals.filter(s => s.groupName === groupName);
      groupStatuses.forEach(s => {
        const sName = s.name || s.status || s.title || '';
        finalStatuses.push(s);
        processed.add(sName);
      });
    });

    // Add any remaining statuses
    sortedInternals.forEach(s => {
      const sName = s.name || s.status || s.title || '';
      if (!processed.has(sName)) {
        if (!list.customGroups.some((g: string) => g.toUpperCase() === sName.toUpperCase())) {
          finalStatuses.push(s);
          processed.add(sName);
        }
      }
    });

    return sortStatusesWithClosedAndKycAtEnd(finalStatuses);
  }, [allLists, task?.listId, internalListStatuses]);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showApiSettings, setShowApiSettings] = useState(false);
  const editorRef = useRef<any>(null);
  const activityPanelRef = useRef<HTMLDivElement>(null);

  // Focus trap and esc handler activity panel
  const [activityWidth, setActivityWidth] = useState(mode === 'full' ? 450 : 380);
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(300);
  const subtaskActivityPanelRef = useRef<HTMLDivElement>(null);

  const startResizing = React.useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = activityWidth;
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  }, [activityWidth]);

    const stopResizing = React.useCallback(() => {
    if (isResizing.current && activityPanelRef.current) {
      const currentWidth = parseInt(activityPanelRef.current.style.width, 10);
      if (!isNaN(currentWidth)) {
        setActivityWidth(currentWidth);
      }
    }
    isResizing.current = false;
    document.body.style.cursor = 'default';
  }, []);

    const resize = React.useCallback((e: MouseEvent) => {
    if (isResizing.current) {
      const delta = resizeStartX.current - e.clientX;
      const newWidth = resizeStartWidth.current + delta;
      if (newWidth > 240 && newWidth < 700) {
        if (activityPanelRef.current) {
          activityPanelRef.current.style.width = newWidth + 'px';
        }
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

    const transitionCheck = canTransitionTaskStatus(task, newStatus);
    if (!transitionCheck.allowed) {
      window.dispatchEvent(new CustomEvent('task:highlight-audits', {
        detail: {
          taskId: task.id,
          targetStatus: newStatus,
          uncheckedAudits: transitionCheck.uncheckedAudits,
          openSubtasks: transitionCheck.openSubtasks,
        }
      }));
      toast.error(transitionCheck.reason || `Cannot move task to ${newStatus}`);
      return;
    }

    if (newStatus.toLowerCase() === 'revision') {
      const updatedChecklists = (task.checklists || []).map(c => {
        if (isNexusAuditChecklist(c)) {
          return {
            ...c,
            items: c.items?.map(i => ({ ...i, completed: false })) || []
          };
        }
        return c;
      });
      if (onUpdateTask) {
        onUpdateTask({ ...task, checklists: updatedChecklists });
      }
    }

    const oldStatus = localStatus;
    lastStatusUpdateTimestampRef.current = Date.now();
    setLocalStatus(newStatus);
    if (taskRef.current) taskRef.current.status = newStatus;
    
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

    const updatedTask = { ...task, status: newStatus };
    useAppStore.getState().updateTask(updatedTask);
    window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: updatedTask } }));

    if (onStatusChange) {
      onStatusChange(newStatus);
      return;
    }
    
    // Let the caller (dashboard, doc, activity page) reflect the new status right away
    if (onUpdateTask) onUpdateTask(updatedTask);
    else task.status = newStatus;

    try {
      let res: any;
      if ((task as any).parentTaskId) {
        res = await tasksApi.updateSubtask((task as any).parentTaskId, task.id, { status: newStatus });
      } else {
        res = await tasksApi.moveTask(task.id, newStatus, task.listId, currentUser?.id);
      }
      if (res?.activity) {
        // Replace optimistic entry with real one from server
        setActivities(prev => prev.map(a => a.id === optimisticId ? res.activity : a));
      }
      toast.success(`Moved to ${newStatus}`);
    } catch (err: any) {
      // Rollback optimistic activity and status on error
      setActivities(prev => prev.filter(a => a.id !== optimisticId));
      setLocalStatus(oldStatus);
      if (taskRef.current) taskRef.current.status = oldStatus;
      if (onUpdateTask) onUpdateTask({ ...task, status: oldStatus });
      else task.status = oldStatus;
      const errMsg = err?.response?.data?.error || err.message || 'Failed to move task';
      const statusCode = err?.response?.status;
      toast.error(errMsg);
      setActionError({
        title: 'Failed to Update Task Status',
        action: `Moving status from "${oldStatus}" to "${newStatus}"`,
        message: errMsg,
        statusCode,
        technicalDetails: typeof err === 'object' ? JSON.stringify(err.response?.data || err, null, 2) : String(err),
        context: {
          taskId: task.id,
          taskTitle: task.title,
          targetStatus: newStatus,
          previousStatus: oldStatus,
          listId: task.listId,
        },
        troubleshooting: [
          'Verify whether all mandatory audit checklist items and open subtasks are completed before moving.',
          'Check if your workspace role has permission to move tasks into this status.',
          'If synced with ClickUp or n8n: verify that the status exists and matches the board configuration.'
        ],
        onRetry: () => handleStatusChangeAction(newStatus),
      });
    }
  };

  const handleStatusClick = () => {
    const statuses = (internalListStatuses && internalListStatuses.length > 0)
      ? internalListStatuses.map(s => typeof s === 'string' ? s : (s.name || s.status || s.title || ''))
      : ALL_STATUSES;
    const currentIndex = statuses.indexOf(localStatus || 'Pending');
    const nextIndex = (currentIndex + 1) % statuses.length;
    const newStatus = statuses[nextIndex];
    handleStatusChangeAction(newStatus);
  };

  const [localAssignees, setLocalAssignees] = useState<UserModel[]>(() => {
    return (task?.assignees && task.assignees.length > 0)
      ? task.assignees
      : (task?.assignee ? [task.assignee] : []);
  });
  const latestAssigneesRef = useRef<UserModel[]>(localAssignees);
  const lastAssigneeUpdateTimestampRef = useRef<number>(0);

  useEffect(() => {
    if (Date.now() - lastAssigneeUpdateTimestampRef.current > 1500) {
      const fromProps = (task?.assignees && task.assignees.length > 0)
        ? task.assignees
        : (task?.assignee ? [task.assignee] : []);
      setLocalAssignees(fromProps);
      latestAssigneesRef.current = fromProps;
    }
  }, [task?.assignees, task?.assignee]);

  const currentAssignees: UserModel[] = localAssignees;

  const isUserAssigned = (userId: string) => currentAssignees.some((u) => u.id === userId);

  const persistAssignees = useCallback(
    async (taskToUpdate: Task, updatedIds: string[], primaryAssignee: UserModel | null, updatedAssignees: UserModel[], previousAssignees: UserModel[]) => {
      // Optimistically append activity to local feed immediately
      const optimisticId = `optimistic-assign-${Date.now()}`;
      const names = updatedAssignees.length > 0 ? updatedAssignees.map(u => u.name).join(', ') : 'Unassigned';
      const added = updatedAssignees.filter(u => !previousAssignees.some(p => p.id === u.id)).map(u => u.name);
      const removed = previousAssignees.filter(p => !updatedAssignees.some(u => u.id === p.id)).map(p => p.name);
      if (added.length === 0 && removed.length === 0) return; // toggled on and off again — nothing changed
      const optimisticActivity = {
        id: optimisticId,
        type: 'assignment',
        author: currentUser?.name || 'Someone',
        assigneeName: names,
        assignees: updatedAssignees.map(u => u.name),
        added,
        removed,
        date: new Date(),
        user: currentUser,
      };
      setActivities(prev => [...prev, optimisticActivity]);

      try {
        const parentId = (taskToUpdate as any).parentTaskId || (taskToUpdate as any).taskId;
        if (parentId) {
          await tasksApi.updateSubtask(parentId, taskToUpdate.id, {
            assigneeIds: updatedIds,
            assigneeId: primaryAssignee?.id || null,
          });
        } else {
          await tasksApi.updateTask(taskToUpdate.id, {
            assigneeIds: updatedIds,
            assigneeId: primaryAssignee?.id || null,
            currentListId: taskToUpdate.listId,
            userId: currentUser?.id,
          });
        }
        lastAssigneeUpdateTimestampRef.current = Date.now();
      } catch (err: any) {
        // Rollback on error
        setActivities(prev => prev.filter(a => a.id !== optimisticId));
        console.warn('[TaskDetailModal] Failed to persist assignees:', err);
      }
    },
    [currentUser, setActivities]
  );

  const handleToggleAssignee = (user: UserModel) => {
    if (!task) return;

    // Always read from latestAssigneesRef to survive rapid clicks
    const latestAssignees = latestAssigneesRef.current;
    if (!assigneeBaselineRef.current) assigneeBaselineRef.current = latestAssignees;

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
    lastAssigneeUpdateTimestampRef.current = Date.now();
    latestAssigneesRef.current = updatedAssignees;
    setLocalAssignees(updatedAssignees);
    task.assignees = updatedAssignees;
    task.assigneeIds = updatedIds;
    task.assignee = primaryAssignee;
    task.assigneeId = primaryAssignee?.id || null;

    if (onUpdateTask) {
      onUpdateTask(updatedTask);
    }
    useAppStore.getState().updateTask(updatedTask);
    window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: updatedTask } }));

    // 2. Immediate remote persistence without lag
    const previousAssignees = assigneeBaselineRef.current || [];
    assigneeBaselineRef.current = null;
    persistAssignees(updatedTask, updatedIds, primaryAssignee, updatedAssignees, previousAssignees);
  };

  const handleClearAllAssignees = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!task) return;

    const previousAssignees = assigneeBaselineRef.current || latestAssigneesRef.current;
    assigneeBaselineRef.current = null;

    const updatedTask: Task = {
      ...task,
      assignees: [],
      assigneeIds: [],
      assignee: null,
      assigneeId: null,
    };

    lastAssigneeUpdateTimestampRef.current = Date.now();
    latestAssigneesRef.current = [];
    setLocalAssignees([]);
    task.assignees = [];
    task.assigneeIds = [];
    task.assignee = null;
    task.assigneeId = null;

    if (onUpdateTask) {
      onUpdateTask(updatedTask);
    }
    useAppStore.getState().updateTask(updatedTask);
    window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: updatedTask } }));
    setIsAssigneeOpen(false);

    persistAssignees(updatedTask, [], null, [], previousAssignees);
  };

  const handleSelectAllRoleAssignees = () => {
    if (!task) return;
    const allSelected = assignableUsers.length > 0 && assignableUsers.every((u: any) => isUserAssigned(u.id));

    let updatedAssignees: UserModel[];
    if (allSelected) {
      // Deselect all assignable users from the current assignees
      updatedAssignees = (latestAssigneesRef.current || []).filter((u: any) => !assignableUsers.some((au: any) => au.id === u.id));
    } else {
      // Select all assignable users, combining with any already assigned
      const map = new Map<string, UserModel>();
      (latestAssigneesRef.current || []).forEach((u: any) => map.set(u.id, u));
      assignableUsers.forEach((u: any) => map.set(u.id, u));
      updatedAssignees = Array.from(map.values());
    }

    const updatedIds = updatedAssignees.map((u: any) => u.id);
    const primaryAssignee = updatedAssignees.length > 0 ? updatedAssignees[0] : null;

    const updatedTask: Task = {
      ...task,
      assignees: updatedAssignees,
      assigneeIds: updatedIds,
      assignee: primaryAssignee,
      assigneeId: primaryAssignee?.id || null,
    };

    const previousAssignees = assigneeBaselineRef.current || latestAssigneesRef.current;
    assigneeBaselineRef.current = null;

    lastAssigneeUpdateTimestampRef.current = Date.now();
    latestAssigneesRef.current = updatedAssignees;
    setLocalAssignees(updatedAssignees);
    task.assignees = updatedAssignees;
    task.assigneeIds = updatedIds;
    task.assignee = primaryAssignee;
    task.assigneeId = primaryAssignee?.id || null;

    if (onUpdateTask) {
      onUpdateTask(updatedTask);
    }
    useAppStore.getState().updateTask(updatedTask);
    window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: updatedTask } }));

    persistAssignees(updatedTask, updatedIds, primaryAssignee, updatedAssignees, previousAssignees);
  };

  const handleApplyRoleRestrictions = (next: string[], transitionToAssignee = true) => {
    if (!task) return;
    const matchingUsers = resolveUsersFromRoleRestrictions(next, workspaceUsers, workspaceTeams);

    // Stop pre-filling assignees: retain only existing assignees that are still valid under new roles
    const currentAssigneesList = latestAssigneesRef.current || [];
    const validAssignees = next.length > 0
      ? currentAssigneesList.filter((u: any) => matchingUsers.some((m: any) => m.id === u.id))
      : currentAssigneesList;
    const validIds = validAssignees.map((u: any) => u.id);
    const primaryAssignee = validAssignees.length > 0 ? validAssignees[0] : null;

    latestRoleRestrictionsRef.current = next;
    setLocalRoleRestrictions(next);
    lastRoleUpdateTimestampRef.current = Date.now();

    latestAssigneesRef.current = validAssignees;
    setLocalAssignees(validAssignees);
    lastAssigneeUpdateTimestampRef.current = Date.now();

    task.assigneeRoleRestrictions = next;
    task.assignees = validAssignees;
    task.assigneeIds = validIds;
    task.assignee = primaryAssignee;
    task.assigneeId = primaryAssignee?.id || null;

    const updatedTask = {
      ...task,
      assigneeRoleRestrictions: next,
      assignees: validAssignees,
      assigneeIds: validIds,
      assignee: primaryAssignee,
      assigneeId: primaryAssignee?.id || null,
    };

    if (onUpdateTask) onUpdateTask(updatedTask);
    useAppStore.getState().updateTask(updatedTask);
    window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: updatedTask } }));

    const parentId = (task as any).parentTaskId || (task as any).taskId;
    if (parentId) {
      tasksApi.updateSubtask(parentId, task.id, { assigneeRoleRestrictions: next, assigneeIds: validIds } as any).catch(console.error);
    } else {
      tasksApi.updateTask(task.id, { assigneeRoleRestrictions: next, assigneeIds: validIds } as any).catch(console.error);
    }

    if (transitionToAssignee) {
      // 1. Close the Team Role dropdown (uncollapsed animation)
      setIsRoleOpen(false);

      if (roleToAssigneeTimeoutRef.current) {
        clearTimeout(roleToAssigneeTimeoutRef.current);
      }

      // 2. Wait for Team Role dropdown to completely uncollapse/close before opening the Assign Assignee dropdown
      if (next.length > 0) {
        roleToAssigneeTimeoutRef.current = setTimeout(() => {
          setIsAssigneeOpen(true);
        }, 220);
      }
    }
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
      if ((task as any).parentTaskId) {
        await tasksApi.updateSubtask((task as any).parentTaskId, task.id, { priority: p });
      } else {
        await tasksApi.updateTask(task.id, {
          priority: p,
          currentListId: task.listId,
          userId: currentUser?.id,
        });
      }
      toast.success(`Priority set to ${getPriorityConfig(p).label}`);
    } catch (err: any) {
      // Rollback on error
      setActivities(prev => prev.filter(a => a.id !== optimisticId));
      toast.error(err.message || 'Failed to update priority');
    }
  };

  const handleDueDateChange = async (date: Date | undefined) => {
    if (!task) return;
    const dateStr = date ? date.toISOString() : null;
    const updated = { ...task, dueDate: dateStr };
    if (onUpdateTask) onUpdateTask(updated);
    useAppStore.getState().updateTask(updated);
    window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: updated } }));
    setIsDateOpen(false);

    try {
      const parentId = (task as any).parentTaskId || (task as any).taskId;
      if (parentId) {
        await tasksApi.updateSubtask(parentId, task.id, { dueDate: dateStr });
      } else {
        await tasksApi.updateTask(task.id, {
          dueDate: dateStr,
          currentListId: task.listId,
          userId: currentUser?.id,
        });
      }
      toast.success(date ? 'Due date updated' : 'Due date cleared');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update due date');
    }
  };

  const handleSaveRecurrence = async (config: RecurringConfig | null, triggerImmediate: boolean) => {
    if (!task) return;
    try {
      const res = await tasksApi.setRecurring(task.id, config, triggerImmediate);
      const updated = { ...task, recurringConfig: config };
      if (onUpdateTask) onUpdateTask(updated);
      useAppStore.getState().updateTask(updated);
      window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: updated } }));
      if (res.duplicatedTask) {
        toast.success(`Duplicate task created in PENDING: ${res.duplicatedTask.title}`);
      } else {
        toast.success(config ? 'Recurring schedule saved' : 'Recurrence cleared');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to save recurring schedule');
    }
  };

  const handleDuplicateNow = async () => {
    if (!task) return;
    try {
      const res = await tasksApi.duplicateToPending(task.id);
      if (res.task) {
        toast.success(`Duplicate task created in PENDING: ${res.task.title}`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to duplicate task');
    }
  };

  const handleAddComment = async () => {
    const trimmed = isBlankCommentHtml(comment) ? '' : trimCommentHtml(comment);
    if (!trimmed && stagedFiles.length === 0) return;
    if (!task) return;
    if (isUploading || isUploadingInline || isSubmittingComment) return;

    setIsSubmittingComment(true);

    let finalComment = trimmed;
    const tempId = `temp-comment-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const draftHtml = comment;

    try {
      // Only uploads hold the editor: files need their URLs before the comment can be shown or sent
      if (stagedFiles.length > 0) {
        setIsUploading(true);
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
        setIsSubmittingComment(false);
        return;
      }

      const isSubtask = !!(task as any).parentTaskId;
      const targetId = isSubtask ? (task as any).parentTaskId : task.id;
      const subtaskId = isSubtask ? task.id : undefined;
      // Optimistic update — into richComments, which is what the feed renders (comment activities are filtered out)
      setRichComments(prev => [...prev, {
        id: tempId,
        content: finalComment,
        createdAt: new Date().toISOString(),
        userId: currentUser?.id,
        user: { id: currentUser?.id, name: currentUser?.name || 'You', avatarUrl: (currentUser as any)?.avatarUrl },
        subtaskId,
        reactions: [],
        replies: [],
      }]);
      setVisibleActivityCount(prev => prev + 1);
      scrollToLatestComment();

      setComment('');
      setTimeout(() => {
        const el = document.getElementById('main-task-comment');
        if (el) el.style.height = '80px';
      }, 10);
      const usersToCelebrate = [...mentionedUsers];
      setStagedFiles([]);
      setMentionedUsers([]);
      setIsUploading(false);

      const res = await tasksApi.addComment(
        targetId,
        finalComment,
        currentUser?.id || '',
        task.listId,
        mentionedUsers.map(u => u.id),
        undefined,
        subtaskId
      );

      if (res?.comment) {
        if (usersToCelebrate.length > 0) {
          usersToCelebrate.forEach(u => {
            const fullUser = workspaceUsersIndex[u.id] || u;
            triggerMentionConfetti(fullUser);
          });
        }
        // A reload that landed meanwhile may already hold the saved comment; then just drop the placeholder
        setRichComments(prev => prev.some(c => c.id === res.comment.id)
          ? prev.filter(c => c.id !== tempId)
          : prev.map(c => c.id === tempId ? { ...c, ...res.comment } : c));
      }
      if (res?.activity) {
        setActivities(prev => prev.some(a => a.id === res.activity.id) ? prev : [...prev, res.activity]);
      }
    } catch (err: any) {
      // Take the unsent comment back out of the feed and give the text back if nothing new was typed
      setRichComments(prev => prev.filter(c => c.id !== tempId));
      setComment(prev => (prev.trim() && prev !== '<p></p>' ? prev : draftHtml));
      const errMsg = err?.response?.data?.error || err.message || 'Failed to post comment';
      const statusCode = err?.response?.status;
      toast.error(errMsg);
      setActionError({
        title: 'Failed to Post Comment',
        action: 'Sending comment to task',
        message: errMsg,
        statusCode,
        technicalDetails: typeof err === 'object' ? JSON.stringify(err.response?.data || err, null, 2) : String(err),
        context: {
          taskId: task.id,
          taskTitle: task.title,
          listId: task.listId,
          subtaskId: (task as any).parentTaskId ? task.id : 'None (Main Task)',
          externalId: (task as any).externalId || 'None',
        },
        troubleshooting: [
          'If this task was synced from ClickUp or Sheets: verify the task has a valid link or externalId.',
          'Verify your network connection to the server.',
          'If triggered via n8n: ensure the comment payload includes a valid "message" and "task_link".'
        ],
        onRetry: handleAddComment,
      });
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
          } catch (err) {
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

  const addStagedFiles = useCallback((newFiles: File[]) => {
    setStagedFiles(prev => {
      const next = [...prev];
      for (const f of newFiles) {
        const check = validateUploadFile(f);
        if (!check.valid) {
          toast.error(check.error || `File ${f.name} is not allowed`);
          continue;
        }
        if (check.isSoftWarning && check.softWarning) {
          toast.warning(check.softWarning);
        }
        if (next.length >= MAX_FILES_PER_BATCH) {
          toast.error(`Maximum of ${MAX_FILES_PER_BATCH} staged files reached.`);
          break;
        }
        if (!next.some(existing => existing.name === f.name && existing.size === f.size && existing.lastModified === f.lastModified)) {
          next.push(f);
        }
      }
      return next;
    });
  }, []);

  const handleCommentFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const check = validateUploadFile(file);
      if (!check.valid) {
        toast.error(check.error || `File ${file.name} is not allowed`);
      } else {
        if (check.isSoftWarning && check.softWarning) {
          toast.warning(check.softWarning);
        }
        if (check.isImage) {
          commentEditorRef.current?.insertImages([file]);
        } else {
          addStagedFiles([file]);
        }
      }
    }
    if (commentFileInputRef.current) {
      commentFileInputRef.current.value = '';
    }
  };
  const handleReturnToList = () => {
    const targetListId = task?.list?.id || task?.listId;
    if (typeof window !== 'undefined') {
      const isCurrentList = !!targetListId && window.location.pathname === `/lists/${targetListId}`;
      if (isCurrentList) {
        onClose();
        const url = new URL(window.location.href);
        url.searchParams.delete('task');
        url.searchParams.delete('subtask');
        window.history.replaceState(null, '', url.pathname + (url.search || ''));
      } else if (targetListId) {
        router.push(`/lists/${targetListId}`);
      } else {
        router.push('/');
      }
    }
  };

  return (
    <div className="w-full h-full relative overflow-hidden flex flex-col">
      {activeSubtask && (
        <div className="absolute inset-0 z-50 bg-background flex flex-col">
          <SubtaskDetailView
            subtask={activeSubtask}
            parentTask={task}
            onClose={() => setActiveSubtask(null)}
            onCloseModal={onClose}
            currentUser={currentUser}
            socket={socket}
            mode={mode}
            workspaceUsers={workspaceUsers}
            onUpdateTask={onUpdateTask}
            setActiveSubtask={setActiveSubtask}
            permission={permission}
            listStatuses={internalListStatuses}
            workspaceTeams={workspaceTeams}
            targetCommentId={targetCommentId}
            targetCommentText={targetCommentText}
            scrollToComments={scrollToComments}
          />
        </div>
      )}
      <div
        className="w-full h-full bg-background flex flex-col overflow-hidden cursor-default"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0 bg-card">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                onClose();
              }}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors mr-2 cursor-pointer"
              title="Close"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {task.list ? (
              <div className="flex items-center gap-2 text-xs text-zinc-400 font-medium">
                {task.list.space && (
                  <>
                    <button
                      onClick={() => {
                        const targetListId = task?.list?.id || task?.listId;
                        if (targetListId) {
                          router.push(`/lists/${targetListId}`);
                        } else {
                          router.push('/');
                        }
                      }}
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
                      onClick={() => {
                        const targetListId = task?.list?.id || task?.listId;
                        if (targetListId) {
                          router.push(`/lists/${targetListId}`);
                        } else {
                          router.push('/');
                        }
                      }}
                      className="flex items-center gap-1.5 hover:text-zinc-200 transition-colors cursor-pointer"
                    >
                      <Folder className="w-3.5 h-3.5 shrink-0" style={{ color: getFolderColor(task.list.folder) }} />
                      <span className="truncate max-w-[120px]">{task.list.folder.name}</span>
                    </button>
                    <span className="text-zinc-700">/</span>
                  </>
                )}

                <button
                  onClick={handleReturnToList}
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
                const link = getNexusTaskUrl(task, activeSubtask?.id);
                navigator.clipboard.writeText(link);
                toast.success('Link copied to clipboard');
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 text-[11px] font-medium rounded-lg border border-zinc-700/50 transition-colors cursor-pointer mr-2"
            >
              <Share2 className="w-3.5 h-3.5 text-zinc-400" />
              Share
            </button>
            {mode === 'modal' && (
              <button
                onClick={() => {
                  onClose();
                  const fromPath = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '';
                  router.push(`/tasks/${task.id}${fromPath ? `?from=${encodeURIComponent(fromPath)}` : ''}`);
                }}
                className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white transition-colors cursor-pointer mr-1"
                title="Open in full page"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => {
                onClose();
              }}
              className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content area: Split layout */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left Panel: Details & Description */}
          <div className="flex-1 overflow-y-auto border-r border-border custom-scrollbar">
            <div className="p-8">

              <div className="mb-8 group max-w-3xl w-full">
                {isEditingTitle ? (
                  <textarea
                    ref={titleTextareaRef}
                    rows={1}
                    autoFocus
                    value={localTitle}
                    onChange={(e) => {
                      setLocalTitle(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = `${e.target.scrollHeight}px`;
                    }}
                    onFocus={(e) => {
                      e.target.style.height = 'auto';
                      e.target.style.height = `${e.target.scrollHeight}px`;
                      e.target.setSelectionRange(e.target.value.length, e.target.value.length);
                    }}
                    onBlur={() => {
                      setIsEditingTitle(false);
                      handleTitleBlur();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    className="text-2xl font-bold bg-card border border-zinc-700 focus:border-zinc-500 focus:outline-none w-full transition-colors rounded px-2 py-1 -ml-2 text-zinc-100 resize-none overflow-hidden leading-snug break-words block"
                  />
                ) : (
                  <h1
                    onClick={() => { if (canEditTask) setIsEditingTitle(true); }}
                    className={`text-2xl font-bold cursor-pointer hover:bg-zinc-800/50 rounded px-2 py-1 -ml-2 transition-colors break-words leading-snug group w-fit max-w-full pr-10 ${(localStatus === 'Closed' || localStatus === 'CLOSED' || localStatus === 'DONE') ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}
                  >
                    <span>{localTitle}</span>
                    <Pencil className="w-4 h-4 ml-2.5 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity inline-block align-middle shrink-0" />
                  </h1>
                )}
              </div>

              {/* Properties Stack — row layout */}
              <div className="flex flex-col gap-2 mb-8 mt-1">

                {/* Status Row */}
                <div className="flex items-center gap-3 min-h-[32px]">
                  <div className="flex items-center gap-2 w-28 shrink-0">
                    {(() => {
                      const isClosed = localStatus === 'Closed' || localStatus === 'CLOSED' || localStatus === 'DONE';
                      return isClosed ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" /> : ((localStatus || '').toUpperCase() === 'KYC' ? <CustomCircleDotted className="w-3.5 h-3.5 shrink-0 text-muted-foreground" /> : <CustomCircleDot className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />);
                    })()}
                    <span className="text-[12px] text-zinc-500">Status</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(() => {
                      const orderedStatuses = orderedListStatuses.length > 0
                        ? orderedListStatuses.map((s: any) => typeof s === 'string' ? s : (s.name || s.status || s.title || ''))
                        : ALL_STATUSES;

                      const statusName = localStatus || 'No Status';
                      const statusObj = internalListStatuses?.find((s: any) => 
                        (s.name || s.title || s.status || '').trim().toUpperCase() === statusName.trim().toUpperCase()
                      );
                      const hasCustomColor = !!statusObj?.color;
                      const defaultClasses = STATUS_COLORS[(localStatus || '').toUpperCase()] || STATUS_COLORS[localStatus] || 'bg-zinc-800/50 text-zinc-400';

                      return (
                        <div
                          style={hasCustomColor ? { backgroundColor: getHexColor(statusObj.color) } : {}}
                          className={`inline-flex items-center h-7 rounded-md text-[11px] font-bold uppercase tracking-wider select-none transition-colors ${hasCustomColor ? 'text-[#fff]' : defaultClasses} shadow-sm group/status`}
                        >
                          <Popover.Root open={isStatusOpen} onOpenChange={setIsStatusOpen}>
                            <Popover.Trigger asChild>
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center h-full px-2.5 cursor-pointer hover:brightness-110 rounded-l-md"
                              >
                                {statusName}
                              </div>
                            </Popover.Trigger>
                            <Popover.Portal>
                              <Popover.Content className="z-[100000] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-100 w-48 p-1.5 bg-background border border-zinc-200 dark:border-zinc-800 rounded-md shadow-xl outline-none" align="start" sideOffset={4}>
                                <div className="max-h-60 overflow-y-auto custom-scrollbar flex flex-col gap-0.5 pr-1">
                                  {(() => {
                                    const openStatuses = orderedStatuses.filter(s => !isClosedStatus(s));
                                    const closedStatuses = orderedStatuses.filter(s => isClosedStatus(s));

                                    const renderItem = (s: string) => {
                                      const customObj = internalListStatuses?.find(ls => (ls.name || ls.status || ls.title) === s);
                                      const isClosed = isClosedStatus(s);
                                      const statusColorHex = STATUS_COLORS[(s || '').toUpperCase()]?.match(/\[(.*?)\]/)?.[1];
                                      const statusIconStyle = statusColorHex ? { color: statusColorHex } : {};

                                      return (
                                        <div
                                          key={s}
                                          onClick={() => {
                                            handleStatusChangeAction(s);
                                            setIsStatusOpen(false);
                                          }}
                                          className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${localStatus === s ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium' : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-accent hover:text-zinc-900 dark:hover:text-accent-foreground'}`}
                                        >
                                          {(() => {
                                            if (isClosed) {
                                              return <CheckCircle2 className="w-3 h-3 shrink-0 text-[#2FA37A]" style={customObj?.color ? { color: getHexColor(customObj.color) } : statusIconStyle} />;
                                            }
                                            if (customObj?.color) {
                                              if ((s || '').toUpperCase() === 'KYC') {
                                                return <CustomCircleDotted className="w-3 h-3 shrink-0" style={{ color: getHexColor(customObj.color) }} />;
                                              }
                                              return <CustomCircleDot className="w-3 h-3 shrink-0" style={{ color: getHexColor(customObj.color) }} />;
                                            }
                                            if ((s || '').toUpperCase() === 'KYC') {
                                              return <CustomCircleDotted className={`w-3 h-3 shrink-0 ${statusColorHex ? '' : 'text-zinc-500'}`} style={statusIconStyle} />;
                                            }
                                            return <CustomCircleDot className={`w-3 h-3 shrink-0 ${statusColorHex ? '' : 'text-zinc-500'}`} style={statusIconStyle} />;
                                          })()}
                                          <span className="uppercase">{s}</span>
                                          {s === localStatus && <Check className="w-3 h-3 ml-auto opacity-70 text-blue-600 dark:text-blue-400" />}
                                        </div>
                                      );
                                    };

                                    return (
                                      <>
                                        {openStatuses.map(renderItem)}
                                        {closedStatuses.length > 0 && (
                                          <>
                                            <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
                                            <div className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400 px-2.5 pt-1.5 pb-1 select-none">
                                              Closed
                                            </div>
                                            {closedStatuses.map(renderItem)}
                                          </>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                              </Popover.Content>
                            </Popover.Portal>
                          </Popover.Root>

                          <div className="h-4 w-[1px] bg-white/20" />

                          {(() => {
                            const statuses = orderedStatuses;
                            const currentIndex = statuses.indexOf(statusName);
                            const nextIndex = currentIndex !== -1 ? (currentIndex + 1) % statuses.length : 0;
                            const nextStatus = statuses[nextIndex];

                            return (
                              <div
                                title={`Move to "${nextStatus}"`}
                                className="flex items-center justify-center h-full px-1.5 cursor-pointer hover:brightness-110 rounded-r-md"
                                onClick={handleStatusClick}
                              >
                                <ChevronRight className="w-3.5 h-3.5 opacity-90" />
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}

                    <div className="flex items-center gap-1.5 shrink-0 ml-1">
                      {(() => {
                        const isTaskClosed = (task as any).completed || (localStatus || '').toLowerCase() === 'closed' || (localStatus || '').toLowerCase() === 'done';
                        return (
                          <button
                            onClick={() => handleStatusChangeAction(isTaskClosed ? 'Pending' : 'Closed')}
                            title={isTaskClosed ? "Mark as Open" : "Mark as Closed"}
                            className={`w-7 h-7 rounded flex items-center justify-center transition-colors shadow-sm border cursor-pointer ${
                              isTaskClosed
                                ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700 hover:border-emerald-700'
                                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-emerald-600 hover:border-emerald-600 hover:text-white'
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        );
                      })()}
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
                    <Popover.Root open={isRoleOpen && canAssignTask} onOpenChange={(open) => canAssignTask && setIsRoleOpen(open)}>
                      <Popover.Trigger asChild>
                        {(localRoleRestrictions && localRoleRestrictions.length > 0) ? (
                          <motion.div layout onClick={blockIfCannotAssign} title={!canAssignTask ? assignDeniedMessage : undefined} className={`flex items-center transition-all duration-300 ${!canAssignTask ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-105 active:scale-95'}`}>
                            <AnimatePresence>
                              {normalizeRoles(localRoleRestrictions, workspaceTeams).map((role, i) => {
                                const colors = ['bg-purple-500', 'bg-red-500', 'bg-emerald-500', 'bg-blue-500', 'bg-amber-500', 'bg-pink-500'];
                                const bgColor = colors[i % colors.length];
                                return (
                                  <motion.div
                                    key={role}
                                    initial={{ opacity: 0, scale: 0.5 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.5 }}
                                    transition={{ duration: 0.2 }}
                                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-card ${i > 0 ? '-ml-2.5' : ''} shadow-sm relative ${bgColor}`}
                                    style={{ zIndex: 10 - i }}
                                    title={role}
                                  >
                                    {role.substring(0, 2).toUpperCase()}
                                  </motion.div>
                                );
                              })}
                            </AnimatePresence>
                          </motion.div>
                        ) : (
                          <button onClick={blockIfCannotAssign} aria-disabled={!canAssignTask} title={!canAssignTask ? assignDeniedMessage : undefined} className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-zinc-800/50 border border-zinc-700/50 text-zinc-400 text-[11px] transition-colors select-none whitespace-nowrap ${!canAssignTask ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-zinc-700/50 hover:text-zinc-200'}`}>
                            <Plus className="w-3 h-3" />
                            Assign Role
                            {!canAssignTask && <Lock className="w-3 h-3 ml-0.5 shrink-0" />}
                          </button>
                        )}
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content className="z-[100000] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 duration-150 w-52 p-1 bg-background border border-zinc-800 rounded-lg shadow-2xl outline-none" sideOffset={4} align="start">
                          <div className="max-h-[220px] overflow-y-auto custom-scrollbar p-1">
                            <p className="text-[10px] text-zinc-500 px-2 py-1 uppercase tracking-wide font-medium">Restrict assignees to roles</p>
                            {workspaceTeams.length === 0 && <div className="px-2 py-1.5 text-xs text-zinc-500">No teams found.</div>}
                            {workspaceTeams.map(team => (
                              <div key={team.id} className="mb-2">
                                {(() => {
                                  const teamRoles = team.teamRoles || [];
                                  const current = latestRoleRestrictionsRef.current;
                                  const hasRoles = teamRoles.length > 0;
                                  const allSelected = hasRoles && teamRoles.every((r: any) => hasRole(current, r.name));
                                  const someSelected = hasRoles && teamRoles.some((r: any) => hasRole(current, r.name));

                                  return (
                                    <div
                                      onClick={() => {
                                        if (!hasRoles) return;
                                        let next = [...current];
                                        if (allSelected) {
                                          next = next.filter(r => !teamRoles.some((tr: any) => roleKey(tr.name) === roleKey(r)));
                                        } else {
                                          const toAdd = teamRoles.filter((tr: any) => !hasRole(next, tr.name)).map((tr: any) => tr.name);
                                          next = [...next, ...toAdd];
                                        }
                                        next = normalizeRoles(next, workspaceTeams);
                                        handleApplyRoleRestrictions(next, true);
                                      }}
                                      className={`flex items-center gap-2 px-2 py-1 text-[10px] font-semibold tracking-wide uppercase bg-zinc-800/30 ${hasRoles ? 'cursor-pointer hover:bg-zinc-800/50 hover:text-zinc-200 transition-colors' : ''} ${someSelected ? 'text-indigo-400' : 'text-zinc-400'}`}
                                    >
                                      {hasRoles && (
                                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${allSelected ? 'bg-indigo-600 border-indigo-500' : someSelected ? 'bg-indigo-900/50 border-indigo-500' : 'border-zinc-500 bg-popover'}`}>
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
                                      const selected = hasRole(localRoleRestrictions, role.name);
                                      return (
                                        <div
                                          key={role.id}
                                          onClick={() => {
                                            const current = latestRoleRestrictionsRef.current;
                                            const next = normalizeRoles(
                                              selected ? withoutRole(current, role.name) : [...current, role.name],
                                              workspaceTeams
                                            );
                                            handleApplyRoleRestrictions(next, true);
                                          }}
                                          className="flex items-center gap-2 cursor-pointer px-1 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors rounded-md"
                                        >
                                          <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${selected ? 'bg-indigo-600 border-indigo-500' : 'border-zinc-600'}`}>
                                            {selected && <Check className="w-2.5 h-2.5 text-white" />}
                                          </div>
                                          {role.name}
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
                    <Popover.Root open={isAssigneeOpen && canAssignMember} onOpenChange={(open) => canAssignMember && setIsAssigneeOpen(open)}>
                      <Popover.Trigger asChild>
                        <motion.div layout
                          onClick={(e) => {
                            if (!canAssignTask) {
                              blockIfCannotAssign(e);
                              return;
                            }
                            if (!hasTeamRole) {
                              e.preventDefault();
                              toast.error("Select a team role first to assign members");
                              setIsRoleOpen(true);
                              return;
                            }
                          }}
                          title={!canAssignTask ? assignDeniedMessage : !hasTeamRole ? "Select a team role first to assign members" : currentAssignees.map((u) => u.name).join(', ')}
                          className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md transition-colors text-[11px] select-none w-fit ${canAssignMember
                            ? 'cursor-pointer bg-zinc-800/50 hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-200'
                            : 'cursor-not-allowed bg-zinc-800/20 text-zinc-500 opacity-70'
                            }`}
                        >
                          {currentAssignees.length > 0 ? (
                            <>
                              <div className="flex items-center -space-x-1.5">
                                <AnimatePresence>
                                  {currentAssignees.slice(0, 3).map((u, i) => {
                                    const avatarSrc = u.avatarUrl || (u as any).imageUrl;
                                    return (
                                      <motion.div
                                        key={u.id}
                                        initial={{ opacity: 0, scale: 0.5 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.5 }}
                                        transition={{ duration: 0.2 }}
                                        style={{ zIndex: i + 1 }}
                                        className="relative ring-2 ring-background rounded-full shrink-0"
                                        title={u.name}
                                      >
                                        {avatarSrc ? (
                                          <img src={avatarSrc} alt={u.name} className="w-5 h-5 rounded-full object-cover" />
                                        ) : (
                                          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] text-white font-bold ${getAssigneeAvatarColor(u.name || u.id || 'U')}`}>
                                            {(u.name || 'U').substring(0, 2).toUpperCase()}
                                          </div>
                                        )}
                                      </motion.div>
                                    );
                                  })}
                                </AnimatePresence>
                                <AnimatePresence>
                                  {currentAssignees.length > 3 && (
                                    <motion.div
                                      key="overflow"
                                      initial={{ opacity: 0, scale: 0.5 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      exit={{ opacity: 0, scale: 0.5 }}
                                      transition={{ duration: 0.2 }}
                                      style={{ zIndex: 10 }}
                                      className="relative ring-2 ring-background rounded-full bg-zinc-800 text-zinc-300 text-[8px] font-bold h-5 w-5 flex items-center justify-center shrink-0"
                                    >
                                      +{currentAssignees.length - 3}
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                              {currentAssignees.length === 1 && (
                                <motion.span layout className="truncate max-w-[100px]">{currentAssignees[0].name}</motion.span>
                              )}
                              {!canAssignMember && <Lock className="w-3 h-3 ml-0.5 shrink-0 text-zinc-500" />}
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5 shrink-0" />
                              <span>Assign</span>
                              {!canAssignMember && <Lock className="w-3 h-3 ml-0.5 shrink-0" />}
                            </>
                          )}
                        </motion.div>
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content
                          className="z-[100000] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 duration-150 w-72 p-0 bg-background border border-zinc-800 rounded-md shadow-2xl outline-none overflow-hidden"
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

                              {hasTeamRole && assignableUsers.length > 0 && (
                                <Command.Item
                                  value={`select all assignees for team role ${localRoleRestrictions.join(' ')}`}
                                  onSelect={() => handleSelectAllRoleAssignees()}
                                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none text-indigo-200 font-semibold hover:text-indigo-100 hover:bg-indigo-500/15 data-[selected=true]:bg-indigo-500/15 data-[selected=true]:text-indigo-100 mb-1 border-b border-zinc-800/40 transition-colors"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                      assignableUsers.every((u: any) => isUserAssigned(u.id))
                                        ? 'bg-indigo-600 border-indigo-500'
                                        : 'border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800/60'
                                    }`}>
                                      {assignableUsers.every((u: any) => isUserAssigned(u.id)) ? (
                                        <Check className="w-2.5 h-2.5 text-white" />
                                      ) : assignableUsers.some((u: any) => isUserAssigned(u.id)) ? (
                                        <div className="w-1.5 h-0.5 bg-indigo-500 rounded-full" />
                                      ) : null}
                                    </div>
                                    <span className="truncate text-inherit">
                                      {assignableUsers.every((u: any) => isUserAssigned(u.id))
                                        ? 'Deselect all assignees'
                                        : localRoleRestrictions.length === 1
                                          ? `Select all ${localRoleRestrictions[0]} assignees`
                                          : 'Select all assignees for Team Role'}
                                    </span>
                                  </div>
                                </Command.Item>
                              )}

                              {currentAssignees.length > 0 && (
                                <Command.Item
                                  value="clear all unassigned none"
                                  onSelect={() => handleClearAllAssignees()}
                                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none data-[selected=true]:bg-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 data-[selected=true]:text-rose-400 mb-1 border-b border-zinc-800/40"
                                >
                                  <div className="w-5 h-5 rounded-full border border-dashed border-zinc-300 dark:border-zinc-600 flex items-center justify-center text-[10px] text-zinc-400 dark:text-zinc-500 mr-2 shrink-0">
                                    ✕
                                  </div>
                                  <span>Clear all assignees</span>
                                </Command.Item>
                              )}

                              {assignableUsers.map((u) => {
                                const assigned = isUserAssigned(u.id);
                                const initials = (u.name || 'U').substring(0, 2).toUpperCase();
                                const role = u.roles?.[0] || '';
                                const avatarColors = ['bg-violet-600','bg-blue-600','bg-emerald-600','bg-rose-600','bg-amber-600','bg-cyan-600','bg-fuchsia-600'];
                                const avatarBg = avatarColors[(u.name || '').charCodeAt(0) % avatarColors.length];
                                return (
                                  <Command.Item
                                    key={u.id}
                                    value={`${u.name} ${u.email} ${role}`}
                                    onSelect={() => handleToggleAssignee(u)}
                                    className="relative flex cursor-pointer select-none items-center rounded-md px-2.5 py-2 outline-none data-[selected=true]:bg-zinc-800/60 hover:bg-zinc-800/60 text-zinc-300 gap-2.5"
                                  >
                                    {u.avatarUrl ? (
                                      <img src={u.avatarUrl} alt={u.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                                    ) : (
                                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] text-white font-bold shrink-0 ${avatarBg}`}>
                                        {initials}
                                      </div>
                                    )}
                                    <div className="flex flex-col min-w-0 flex-1">
                                      <span className="truncate text-[13px] font-medium text-zinc-200">{u.name}</span>
                                      <span className="truncate text-[11px] text-zinc-500">{role || u.email}</span>
                                    </div>
                                    {assigned && (
                                      <Check className="w-4 h-4 text-indigo-400 shrink-0 ml-2" />
                                    )}
                                  </Command.Item>
                                );
                              })}
                            </Command.List>
                          </Command>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                    {currentAssignees.length > 0 && canAssignTask && (
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
                          const config = getPriorityConfig(task.priority);
                          return (
                            <>
                              {task.priority && <Flag className={`w-3.5 h-3.5 shrink-0 ${config.iconColor}`} />}
                              <span className={`font-medium ${config.color}`}>
                                {task.priority ? config.label : 'Empty'}
                              </span>
                            </>
                          );
                        })()}
                      </div>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content className="z-[100000] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-100 w-56 p-1 bg-popover border border-zinc-800 rounded-xl shadow-2xl outline-none" side="bottom" align="start" sideOffset={4}>
                        <div className="flex flex-col gap-0.5">
                          <div className="text-[10px] font-bold text-zinc-500 tracking-wider px-2.5 py-1.5 uppercase">Priority</div>
                          {(PRIORITY_OPTIONS as readonly Priority[]).map(p => (
                            <button
                              key={p}
                              onClick={() => { handlePriorityChange(p); setIsPriorityOpen(false); }}
                              className={`w-full flex items-center gap-2.5 px-2.5 py-2 hover:bg-zinc-800 rounded-lg text-sm transition-colors cursor-pointer ${task.priority === p ? 'bg-zinc-800/50' : ''}`}
                            >
                              <Flag className={`w-3.5 h-3.5 shrink-0 ${getPriorityConfig(p).iconColor}`} />
                              <span className={`font-medium ${getPriorityConfig(p).color}`}>{getPriorityConfig(p).label}</span>
                              {task.priority === p && <Check className="w-4 h-4 ml-auto text-blue-500" />}
                            </button>
                          ))}
                          {task.priority && (
                            <div className="border-t border-zinc-800/60 mt-1 pt-1">
                              <button
                                className="w-full flex items-center gap-2.5 px-2.5 py-2 hover:bg-zinc-800 rounded-lg text-sm text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                                onClick={() => { handlePriorityChange(null as any); setIsPriorityOpen(false); }}
                              >
                                <Flag className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                                <span>Clear Priority</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                </div>

                {/* Dates / Due Date & Recurrence Row */}
                <div className="flex items-center gap-3 min-h-[32px]">
                  <div className="flex items-center gap-2 w-28 shrink-0">
                    <Calendar className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                    <span className="text-[12px] text-zinc-500">Dates</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Left: Due Date */}
                    <Popover.Root open={isDateOpen && canEditTask} onOpenChange={setIsDateOpen}>
                      <Popover.Trigger asChild>
                        <div className="inline-flex items-center gap-1.5 h-7 px-2.5 cursor-pointer bg-zinc-800/50 hover:bg-zinc-700/50 rounded-md transition-colors text-[11px] select-none w-fit text-zinc-300">
                          <Calendar className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                          <span>
                            {task.dueDate
                              ? new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                              : 'Set Due Date'}
                          </span>
                        </div>
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content className="z-[100000] p-2.5 bg-background border border-zinc-800 rounded-xl shadow-2xl outline-none w-[230px]" side="bottom" align="start" sideOffset={4}>
                          <div className="kanban-date-picker">
                            <style>{`
                              .kanban-date-picker .rdp-root {
                                --rdp-accent-color: #6366f1;
                                --rdp-accent-background-color: rgba(99, 102, 241, 0.2);
                                --rdp-day-height: 26px; --rdp-day-width: 26px;
                                --rdp-day_button-height: 24px; --rdp-day_button-width: 24px;
                                --rdp-day_button-border-radius: 4px;
                                --rdp-selected-border: none;
                                --rdp-nav-height: 24px;
                                --rdp-nav_button-height: 20px; --rdp-nav_button-width: 20px;
                                --rdp-weekday-padding: 2px 0;
                                margin: 0; font-size: 11px;
                              }
                              .kanban-date-picker .rdp-months, .kanban-date-picker .rdp-month { max-width: 100%; }
                              .kanban-date-picker .rdp-month_grid { margin: 0 auto; border-collapse: separate; border-spacing: 1px; }
                              .kanban-date-picker .rdp-month_caption { height: var(--rdp-nav-height); color: #f4f4f5; padding-left: 4px; }
                              .kanban-date-picker .rdp-caption_label { font-size: 12px; font-weight: 600; }
                              .kanban-date-picker .rdp-weekday { color: #a1a1aa; font-weight: 600; font-size: 10px; }
                              .kanban-date-picker .rdp-day { font-size: 11px; padding: 0; }
                              .kanban-date-picker .rdp-day_button { transition: background-color 0.15s; }
                              .kanban-date-picker .rdp-day_button:hover:not([disabled]) { background-color: rgba(255, 255, 255, 0.1); }
                              .kanban-date-picker .rdp-today:not(.rdp-outside) { color: #818cf8; font-weight: 700; }
                              .kanban-date-picker .rdp-selected .rdp-day_button { background-color: var(--rdp-accent-color); color: white; font-weight: 700; }
                              .kanban-date-picker .rdp-button_previous, .kanban-date-picker .rdp-button_next { border-radius: 4px; }
                              .kanban-date-picker .rdp-button_previous:hover, .kanban-date-picker .rdp-button_next:hover { background-color: rgba(255, 255, 255, 0.1); }
                              .kanban-date-picker .rdp-chevron { fill: #d4d4d8; width: 12px; height: 12px; }
                            `}</style>
                            <div className="flex justify-between items-center mb-2 px-1">
                              <div className="text-[11px] text-zinc-500 font-semibold uppercase">Set Due Date</div>
                              {task.dueDate && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDueDateChange(undefined); }}
                                  className="text-[10px] text-red-400/80 hover:text-red-400 hover:bg-red-500/10 px-2 py-0.5 rounded transition-colors"
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                            <DayPicker
                              mode="single"
                              selected={task.dueDate ? new Date(task.dueDate) : undefined}
                              onSelect={handleDueDateChange}
                            />
                          </div>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>

                    {/* Right: Recurrence - ONLY if in recurring group! */}
                    {isInRecurringGroup && (
                      <Popover.Root open={isRecurrenceOpen && canEditTask} onOpenChange={setIsRecurrenceOpen}>
                        <Popover.Trigger asChild>
                          <div className="inline-flex items-center gap-1.5 h-7 px-2.5 cursor-pointer bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800/50 dark:hover:bg-zinc-700/50 rounded-md transition-colors text-[11px] select-none w-fit">
                            {task.recurringConfig ? (
                              <>
                                <Repeat className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                                <span className="font-semibold text-purple-700 dark:text-purple-300">
                                  {(() => {
                                    const statusUpper = (localStatus || '').toUpperCase().trim();
                                    const effectiveFreq = ['DAILY', 'WEEKLY', 'MONTHLY'].includes(statusUpper)
                                      ? statusUpper
                                      : (task.recurringConfig.frequency || 'DAILY');
                                    return effectiveFreq === 'DAILY'
                                      ? `Daily at ${formatTimeDisplay(task.recurringConfig.time)}`
                                      : effectiveFreq === 'WEEKLY'
                                      ? `Weekly Mon-Fri at ${formatTimeDisplay(task.recurringConfig.time)}`
                                      : `Monthly on ${task.recurringConfig.dayOfMonth || 1} at ${formatTimeDisplay(task.recurringConfig.time)}`;
                                  })()}
                                </span>
                              </>
                            ) : (
                              <>
                                <Repeat className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                                <span className="text-zinc-500 hover:text-zinc-300">
                                  {['DAILY', 'WEEKLY', 'MONTHLY'].includes((localStatus || '').toUpperCase())
                                    ? `Set ${(localStatus || '').toUpperCase()} Time`
                                    : 'Set Recurrence'}
                                </span>
                              </>
                            )}
                          </div>
                        </Popover.Trigger>
                        <Popover.Portal>
                          <Popover.Content className="z-[100000] p-0 border-none bg-transparent outline-none" side="bottom" align="start" sideOffset={4}>
                            <RecurrencePicker
                              task={task}
                              defaultFrequency={
                                ['DAILY', 'WEEKLY', 'MONTHLY'].includes((localStatus || '').toUpperCase())
                                  ? ((localStatus || '').toUpperCase() as any)
                                  : 'DAILY'
                              }
                              onSave={handleSaveRecurrence}
                              onDuplicateNow={handleDuplicateNow}
                              onClose={() => setIsRecurrenceOpen(false)}
                            />
                          </Popover.Content>
                        </Popover.Portal>
                      </Popover.Root>
                    )}
                  </div>
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

                <div className="relative">
                  <div
                    ref={descContentRef}
                  className={`relative p-2 -mx-2 rounded-lg hover:bg-zinc-800/20 cursor-text break-words overflow-hidden transition-[max-height,background-color] duration-300 ease-in-out`}
                  style={{ maxHeight: (!isLocalEditing && !editingUser && isDescOverflowing && !isDescExpanded) ? 160 : (descContentRef.current ? descContentRef.current.scrollHeight + 100 : 3000) }}
                  onFocus={(e) => { 
                    if (canEditTask) {
                        setIsLocalEditing(true);
                        setIsDescExpanded(true);
                        handleStartEditing(); 
                      } else {
                        e.target.blur();
                      }
                    }}
                    onClick={() => {
                      if (canEditTask) {
                        setIsLocalEditing(true);
                        setIsDescExpanded(true);
                        handleStartEditing();
                      }
                    }}
                  >
                    <BlockEditor
                      content={localDescription}
                      onChange={handleDescChange}
                      onBlur={() => {
                        setIsLocalEditing(false);
                        handleDescBlur();
                      }}
                      editable={!editingUser}
                      onEditorReady={(editor) => { editorRef.current = editor; }}
                    />

                    {(!localDescription || localDescription === '<p></p>' || localDescription === '<p><br></p>') && (
                      <div className={`absolute top-2 ${!editingUser ? 'left-9' : 'left-2'} text-sm text-zinc-500 italic pointer-events-none`}>
                        Add description...
                      </div>
                    )}
                    
                    {!editingUser && isDescOverflowing && !isDescExpanded && (
                      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background via-background/90 to-transparent flex items-end justify-center pb-1 pointer-events-none">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setIsDescExpanded(true); }}
                          onMouseDown={(e) => e.preventDefault()}
                          onFocus={(e) => e.stopPropagation()}
                          className="pointer-events-auto flex items-center gap-1.5 px-3 py-1 bg-popover hover:bg-zinc-800 border border-zinc-700/50 rounded-md text-[10px] text-zinc-300 font-medium transition-colors shadow-sm cursor-pointer"
                        >
                          <ChevronDown className="w-3 h-3" />
                          Expand
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {isDescOverflowing && !editingUser && isDescExpanded && (
                    <button
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setIsDescExpanded(false); 
                        setIsLocalEditing(false);
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                      onFocus={(e) => e.stopPropagation()}
                      className="mt-2 flex items-center gap-1.5 px-3 py-1 self-center mx-auto bg-zinc-800/50 hover:bg-zinc-700 border border-zinc-700/30 rounded-md text-[10px] text-zinc-400 font-medium transition-colors shadow-sm cursor-pointer"
                    >
                      <ChevronUp className="w-3 h-3" />
                      Collapse
                    </button>
                  )}
                </div>
              </div>

              <div 
                id="task-modal-subtasks-section"
                className="flex items-center justify-between mb-1 mt-5 cursor-pointer group select-none" 
                onClick={handleSubtasksHeaderClick}
                onDoubleClick={handleSubtasksHeaderDoubleClick}
                title={
                  isSubtasksExpanded
                    ? "Single-click: Toggle expand/collapse all rows • Double-click: Collapse section"
                    : "Click to expand subtasks section"
                }
              >
                <div className="flex items-center gap-2">
                  {isSubtasksExpanded ? (
                    <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0 group-hover:text-zinc-200 transition-colors" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0 group-hover:text-zinc-200 transition-colors" />
                  )}
                  <span className="font-semibold text-zinc-100 flex items-center gap-2 group-hover:text-white transition-colors">
                    <ListTodo className="w-4 h-4 text-zinc-400 group-hover:text-zinc-200 transition-colors" />
                    Subtasks
                  </span>
                  {task.subtasks && task.subtasks.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-medium ml-1">
                      {task.subtasks.filter((s: any) => {
                        const st = (s.status || '').toUpperCase();
                        return st !== 'CLOSED' && st !== 'DONE' && !s.completed;
                      }).length}
                    </span>
                  )}
                </div>
              </div>


              {isSubtasksExpanded && (
                <>
              <SubtasksSection
                task={task}
                onUpdateTask={(updatedTask) => {
                  if (onUpdateTask) onUpdateTask(updatedTask);
                }}
                users={workspaceUsers}
                addingSubtask={addingSubtask}
                setAddingSubtask={setAddingSubtask}
                socket={socket}
                currentUser={currentUser}
                onOpenSubtask={(subtask) => setActiveSubtask(subtask)}
                listStatuses={orderedListStatuses}
                teams={workspaceTeams}
                onCollapseSection={() => setIsSubtasksExpanded(false)}
                expandAllSignal={subtasksExpandAllSignal}
              />

              {(!task.subtasks || task.subtasks.length === 0) && !addingSubtask && (
                <div className="my-1">
                  <button onClick={() => setAddingSubtask(true)} className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 px-2 py-1 hover:bg-zinc-800/50 rounded-md transition-colors text-xs font-medium cursor-pointer">
                    <Plus className="w-3.5 h-3.5 shrink-0" /> Add subtask
                  </button>
                </div>
              )}
              </>
              )}

              {/* Action Buttons (Notes, Attachments, etc) */}
              <div className="mt-1 flex flex-col gap-1 w-full">
                <AuditSection
                  task={task}
                  title={task.title}
                  users={workspaceUsers || []}
                  checklists={task.checklists || []}
                  currentUser={currentUser}
                  onUpdateChecklists={(checklists) => {
                    if (onUpdateTask) onUpdateTask({ ...task, checklists });
                  }}
                />
                <ChecklistsSection
                  task={task}
                  users={workspaceUsers || []}
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
          <div ref={activityPanelRef} style={{ width: activityWidth }} className="flex-shrink-0 bg-card flex flex-col border-l border-zinc-800/60">
            <div className="px-6 py-5 border-b border-zinc-800/60 shrink-0 flex items-center justify-between">
              <h3 className="font-semibold text-sm text-zinc-200">Activity</h3>
              <div className="flex gap-3">
                <span className="text-zinc-500 text-xs">Created {new Date(task.createdAt || Date.now()).toLocaleDateString()}</span>
              </div>
            </div>

            <div ref={activityScrollRef} onScroll={handleActivityScroll} className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              <div className="space-y-5">

                {/* Loading older activities indicator / trigger */}
                {hasOlderActivities && (
                  <div className="py-2.5 flex justify-center items-center">
                    {isLoadingOlderActivities ? (
                      <div className="flex items-center gap-2 text-xs text-zinc-500 py-1">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                        <span>Loading earlier updates...</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={loadOlderActivities}
                        className="text-[11px] font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800/40 hover:bg-zinc-800/80 border border-zinc-800 transition-all flex items-center gap-1.5 py-1 px-3 rounded-full cursor-pointer"
                      >
                        <Clock className="w-3 h-3 text-zinc-500" />
                        <span>Load earlier updates ({olderActivitiesCount} remaining)</span>
                      </button>
                    )}
                  </div>
                )}



                {/* Sort activities and comments oldest to newest */}
                {loadError && (
                  <div className="text-red-400 text-sm p-4 mb-4 border border-red-500/20 bg-red-500/10 rounded-lg">
                    <p className="font-semibold mb-1">Failed to load activity logs</p>
                    <p className="opacity-80">{loadError}</p>
                  </div>
                )}
                {loadingActivities ? <CommentSkeleton /> : (() => {
                  const renderComment = (comment: any, isReply = false) => {
                    const cTimeStr = new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const cGroups: Record<string, { count: number; users: string[]; hasMe: boolean }> = {};
                    (comment.reactions || []).forEach((r: any) => {
                      if (!cGroups[r.emoji]) cGroups[r.emoji] = { count: 0, users: [], hasMe: false };
                      cGroups[r.emoji].count++;
                      cGroups[r.emoji].users.push(r.user?.name || '?');
                      if (r.userId === currentUser?.id) cGroups[r.emoji].hasMe = true;
                    });
                    const isEditing = editingCommentId === comment.id;
                    return (
                      <div
                        key={comment.id}
                        id={`comment-${comment.id}`}
                        data-comment-id={comment.id}
                        data-comment-text={(comment.content || '').slice(0, 80)}
                        className={`group/comment flex flex-col gap-2 text-sm w-full min-w-0 max-w-full p-4 rounded-xl shadow-sm transition-all ${
                          isReply
                            ? 'mt-2 border'
                            : 'bg-card border border-zinc-800/60'
                        }`}
                        style={{
                          ...(isReply
                            ? {
                                backgroundColor: 'color-mix(in srgb, var(--accent) 6%, var(--surface, #18181c))',
                                borderColor: isEditing
                                  ? 'color-mix(in srgb, var(--accent) 55%, var(--border, #242429))'
                                  : 'color-mix(in srgb, var(--accent) 25%, var(--border, #242429))',
                              }
                            : isEditing
                              ? {
                                  borderColor: 'color-mix(in srgb, var(--accent) 55%, var(--border, #242429))',
                                }
                              : {}),
                          boxShadow: isEditing
                            ? '0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent), 0 4px 14px color-mix(in srgb, var(--accent) 12%, transparent)'
                            : undefined,
                        }}
                      >
                        <div className="flex items-center gap-3 w-full">
                          {comment.user?.avatarUrl ? (
                            <img src={comment.user.avatarUrl} alt={comment.user.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-indigo-600 shrink-0 flex items-center justify-center text-white text-[11px] font-bold">
                              {(comment.user?.name || 'U').charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-zinc-200 font-medium text-[13px]">{comment.user?.name || 'Someone'}</span>
                              <span className="text-[11px] text-zinc-500">{new Date(comment.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} {cTimeStr}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setFullscreenCommentId(comment.id)}
                                className="opacity-0 group-hover/comment:opacity-100 transition-opacity text-zinc-300 hover:text-white p-1.5 rounded-md hover:bg-zinc-800/60 cursor-pointer"
                                title="Full screen view"
                              >
                                <Maximize2 className="w-3.5 h-3.5" />
                              </button>
                              {comment.user?.id === currentUser?.id && (
                                <Popover.Root>
                                  <Popover.Trigger asChild>
                                    <button className="text-zinc-500 hover:text-zinc-300 transition-colors p-1" title="Comment Options">
                                      <MoreHorizontal className="w-3.5 h-3.5" />
                                    </button>
                                  </Popover.Trigger>
                                  <Popover.Portal>
                                    <Popover.Content
                                      className="w-32 bg-popover border border-border rounded-lg shadow-xl overflow-hidden z-[100000] p-1"
                                      align="end"
                                      onCloseAutoFocus={(e) => {
                                        e.preventDefault();
                                      }}
                                    >
                                      <Popover.Close asChild>
                                        <button onClick={() => { setEditingCommentId(comment.id); setEditCommentText(comment.content); }} className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent hover:text-foreground rounded-md transition-colors flex items-center gap-2 cursor-pointer">
                                          <Pencil className="w-3.5 h-3.5" /> Edit
                                        </button>
                                      </Popover.Close>
                                      <Popover.Close asChild>
                                        <button onClick={() => { setCommentToDelete(comment.id); }} className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/15 hover:text-red-300 rounded-md transition-colors flex items-center gap-2 cursor-pointer">
                                          <Trash2 className="w-3.5 h-3.5" /> Delete
                                        </button>
                                      </Popover.Close>
                                    </Popover.Content>
                                  </Popover.Portal>
                                </Popover.Root>
                              )}
                            </div>
                          </div>
                        </div>

                        {editingCommentId === comment.id ? (
                          <div className="w-full mt-1.5">
                            <EditCommentForm
                              commentId={comment.id}
                              initialContent={comment.content || ''}
                              workspaceUsers={workspaceUsers}
                              currentUser={currentUser}
                              onSave={(newContent) => handleSaveEdit(comment.id, newContent)}
                              onCancel={() => setEditingCommentId(null)}
                              onPreviewImage={setLightboxImage}
                            />
                          </div>
                        ) : (
                          <div className="text-zinc-300 text-[13.5px] leading-relaxed max-w-full break-words prose prose-sm prose-invert prose-p:my-0 [&_p:empty:not(:first-child):not(:last-child)]:min-h-[1.6em] prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:underline hover:prose-a:text-blue-700 dark:hover:prose-a:text-blue-300 prose-a:rounded-sm prose-a:transition-colors prose-img:rounded-md prose-img:my-2 prose-img:max-w-full w-full pl-11 select-text cursor-text">
                            <CommentMarkdown
                              content={comment.content || ''}
                              components={isReply ? replyMarkdownComponents : markdownComponents}
                              onToggleChecklist={(itemIndex, checked) => handleToggleCommentChecklist(comment.id, itemIndex, checked)}
                            />
                          </div>
                        )}
                        {/* Reaction pills */}
                        {Object.keys(cGroups).length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 pl-11">
                            {Object.entries(cGroups).map(([emoji, data]) => (
                              <button
                                key={emoji}
                                title={data.users.join(', ')}
                                onClick={() => handleToggleReaction(comment.id, emoji)}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] border transition-colors cursor-pointer ${data.hasMe ? 'bg-indigo-500/15 border-indigo-500/60 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/25' : 'bg-muted/70 border-border text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground'}`}
                              >
                                {emoji} <span className="font-medium">{data.count}</span>
                              </button>
                            ))}
                            <button
                              onClick={(e) => {
                                const btn = e.currentTarget;
                                if (showEmojiPickerFor === comment.id) {
                                  setShowEmojiPickerFor(null);
                                  setEmojiPickerAnchor(null);
                                } else {
                                  setShowEmojiPickerFor(comment.id);
                                  setEmojiPickerAnchor(btn);
                                }
                              }}
                              className="flex items-center justify-center w-5 h-5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-accent text-xs transition-colors cursor-pointer"
                              title="Add reaction"
                            >
                              +
                            </button>
                          </div>
                        )}
                        {/* Action row */}
                        <div className="flex items-center gap-1 mt-1 pl-11 relative">
                          <button
                            onClick={() => handleToggleReaction(comment.id, '👍')}
                            className={`flex items-center justify-center w-6 h-6 rounded hover:bg-accent cursor-pointer transition-colors ${cGroups['👍']?.hasMe ? 'text-indigo-600 dark:text-indigo-400' : 'text-muted-foreground hover:text-foreground'}`}
                            title="Like"
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                          </button>
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                const btn = e.currentTarget;
                                if (showEmojiPickerFor === comment.id) {
                                  setShowEmojiPickerFor(null);
                                  setEmojiPickerAnchor(null);
                                } else {
                                  setShowEmojiPickerFor(comment.id);
                                  setEmojiPickerAnchor(btn);
                                }
                              }}
                              className="flex items-center justify-center w-6 h-6 rounded hover:bg-accent cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                              title="React"
                            >
                              <SmilePlus className="w-3.5 h-3.5" />
                            </button>
                            {showEmojiPickerFor === comment.id && emojiPickerAnchor && (
                              <EmojiPicker
                                anchorEl={emojiPickerAnchor}
                                onSelect={(emoji) => {
                                  handleToggleReaction(comment.id, emoji);
                                  setShowEmojiPickerFor(null);
                                  setEmojiPickerAnchor(null);
                                }}
                                onClose={() => {
                                  setShowEmojiPickerFor(null);
                                  setEmojiPickerAnchor(null);
                                }}
                                placement="auto"
                              />
                            )}
                          </div>
                          {!isReply && (
                            <button
                              onClick={() => setReplyingToId(replyingToId === comment.id ? null : comment.id)}
                              className="flex items-center gap-1.5 px-2 h-6 rounded hover:bg-zinc-700/80 cursor-pointer text-zinc-500 hover:text-zinc-300 transition-colors text-[11px] font-medium ml-1"
                            >
                              <MessageSquare className="w-3 h-3" /> Reply {((comment.replies?.length ?? comment.replyCount) > 0) && `(${comment.replies?.length ?? comment.replyCount})`}
                            </button>
                          )}
                        </div>
                        {/* Reply input */}
                        {!isReply && replyingToId === comment.id && (
                          <CommentReplyInput
                            commentId={comment.id}
                            workspaceUsers={workspaceUsers}
                            currentUser={currentUser}
                            onSubmit={async (content, mentionIds) => {
                              await handleSubmitReply(comment.id, content, mentionIds);
                            }}
                            onCancel={() => setReplyingToId(null)}
                          />
                        )}
                        {/* Replies */}
                        {!isReply && comment.replies?.length > 0 && (
                          <div
                            className="pl-4 flex flex-col gap-2 mt-1 border-l-2 min-w-0 max-w-full"
                            style={{
                              borderLeftColor: 'color-mix(in srgb, var(--accent) 55%, var(--border, #242429))',
                            }}
                          >
                            {comment.replies.map((r: any) => renderComment(r, true))}
                          </div>
                        )}
                      </div>
                    );
                  };

                  return (
                    <>
                      {/* Combined Timeline */}
                      {(paginatedCombined.length > 0 || (!hasOlderActivities && task?.createdAt)) && (() => {
                        const rawItems: any[] = [];
                        if (!hasOlderActivities && task?.createdAt) {
                          const creationTime = new Date(task.createdAt).getTime();
                          rawItems.push({
                            isCreationEvent: true,
                            sortDate: paginatedCombined.length > 0
                              ? Math.min(isNaN(creationTime) ? Date.now() : creationTime, paginatedCombined[0].sortDate - 1)
                              : (isNaN(creationTime) ? Date.now() : creationTime),
                          });
                        }
                        rawItems.push(...paginatedCombined);

                        // Group rawItems by day (YYYY-MM-DD)
                        interface DayGroup {
                          dayKey: string;
                          date: Date | number | string;
                          isNew: boolean;
                          items: any[];
                        }

                        const dayGroups: DayGroup[] = [];
                        let currentDayGroup: DayGroup | null = null;

                        rawItems.forEach(item => {
                          const itemDate = item.sortDate || (item.createdAt ? new Date(item.createdAt).getTime() : Date.now());
                          const dayKey = getDayKey(itemDate);

                          if (!currentDayGroup || currentDayGroup.dayKey !== dayKey) {
                            const isNew = isTodayDate(itemDate);
                            currentDayGroup = {
                              dayKey,
                              date: itemDate,
                              isNew,
                              items: [item],
                            };
                            dayGroups.push(currentDayGroup);
                          } else {
                            currentDayGroup.items.push(item);
                          }
                        });

                        const renderTimelineItem = (item: any) => {
                              if (item.isCreationEvent) {
                                return (
                                  <div key="task-initial-creation" className="flex gap-4 text-sm text-zinc-400 items-start">
                                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
                                    <div className="flex-1 leading-relaxed">
                                      <span className="text-zinc-200 font-medium">{task.creator?.name || 'System'}</span> created this task
                                    </div>
                                    <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                      {new Date(task.createdAt || Date.now()).toLocaleDateString()}
                                    </span>
                                  </div>
                                );
                              }
                              if (item.isShowMore) {
                                return (
                                  <button
                                    key={`show-more-${item.blockId}`}
                                    onClick={() => setExpandedBlocks(prev => [...prev, item.blockId])}
                                    className="flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors w-full py-2 mb-2"
                                  >
                                    <ChevronRight className="w-4 h-4" />
                                    Show more
                                  </button>
                                );
                              }
                              if (item.isShowLess) {
                                return (
                                  <button
                                    key={`show-less-${item.blockId}`}
                                    onClick={() => setExpandedBlocks(prev => prev.filter(id => id !== item.blockId))}
                                    className="flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors w-full py-2 mb-2"
                                  >
                                    <ChevronDown className="w-4 h-4" />
                                    Show less
                                  </button>
                                );
                              }
                              if (item.isActivityType) {
                              const act = item;
                              const timeStr = new Date(act.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                              if (act.type === 'status_change') {
                                return (
                                  <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start">
                                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                    <div className="flex-1 leading-relaxed">
                                      <span className="inline-block px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1 mb-1">{act.author || 'Someone'}</span>
                                      {act.subtaskTitle ? (
                                        <>
                                          changed status of subtask <span className="font-medium text-zinc-300 px-1">{act.subtaskTitle}</span>
                                          {act.oldStatus && (
                                            <>from <span
                                              className={`font-medium px-1.5 py-0.5 rounded text-[11px] mx-1 inline-block whitespace-nowrap ${!(internalListStatuses?.find((s: any) => (s.name || s.title || s.status) === act.oldStatus))?.color ? (STATUS_COLORS[(act.oldStatus || '').toUpperCase()] || 'bg-zinc-800 text-zinc-300') : 'on-solid text-white shadow-sm'}`}
                                              style={(internalListStatuses?.find((s: any) => (s.name || s.title || s.status) === act.oldStatus))?.color ? { backgroundColor: getHexColor((internalListStatuses?.find((s: any) => (s.name || s.title || s.status) === act.oldStatus))?.color) } : {}}
                                            >
                                              {act.oldStatus}
                                            </span></>
                                          )}
                                        </>
                                      ) : (
                                        <>
                                          changed status
                                          {act.oldStatus && (
                                            <> from <span
                                              className={`font-medium px-1.5 py-0.5 rounded text-[11px] mx-1 inline-block whitespace-nowrap ${!(internalListStatuses?.find((s: any) => (s.name || s.title || s.status) === act.oldStatus))?.color ? (STATUS_COLORS[(act.oldStatus || '').toUpperCase()] || 'bg-zinc-800 text-zinc-300') : 'on-solid text-white shadow-sm'}`}
                                              style={(internalListStatuses?.find((s: any) => (s.name || s.title || s.status) === act.oldStatus))?.color ? { backgroundColor: getHexColor((internalListStatuses?.find((s: any) => (s.name || s.title || s.status) === act.oldStatus))?.color) } : {}}
                                            >
                                              {act.oldStatus}
                                            </span></>
                                          )}
                                        </>
                                      )}
                                      {' '}to <span
                                        className={`font-medium px-1.5 py-0.5 rounded text-[11px] ml-1 inline-block whitespace-nowrap ${!(internalListStatuses?.find((s: any) => (s.name || s.title || s.status) === act.newStatus))?.color ? (STATUS_COLORS[(act.newStatus || '').toUpperCase()] || 'bg-blue-500/10 text-blue-400') : 'on-solid text-white shadow-sm'}`}
                                        style={(internalListStatuses?.find((s: any) => (s.name || s.title || s.status) === act.newStatus))?.color ? { backgroundColor: getHexColor((internalListStatuses?.find((s: any) => (s.name || s.title || s.status) === act.newStatus))?.color) } : {}}
                                      >
                                        {act.newStatus}
                                      </span>
                                    </div>
                                    <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                      {timeStr}
                                    </span>
                                  </div>
                                );
                              }
                              if (act.type === 'assignment' || act.type === 'unassignment' || act.type === 'add_follower' || act.type === 'remove_follower' || act.type === 'followers_change') {
                                const actorName = act.author === currentUser?.name ? 'You' : (act.author || 'Someone');

                                return (
                                  <div key={act.id} className="flex justify-between items-center text-sm text-zinc-400 py-1">
                                    <div className="flex gap-2 items-center">
                                      <span className="text-zinc-500 text-lg leading-none mt-[-2px]">&bull;</span>
                                      <span>
                                        {actorName} {describeAssigneeActivity(act, currentUser?.name)}
                                        {act.subtaskTitle && (
                                          <span className="text-zinc-400"> on subtask <span className="text-zinc-300 font-medium px-1">{act.subtaskTitle}</span></span>
                                        )}
                                      </span>
                                    </div>
                                    <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                      {timeStr}
                                    </span>
                                  </div>
                                );
                              }
                              if (act.type === 'title_change') {
                                return renderTitleChangeActivity(act, currentUser?.name);
                              }
                              if (act.type === 'priority_change') {
                                return (
                                  <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start">
                                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                    <div className="flex-1 leading-relaxed">
                                      <span className="inline-block px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1 mb-1">{act.author || 'Someone'}</span>
                                      {act.subtaskTitle ? (
                                        <>
                                          changed priority of subtask <span className="text-zinc-300 font-medium px-1">{act.subtaskTitle}</span>{' '}
                                          {act.oldPriority && (
                                            <>from <span className={`font-medium px-1 ${getPriorityConfig(act.oldPriority).color}`}>{getPriorityConfig(act.oldPriority).label}</span> </>
                                          )}
                                          to{' '}
                                        </>
                                      ) : (
                                        <>
                                          changed priority{' '}
                                          {act.oldPriority && (
                                            <>from <span className={`font-medium px-1 ${getPriorityConfig(act.oldPriority).color}`}>{getPriorityConfig(act.oldPriority).label}</span> </>
                                          )}
                                          to{' '}
                                        </>
                                      )}
                                      <span className={`font-medium ${getPriorityConfig(act.newPriority).color}`}>{getPriorityConfig(act.newPriority).label}</span>
                                    </div>
                                    <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                      {timeStr}
                                    </span>
                                  </div>
                                );
                              }
                              if (act.type === 'create_subtask') {
                                return (
                                  <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start">
                                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                    <div className="flex-1 leading-relaxed">
                                      <span className="inline-block px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1 mb-1">{act.author || 'Someone'}</span>
                                      created subtask <span className="text-zinc-200 font-medium px-1">{act.subtaskTitle}</span>
                                    </div>
                                    <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                      {timeStr}
                                    </span>
                                  </div>
                                );
                              }
                              if (act.type === 'team_role_change') {
                                return (
                                  <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start">
                                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-pink-500 shrink-0" />
                                    <div className="flex-1 leading-relaxed">
                                      <span className="inline-block px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1 mb-1">{act.author || 'Someone'}</span>
                                      {(act.subtaskTitle && !((task as any)?.parentTaskId)) ? (
                                        <>updated team roles for subtask <span className="text-zinc-300 font-medium px-1">{act.subtaskTitle}</span></>
                                      ) : (
                                        <>updated team roles</>
                                      )}
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
                                    <div className="flex-1 leading-relaxed">
                                      <span className="inline-block px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1 mb-1">{act.author || 'Someone'}</span>
                                      {(act.subtaskTitle && !((task as any)?.parentTaskId)) ? (
                                        <>attached a file to subtask <span className="text-zinc-300 font-medium px-1">{act.subtaskTitle}</span>:{' '}</>
                                      ) : (
                                        <>attached a file:{' '}</>
                                      )}
                                      <span className="text-indigo-400 ml-1">{act.fileName}</span>
                                    </div>
                                    <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                      {timeStr}
                                    </span>
                                  </div>
                                );
                              }
                              if (act.type === 'audit_item_checked' || act.type === 'checklist_item_checked') {
                                const isAudit = act.type === 'audit_item_checked' || act.isAudit;
                                const actorName = act.author === currentUser?.name ? 'You' : (act.author || 'Someone');
                                const itemName = act.itemName || 'item';
                                return (
                                  <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start">
                                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                                    <div className="flex-1 leading-relaxed">
                                      <span className="inline-block px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1 mb-1">{actorName}</span>
                                      {act.subtaskTitle && !((task as any)?.parentTaskId) ? (
                                        <>checked {isAudit ? 'audit item' : 'checklist item'} <span className="text-zinc-200 font-medium px-1">"{itemName}"</span> on subtask <span className="text-zinc-300 font-medium px-1">{act.subtaskTitle}</span></>
                                      ) : (
                                        <>checked {isAudit ? 'audit item' : 'checklist item'} <span className="text-zinc-200 font-medium px-1">"{itemName}"</span></>
                                      )}
                                    </div>
                                    <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                      {timeStr}
                                    </span>
                                  </div>
                                );
                              }
                              return null;
                            } else {
                              return renderComment(item);
                            }
                          };

                          return (
                            <>
                              {dayGroups.map((dayGroup) => {
                                const isCollapsed = Boolean(collapsedDays[dayGroup.dayKey]);

                                let currentGroupKey: string | null = null;
                                let currentBlock: any[] = [];
                                const blocks: any[][] = [];

                                dayGroup.items.forEach(item => {
                                  const key = item.isCreationEvent ? 'creation' : (item.isActivityType ? (item.type || 'activity') : 'comment');
                                  if (currentGroupKey === null) {
                                    currentGroupKey = key;
                                    currentBlock.push(item);
                                  } else if (currentGroupKey === key && item.isActivityType) {
                                    currentBlock.push(item);
                                  } else {
                                    blocks.push(currentBlock);
                                    currentGroupKey = key;
                                    currentBlock = [item];
                                  }
                                });
                                if (currentBlock.length > 0) blocks.push(currentBlock);

                                const dayTimelineItems: any[] = [];
                                blocks.forEach((block, bIdx) => {
                                  const blockId = `${dayGroup.dayKey}-${bIdx}`;
                                  const isExpanded = expandedBlocks.includes(blockId);
                                  if (!block[0].isActivityType || block.length <= 1) {
                                    dayTimelineItems.push(...block);
                                  } else if (isExpanded) {
                                    dayTimelineItems.push({ isShowLess: true, blockId });
                                    dayTimelineItems.push(...block);
                                  } else {
                                    dayTimelineItems.push({ isShowMore: true, count: block.length - 1, blockId });
                                    dayTimelineItems.push(...block.slice(-1));
                                  }
                                });

                                const visibleItems = dayGroup.items.filter(item => {
                                  if (item.isCreationEvent) return true;
                                  if (item.isActivityType) return isActivityVisible(item);
                                  return true; // rich comment
                                });
                                if (visibleItems.length === 0) return null;

                                const hasLogUpdateOrComment = dayGroup.items.some(item => {
                                  if (item.isCreationEvent) return false;
                                  if (item.isActivityType) return isActivityVisible(item);
                                  return true; // rich comment
                                });

                                return (
                                  <div key={`day-section-${dayGroup.dayKey}`} className="w-full">
                                    {hasLogUpdateOrComment && (
                                      <ActivityDayDivider
                                        date={dayGroup.date}
                                        isNew={dayGroup.isNew}
                                        isCollapsed={isCollapsed}
                                        itemCount={visibleItems.length}
                                        onToggleCollapse={() => toggleCollapseDay(dayGroup.dayKey)}
                                      />
                                    )}
                                    <AnimatePresence initial={false}>
                                      {(!isCollapsed || !hasLogUpdateOrComment) && (
                                        <motion.div
                                          key={`day-content-${dayGroup.dayKey}`}
                                          initial={{ height: 0, opacity: 0 }}
                                          animate={{ height: 'auto', opacity: 1 }}
                                          exit={{ height: 0, opacity: 0 }}
                                          transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
                                          className="overflow-hidden space-y-4 pt-1"
                                        >
                                          {dayTimelineItems.map((item) => renderTimelineItem(item))}
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                );
                              })}
                            </>
                          );
                  })()}
                </>
              );
            })()}

              </div>
            </div>

            {/* Comment Input */}
            <div className="p-5 border-t border-zinc-800/60 shrink-0 bg-card flex flex-col gap-2">
              {stagedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2.5 mb-1.5">
                  {stagedFiles.map((file, idx) => {
                    const isImage = file.type.startsWith('image/');
                    const previewUrl = isImage ? URL.createObjectURL(file) : null;
                    const ext = getFileExtension(file.name);
                    const isSoftWarning = isImage ? file.size > IMAGE_SOFT_MAX_BYTES : file.size > ATTACHMENT_SOFT_MAX_BYTES;
                    const softLimitLabel = isImage ? '>3MB' : '>10MB';
                    const sizeFormatted = formatFileSize(file.size);
                    return (
                      <div key={idx} className={`relative group flex items-center justify-center bg-zinc-900 rounded-lg border ${isSoftWarning ? 'border-amber-500/60 ring-1 ring-amber-500/30' : 'border-indigo-500/40 ring-1 ring-indigo-500/20'} w-16 h-16 shrink-0 overflow-hidden shadow-sm`}>
                        {isImage && previewUrl ? (
                          <>
                            <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
                            <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-white font-medium text-center py-0.5">
                              {sizeFormatted}
                            </span>
                            {isSoftWarning && (
                              <span className="absolute top-1 left-1 bg-amber-500 text-black text-[7px] font-bold px-1 rounded shadow" title={`Large image: ${sizeFormatted} (soft limit >3MB)`}>
                                {softLimitLabel}
                              </span>
                            )}
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center p-1 text-center w-full">
                            <FileText className={`w-4 h-4 ${isSoftWarning ? 'text-amber-400' : 'text-indigo-400'} mb-0.5`} />
                            <span className={`text-[8px] font-bold tracking-wider uppercase px-1 py-0.2 rounded ${isSoftWarning ? 'bg-amber-500/15 text-amber-400' : 'bg-indigo-500/15 text-indigo-400'}`}>
                              {ext}
                            </span>
                            <span className="text-[9px] text-zinc-300 font-medium truncate max-w-[50px] mt-0.5" title={file.name}>
                              {file.name}
                            </span>
                            <span className="text-[7px] text-zinc-500 font-mono mt-0.2">
                              {sizeFormatted}
                            </span>
                            {isSoftWarning && (
                              <span className="absolute top-1 left-1 bg-amber-500 text-black text-[7px] font-bold px-1 rounded shadow" title={`Large attachment: ${sizeFormatted} (soft limit >10MB)`}>
                                {softLimitLabel}
                              </span>
                            )}
                          </div>
                        )}
                        <button
                          onClick={() => setStagedFiles(prev => prev.filter((_, i) => i !== idx))}
                          title="Remove"
                          className="absolute top-1 right-1 p-0.5 bg-black/80 hover:bg-red-600 border border-zinc-700/80 rounded-full text-zinc-300 hover:text-white shadow-sm backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="relative">
                {(() => {
                  const filteredMentionUsers = (workspaceUsers || []).filter(u =>
                    (u.name || '').toLowerCase().includes(mentionSearch.toLowerCase()) ||
                    (u.email || '').toLowerCase().includes(mentionSearch.toLowerCase())
                  );

                  const handleSelectMentionUser = (u: any) => {
                    const matchLength = mentionSearch.length + 1;
                    commentEditorRef.current?.insertMention(u.name || '', matchLength, u.id);
                    setShowMentionMenu(false);
                    if (!mentionedUsers.some(m => m.id === u.id)) {
                      setMentionedUsers(prev => [...prev, { id: u.id, name: u.name }]);
                    }
                    triggerMentionConfetti(u);
                  };

                  return (
                    <>
                      {showMentionMenu && (
                        <div className="absolute bottom-full left-0 mb-2 w-72 bg-popover border border-border rounded-xl shadow-2xl overflow-hidden z-[100000] animate-in fade-in zoom-in-95 duration-100">
                          <div className="p-2 border-b border-border text-xs font-semibold text-muted-foreground bg-accent/40 flex items-center justify-between">
                            <span>People</span>
                            <span className="text-[10px] text-muted-foreground font-normal">↑↓ navigate, Enter/Tab select</span>
                          </div>
                          <div ref={mentionListRef} className="max-h-52 overflow-y-auto custom-scrollbar relative">
                            {filteredMentionUsers.map((u, idx) => {
                              const isSelected = idx === mentionSelectedIndex;
                              const targetUrl = u.confettiUrl || u.avatarUrl;
                              if (idx < 5 && targetUrl) {
                                preloadMentionConfettiImage(targetUrl);
                              }
                              return (
                                <div
                                  key={u.id}
                                  onMouseEnter={() => setMentionSelectedIndex(idx)}
                                  onClick={() => handleSelectMentionUser(u)}
                                  style={
                                    isSelected
                                      ? {
                                          backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)',
                                        }
                                      : undefined
                                  }
                                  className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer text-sm transition-colors ${
                                    isSelected ? 'text-foreground font-medium' : 'text-foreground/80 hover:bg-accent/50'
                                  }`}
                                >
                                  {u.avatarUrl ? (
                                    <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                                  ) : (
                                    <div
                                      style={{
                                        backgroundColor: 'color-mix(in srgb, var(--accent) 20%, transparent)',
                                        color: 'var(--accent)',
                                      }}
                                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                                    >
                                      {(u.name || '?').substring(0, 2).toUpperCase()}
                                    </div>
                                  )}
                                  <div className="flex flex-col min-w-0">
                                    <span className="text-xs font-medium truncate">{u.name}</span>
                                    {u.email && <span className="text-[10px] text-muted-foreground truncate">{u.email}</span>}
                                  </div>
                                </div>
                              );
                            })}
                            {filteredMentionUsers.length === 0 && (
                              <div className="p-3 text-sm text-muted-foreground text-center">No users found</div>
                            )}
                          </div>
                        </div>
                      )}
                      <CommentEditor
                        ref={commentEditorRef}
                        id="main-task-comment"
                        value={comment}
                        onChange={(html, text, cursorPosition, textBefore) => {
                          setComment(html);

                          // Mention logic
                          const textBeforeCursor = textBefore !== undefined
                            ? textBefore
                            : (text || "").substring(0, cursorPosition || 0);
                          const match = textBeforeCursor.match(/(?:^|\s)@([^\s@]*)$/);

                          if (match) {
                            setShowMentionMenu(true);
                            setMentionSearch(match[1]);
                            setMentionStartIndex(textBeforeCursor.lastIndexOf('@'));
                            setMentionSelectedIndex(0);
                          } else {
                            setShowMentionMenu(false);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (showMentionMenu && filteredMentionUsers.length > 0) {
                            if (e.key === 'ArrowDown') {
                              e.preventDefault();
                              setMentionSelectedIndex(prev => (prev + 1) % filteredMentionUsers.length);
                              return true;
                            }
                            if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              setMentionSelectedIndex(prev => (prev - 1 + filteredMentionUsers.length) % filteredMentionUsers.length);
                              return true;
                            }
                            if (e.key === 'Enter' || e.key === 'Tab') {
                              e.preventDefault();
                              const targetUser = filteredMentionUsers[mentionSelectedIndex] || filteredMentionUsers[0];
                              if (targetUser) {
                                handleSelectMentionUser(targetUser);
                              }
                              return true;
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              setShowMentionMenu(false);
                              return true;
                            }
                          }
                          return false;
                        }}
                        onSubmit={handleAddComment}
                        onPasteFiles={addStagedFiles}
                        onDropFiles={addStagedFiles}
                        onUploadImage={uploadCommentImage}
                        onUploadImageUrl={copyCommentImage}
                        onUploadingChange={setIsUploadingInline}
                        disabled={isSubmittingComment}
                        placeholder={isSubmittingComment ? "Posting comment..." : "Write a comment..."}
                        footer={
                          <div className="flex items-center gap-1">
                            <ComposerToolButton onClick={() => commentFileInputRef.current?.click()} disabled={isUploading} title="Attach file or image">
                              <Paperclip className="w-4 h-4" />
                            </ComposerToolButton>
                            <ComposerToolButton
                              onClick={(e) => {
                                const btn = e.currentTarget;
                                setCommentEmojiAnchor(prev => prev ? null : btn);
                              }}
                              disabled={isSubmittingComment}
                              title="Add emoji"
                            >
                              <SmilePlus className="w-4 h-4" />
                            </ComposerToolButton>
                          </div>
                        }
                        footerEnd={
                          <ComposerSendButton
                            onClick={handleAddComment}
                            disabled={(isBlankCommentHtml(comment) && stagedFiles.length === 0) || isUploading || isUploadingInline || isSubmittingComment}
                            title={isUploadingInline ? 'Uploading image...' : 'Send comment'}
                          >
                            {isSubmittingComment ? 'Sending…' : 'Send'}
                          </ComposerSendButton>
                        }
                      />
                      {commentEmojiAnchor && (
                        <EmojiPicker
                          anchorEl={commentEmojiAnchor}
                          onSelect={(emoji) => {
                            commentEditorRef.current?.insertEmoji(emoji);
                            setCommentEmojiAnchor(null);
                          }}
                          onClose={() => setCommentEmojiAnchor(null)}
                          placement="top"
                        />
                      )}
                    </>
                  );
                })()}
                <input type="file" ref={commentFileInputRef} className="hidden" onChange={handleCommentFileChange} />
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Fullscreen Comment Modal */}
      <FullscreenCommentModal
        isOpen={!!activeFullscreenComment}
        onClose={() => setFullscreenCommentId(null)}
        comment={activeFullscreenComment}
        taskTitle={task.title}
        parentTaskId={task.id}
        currentUser={currentUser}
        workspaceUsers={workspaceUsers}
        onToggleReaction={handleToggleReaction}
        onSubmitReply={handleSubmitReply}
        onToggleChecklist={handleToggleCommentChecklist}
        onEdit={handleSaveEdit}
        onDelete={(cId) => setCommentToDelete(cId)}
        onPreviewImage={setLightboxImage}
      />
      {/* Lightbox Modal */}
      <ImageLightboxModal
        isOpen={!!lightboxImage}
        onClose={() => setLightboxImage(null)}
        currentSrc={lightboxImage}
        images={commentImages}
        onNavigate={setLightboxImage}
      />
      {commentToDelete && (
        <ConfirmDeleteModal
          isOpen={!!commentToDelete}
          onClose={() => setCommentToDelete(null)}
          onConfirm={() => handleDeleteComment(commentToDelete)}
          title="Delete Comment"
          itemName="this comment"
        />
      )}
      <ActionErrorModal
        isOpen={!!actionError}
        onClose={() => setActionError(null)}
        error={actionError}
      />

    </div>
  );
}

/** Assignee clicks within this window are saved together as one change. */
const ASSIGNEE_BATCH_MS = 600;



// ─── Subtask Detail View (Replaces Parent View) ─────────────────────────────
export function SubtaskDetailView({
  subtask,
  parentTask,
  onClose,
  onCloseModal,
  currentUser,
  socket,
  workspaceUsers,
  onUpdateTask,
  setActiveSubtask,
  permission,
  listStatuses,
  workspaceTeams = [],
  mode = 'modal',
  targetCommentId,
  targetCommentText,
  scrollToComments,
}: {
  subtask: any;
  parentTask: any;
  onClose: () => void;
  onCloseModal?: () => void;
  currentUser?: any;
  socket?: any;
  workspaceUsers?: any[];
  onUpdateTask?: (task: any) => void;
  setActiveSubtask?: (st: any) => void;
  permission?: { allowed: boolean; reason?: string };
  listStatuses?: any[];
  workspaceTeams?: any[];
  workspaceRoles?: any[];
  mode?: 'modal' | 'full';
  targetCommentId?: string | null;
  targetCommentText?: string | null;
  scrollToComments?: boolean;
}) {
  const router = useRouter();

  const subtaskRef = useRef(subtask);
  useEffect(() => {
    subtaskRef.current = subtask;
  }, [subtask]);

  const parentTaskRef = useRef(parentTask);
  useEffect(() => {
    parentTaskRef.current = parentTask;
  }, [parentTask]);

  // Synchronize subtask modifications immediately to local parent, global store, and window event bus
  const syncSubtaskToParent = useCallback((updatedSubtask: any) => {
    subtaskRef.current = updatedSubtask;
    if (setActiveSubtask) setActiveSubtask(updatedSubtask);
    const currentParent = parentTaskRef.current || parentTask;
    const newSubtasks = (currentParent.subtasks || []).map((st: any) =>
      st.id === updatedSubtask.id ? { ...st, ...updatedSubtask } : st
    );
    const updatedParent = { ...currentParent, subtasks: newSubtasks };
    parentTaskRef.current = updatedParent;
    if (onUpdateTask) onUpdateTask(updatedParent);
    useAppStore.getState().updateTask(updatedParent);
    window.dispatchEvent(new CustomEvent('task:updated', { detail: { task: updatedParent } }));
  }, [parentTask, onUpdateTask, setActiveSubtask]);

  const [localRoleRestrictions, setLocalRoleRestrictions] = useState<string[]>(() => subtask?.assigneeRoleRestrictions || []);
  const latestRoleRestrictionsRef = useRef<string[]>(subtask?.assigneeRoleRestrictions || []);
  const lastRoleUpdateTimestampRef = useRef<number>(0);

  useEffect(() => {
    if (Date.now() - lastRoleUpdateTimestampRef.current > 1500) {
      const fromProps = subtask?.assigneeRoleRestrictions || [];
      setLocalRoleRestrictions(fromProps);
      latestRoleRestrictionsRef.current = fromProps;
    }
  }, [subtask?.assigneeRoleRestrictions]);

  const subtaskAssignableUsers = React.useMemo(() => {
    const wsUsers = workspaceUsers || [];
    const wsTeams = workspaceTeams || [];
    if (!localRoleRestrictions || localRoleRestrictions.length === 0) {
      return wsUsers;
    }
    const teamRoleToTeamId = new Map<string, string>();
    wsTeams.forEach((team: any) => {
      (team.teamRoles || []).forEach((tr: any) => {
        teamRoleToTeamId.set(tr.name.toLowerCase(), team.id);
      });
    });

    const filteredUsers = wsUsers.filter((u) => {
      const userRoles = (u.roles || []) as string[];
      return localRoleRestrictions.some((role: string) => {
        if (userRoles.map(r => r.toUpperCase()).includes(role.toUpperCase())) return true;
        const teamId = teamRoleToTeamId.get(role.toLowerCase());
        if (teamId && (u as any).teamId === teamId) return true;
        return false;
      });
    });

    // Always allow the current user to assign themselves
    if (currentUser && !filteredUsers.some(u => u.id === currentUser.id)) {
      const me = wsUsers.find(u => u.id === currentUser.id);
      if (me) {
        filteredUsers.push(me);
      }
    }

    return filteredUsers;
  }, [localRoleRestrictions, workspaceUsers, workspaceTeams, currentUser]);

  const [richComments, setRichComments] = useState<any[]>([]);
  const commentImages = useMemo(() => {
    return extractImagesFromComments(richComments);
  }, [richComments]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentToDelete, setCommentToDelete] = useState<string | null>(null);
  const [showEmojiPickerFor, setShowEmojiPickerFor] = useState<string | null>(null);
  const [emojiPickerAnchor, setEmojiPickerAnchor] = useState<HTMLElement | null>(null);
  const [commentEmojiAnchor, setCommentEmojiAnchor] = useState<HTMLElement | null>(null);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const [fullscreenCommentId, setFullscreenCommentId] = useState<string | null>(null);

  const activeFullscreenComment = useMemo(() => {
    if (!fullscreenCommentId) return null;
    const top = richComments.find(c => c.id === fullscreenCommentId);
    if (top) return top;
    for (const c of richComments) {
      const r = c.replies?.find((rep: any) => rep.id === fullscreenCommentId);
      if (r) return r;
    }
    return null;
  }, [fullscreenCommentId, richComments]);

  useEffect(() => {
    setReplyingToId(null);
    setReplyText('');
    setShowEmojiPickerFor(null);
    setFullscreenCommentId(null);
  }, [subtask?.id]);

  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState(0);
  const [mentionedUsers, setMentionedUsers] = useState<{ id: string, name: string }[]>([]);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const subtaskMentionListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMentionMenu || !subtaskMentionListRef.current) return;
    const container = subtaskMentionListRef.current;
    const selectedEl = container.children[mentionSelectedIndex] as HTMLElement | undefined;
    if (!selectedEl) return;

    const containerTop = container.scrollTop;
    const containerBottom = containerTop + container.clientHeight;
    const elTop = selectedEl.offsetTop;
    const elBottom = elTop + selectedEl.offsetHeight;

    if (elTop < containerTop) {
      container.scrollTop = elTop;
    } else if (elBottom > containerBottom) {
      container.scrollTop = elBottom - container.clientHeight;
    }
  }, [mentionSelectedIndex, showMentionMenu]);
  const [editCommentText, setEditCommentText] = useState('');
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [isSubmittingStatus, setIsSubmittingStatus] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [localDesc, setLocalDesc] = useState(subtask.description || '');
  const [isLocalEditing, setIsLocalEditing] = useState(false);
  const [localStatus, setLocalStatus] = useState<string>(subtask.status || 'Pending');
  const [localCompleted, setLocalCompleted] = useState<boolean>(!!subtask.completed);
  const lastStatusUpdateTimestampRef = useRef<number>(0);

  useEffect(() => {
    if (Date.now() - lastStatusUpdateTimestampRef.current > 1500) {
      setLocalStatus(subtask.status || 'Pending');
      setLocalCompleted(!!subtask.completed);
    }
  }, [subtask.status, subtask.completed]);

  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [localTitle, setLocalTitle] = useState(subtask.title || '');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const subtaskTitleTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditingTitle && subtaskTitleTextareaRef.current) {
      const el = subtaskTitleTextareaRef.current;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [isEditingTitle]);
  const [activities, setActivities] = useState<any[]>([]);
  const activityScrollRef = useRef<HTMLDivElement>(null);
  const [collapsedDays, setCollapsedDays] = useState<Record<string, boolean>>({});
  const toggleCollapseDay = useCallback((dayKey: string) => {
    setCollapsedDays(prev => ({
      ...prev,
      [dayKey]: !prev[dayKey]
    }));
  }, []);


  const INITIAL_ACTIVITY_COUNT = 20;
  const ACTIVITY_BATCH_SIZE = 20;
  const [visibleActivityCount, setVisibleActivityCount] = useState(INITIAL_ACTIVITY_COUNT);
  const [isLoadingOlderActivities, setIsLoadingOlderActivities] = useState(false);
  const [prevSubtaskModalId, setPrevSubtaskModalId] = useState(subtask?.id);
  if (subtask?.id !== prevSubtaskModalId) {
    setPrevSubtaskModalId(subtask?.id);
    setVisibleActivityCount(INITIAL_ACTIVITY_COUNT);
    setIsLoadingOlderActivities(false);
    setCollapsedDays({});
  }

  const otherActivities = useMemo(() => {
    const visible = activities.filter(a => a.type !== 'comment' && isActivityVisible(a));
    const seenStatusKeys = new Set<string>();
    return visible.filter(a => {
      if (a.type === 'status_change') {
        const sub = a.subtaskTitle || '';
        const isOptimistic = typeof a.id === 'string' && a.id.startsWith('optimistic-');
        if (isOptimistic && visible.some(other => typeof other.id === 'string' && !other.id.startsWith('optimistic-') && other.type === 'status_change' && (other.subtaskTitle || '') === sub && other.newStatus === a.newStatus)) {
          return false;
        }
        const time = new Date(a.date || a.createdAt || 0).getTime();
        const duplicateKey = `${sub}|${a.oldStatus || ''}->${a.newStatus || ''}|${Math.floor(time / 15000)}`;
        if (seenStatusKeys.has(duplicateKey)) return false;
        seenStatusKeys.add(duplicateKey);
      }
      return true;
    });
  }, [activities]);
  const combined = useMemo(() => [
    ...otherActivities.map(a => ({ ...a, isActivityType: true, sortDate: new Date(a.date || Date.now()).getTime() })),
    ...richComments.map(c => ({ ...c, isActivityType: false, sortDate: new Date(c.createdAt || Date.now()).getTime() }))
  ].sort((a, b) => (a.sortDate || 0) - (b.sortDate || 0)), [otherActivities, richComments]);

  const hasOlderActivities = combined.length > visibleActivityCount;
  const olderActivitiesCount = Math.max(0, combined.length - visibleActivityCount);

  const paginatedCombined = useMemo(() => {
    if (combined.length <= visibleActivityCount) return combined;
    return combined.slice(combined.length - visibleActivityCount);
  }, [combined, visibleActivityCount]);

  const isTargetingComment = Boolean(targetCommentId || targetCommentText || scrollToComments);
  const targetKey = `${targetCommentId || ''}_${targetCommentText ? targetCommentText.slice(0, 30) : ''}_${scrollToComments ? '1' : '0'}`;
  const lastTargetKeyRef = useRef('');
  const hasScrolledToTargetRef = useRef(false);

  useEffect(() => {
    if (targetKey !== lastTargetKeyRef.current) {
      lastTargetKeyRef.current = targetKey;
      hasScrolledToTargetRef.current = false;
    }
  }, [targetKey]);

  // If a target comment is older than visibleActivityCount, expand visibleActivityCount so it is rendered
  useEffect(() => {
    if ((targetCommentId || targetCommentText) && combined.length > visibleActivityCount) {
      const idx = combined.findIndex((item) => {
        if (targetCommentId && (item.id === targetCommentId || item.commentId === targetCommentId)) return true;
        if (targetCommentText) {
          const itemText = (item.text || item.content || '').toLowerCase();
          const cleanSnippet = targetCommentText.trim().toLowerCase().slice(0, 30);
          if (cleanSnippet && itemText.includes(cleanSnippet)) return true;
        }
        return false;
      });
      if (idx !== -1 && idx < combined.length - visibleActivityCount) {
        setVisibleActivityCount(combined.length);
      }
    }
  }, [targetCommentId, targetCommentText, combined, visibleActivityCount]);

  const scrollToLatestComment = useCallback(() => {
    const scroll = () => {
      if (activityScrollRef.current) {
        activityScrollRef.current.scrollTop = activityScrollRef.current.scrollHeight;
      }
    };
    scroll();
    requestAnimationFrame(scroll);
    setTimeout(scroll, 50);
    setTimeout(scroll, 150);
  }, []);

  const scrollToTargetComment = useCallback(() => {
    if (hasScrolledToTargetRef.current) return true;
    const container = activityScrollRef.current;
    if (!container) return false;

    let targetEl: HTMLElement | null = null;
    if (targetCommentId) {
      targetEl =
        document.getElementById(`comment-${targetCommentId}`) ||
        (container.querySelector(`[data-comment-id="${targetCommentId}"]`) as HTMLElement | null);
    }
    if (!targetEl && targetCommentText) {
      const lines = targetCommentText
        .split('\n')
        .map(l => l.trim().toLowerCase())
        .filter(l => l.length >= 15 && !l.includes('📅') && !l.includes('🖊') && !l.startsWith('status:') && !l.startsWith('resources:'));
      
      const snippet = (lines[0] || targetCommentText.trim().toLowerCase()).slice(0, 50);
      if (snippet) {
        const commentEls = Array.from(container.querySelectorAll<HTMLElement>('.group\\/comment')).reverse();
        for (const el of commentEls) {
          const txt = el.textContent?.toLowerCase() || '';
          if (txt.includes(snippet) || (lines.length > 1 && lines.some(line => line.length >= 20 && txt.includes(line.slice(0, 40))))) {
            targetEl = el;
            break;
          }
        }
      }
    }

    if (targetEl) {
      hasScrolledToTargetRef.current = true;
      const containerRect = container.getBoundingClientRect();
      const elRect = targetEl.getBoundingClientRect();
      const relativeTop = elRect.top - containerRect.top + container.scrollTop - 14;
      container.scrollTo({ top: Math.max(0, relativeTop), behavior: 'smooth' });

      // Clear any existing rings across all comments first so only ONE comment is highlighted
      container.querySelectorAll('.ring-indigo-500\\/80').forEach(el => {
        el.classList.remove('ring-2', 'ring-indigo-500/80');
      });

      targetEl.classList.add('ring-2', 'ring-indigo-500/80', 'transition-all', 'duration-500');
      setTimeout(() => {
        targetEl?.classList.remove('ring-2', 'ring-indigo-500/80');
      }, 3000);
      return true;
    }

    // Only if pure scrollToComments was requested without a specific target, scroll to latest
    if (!targetCommentId && !targetCommentText && scrollToComments) {
      hasScrolledToTargetRef.current = true;
      scrollToLatestComment();
      return true;
    }

    return false;
  }, [targetCommentId, targetCommentText, scrollToComments, scrollToLatestComment]);

  const hasScrolledInitiallyRef = useRef(false);
  useEffect(() => {
    hasScrolledInitiallyRef.current = false;
  }, [subtask?.id]);

  useEffect(() => {
    if (isTargetingComment) {
      if (hasScrolledToTargetRef.current) return;
      if (activities.length > 0 || richComments.length > 0) {
        let attempts = 0;
        const tryScroll = () => {
          if (hasScrolledToTargetRef.current) return;
          attempts++;
          const found = scrollToTargetComment();
          if (!found && attempts < 10) {
            setTimeout(tryScroll, 120);
          }
        };
        requestAnimationFrame(() => {
          setTimeout(tryScroll, 60);
        });
      }
    } else if (!hasScrolledInitiallyRef.current && (activities.length > 0 || richComments.length > 0)) {
      hasScrolledInitiallyRef.current = true;
      scrollToLatestComment();
    }
  }, [activities, richComments, isTargetingComment, scrollToTargetComment, scrollToLatestComment]);

  const loadOlderActivities = useCallback(() => {
    if (!hasOlderActivities || isLoadingOlderActivities) return;
    const container = activityScrollRef.current;
    if (!container) return;

    setIsLoadingOlderActivities(true);
    const prevScrollHeight = container.scrollHeight;
    const prevScrollTop = container.scrollTop;

    setTimeout(() => {
      setVisibleActivityCount(prev => Math.min(combined.length, prev + ACTIVITY_BATCH_SIZE));
      setIsLoadingOlderActivities(false);

      requestAnimationFrame(() => {
        if (activityScrollRef.current) {
          const newScrollHeight = activityScrollRef.current.scrollHeight;
          activityScrollRef.current.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        }
      });
    }, 120);
  }, [hasOlderActivities, isLoadingOlderActivities, combined.length]);

  const handleActivityScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop } = e.currentTarget;
    if (scrollTop < 60 && hasOlderActivities && !isLoadingOlderActivities) {
      loadOlderActivities();
    }
  }, [hasOlderActivities, isLoadingOlderActivities, loadOlderActivities]);

  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [expandedBlocks, setExpandedBlocks] = useState<(string | number)[]>([]);
  const [isRoleOpen, setIsRoleOpen] = useState(false);
  const [isAssigneeOpen, setIsAssigneeOpen] = useState(false);
  const roleToAssigneeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (roleToAssigneeTimeoutRef.current) {
        clearTimeout(roleToAssigneeTimeoutRef.current);
      }
    };
  }, []);
  const [isPriorityOpen, setIsPriorityOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [isUploadingInline, setIsUploadingInline] = useState(false);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const commentEditorRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ActionErrorInfo | null>(null);
  
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const descContentRef = useRef<HTMLDivElement>(null);
  const [isDescOverflowing, setIsDescOverflowing] = useState(false);

  useEffect(() => {
    const checkOverflow = () => {
      if (descContentRef.current) {
        setIsDescOverflowing(descContentRef.current.scrollHeight > 160);
      }
    };
    checkOverflow();
    const observer = new ResizeObserver(checkOverflow);
    if (descContentRef.current) {
      observer.observe(descContentRef.current);
      if (descContentRef.current.firstElementChild) {
        observer.observe(descContentRef.current.firstElementChild);
      }
    }
    return () => observer.disconnect();
  }, [localDesc, isDescExpanded]);

  const createMarkdownComponents = useCallback((isReply = false) => ({
    a: (props: any) => {
      const { node, ...rest } = props;
      const href = rest.href || '';
      if (href.match(/\.(mp4|webm|ogg|mov)$/i)) {
        return <LazyMarkdownVideo src={href} onPreview={setLightboxImage} />;
      }
      if (href.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
        return <LazyMarkdownImage src={href} alt="attachment" onPreview={setLightboxImage} isReply={isReply} />;
      }
      if (href.startsWith('mention://')) {
        const userId = href.replace('mention://', '');
        return <UserMentionChip userId={userId}>{rest.children}</UserMentionChip>;
      }
      const nexus = parseNexusTaskLink(href);
      if (nexus) {
        return (
          <TaskMentionChip
            taskId={nexus.taskId}
            mentionType={nexus.isSubtask ? 'subtask' : 'task'}
            parentTaskId={nexus.subtaskId ? (parentTask?.id || nexus.taskId) : undefined}
            initialLabel={typeof rest.children === 'string' && !rest.children.startsWith('http') ? rest.children : undefined}
          />
        );
      }
      if (isAttachmentUrl(href, typeof rest.children === 'string' ? rest.children : undefined)) {
        return (
          <CommentAttachmentCard
            href={href}
            fileName={typeof rest.children === 'string' ? rest.children : undefined}
          />
        );
      }
      return (
        <LinkWithPreview
          {...rest}
          href={normalizeHref(href)}
          className="text-blue-400 hover:bg-blue-500/15 hover:text-blue-300 rounded-sm transition-colors"
          onClick={(e) => { e.stopPropagation(); }}
        >
          {rest.children}
        </LinkWithPreview>
      );
    },
    span: (props: any) => {
      const { node, ...rest } = props;
      const dataType = rest['data-type'] || (node?.properties as any)?.dataType;
      if (dataType === 'mention') {
        const taskId = rest['data-id'] || (node?.properties as any)?.dataId;
        const mentionType = rest['data-mention-type'] || (node?.properties as any)?.dataMentionType || 'task';
        const label = rest['data-label'] || (node?.properties as any)?.dataLabel || '';
        if (taskId) {
          return (
            <TaskMentionChip
              taskId={taskId}
              mentionType={mentionType}
              initialLabel={label}
              attrs={rest}
            />
          );
        }
      }
      return <span {...rest} />;
    },
    img: (props: any) => {
      const { node, ...rest } = props;
      return <LazyMarkdownImage src={rest.src} alt={rest.alt || "attachment"} onPreview={setLightboxImage} isReply={isReply} />;
    }
  }), [parentTask?.id]);

  const markdownComponents = React.useMemo(() => createMarkdownComponents(false), [createMarkdownComponents]);
  const replyMarkdownComponents = React.useMemo(() => createMarkdownComponents(true), [createMarkdownComponents]);
  const editorRef = useRef<any>(null);
  const activityPanelRef = useRef<HTMLDivElement>(null);
  // Task edits are open to all
  const canEditTask = true;
  // Only Project Managers and Admins can set Team Role and Assignees
  const canAssignTask = useCanSetAssignees();
  const assignDeniedMessage = useAssignDeniedMessage();
  // Locked triggers stay clickable so the user is told why; preventDefault stops Radix opening the popover
  const blockIfCannotAssign = (e: React.MouseEvent) => {
    if (canAssignTask) return;
    e.preventDefault();
    toast.error(assignDeniedMessage);
  };
  const hasTeamRole = Boolean(localRoleRestrictions && localRoleRestrictions.length > 0);
  const canAssignMember = canAssignTask && hasTeamRole;

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
          const updatedSubtask = { ...subtaskRef.current, attachments: [...(subtaskRef.current.attachments || []), attachment] };
          syncSubtaskToParent(updatedSubtask);
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

  const [activityWidth, setActivityWidth] = useState(mode === 'full' ? 450 : 380);
  const isResizingRef = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(300);
  const subtaskActivityPanelRef = useRef<HTMLDivElement>(null);
  const [isCheckLocked, setIsCheckLocked] = useState(false);

  const handleStatusChangeAction = async (newStatus: string) => {
    if (!subtask || isSubmittingStatus) return;

    const currentSubtask = subtaskRef.current || subtask;
    const transitionCheck = canTransitionTaskStatus(currentSubtask, newStatus);
    if (!transitionCheck.allowed) {
      window.dispatchEvent(new CustomEvent('task:highlight-audits', {
        detail: {
          taskId: parentTask.id,
          subtaskId: subtask.id,
          targetStatus: newStatus,
          uncheckedAudits: transitionCheck.uncheckedAudits,
          openSubtasks: transitionCheck.openSubtasks,
        }
      }));
      toast.error(transitionCheck.reason || `Cannot move task to ${newStatus}`);
      return;
    }

    const oldStatus = localStatus;
    const oldCompleted = localCompleted;
    const isCompleted = newStatus.toLowerCase() === 'closed' || newStatus.toLowerCase() === 'done' || newStatus.toLowerCase() === 'completed';

    // 1. Instantly update local state
    lastStatusUpdateTimestampRef.current = Date.now();
    setLocalStatus(newStatus);
    setLocalCompleted(isCompleted);

    let updatedChecklists = currentSubtask.checklists || [];
    if (newStatus.toLowerCase() === 'revision') {
      updatedChecklists = updatedChecklists.map((c: any) => {
        if (isNexusAuditChecklist(c)) {
          return {
            ...c,
            items: c.items?.map((i: any) => ({ ...i, completed: false })) || []
          };
        }
        return c;
      });
    }

    const updatedSubtask = {
      ...currentSubtask,
      status: newStatus,
      completed: isCompleted,
      checklists: updatedChecklists
    };

    // 2. Instantly append optimistic activity to local subtask feed
    const optimisticId = `optimistic-status-${Date.now()}`;
    const optimisticActivity = {
      id: optimisticId,
      type: 'status_change',
      author: currentUser?.name || 'Someone',
      oldStatus,
      newStatus,
      date: new Date().toISOString(),
      user: currentUser,
      subtaskTitle: subtask.title,
    };
    setActivities(prev => [...prev, optimisticActivity]);

    // 3. Instantly update parent task, app store, and broadcast real-time event
    syncSubtaskToParent(updatedSubtask);

    // 4. Background DB update
    setIsSubmittingStatus(true);
    try {
      const res = await tasksApi.updateSubtask(parentTask.id, subtask.id, {
        status: newStatus,
        completed: isCompleted
      });
      if (res?.activity) {
        setActivities(prev => prev.map(a => a.id === optimisticId ? res.activity : a));
      }
    } catch (err: any) {
      console.error('Failed to update subtask status', err);
      // Revert optimistic updates on error
      setLocalStatus(oldStatus);
      setLocalCompleted(oldCompleted);
      setActivities(prev => prev.filter(a => a.id !== optimisticId));
      syncSubtaskToParent(currentSubtask);
      const errMsg = err?.response?.data?.error || err?.message || 'Failed to update subtask status';
      const statusCode = err?.response?.status;
      toast.error(errMsg);
      setActionError({
        title: 'Failed to Update Subtask Status',
        action: `Moving subtask "${subtask.title}" to status "${newStatus}"`,
        message: errMsg,
        statusCode,
        technicalDetails: typeof err === 'object' ? JSON.stringify(err.response?.data || err, null, 2) : String(err),
        context: {
          subtaskId: subtask.id,
          subtaskTitle: subtask.title,
          parentTaskId: parentTask.id,
          targetStatus: newStatus,
          previousStatus: oldStatus,
        },
        troubleshooting: [
          'Verify whether subtask audits or checklists must be completed first.',
          'Verify your connection to the server.',
          'If mapped to ClickUp/n8n: verify whether ClickUp subtask status allows this transition.'
        ],
        onRetry: () => handleStatusChangeAction(newStatus),
      });
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = resizeStartX.current - e.clientX;
      const newWidth = resizeStartWidth.current + delta;
      if (newWidth > 240 && newWidth < 700) {
        if (subtaskActivityPanelRef.current) {
          subtaskActivityPanelRef.current.style.width = `${newWidth}px`;
        }
      }
    };
        const handleMouseUp = () => {
      if (subtaskActivityPanelRef.current) {
        const currentWidth = parseInt(subtaskActivityPanelRef.current.style.width, 10);
        if (!isNaN(currentWidth)) {
          setActivityWidth(currentWidth);
        }
      }
      isResizingRef.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = activityWidth;
    isResizingRef.current = true; document.body.style.cursor = 'col-resize';
  };

  useEffect(() => {
    if (!isLocalEditing) {
      setLocalDesc(subtask.description || '');
    }
    if (!isEditingTitle) {
      setLocalTitle(subtask.title || '');
    }
  }, [subtask.description, subtask.title, isLocalEditing, isEditingTitle]);

  useEffect(() => {
    if (!socket || !subtask?.id) return;

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

    const handleActivity = (data: any) => {
      const currentSubtask = subtaskRef.current;
      const currentParentTask = parentTaskRef.current;

      const isForThisSubtask =
        data.taskId === currentParentTask?.id &&
        (data.activity?.subtaskId === currentSubtask?.id ||
          (data.activity?.subtaskTitle && currentSubtask?.title &&
            data.activity.subtaskTitle.toLowerCase() === currentSubtask.title.toLowerCase()));

      if (isForThisSubtask) {
        setActivities(prev => mergeIncomingActivity(prev, data.activity));

        if (data.activity.type === 'status_change' && data.activity.newStatus) {
          if (Date.now() - lastStatusUpdateTimestampRef.current > 1500) {
            setLocalStatus(data.activity.newStatus);
            setLocalCompleted(data.activity.newStatus.toLowerCase() === 'closed' || data.activity.newStatus.toLowerCase() === 'done' || data.activity.newStatus.toLowerCase() === 'completed');
          }
          if (currentSubtask.status !== data.activity.newStatus) {
            const updatedSubtask = {
              ...currentSubtask,
              status: data.activity.newStatus,
              completed: data.activity.newStatus.toLowerCase() === 'closed' || data.activity.newStatus.toLowerCase() === 'done' || data.activity.newStatus.toLowerCase() === 'completed'
            };
            syncSubtaskToParent(updatedSubtask);
          }
        }
        if (data.activity.type === 'priority_change' && data.activity.newPriority) {
          if (currentSubtask.priority !== data.activity.newPriority) {
            const updatedSubtask = { ...currentSubtask, priority: data.activity.newPriority };
            syncSubtaskToParent(updatedSubtask);
          }
        }
      }
    };

    const handleCommentAdded = (payload: { taskId: string; comment: any; subtaskId?: string }) => {
      const currentParentTask = parentTaskRef.current;
      const currentSubtask = subtaskRef.current;
      if (!currentParentTask || !currentSubtask) return;
      if (payload.taskId !== currentParentTask.id) return;
      if (payload.subtaskId !== currentSubtask.id) return;

      setRichComments(prev => {
        if (payload.comment.parentCommentId) {
          return prev.map(c => {
            if (c.id === payload.comment.parentCommentId) {
              const replies = c.replies || [];
              if (replies.some((r: any) => r.id === payload.comment.id)) return c;
              const tempIdx = replies.findIndex((r: any) =>
                typeof r.id === 'string' && r.id.startsWith('temp-') && r.content === payload.comment.content
              );
              if (tempIdx !== -1) {
                const nextReplies = [...replies];
                nextReplies[tempIdx] = payload.comment;
                return { ...c, replies: nextReplies, replyCount: nextReplies.length };
              }
              const nextReplies = [...replies, payload.comment];
              return { ...c, replies: nextReplies, replyCount: nextReplies.length };
            }
            return c;
          });
        }

        if (prev.some(c => c.id === payload.comment.id)) return prev;
        const tempIdx = prev.findIndex(c =>
          typeof c.id === 'string' && c.id.startsWith('temp-') &&
          c.content === payload.comment.content
        );
        if (tempIdx !== -1) {
          const updated = [...prev];
          updated[tempIdx] = payload.comment;
          return updated;
        }
        const nextComments = [...prev, payload.comment];
        const currentSubtask = subtaskRef.current;
        if (currentSubtask) {
          const cacheKey = `subtask:${currentSubtask.id}`;
          const cached = activityCache.get(cacheKey);
          if (cached?.comments && !cached.comments.some((c: any) => c.id === payload.comment.id)) {
            cached.comments = [...cached.comments, payload.comment];
          }
        }
        return nextComments;
      });
    };

    const handleCommentUpdated = (payload: { taskId: string; comment: any }) => {
      const currentParentTask = parentTaskRef.current;
      if (!currentParentTask || payload.taskId !== currentParentTask.id) return;
      setRichComments(prev =>
        prev.map(c => {
          if (c.id === payload.comment.id) return { ...c, ...payload.comment };
          return {
            ...c,
            replies: c.replies?.map((r: any) => r.id === payload.comment.id ? { ...r, ...payload.comment } : r)
          };
        })
      );
      const currentSubtask = subtaskRef.current;
      if (currentSubtask) {
        const cacheKey = `subtask:${currentSubtask.id}`;
        const cached = activityCache.get(cacheKey);
        if (cached?.comments) {
          cached.comments = cached.comments.map((c: any) => {
            if (c.id === payload.comment.id) return { ...c, ...payload.comment };
            return {
              ...c,
              replies: c.replies?.map((r: any) => r.id === payload.comment.id ? { ...r, ...payload.comment } : r)
            };
          });
        }
      }
    };

    const handleCommentDeleted = (payload: { taskId: string; commentId: string }) => {
      const currentParentTask = parentTaskRef.current;
      if (!currentParentTask || payload.taskId !== currentParentTask.id) return;
      setRichComments(prev =>
        prev.filter(c => c.id !== payload.commentId).map(c => ({
          ...c,
          replies: c.replies?.filter((r: any) => r.id !== payload.commentId)
        }))
      );
      const currentSubtask = subtaskRef.current;
      if (currentSubtask) {
        const cacheKey = `subtask:${currentSubtask.id}`;
        const cached = activityCache.get(cacheKey);
        if (cached?.comments) {
          cached.comments = cached.comments.filter((c: any) => c.id !== payload.commentId);
        }
      }
    };

    const handleChecklistCreated = (payload: { taskId: string; subtaskId?: string | null; checklist: any }) => {
      const currentSub = subtaskRef.current;
      if (!currentSub || payload.subtaskId !== currentSub.id || !payload.checklist) return;
      if ((currentSub.checklists || []).some((c: any) => c.id === payload.checklist.id)) return;
      const checklists = [...(currentSub.checklists || []), payload.checklist];
      syncSubtaskToParent({ ...currentSub, checklists });
    };

    const handleChecklistItemUpdated = (payload: { taskId: string; subtaskId?: string | null; checklistId: string; item: any }) => {
      const currentSub = subtaskRef.current;
      if (!currentSub || payload.subtaskId !== currentSub.id || !payload.item) return;

      const checklists = (currentSub.checklists || []).map((c: any) => {
        if (c.id === payload.checklistId || (isNexusAuditChecklist(c) && (payload.item?.text?.startsWith('!') || ['instructions audit','design audit','ui ux audit','funnel audit'].includes(normalizeAuditName((payload.item?.text || '').replace(/^!\s*/, '')))))) {
          const hasItem = (c.items || []).some((i: any) => i.id === payload.item.id || (typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text));
          if (hasItem) {
            const items = (c.items || []).map((i: any) =>
              (i.id === payload.item.id || (typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text))
                ? { ...i, ...payload.item }
                : i
            );
            return { ...c, items };
          } else {
            return { ...c, items: [...(c.items || []), payload.item] };
          }
        }
        return c;
      });
      syncSubtaskToParent({ ...currentSub, checklists });
    };

    const handleChecklistItemCreated = (payload: { taskId: string; subtaskId?: string | null; checklistId: string; item: any }) => {
      const currentSub = subtaskRef.current;
      if (!currentSub || payload.subtaskId !== currentSub.id || !payload.item) return;

      let found = false;
      const checklists = (currentSub.checklists || []).map((c: any) => {
        if (c.id === payload.checklistId || (isNexusAuditChecklist(c) && (payload.item?.text?.startsWith('!') || ['instructions audit','design audit','ui ux audit','funnel audit'].includes(normalizeAuditName((payload.item?.text || '').replace(/^!\s*/, '')))))) {
          found = true;
          if ((c.items || []).some((i: any) => i.id === payload.item.id)) return c;
          const tempIdx = (c.items || []).findIndex((i: any) => typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text);
          if (tempIdx !== -1) {
            const newItems = [...c.items];
            newItems[tempIdx] = payload.item;
            return { ...c, items: newItems };
          }
          return { ...c, items: [...(c.items || []), payload.item] };
        }
        return c;
      });
      const isAudit = (payload.item?.text?.startsWith('!') || ['instructions audit','design audit','ui ux audit','funnel audit'].includes(normalizeAuditName((payload.item?.text || '').replace(/^!\s*/, ''))));
      const finalChecklists = found ? checklists : [
        ...(currentSub.checklists || []),
        {
          id: payload.checklistId,
          taskId: parentTask.id,
          subtaskId: currentSub.id,
          name: isAudit ? 'Audit' : 'Checklist',
          createdAt: new Date().toISOString(),
          items: [payload.item],
        }
      ];
      syncSubtaskToParent({ ...currentSub, checklists: finalChecklists });
    };

    const handleChecklistItemDeleted = (payload: { taskId: string; subtaskId?: string | null; checklistId: string; itemId: string; text?: string }) => {
      const currentSub = subtaskRef.current;
      if (!currentSub || payload.subtaskId !== currentSub.id) return;

      const checklists = (currentSub.checklists || []).map((c: any) => {
        if (c.id === payload.checklistId || isNexusAuditChecklist(c)) {
          const items = (c.items || []).filter((i: any) => {
            if (i.id === payload.itemId) return false;
            if (payload.text && i.text === payload.text) return false;
            return true;
          });
          return { ...c, items };
        }
        return c;
      });
      syncSubtaskToParent({ ...currentSub, checklists });
    };

    const handleChecklistDeleted = (payload: { taskId: string; subtaskId?: string | null; checklistId: string }) => {
      const currentSub = subtaskRef.current;
      if (!currentSub || payload.subtaskId !== currentSub.id) return;

      const checklists = (currentSub.checklists || []).filter((c: any) => c.id !== payload.checklistId);
      syncSubtaskToParent({ ...currentSub, checklists });
    };

    socket.on('task_editing_start', handleEditingStart);
    socket.on('task_editing_stop', handleEditingStop);
    socket.on('task_editing_content', handleEditingContent);
    socket.on('task_activity', handleActivity);
    socket.on('task:comment_added', handleCommentAdded);
    socket.on('task:comment_updated', handleCommentUpdated);
    socket.on('task:comment_deleted', handleCommentDeleted);
    socket.on('task:checklist_created', handleChecklistCreated);
    socket.on('task:checklist_item_updated', handleChecklistItemUpdated);
    socket.on('task:checklist_item_created', handleChecklistItemCreated);
    socket.on('task:checklist_item_deleted', handleChecklistItemDeleted);
    socket.on('task:checklist_deleted', handleChecklistDeleted);

    return () => {
      socket.off('task_editing_start', handleEditingStart);
      socket.off('task_editing_stop', handleEditingStop);
      socket.off('task_editing_content', handleEditingContent);
      socket.off('task_activity', handleActivity);
      socket.off('task:comment_added', handleCommentAdded);
      socket.off('task:comment_updated', handleCommentUpdated);
      socket.off('task:comment_deleted', handleCommentDeleted);
      socket.off('task:checklist_created', handleChecklistCreated);
      socket.off('task:checklist_item_updated', handleChecklistItemUpdated);
      socket.off('task:checklist_item_created', handleChecklistItemCreated);
      socket.off('task:checklist_item_deleted', handleChecklistItemDeleted);
      socket.off('task:checklist_deleted', handleChecklistDeleted);
    };
  }, [socket, subtask?.id, currentUser?.name, parentTask.id, syncSubtaskToParent]);

  const [localAssignees, setLocalAssignees] = useState<any[]>(() => {
    return subtask.assignees || (subtask.User ? [subtask.User] : (subtask.assignee ? [subtask.assignee] : []));
  });

  const currentAssignees = localAssignees;
  const isUserAssigned = (userId: string) => currentAssignees.some((u: any) => u.id === userId);

  const assigneeBaselineRef = useRef<any[] | null>(null);
  const latestAssigneesRef = useRef<any[]>(currentAssignees);
  const lastAssigneeUpdateTimestampRef = useRef<number>(0);

  useEffect(() => {
    if (Date.now() - lastAssigneeUpdateTimestampRef.current > 1500) {
      const fromProps = subtask.assignees || (subtask.User ? [subtask.User] : (subtask.assignee ? [subtask.assignee] : []));
      setLocalAssignees(fromProps);
      latestAssigneesRef.current = fromProps;
    }
  }, [subtask.assignees, subtask.User, subtask.assignee]);

  // Comprehensive cross-client and window real-time sync for subtask
  useEffect(() => {
    const handleWindowTaskUpdated = (e: any) => {
      const incoming = e.detail?.task;
      if (!incoming) return;
      let targetSubtask = null;
      if (incoming.id === subtask.id) {
        targetSubtask = incoming;
      } else if (incoming.subtasks) {
        targetSubtask = incoming.subtasks.find((s: any) => s.id === subtask.id);
      }
      if (targetSubtask) {
        if (Date.now() - lastAssigneeUpdateTimestampRef.current > 1500) {
          const fromProps = targetSubtask.assignees || (targetSubtask.User ? [targetSubtask.User] : (targetSubtask.assignee ? [targetSubtask.assignee] : []));
          setLocalAssignees(fromProps);
          latestAssigneesRef.current = fromProps;
        }
        if (Date.now() - lastRoleUpdateTimestampRef.current > 1500) {
          if (targetSubtask.assigneeRoleRestrictions !== undefined) {
            setLocalRoleRestrictions(targetSubtask.assigneeRoleRestrictions);
            latestRoleRestrictionsRef.current = targetSubtask.assigneeRoleRestrictions;
          }
        }
        if (Date.now() - lastStatusUpdateTimestampRef.current > 1500 && targetSubtask.status !== undefined) {
          setLocalStatus(targetSubtask.status);
          const isDone = targetSubtask.status.toLowerCase() === 'closed' || targetSubtask.status.toLowerCase() === 'done' || targetSubtask.status.toLowerCase() === 'completed';
          setLocalCompleted(isDone || !!targetSubtask.completed);
        }
        if (!isEditingTitle && targetSubtask.title !== undefined) {
          setLocalTitle(targetSubtask.title);
        }
        if (!isLocalEditing && targetSubtask.description !== undefined) {
          setLocalDesc(targetSubtask.description || '');
        }
        const mergedSubtask = {
          ...subtaskRef.current,
          ...targetSubtask,
        };
        subtaskRef.current = mergedSubtask;
        if (setActiveSubtask) {
          setActiveSubtask(mergedSubtask);
        }
      }
      if (incoming.id === parentTask.id) {
        parentTaskRef.current = { ...parentTaskRef.current, ...incoming };
      }
    };
    window.addEventListener('task:updated', handleWindowTaskUpdated);
    return () => window.removeEventListener('task:updated', handleWindowTaskUpdated);
  }, [subtask.id, isEditingTitle, isLocalEditing, setActiveSubtask, parentTask.id]);

  useEffect(() => {
    const handleWindowSubtaskActivity = (e: any) => {
      const data = e.detail;
      const currentSubtask = subtaskRef.current;
      const currentParentTask = parentTaskRef.current;
      if (!data || !currentSubtask || !currentParentTask) return;
      const isForThisSubtask =
        data.taskId === currentParentTask?.id &&
        (data.activity?.subtaskId === currentSubtask?.id ||
          (data.activity?.subtaskTitle && currentSubtask?.title &&
            data.activity.subtaskTitle.toLowerCase() === currentSubtask.title.toLowerCase()));

      if (isForThisSubtask && data.activity?.type === 'status_change' && data.activity?.newStatus) {
        if (Date.now() - lastStatusUpdateTimestampRef.current > 1500) {
          setLocalStatus(data.activity.newStatus);
          setLocalCompleted(data.activity.newStatus.toLowerCase() === 'closed' || data.activity.newStatus.toLowerCase() === 'done' || data.activity.newStatus.toLowerCase() === 'completed');
        }
        if (currentSubtask.status !== data.activity.newStatus) {
          const updatedSubtask = {
            ...currentSubtask,
            status: data.activity.newStatus,
            completed: data.activity.newStatus.toLowerCase() === 'closed' || data.activity.newStatus.toLowerCase() === 'done' || data.activity.newStatus.toLowerCase() === 'completed'
          };
          syncSubtaskToParent(updatedSubtask);
        }
      }
    };
    window.addEventListener('task_activity', handleWindowSubtaskActivity);
    return () => window.removeEventListener('task_activity', handleWindowSubtaskActivity);
  }, [subtask?.id]);

  const applyAssigneesLocally = (updatedAssignees: any[]) => {
    lastAssigneeUpdateTimestampRef.current = Date.now();
    latestAssigneesRef.current = updatedAssignees;
    setLocalAssignees(updatedAssignees);
    subtask.assignees = updatedAssignees;
    subtask.assigneeIds = updatedAssignees.map((a: any) => a.id);
    const updatedSubtask = { ...subtaskRef.current, assignees: updatedAssignees, assigneeIds: updatedAssignees.map((a: any) => a.id) };
    syncSubtaskToParent(updatedSubtask);
  };

  const persistAssignees = (previous: any[], next: any[]) => {
    const added = next.filter(u => !previous.some(p => p.id === u.id)).map(u => u.name);
    const removed = previous.filter(p => !next.some(u => u.id === p.id)).map(p => p.name);
    if (added.length === 0 && removed.length === 0) return; // toggled on and off again

    const optimisticId = `optimistic-assign-${Date.now()}`;
    setActivities(prev => [...prev, {
      id: optimisticId,
      type: 'assignment',
      author: currentUser?.name || 'Someone',
      assigneeName: next.length > 0 ? next.map(u => u.name).join(', ') : 'Unassigned',
      assignees: next.map(u => u.name),
      added,
      removed,
      date: new Date(),
      user: currentUser,
    }]);

    tasksApi.updateSubtask(parentTask.id, subtask.id, { assigneeIds: next.map(u => u.id) }).then(() => {
      lastAssigneeUpdateTimestampRef.current = Date.now();
    }).catch((err) => {
      console.error(err);
      setActivities(prev => prev.filter(a => a.id !== optimisticId));
    });
  };

  const handleToggleAssignee = (u: any) => {
    const latest = latestAssigneesRef.current;
    if (!assigneeBaselineRef.current) assigneeBaselineRef.current = latest;
    const updatedAssignees = latest.some((a: any) => a.id === u.id)
      ? latest.filter((a: any) => a.id !== u.id)
      : [...latest, u];
    applyAssigneesLocally(updatedAssignees);

    const previous = assigneeBaselineRef.current || [];
    assigneeBaselineRef.current = null;
    persistAssignees(previous, updatedAssignees);
  };

  const handleClearAllAssignees = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const previous = assigneeBaselineRef.current || latestAssigneesRef.current;
    assigneeBaselineRef.current = null;
    applyAssigneesLocally([]);
    persistAssignees(previous, []);
    setIsAssigneeOpen(false);
  };

  const handleSelectAllRoleAssignees = () => {
    if (!subtask) return;
    const allSelected = subtaskAssignableUsers.length > 0 && subtaskAssignableUsers.every((u: any) => isUserAssigned(u.id));

    let updatedAssignees: any[];
    if (allSelected) {
      updatedAssignees = (latestAssigneesRef.current || []).filter((u: any) => !subtaskAssignableUsers.some((au: any) => au.id === u.id));
    } else {
      const map = new Map<string, any>();
      (latestAssigneesRef.current || []).forEach((u: any) => map.set(u.id, u));
      subtaskAssignableUsers.forEach((u: any) => map.set(u.id, u));
      updatedAssignees = Array.from(map.values());
    }

    const previous = assigneeBaselineRef.current || latestAssigneesRef.current;
    assigneeBaselineRef.current = null;
    applyAssigneesLocally(updatedAssignees);
    persistAssignees(previous, updatedAssignees);
  };

  const handleApplySubtaskRoleRestrictions = (next: string[], transitionToAssignee = true) => {
    const matchingUsers = resolveUsersFromRoleRestrictions(next, workspaceUsers || [], workspaceTeams || []);
    const currentAssigneesList = latestAssigneesRef.current || [];
    const validAssignees = next.length > 0
      ? currentAssigneesList.filter((u: any) => matchingUsers.some((m: any) => m.id === u.id))
      : currentAssigneesList;
    const validIds = validAssignees.map((u: any) => u.id);
    const primaryAssignee = validAssignees.length > 0 ? validAssignees[0] : null;

    latestRoleRestrictionsRef.current = next;
    setLocalRoleRestrictions(next);
    lastRoleUpdateTimestampRef.current = Date.now();

    latestAssigneesRef.current = validAssignees;
    setLocalAssignees(validAssignees);
    lastAssigneeUpdateTimestampRef.current = Date.now();

    subtask.assigneeRoleRestrictions = next;
    subtask.assignees = validAssignees;
    subtask.assigneeIds = validIds;
    subtask.assignee = primaryAssignee;
    subtask.assigneeId = primaryAssignee?.id || null;

    const updatedSubtask = {
      ...subtaskRef.current,
      assigneeRoleRestrictions: next,
      assignees: validAssignees,
      assigneeIds: validIds,
      assignee: primaryAssignee,
      assigneeId: primaryAssignee?.id || null,
    };
    syncSubtaskToParent(updatedSubtask);

    tasksApi.updateSubtask(parentTask.id, subtask.id, { assigneeRoleRestrictions: next, assigneeIds: validIds } as any)
      .catch((err: any) => {
        console.error("Failed to update subtask role restriction", err);
      });

    if (transitionToAssignee) {
      setIsRoleOpen(false);

      if (roleToAssigneeTimeoutRef.current) {
        clearTimeout(roleToAssigneeTimeoutRef.current);
      }

      if (next.length > 0) {
        roleToAssigneeTimeoutRef.current = setTimeout(() => {
          setIsAssigneeOpen(true);
        }, 220);
      }
    }
  };

  const handleUpdatePriority = (newPriority: string | null) => {
    const updatedSubtask = { ...subtaskRef.current, priority: newPriority };
    syncSubtaskToParent(updatedSubtask);
    tasksApi.updateSubtask(parentTask.id, subtask.id, { priority: newPriority } as any).catch(console.error);
    setIsPriorityOpen(false);
  };

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

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const commentsBootstrappedRef = useRef<string | null>(null);

  // ── Reset subtask activities and comments immediately when active subtask changes ──
  useEffect(() => {
    if (!subtask?.id) {
      setActivities([]);
      setRichComments([]);
      return;
    }
    const cacheKey = `subtask:${subtask.id}`;
    const cached = activityCache.get(cacheKey);
    const cacheAge = cached ? Date.now() - cached.timestamp : Infinity;
    if (cached && cacheAge < ACTIVITY_CACHE_TTL_MS) {
      setActivities(cached.activities);
      setRichComments(cached.comments);
      setLoadingActivities(false);
    } else {
      setActivities([]);
      setRichComments([]);
      setLoadingActivities(true);
    }
  }, [subtask?.id]);

  const loadActivities = useCallback(async (silent = false) => {
    if (!subtask?.id || !parentTask?.id) return;
    const currentSubtaskId = subtask.id;
    try {
      const cacheKey = `subtask:${subtask.id}`;
      const cached = activityCache.get(cacheKey);
      const cacheAge = cached ? Date.now() - cached.timestamp : Infinity;
      const cacheValid = cacheAge < ACTIVITY_CACHE_TTL_MS;

      if (cached && cacheValid) {
        // Serve cached data right away — zero skeleton flicker
        setActivities(cached.activities);
        setRichComments(cached.comments);
        setLoadingActivities(false);
      } else {
        // Only show skeleton on first load if we don't already have activities or comments
        if (!silent) {
          setLoadingActivities(true);
        }
      }

      setLoadError(null);

      // Background refresh: always fetch fresh data
      const [actRes, commentRes] = await Promise.all([
        tasksApi.getActivities(parentTask.id),
        tasksApi.getComments(parentTask.id, subtask.id)
      ]);

      if (!isMountedRef.current || subtaskRef.current?.id !== currentSubtaskId) return;

      const currentTitle = subtaskRef.current?.title || subtask.title;
      let fetchedActivities: any[] = [];
      if (actRes?.activities) {
        fetchedActivities = actRes.activities.filter(
          (a: any) => a.subtaskId === currentSubtaskId || (a.subtaskTitle && currentTitle && a.subtaskTitle.toLowerCase() === currentTitle.toLowerCase())
        );
      }

      const fetchedComments = commentRes?.comments || [];

      // Save to cache
      activityCache.set(cacheKey, {
        activities: fetchedActivities,
        comments: fetchedComments,
        timestamp: Date.now(),
      });

      // Merge activities preserving optimistic entries
      setActivities(prev => {
        if (subtaskRef.current?.id !== currentSubtaskId) return prev;
        const fetchedIds = new Set(fetchedActivities.map((a: any) => a.id));
        const optimistic = prev.filter(a => {
          if (typeof a.id !== 'string' || (!a.id.startsWith('optimistic-') && !a.id.startsWith('temp-'))) return false;
          if (a.type === 'status_change') {
            return !fetchedActivities.some((f: any) =>
              f.type === 'status_change' &&
              f.newStatus === a.newStatus &&
              (f.subtaskTitle || '') === (a.subtaskTitle || '')
            );
          }
          if (a.type === 'priority_change') {
            return !fetchedActivities.some((f: any) => f.type === 'priority_change' && f.newPriority === a.newPriority);
          }
          if (a.type === 'assignment') {
            return !fetchedActivities.some((f: any) => f.type === 'assignment' && sameNameSet(f.assigneeName, a.assigneeName));
          }
          if (a.type === 'title_change') {
            return !fetchedActivities.some((f: any) => f.type === 'title_change' && f.newTitle === a.newTitle);
          }
          const optTime = new Date(a.date || 0).getTime();
          if (optTime && Date.now() - optTime > 30000) return false;
          return true;
        });
        const recentReal = prev.filter(
          a =>
            !(typeof a.id === 'string' && (a.id.startsWith('optimistic-') || a.id.startsWith('temp-'))) &&
            !fetchedIds.has(a.id) &&
            (a.subtaskId === currentSubtaskId || (a.subtaskTitle && currentTitle && a.subtaskTitle.toLowerCase() === currentTitle.toLowerCase())) &&
            a.date &&
            Date.now() - new Date(a.date).getTime() < 30_000
        );
        const merged = [...fetchedActivities, ...recentReal, ...optimistic];
        return merged.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      });

      // Merge comments preserving optimistic entries
      setRichComments(prev => {
        if (subtaskRef.current?.id !== currentSubtaskId) return prev;
        const fetchedIds = new Set(fetchedComments.map((c: any) => c.id));
        const optimistic = prev.filter(
          c => typeof c.id === 'string' && (c.id.startsWith('optimistic-') || c.id.startsWith('temp-'))
        );
        const recentReal = prev.filter(
          c =>
            !(typeof c.id === 'string' && (c.id.startsWith('optimistic-') || c.id.startsWith('temp-'))) &&
            !fetchedIds.has(c.id) &&
            c.subtaskId === currentSubtaskId &&
            c.createdAt &&
            Date.now() - new Date(c.createdAt).getTime() < 30_000
        );
        return [...fetchedComments, ...recentReal, ...optimistic].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });
    } catch (err: any) {
      if (subtaskRef.current?.id === currentSubtaskId) {
        console.error('Failed to load comments/activities:', err);
        setLoadError(err?.message || String(err));
        commentsBootstrappedRef.current = null;
      }
    } finally {
      if (isMountedRef.current && subtaskRef.current?.id === currentSubtaskId) {
        setLoadingActivities(false);
      }
    }
  }, [subtask?.id, parentTask?.id]);

  useEffect(() => {
    if (!subtask?.id) return;
    if (commentsBootstrappedRef.current !== subtask.id) {
      commentsBootstrappedRef.current = subtask.id;
      loadActivities();
    }
  }, [subtask?.id, loadActivities]);

  const addStagedFiles = useCallback((newFiles: File[]) => {
    setStagedFiles(prev => {
      const next = [...prev];
      for (const f of newFiles) {
        const check = validateUploadFile(f);
        if (!check.valid) {
          toast.error(check.error || `File ${f.name} is not allowed`);
          continue;
        }
        if (check.isSoftWarning && check.softWarning) {
          toast.warning(check.softWarning);
        }
        if (next.length >= MAX_FILES_PER_BATCH) {
          toast.error(`Maximum of ${MAX_FILES_PER_BATCH} staged files reached.`);
          break;
        }
        if (!next.some(existing => existing.name === f.name && existing.size === f.size && existing.lastModified === f.lastModified)) {
          next.push(f);
        }
      }
      return next;
    });
  }, []);

  const handleCommentFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const check = validateUploadFile(file);
      if (!check.valid) {
        toast.error(check.error || `File ${file.name} is not allowed`);
      } else {
        if (check.isSoftWarning && check.softWarning) {
          toast.warning(check.softWarning);
        }
        if (check.isImage) {
          commentEditorRef.current?.insertImages([file]);
        } else {
          addStagedFiles([file]);
        }
      }
    }
    if (commentFileInputRef.current) {
      commentFileInputRef.current.value = '';
    }
  };

  const handleAddComment = async () => {
    const trimmed = isBlankCommentHtml(comment) ? '' : trimCommentHtml(comment);
    if (!trimmed && stagedFiles.length === 0) return;
    if (!currentUser?.id || isSubmittingComment || isUploading || isUploadingInline) return;

    const tempId = `temp-comment-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const draftHtml = comment;
    try {
      let content = trimmed;
      // Only uploads hold the editor: files need their URLs before the comment can be shown or sent
      if (stagedFiles.length > 0) {
        setIsSubmittingComment(true);
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

      const optimisticComment = {
        id: tempId,
        content,
        createdAt: new Date().toISOString(),
        userId: currentUser?.id,
        user: { id: currentUser?.id, name: currentUser?.name || 'You', avatarUrl: (currentUser as any)?.avatarUrl },
        subtaskId: subtask.id,
        reactions: [],
        replies: []
      };
      setRichComments((prev: any[]) => [...prev, optimisticComment]);
      setVisibleActivityCount(prev => prev + 1);
      scrollToLatestComment();

      setComment('');
      setTimeout(() => {
        const el = document.getElementById('subtask-comment');
        if (el) el.style.height = '80px';
      }, 10);
      setStagedFiles([]);
      setIsSubmittingComment(false);

      const res = await tasksApi.addComment(parentTask.id, content, currentUser.id, parentTask.listId, [], undefined, subtask.id);
      const saved = res?.comment;
      if (saved) {
        // A reload that landed meanwhile may already hold the saved comment; then just drop the placeholder
        setRichComments((prev: any[]) => prev.some(c => c.id === saved.id)
          ? prev.filter(c => c.id !== tempId)
          : prev.map(c => c.id === tempId ? { ...c, ...saved } : c));
      }

      // Reflect comment count in the parent task modal's SubtasksSection
      const count = (subtaskRef.current._count?.comments || 0) + 1;
      const updatedSubtask = subtask.comments
        ? { ...subtaskRef.current, comments: [...(subtaskRef.current.comments || []), saved || { id: Date.now().toString() }] }
        : { ...subtaskRef.current, _count: { ...(subtaskRef.current._count || {}), comments: count } };
      syncSubtaskToParent(updatedSubtask);
    } catch (err: any) {
      console.error('Failed to post comment:', err);
      // Take the unsent comment back out and give the text back if nothing new was typed
      setRichComments((prev: any[]) => prev.filter(c => c.id !== tempId));
      setComment((prev: string) => (prev.trim() && prev !== '<p></p>' ? prev : draftHtml));
      const errMsg = err?.response?.data?.error || err?.message || 'Failed to post comment';
      const statusCode = err?.response?.status;
      toast.error(errMsg);
      setActionError({
        title: 'Failed to Post Subtask Comment',
        action: `Sending comment to subtask "${subtask.title}"`,
        message: errMsg,
        statusCode,
        technicalDetails: typeof err === 'object' ? JSON.stringify(err.response?.data || err, null, 2) : String(err),
        context: {
          subtaskId: subtask.id,
          subtaskTitle: subtask.title,
          parentTaskId: parentTask.id,
          parentTaskTitle: parentTask.title,
        },
        troubleshooting: [
          'Verify whether the subtask or parent task exists in Nexus.',
          'If mirrored to ClickUp/n8n: verify the subtask externalId is valid.',
          'Check your network connection to the server.'
        ],
        onRetry: handleAddComment,
      });
      setIsUploading(false);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleSaveEdit = async (commentId: string, updatedContent?: string) => {
    const contentToSave = (updatedContent !== undefined ? updatedContent : editCommentText).trim();
    if ((!contentToSave || contentToSave === '<p></p>') || !parentTask?.id || isSubmittingEdit) return;
    setIsSubmittingEdit(true);
    try {
      setRichComments(prev => prev.map(c => {
        if (c.id === commentId) return { ...c, content: contentToSave };
        return {
          ...c,
          replies: c.replies?.map((r: any) => r.id === commentId ? { ...r, content: contentToSave } : r)
        };
      }));
      setEditingCommentId(null);
      setEditCommentText('');
      await tasksApi.updateComment(parentTask.id, commentId, contentToSave);
      const res = await tasksApi.getComments(parentTask.id, subtask.id);
      if (res?.comments) setRichComments(res.comments);
    } catch (err) {
      console.warn('Edit failed:', err);
      toast.error('Failed to update comment');
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleToggleCommentChecklist = async (commentId: string, itemIndex: number, newChecked: boolean) => {
    const currentComment = richComments.flatMap(c => [c, ...(c.replies || [])]).find(c => c.id === commentId);
    if (!currentComment || !currentComment.content || !parentTask?.id) return;

    const updatedContent = toggleCommentChecklistItem(currentComment.content, itemIndex, newChecked);
    if (updatedContent === currentComment.content) return;

    // 1. Instant local optimistic update
    setRichComments(prev => prev.map(c => {
      if (c.id === commentId) return { ...c, content: updatedContent };
      return {
        ...c,
        replies: c.replies?.map((r: any) => r.id === commentId ? { ...r, content: updatedContent } : r)
      };
    }));

    // 2. Synchronously update subtask activityCache so background fetches never revert
    const cacheKey = `subtask:${subtask.id}`;
    const cached = activityCache.get(cacheKey);
    if (cached?.comments) {
      cached.comments = cached.comments.map((c: any) => {
        if (c.id === commentId) return { ...c, content: updatedContent };
        return {
          ...c,
          replies: c.replies?.map((r: any) => r.id === commentId ? { ...r, content: updatedContent } : r)
        };
      });
    }

    // 3. Immediately emit live websocket update so other clients and tabs sync instantly
    if (socket) {
      socket.emit('task_comment_live_update', {
        listId: parentTask.listId,
        taskId: parentTask.id,
        subtaskId: subtask.id,
        commentId,
        content: updatedContent,
      });
    }

    // 4. Background DB persistence
    try {
      await tasksApi.updateComment(parentTask.id, commentId, updatedContent, parentTask.listId);
    } catch (err) {
      console.warn('Failed to update subtask comment checklist item:', err);
      setRichComments(prev => prev.map(c => {
        if (c.id === commentId) return { ...c, content: currentComment.content };
        return {
          ...c,
          replies: c.replies?.map((r: any) => r.id === commentId ? { ...r, content: currentComment.content } : r)
        };
      }));
      toast.error('Failed to update checklist item');
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!parentTask?.id) return;
    try {
      setRichComments(prev =>
        prev.filter(c => c.id !== commentId).map(c => ({
          ...c,
          replies: c.replies?.filter((r: any) => r.id !== commentId)
        }))
      );
      await tasksApi.deleteComment(parentTask.id, commentId);
    } catch (err) {
      console.warn('Delete failed:', err);
    }
  };

  const handleToggleReaction = async (commentId: string, emoji: string) => {
    if (!parentTask?.id || !currentUser?.id) return;
    setShowEmojiPickerFor(null);
    try {
      const res = await tasksApi.toggleCommentReaction(parentTask.id, commentId, emoji, currentUser.id);
      setRichComments(prev => prev.map(c => {
        if (c.id === commentId) return { ...c, reactions: res.reactions };
        return {
          ...c,
          replies: c.replies?.map((r: any) => r.id === commentId ? { ...r, reactions: res.reactions } : r),
        };
      }));
    } catch (err) {
      console.warn('Reaction failed:', err);
    }
  };

  const handleSubmitReply = async (parentCommentId: string, replyContent?: string, mentionIds?: string[]) => {
    const textToSubmit = (replyContent !== undefined ? replyContent : replyText).trim();
    if (!textToSubmit || !parentTask?.id || !currentUser?.id) return;
    const text = textToSubmit;
    const tempId = `temp-reply-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const withReplies = (map: (replies: any[]) => any[]) => (prev: any[]) =>
      prev.map(c => {
        if (c.id !== parentCommentId) return c;
        const newReplies = map(c.replies || []);
        return { ...c, replies: newReplies, replyCount: newReplies.length };
      });

    // Shown in the thread at once; the saved reply replaces it when the server answers
    setRichComments(withReplies(replies => [...replies, {
      id: tempId,
      content: text,
      createdAt: new Date().toISOString(),
      userId: currentUser.id,
      user: { id: currentUser.id, name: currentUser.name || 'You', avatarUrl: (currentUser as any)?.avatarUrl },
      parentCommentId,
      subtaskId: subtask.id,
      reactions: [],
    }]));
    setReplyText('');
    setReplyingToId(null);
    try {
      const res = await tasksApi.addComment(parentTask.id, text, currentUser.id, parentTask.listId, mentionIds || [], parentCommentId, subtask.id);
      if (res?.comment) {
        setRichComments(withReplies(replies => replies.some(r => r.id === res.comment.id)
          ? replies.filter(r => r.id !== tempId)
          : replies.map(r => r.id === tempId ? { ...r, ...res.comment } : r)));
      }
    } catch (err: any) {
      console.warn('Reply failed:', err);
      setRichComments(withReplies(replies => replies.filter(r => r.id !== tempId)));
      toast.error(err?.message || 'Failed to post reply');
    }
  };

  const handleTitleBlur = () => {
    const trimmed = localTitle.trim();
    if (!trimmed) {
      setLocalTitle(subtaskRef.current.title || '');
      return;
    }
    if (trimmed !== subtaskRef.current.title) {
      const updatedSubtask = { ...subtaskRef.current, title: trimmed };
      syncSubtaskToParent(updatedSubtask);
      tasksApi.updateSubtask(parentTask.id, subtask.id, { title: trimmed }).catch(err => console.error(err));
    }
  };

  const handleReturnToList = () => {
    if (setActiveSubtask) setActiveSubtask(null);
    const targetListId = parentTask?.list?.id || parentTask?.listId;
    if (typeof window !== 'undefined') {
      const isCurrentList = !!targetListId && window.location.pathname === `/lists/${targetListId}`;
      if (isCurrentList) {
        if (onCloseModal) {
          onCloseModal();
        } else {
          onClose();
        }
        const url = new URL(window.location.href);
        url.searchParams.delete('task');
        url.searchParams.delete('subtask');
        window.history.replaceState(null, '', url.pathname + (url.search || ''));
      } else if (targetListId) {
        router.push(`/lists/${targetListId}`);
      } else {
        router.push('/');
      }
    }
  };

  const assignee = subtask.assignee;

  return (
    <div
      className="w-full h-full bg-background flex flex-col overflow-hidden cursor-default"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (setActiveSubtask) {
                setActiveSubtask(null);
              } else {
                onClose();
              }
            }}
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
                    onClick={() => {
                      if (setActiveSubtask) setActiveSubtask(null);
                      const targetListId = parentTask?.list?.id || parentTask?.listId;
                      if (targetListId) {
                        router.push(`/lists/${targetListId}`);
                      } else {
                        router.push('/');
                      }
                    }}
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
                    onClick={() => {
                      if (setActiveSubtask) setActiveSubtask(null);
                      const targetListId = parentTask?.list?.id || parentTask?.listId;
                      if (targetListId) {
                        router.push(`/lists/${targetListId}`);
                      } else {
                        router.push('/');
                      }
                    }}
                    className="flex items-center gap-1.5 hover:text-zinc-200 transition-colors cursor-pointer"
                  >
                    <Folder className="w-3.5 h-3.5 shrink-0" style={{ color: getFolderColor(parentTask.list.folder) }} />
                    <span className="truncate max-w-[120px]">{parentTask.list.folder.name}</span>
                  </button>
                  <span className="text-zinc-700">/</span>
                </>
              )}
              <button
                onClick={handleReturnToList}
                className="flex items-center gap-1.5 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                <ListTodo className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate max-w-[150px]">{parentTask.list.name}</span>
              </button>
              <span className="text-zinc-700">/</span>
              <button
                onClick={() => {
                  if (mode === 'modal' && setActiveSubtask) {
                    setActiveSubtask(null);
                  } else {
                    // Carry the original origin along so closing the parent still returns there
                    const fromPath = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('from') : null;
                    onClose();
                    router.push(`/tasks/${parentTask.id}${fromPath ? `?from=${encodeURIComponent(fromPath)}` : ''}`);
                  }
                }}
                className="truncate max-w-[150px] font-semibold text-zinc-300 hover:text-white transition-colors cursor-pointer"
              >
                {parentTask.title || 'Untitled'}
              </button>
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
              const link = getNexusTaskUrl(parentTask, subtask.id);
              navigator.clipboard.writeText(link);
              toast.success('Link copied to clipboard');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 text-[11px] font-medium rounded-lg border border-zinc-700/50 transition-colors cursor-pointer mr-2"
          >
            <Share2 className="w-3.5 h-3.5 text-zinc-400" />
            Share
          </button>
          {mode !== 'full' && (
            <button
              onClick={() => {
                onClose();
                const fromPath = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '';
                router.push(`/tasks/${subtask.id}${fromPath ? `?from=${encodeURIComponent(fromPath)}` : ''}`);
              }}
              className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 hover:text-white transition-colors cursor-pointer mr-1"
              title="Open subtask in full page"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => {
              if (onCloseModal) {
                onCloseModal();
              } else {
                onClose();
              }
            }}
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
            <div className="flex items-center gap-1.5 text-[13px] text-zinc-500 mb-2 cursor-pointer hover:text-zinc-300 transition-colors group/subtask-parent w-fit" onClick={onClose}>
              <span>Subtask of</span>
              <div className="flex items-center gap-1.5 ml-1 font-bold text-zinc-100 group-hover/subtask-parent:text-white transition-colors">
                {(parentTask.completed || parentTask.status === 'DONE' || parentTask.status === 'CLOSED' || parentTask.status === 'Closed') && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                )}
                <span>{parentTask.title}</span>
              </div>
            </div>

            <div className="flex items-start gap-2 mb-8 group max-w-3xl w-full">
              <CornerDownRight className="w-5 h-5 text-zinc-500 shrink-0 mt-1.5" />
              {isEditingTitle ? (
                <textarea
                  ref={subtaskTitleTextareaRef}
                  rows={1}
                  autoFocus
                  value={localTitle}
                  onChange={(e) => {
                    setLocalTitle(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${e.target.scrollHeight}px`;
                  }}
                  onFocus={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = `${e.target.scrollHeight}px`;
                    e.target.setSelectionRange(e.target.value.length, e.target.value.length);
                  }}
                  onBlur={() => {
                    setIsEditingTitle(false);
                    handleTitleBlur();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                  className="text-2xl font-bold bg-card border border-zinc-700 focus:border-zinc-500 focus:outline-none w-full transition-colors rounded px-2 py-1 -ml-2 text-zinc-100 resize-none overflow-hidden leading-snug break-words block"
                />
              ) : (
                <h1
                  onClick={() => { if (canEditTask) setIsEditingTitle(true); }}
                  className={`text-2xl font-bold cursor-pointer hover:bg-zinc-800/50 rounded px-2 py-1 -ml-2 transition-colors break-words leading-snug group w-fit max-w-full pr-10 ${(subtask.status === 'Closed' || subtask.status === 'CLOSED' || subtask.completed) ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}
                >
                  <span>{localTitle}</span>
                  <Pencil className="w-4 h-4 ml-2.5 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity inline-block align-middle shrink-0" />
                </h1>
              )}
            </div>

            {/* Properties Stack — row layout */}
            <div className="flex flex-col gap-2 mb-8 mt-1">

              {/* Status Row */}
              <div className="flex items-center gap-3 min-h-[32px]">
                <div className="flex items-center gap-2 w-28 shrink-0">
                  {(() => {
                    const isClosed = localCompleted || (localStatus || '').toLowerCase() === 'closed' || (localStatus || '').toLowerCase() === 'done';
                    return isClosed ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" /> : ((localStatus || '').toUpperCase() === 'KYC' ? <CustomCircleDotted className="w-3.5 h-3.5 shrink-0 text-muted-foreground" /> : <CustomCircleDot className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />);
                  })()}
                  <span className="text-[12px] text-zinc-500">Status</span>
                </div>
                  <div className="flex items-center gap-1.5">
                    {(() => {
                      const orderedStatuses = (listStatuses && listStatuses.length > 0)
                        ? sortStatusesWithClosedAndKycAtEnd(listStatuses.map((s: any) => typeof s === 'string' ? s : (s.name || s.status || s.title || '')))
                        : ALL_STATUSES;

                      const statusName = localStatus || 'No Status';
                      const statusObj = listStatuses?.find((s: any) => 
                        (s.name || s.title || s.status || '').trim().toUpperCase() === statusName.trim().toUpperCase()
                      );
                      const hasCustomColor = !!statusObj?.color;
                      const defaultClasses = STATUS_COLORS[(localStatus || '').toUpperCase()] || STATUS_COLORS[localStatus] || 'bg-zinc-800/50 text-zinc-400';

                      const getHex = (colorStr: string) => {
                        const tailwindColors: Record<string, string> = {
                          slate: '#64748b', gray: '#6b7280', zinc: '#71717a', neutral: '#737373', stone: '#78716c',
                          red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', lime: '#84cc16',
                          green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9',
                          blue: '#3b82f6', indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef',
                          pink: '#ec4899', rose: '#f43f5e'
                        };
                        return tailwindColors[colorStr] || colorStr;
                      };

                      return (
                        <div
                          style={hasCustomColor ? { backgroundColor: getHexColor(statusObj.color) } : {}}
                          className={`inline-flex items-center h-7 rounded-md text-[11px] font-bold uppercase tracking-wider select-none transition-colors ${hasCustomColor ? 'text-[#fff]' : defaultClasses} shadow-sm group/status`}
                        >
                          <Popover.Root open={isStatusOpen} onOpenChange={setIsStatusOpen}>
                            <Popover.Trigger asChild>
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center h-full px-2.5 cursor-pointer hover:brightness-110 rounded-l-md"
                              >
                                {statusName}
                              </div>
                            </Popover.Trigger>
                            <Popover.Portal>
                              <Popover.Content className="z-[100000] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-100 w-48 p-1.5 bg-background border border-zinc-200 dark:border-zinc-800 rounded-md shadow-xl outline-none" align="start" sideOffset={4}>
                                <div className="max-h-60 overflow-y-auto custom-scrollbar flex flex-col gap-0.5 pr-1">
                                  {(() => {
                                    const openStatuses = orderedStatuses.filter((s: string) => !isClosedStatus(s));
                                    const closedStatuses = orderedStatuses.filter((s: string) => isClosedStatus(s));

                                    const renderItem = (s: string) => {
                                      const customObj = listStatuses?.find((ls: any) => (ls.name || ls.status || ls.title) === s);
                                      const isClosed = isClosedStatus(s);
                                      const statusColorHex = STATUS_COLORS[(s || '').toUpperCase()]?.match(/\[(.*?)\]/)?.[1];
                                      const statusIconStyle = statusColorHex ? { color: statusColorHex } : {};

                                      return (
                                        <div
                                          key={s}
                                          onClick={() => {
                                            handleStatusChangeAction(s);
                                            setIsStatusOpen(false);
                                          }}
                                          className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${localStatus === s ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium' : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-accent hover:text-zinc-900 dark:hover:text-accent-foreground'}`}
                                        >
                                          {(() => {
                                            if (isClosed) {
                                              return <CheckCircle2 className="w-3 h-3 shrink-0 text-[#2FA37A]" style={customObj?.color ? { color: getHexColor(customObj.color) } : statusIconStyle} />;
                                            }
                                            if (customObj?.color) {
                                              if ((s || '').toUpperCase() === 'KYC') {
                                                return <CustomCircleDotted className="w-3 h-3 shrink-0" style={{ color: getHexColor(customObj.color) }} />;
                                              }
                                              return <CustomCircleDot className="w-3 h-3 shrink-0" style={{ color: getHexColor(customObj.color) }} />;
                                            }
                                            if ((s || '').toUpperCase() === 'KYC') {
                                              return <CustomCircleDotted className={`w-3 h-3 shrink-0 ${statusColorHex ? '' : 'text-zinc-500'}`} style={statusIconStyle} />;
                                            }
                                            return <CustomCircleDot className={`w-3 h-3 shrink-0 ${statusColorHex ? '' : 'text-zinc-500'}`} style={statusIconStyle} />;
                                          })()}
                                          <span className="uppercase">{s}</span>
                                          {s === localStatus && <Check className="w-3 h-3 ml-auto opacity-70 text-blue-600 dark:text-blue-400" />}
                                        </div>
                                      );
                                    };

                                    return (
                                      <>
                                        {openStatuses.map(renderItem)}
                                        {closedStatuses.length > 0 && (
                                          <>
                                            <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
                                            <div className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400 px-2.5 pt-1.5 pb-1 select-none">
                                              Closed
                                            </div>
                                            {closedStatuses.map(renderItem)}
                                          </>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                              </Popover.Content>
                            </Popover.Portal>
                          </Popover.Root>

                          <div className="h-4 w-[1px] bg-white/20" />

                          {(() => {
                            const statuses = orderedStatuses;
                            const currentIndex = statuses.indexOf(statusName);
                            const nextIndex = currentIndex !== -1 ? (currentIndex + 1) % statuses.length : 0;
                            const nextStatus = statuses[nextIndex];

                            return (
                              <div
                                title={`Move to "${nextStatus}"`}
                                className="flex items-center justify-center h-full px-1.5 cursor-pointer hover:brightness-110 rounded-r-md"
                                onClick={() => {
                                  handleStatusChangeAction(nextStatus);
                                }}
                              >
                                <ChevronRight className="w-3.5 h-3.5 opacity-90" />
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}

                      {(() => {
                        const isSubClosed = localCompleted || (localStatus || '').toLowerCase() === 'closed' || (localStatus || '').toLowerCase() === 'done';
                        return (
                          <button
                            onClick={() => {
                              handleStatusChangeAction(isSubClosed ? 'Pending' : 'Closed');
                            }}
                            title={isSubClosed ? "Mark as Open" : "Mark as Closed"}
                            className={`w-7 h-7 rounded flex items-center justify-center transition-colors shadow-sm border cursor-pointer ${
                              isSubClosed
                                ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700 hover:border-emerald-700'
                                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-emerald-600 hover:border-emerald-600 hover:text-white'
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        );
                      })()}
                  </div>
              </div>



              {/* Assignees Row */}
              <div className="flex items-center gap-3 min-h-[32px]">
                <div className="flex items-center gap-2 w-28 shrink-0">
                  <User className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                  <span className="text-[12px] text-zinc-500">Assignees</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Popover.Root open={isRoleOpen && canAssignTask} onOpenChange={(open) => canAssignTask && setIsRoleOpen(open)}>
                    <Popover.Trigger asChild>
                      {(localRoleRestrictions && localRoleRestrictions.length > 0) ? (
                        <div onClick={blockIfCannotAssign} title={!canAssignTask ? assignDeniedMessage : undefined} className={`flex items-center transition-all duration-300 ${!canAssignTask ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-105 active:scale-95'}`}>
                          {normalizeRoles(localRoleRestrictions, workspaceTeams).map((role: string, i: number) => {
                            const colors = ['bg-purple-500', 'bg-red-500', 'bg-emerald-500', 'bg-blue-500', 'bg-amber-500', 'bg-pink-500'];
                            const bgColor = colors[i % colors.length];
                            return (
                              <div
                                key={role}
                                className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-card ${i > 0 ? '-ml-2.5' : ''} shadow-sm relative z-[${10 - i}] ${bgColor} transition-transform`}
                                title={role}
                              >
                                {role.substring(0, 2).toUpperCase()}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <button onClick={blockIfCannotAssign} aria-disabled={!canAssignTask} title={!canAssignTask ? assignDeniedMessage : undefined} className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-zinc-800/50 border border-zinc-700/50 text-zinc-400 text-[11px] transition-colors select-none whitespace-nowrap ${!canAssignTask ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-zinc-700/50 hover:text-zinc-200'}`}>
                          <Plus className="w-3 h-3 shrink-0" />
                          Assign Role
                        </button>
                      )}
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content className="z-[100000] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 duration-150 w-52 p-1 bg-background border border-zinc-800 rounded-lg shadow-2xl outline-none" sideOffset={4} align="start">
                        <div className="max-h-[220px] overflow-y-auto custom-scrollbar p-1">
                          <p className="text-[10px] text-zinc-500 px-2 py-1 uppercase tracking-wide font-medium">Restrict assignees to roles</p>
                          {workspaceTeams.length === 0 && <div className="px-2 py-1.5 text-xs text-zinc-500">No teams found.</div>}
                          {workspaceTeams.map((team: any) => (
                            <div key={team.id} className="mb-2">
                              {(() => {
                                const teamRoles = team.teamRoles || [];
                                const current = latestRoleRestrictionsRef.current;
                                const hasRoles = teamRoles.length > 0;
                                const allSelected = hasRoles && teamRoles.every((r: any) => hasRole(current, r.name));
                                const someSelected = hasRoles && teamRoles.some((r: any) => hasRole(current, r.name));

                                return (
                                  <div
                                      onClick={() => {
                                        if (!hasRoles) return;
                                        let next = [...current];
                                        if (allSelected) {
                                          next = next.filter(r => !teamRoles.some((tr: any) => roleKey(tr.name) === roleKey(r)));
                                        } else {
                                          const toAdd = teamRoles.filter((tr: any) => !hasRole(next, tr.name)).map((tr: any) => tr.name);
                                          next = [...next, ...toAdd];
                                        }
                                        next = normalizeRoles(next, workspaceTeams);
                                        handleApplySubtaskRoleRestrictions(next, true);
                                      }}
                                    className={`flex items-center gap-2 px-2 py-1 text-[10px] font-semibold tracking-wide uppercase bg-accent/30 ${hasRoles ? 'cursor-pointer hover:bg-accent/50 hover:text-foreground transition-colors' : ''} ${someSelected ? 'text-indigo-400' : 'text-muted-foreground'}`}
                                  >
                                    {hasRoles && (
                                      <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${allSelected ? 'bg-indigo-600 border-indigo-500' : someSelected ? 'bg-indigo-900/50 border-indigo-500' : 'border-border bg-popover'}`}>
                                        {allSelected && <Check className="w-2.5 h-2.5 text-white" />}
                                        {!allSelected && someSelected && <div className="w-1.5 h-0.5 bg-indigo-400 rounded-full" />}
                                      </div>
                                    )}
                                    <span>{team.name}</span>
                                  </div>
                                );
                              })()}
                              {(!team.teamRoles || team.teamRoles.length === 0) && (
                                <div className="px-2 py-1 text-[10px] text-muted-foreground italic">No roles</div>
                              )}
                              {team.teamRoles && team.teamRoles.length > 0 && (
                                <div className="flex flex-col ml-[15px] pl-3 py-0.5 border-l border-border/50 mt-1 mb-1 relative">
                                  {team.teamRoles.map((role: any) => {
                                    const selected = hasRole(localRoleRestrictions, role.name);
                                    return (
                                      <div
                                        key={role.id}
                                        onClick={() => {
                                          const current = latestRoleRestrictionsRef.current;
                                          const next = normalizeRoles(
                                            selected ? withoutRole(current, role.name) : [...current, role.name],
                                            workspaceTeams
                                          );
                                          handleApplySubtaskRoleRestrictions(next, true);
                                        }}
                                        className="flex items-center gap-2 cursor-pointer px-1 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors rounded-md"
                                      >
                                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${selected ? 'bg-indigo-600 border-indigo-500' : 'border-border bg-card'}`}>
                                          {selected && <Check className="w-2.5 h-2.5 text-white" />}
                                        </div>
                                        {role.name}
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

                  <Popover.Root open={isAssigneeOpen && canAssignMember} onOpenChange={(open) => canAssignMember && setIsAssigneeOpen(open)}>
                    <Popover.Trigger asChild>
                      <motion.div layout
                        onClick={(e) => {
                          if (!canAssignTask) {
                            blockIfCannotAssign(e);
                            return;
                          }
                          if (!hasTeamRole) {
                            e.preventDefault();
                            toast.error("Select a team role first to assign members");
                            setIsRoleOpen(true);
                            return;
                          }
                        }}
                        title={!canAssignTask ? assignDeniedMessage : !hasTeamRole ? "Select a team role first to assign members" : currentAssignees.map((u: any) => u.name).join(', ')}
                        className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md transition-colors text-[11px] select-none w-fit ${canAssignMember
                          ? 'cursor-pointer bg-zinc-800/50 hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-200'
                          : 'cursor-not-allowed bg-zinc-800/20 text-zinc-500 opacity-70'
                          }`}
                      >
                        {currentAssignees.length > 0 ? (
                          <>
                            <div className="flex items-center -space-x-1.5">
                              <AnimatePresence>
                                {currentAssignees.slice(0, 3).map((u: any, i: number) => {
                                  const avatarSrc = u.avatarUrl || u.imageUrl;
                                  return (
                                    <motion.div
                                      key={u.id}
                                      initial={{ opacity: 0, scale: 0.5 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      exit={{ opacity: 0, scale: 0.5 }}
                                      transition={{ duration: 0.2 }}
                                      style={{ zIndex: i + 1 }}
                                      className="relative ring-2 ring-background rounded-full shrink-0"
                                      title={u.name}
                                    >
                                      {avatarSrc ? (
                                        <img src={avatarSrc} alt={u.name} className="w-5 h-5 rounded-full object-cover" />
                                      ) : (
                                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] text-white font-bold ${getAssigneeAvatarColor(u.name || u.id || 'U')}`}>
                                          {(u.name || 'U').substring(0, 2).toUpperCase()}
                                        </div>
                                      )}
                                    </motion.div>
                                  );
                                })}
                              </AnimatePresence>
                              <AnimatePresence>
                                {currentAssignees.length > 3 && (
                                  <motion.div
                                    key="overflow"
                                    initial={{ opacity: 0, scale: 0.5 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.5 }}
                                    transition={{ duration: 0.2 }}
                                    style={{ zIndex: 10 }}
                                    className="relative ring-2 ring-background rounded-full bg-zinc-800 text-zinc-300 text-[8px] font-bold h-5 w-5 flex items-center justify-center shrink-0"
                                  >
                                    +{currentAssignees.length - 3}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                            {currentAssignees.length === 1 && (
                              <motion.span layout className="truncate max-w-[100px]">{currentAssignees[0].name}</motion.span>
                            )}
                            {!canAssignMember && <Lock className="w-3 h-3 ml-0.5 shrink-0 text-zinc-500" />}
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5 shrink-0" />
                            <span>Assign</span>
                            {!canAssignMember && <Lock className="w-3 h-3 ml-0.5 shrink-0" />}
                          </>
                        )}
                      </motion.div>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content
                        className="z-[100000] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 duration-150 w-72 p-0 bg-background border border-zinc-800 rounded-md shadow-2xl outline-none overflow-hidden"
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

                            {hasTeamRole && subtaskAssignableUsers.length > 0 && (
                              <Command.Item
                                value={`select all assignees for team role ${localRoleRestrictions.join(' ')}`}
                                onSelect={() => handleSelectAllRoleAssignees()}
                                className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none text-indigo-200 font-semibold hover:text-indigo-100 hover:bg-indigo-500/15 data-[selected=true]:bg-indigo-500/15 data-[selected=true]:text-indigo-100 mb-1 border-b border-zinc-800/40 transition-colors"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                    subtaskAssignableUsers.every((u: any) => isUserAssigned(u.id))
                                      ? 'bg-indigo-600 border-indigo-500'
                                      : 'border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800/60'
                                  }`}>
                                    {subtaskAssignableUsers.every((u: any) => isUserAssigned(u.id)) ? (
                                      <Check className="w-2.5 h-2.5 text-white" />
                                    ) : subtaskAssignableUsers.some((u: any) => isUserAssigned(u.id)) ? (
                                      <div className="w-1.5 h-0.5 bg-indigo-500 rounded-full" />
                                    ) : null}
                                  </div>
                                  <span className="truncate text-inherit">
                                    {subtaskAssignableUsers.every((u: any) => isUserAssigned(u.id))
                                      ? 'Deselect all assignees'
                                      : localRoleRestrictions.length === 1
                                        ? `Select all ${localRoleRestrictions[0]} assignees`
                                        : 'Select all assignees for Team Role'}
                                  </span>
                                </div>
                              </Command.Item>
                            )}

                            {currentAssignees.length > 0 && (
                              <Command.Item
                                value="clear all unassigned none"
                                onSelect={() => handleClearAllAssignees()}
                                className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none data-[selected=true]:bg-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 data-[selected=true]:text-rose-400 mb-1 border-b border-zinc-800/40"
                              >
                                <div className="w-5 h-5 rounded-full border border-dashed border-zinc-300 dark:border-zinc-600 flex items-center justify-center text-[10px] text-zinc-400 dark:text-zinc-500 mr-2 shrink-0">
                                  ✕
                                </div>
                                <span>Clear all assignees</span>
                              </Command.Item>
                            )}

                            {subtaskAssignableUsers.map((u: any) => {
                              const assigned = isUserAssigned(u.id);
                              const initials = (u.name || 'U').substring(0, 2).toUpperCase();
                              const role = u.roles?.[0] || '';
                              const avatarColors = ['bg-violet-600','bg-blue-600','bg-emerald-600','bg-rose-600','bg-amber-600','bg-cyan-600','bg-fuchsia-600'];
                              const avatarBg = avatarColors[(u.name || '').charCodeAt(0) % avatarColors.length];
                              return (
                                <Command.Item
                                  key={u.id}
                                  value={`${u.name} ${u.email} ${role}`}
                                  onSelect={() => handleToggleAssignee(u)}
                                  className="relative flex cursor-pointer select-none items-center rounded-md px-2.5 py-2 outline-none data-[selected=true]:bg-zinc-800/60 hover:bg-zinc-800/60 text-zinc-300 gap-2.5"
                                >
                                  {u.avatarUrl ? (
                                    <img src={u.avatarUrl} alt={u.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                                  ) : (
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] text-white font-bold shrink-0 ${avatarBg}`}>
                                      {initials}
                                    </div>
                                  )}
                                  <div className="flex flex-col min-w-0 flex-1">
                                    <span className="truncate text-[13px] font-medium text-zinc-200">{u.name}</span>
                                    <span className="truncate text-[11px] text-zinc-500">{role || u.email}</span>
                                  </div>
                                  {assigned && (
                                    <Check className="w-4 h-4 text-indigo-400 shrink-0 ml-2" />
                                  )}
                                </Command.Item>
                              );
                            })}
                          </Command.List>
                        </Command>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                  {currentAssignees.length > 0 && canAssignTask && (
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
                    <div
                      title={subtask.completed ? 'Locked' : (subtask.priority ? subtask.priority.toLowerCase() : 'No priority')}
                      className={`inline-flex items-center h-7 px-2.5 rounded-md text-[11px] font-semibold tracking-wide select-none w-fit transition-all ${
                        subtask.completed
                          ? 'bg-zinc-800/40 cursor-not-allowed opacity-60'
                          : 'cursor-pointer bg-zinc-800/50 hover:bg-zinc-700/50'
                      }`}
                    >
                      {subtask.priority && <Flag className={`w-3.5 h-3.5 shrink-0 mr-1.5 ${getPriorityConfig(subtask.priority).iconColor}`} />}
                      <span className={getPriorityConfig(subtask.priority).color}>
                        {subtask.priority ? getPriorityConfig(subtask.priority).label : 'Empty'}
                      </span>
                    </div>
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content className="z-[100000] w-36 p-1.5 bg-popover border border-zinc-800 rounded-xl shadow-2xl outline-none" align="start" sideOffset={4}>
                      <div className="flex flex-col gap-0.5">
                        <div className="text-[10px] font-bold text-zinc-500 tracking-wider px-2.5 py-1.5 uppercase">Priority</div>
                        {(PRIORITY_OPTIONS as readonly Priority[]).map((p) => (
                          <button
                            key={p}
                            onClick={() => { handleUpdatePriority(p); setIsPriorityOpen(false); }}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 hover:bg-zinc-800 rounded-lg text-sm transition-colors cursor-pointer ${subtask.priority === p ? 'bg-zinc-800/50' : ''}`}
                          >
                            <Flag className={`w-3.5 h-3.5 shrink-0 ${getPriorityConfig(p).iconColor}`} />
                            <span className={`font-medium ${getPriorityConfig(p).color}`}>{getPriorityConfig(p).label}</span>
                            {subtask.priority === p && <Check className="w-4 h-4 ml-auto text-blue-500" />}
                          </button>
                        ))}
                        {subtask.priority && (
                          <div className="border-t border-zinc-800/60 mt-1 pt-1">
                            <button
                              className="w-full flex items-center gap-2.5 px-2.5 py-2 hover:bg-zinc-800 rounded-lg text-sm text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                              onClick={() => { handleUpdatePriority(null); setIsPriorityOpen(false); }}
                            >
                              <Flag className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                              <span>Clear Priority</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
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

              <div className="relative">
                <div
                  ref={descContentRef}
                  className={`relative p-2 -mx-2 rounded-lg hover:bg-zinc-800/20 cursor-text break-words overflow-hidden transition-[max-height,background-color] duration-300 ease-in-out`}
                  style={{ maxHeight: (!isLocalEditing && !editingUser && isDescOverflowing && !isDescExpanded) ? 160 : (descContentRef.current ? descContentRef.current.scrollHeight + 100 : 3000) }}
                  onFocus={(e) => { 
                    if (canEditTask) {
                      setIsLocalEditing(true);
                      setIsDescExpanded(true);
                      handleStartEditing(); 
                    } else {
                      e.target.blur(); 
                    }
                  }}
                  onClick={() => {
                    if (canEditTask) {
                      setIsLocalEditing(true);
                      setIsDescExpanded(true);
                      handleStartEditing();
                    }
                  }}
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
                      setIsLocalEditing(false);
                      const sanitizedDesc = (localDesc === '<p></p>' || localDesc === '<p><br></p>') ? '' : localDesc;
                      
                      if (sanitizedDesc !== subtaskRef.current.description) {
                        const updatedSubtask = { ...subtaskRef.current, description: sanitizedDesc };
                        syncSubtaskToParent(updatedSubtask);
                        tasksApi.updateSubtask(parentTask.id, subtask.id, { description: sanitizedDesc }).catch(err => console.error(err));
                        if (socket) {
                          socket.emit('task_editing_stop', {
                            listId: parentTask.listId,
                            taskId: subtask.id,
                            description: sanitizedDesc,
                          });
                        }
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

                  {!editingUser && isDescOverflowing && !isDescExpanded && (
                    <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background via-background/90 to-transparent flex items-end justify-center pb-1 pointer-events-none">
                      <button 
                        onClick={(e) => { e.stopPropagation(); setIsDescExpanded(true); }}
                        onMouseDown={(e) => e.preventDefault()}
                        onFocus={(e) => e.stopPropagation()}
                        className="pointer-events-auto flex items-center gap-1.5 px-3 py-1 bg-popover hover:bg-zinc-800 border border-zinc-700/50 rounded-md text-[10px] text-zinc-300 font-medium transition-colors shadow-sm cursor-pointer"
                      >
                        <ChevronDown className="w-3 h-3" />
                        Expand
                      </button>
                    </div>
                  )}
                </div>

                {isDescOverflowing && !editingUser && isDescExpanded && (
                  <button
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setIsDescExpanded(false); 
                      setIsLocalEditing(false);
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onFocus={(e) => e.stopPropagation()}
                    className="mt-2 flex items-center gap-1.5 px-3 py-1 self-center mx-auto bg-zinc-800/50 hover:bg-zinc-700 border border-zinc-700/30 rounded-md text-[10px] text-zinc-400 font-medium transition-colors shadow-sm cursor-pointer"
                  >
                    <ChevronUp className="w-3 h-3" />
                    Collapse
                  </button>
                )}
              </div>

              {/* Action Buttons (Notes, Attachments, etc) */}
              <div className="mt-8 flex flex-col gap-2 w-full">
                <AuditSection
                  task={parentTask}
                  title={subtask.title}
                  subtaskId={subtask.id}
                  users={workspaceUsers || []}
                  checklists={subtask.checklists || []}
                  currentUser={currentUser}
                  onUpdateChecklists={(checklists) => {
                    const updatedSubtask = { ...subtaskRef.current, checklists };
                    syncSubtaskToParent(updatedSubtask);
                  }}
                />
                <ChecklistsSection
                  task={parentTask}
                  subtaskId={subtask.id}
                  users={workspaceUsers || []}
                  checklists={subtask.checklists || []}
                  currentUser={currentUser}
                  onUpdateChecklists={(checklists) => {
                    const updatedSubtask = { ...subtaskRef.current, checklists };
                    syncSubtaskToParent(updatedSubtask);
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
                    const updatedSubtask = { ...subtaskRef.current, attachments: (subtaskRef.current.attachments || []).filter((a: any) => a.id !== id) };
                    syncSubtaskToParent(updatedSubtask);
                  }}
                />
              </div>
            </div>
          </div >
        </div >

        {/* Right Panel: Activity Log */}
        <div className="w-[380px] bg-card flex flex-col border-l border-zinc-800/60 shrink-0 z-10">
          <div className="px-6 py-5 border-b border-zinc-800/60 shrink-0 flex items-center justify-between">
            <h3 className="font-semibold text-sm text-zinc-200">Activity</h3>
            <div className="flex gap-3">
              <span className="text-zinc-500 text-xs">Created {new Date(subtask.createdAt || Date.now()).toLocaleDateString()}</span>
            </div>
          </div>

          <div ref={activityScrollRef} onScroll={handleActivityScroll} className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            <div className="space-y-5">

              {/* Loading older activities indicator / trigger */}
              {hasOlderActivities && (
                <div className="py-2.5 flex justify-center items-center">
                  {isLoadingOlderActivities ? (
                    <div className="flex items-center gap-2 text-xs text-zinc-500 py-1">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                      <span>Loading earlier updates...</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={loadOlderActivities}
                      className="text-[11px] font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800/40 hover:bg-zinc-800/80 border border-zinc-800 transition-all flex items-center gap-1.5 py-1 px-3 rounded-full cursor-pointer"
                    >
                      <Clock className="w-3 h-3 text-zinc-500" />
                      <span>Load earlier updates ({olderActivitiesCount} remaining)</span>
                    </button>
                  )}
                </div>
              )}



              {/* Sort activities and comments oldest to newest */}
              {loadError && (
                <div className="text-red-400 text-sm p-4 mb-4 border border-red-500/20 bg-red-500/10 rounded-lg">
                  <p className="font-semibold mb-1">Failed to load activity logs</p>
                  <p className="opacity-80">{loadError}</p>
                </div>
              )}
              {loadingActivities ? <CommentSkeleton /> : (() => {
                const renderComment = (c: any, isReply = false) => {
                  const timeStr = new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const dateStr = new Date(c.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

                  const cGroups: Record<string, { count: number; users: string[]; hasMe: boolean }> = {};
                  (c.reactions || []).forEach((r: any) => {
                    if (!cGroups[r.emoji]) cGroups[r.emoji] = { count: 0, users: [], hasMe: false };
                    cGroups[r.emoji].count++;
                    cGroups[r.emoji].users.push(r.user?.name || '?');
                    if (r.userId === currentUser?.id) cGroups[r.emoji].hasMe = true;
                  });

                  const isEditing = editingCommentId === c.id;
                  return (
                    <div
                      key={c.id}
                      id={`comment-${c.id}`}
                      data-comment-id={c.id}
                      data-comment-text={(c.content || '').slice(0, 80)}
                      className={`group/comment flex flex-col gap-2 text-sm w-full min-w-0 max-w-full p-4 rounded-xl shadow-sm transition-all ${
                        isReply
                          ? 'mt-2 border'
                          : 'bg-card border border-zinc-800/60 mt-2'
                      }`}
                      style={{
                        ...(isReply
                          ? {
                              backgroundColor: 'color-mix(in srgb, var(--accent) 6%, var(--surface, #18181c))',
                              borderColor: isEditing
                                ? 'color-mix(in srgb, var(--accent) 55%, var(--border, #242429))'
                                : 'color-mix(in srgb, var(--accent) 25%, var(--border, #242429))',
                            }
                          : isEditing
                            ? {
                                borderColor: 'color-mix(in srgb, var(--accent) 55%, var(--border, #242429))',
                              }
                            : {}),
                        boxShadow: isEditing
                          ? '0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent), 0 4px 14px color-mix(in srgb, var(--accent) 12%, transparent)'
                            : undefined,
                      }}
                    >
                      <div className="flex items-center gap-3 w-full">
                        {c.user?.avatarUrl ? (
                          <img src={c.user.avatarUrl} alt={c.user?.name} className="w-8 h-8 rounded-full shrink-0 object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-indigo-600 shrink-0 flex items-center justify-center text-white text-[11px] font-bold">
                            {(c.user?.name || 'U').charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-zinc-200 font-medium text-[13px]">{c.user?.name || 'Someone'}</span>
                            <span className="text-[11px] text-zinc-500">{dateStr} {timeStr}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setFullscreenCommentId(c.id)}
                              className="opacity-0 group-hover/comment:opacity-100 transition-opacity text-zinc-300 hover:text-white p-1.5 rounded-md hover:bg-zinc-800/60 cursor-pointer"
                              title="Full screen view"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </button>
                            {c.user?.id === currentUser?.id && (
                              <Popover.Root>
                                <Popover.Trigger asChild>
                                  <button className="text-zinc-500 hover:text-zinc-300 transition-colors p-1" title="Comment Options">
                                    <MoreHorizontal className="w-3.5 h-3.5" />
                                  </button>
                                </Popover.Trigger>
                                <Popover.Portal>
                                  <Popover.Content
                                    className="w-32 bg-popover border border-border rounded-lg shadow-xl overflow-hidden z-[100000] p-1"
                                    align="end"
                                    onCloseAutoFocus={(e) => {
                                      e.preventDefault();
                                    }}
                                  >
                                    <Popover.Close asChild>
                                      <button onClick={(e) => { e.stopPropagation(); setEditingCommentId(c.id); setEditCommentText(c.content); }} className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent hover:text-foreground rounded-md transition-colors flex items-center gap-2 cursor-pointer">
                                        <Pencil className="w-3.5 h-3.5" /> Edit
                                      </button>
                                    </Popover.Close>
                                    <Popover.Close asChild>
                                      <button onClick={(e) => { e.stopPropagation(); setCommentToDelete(c.id); }} className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/15 hover:text-red-300 rounded-md transition-colors flex items-center gap-2 cursor-pointer">
                                        <Trash2 className="w-3.5 h-3.5" /> Delete
                                      </button>
                                    </Popover.Close>
                                  </Popover.Content>
                                </Popover.Portal>
                              </Popover.Root>
                            )}
                          </div>
                        </div>
                      </div>

                      {editingCommentId === c.id ? (
                        <div className="w-full mt-1.5">
                          <EditCommentForm
                            commentId={c.id}
                            initialContent={c.content || ''}
                            workspaceUsers={workspaceUsers}
                            currentUser={currentUser}
                            onSave={(newContent) => handleSaveEdit(c.id, newContent)}
                            onCancel={() => setEditingCommentId(null)}
                            onPreviewImage={setLightboxImage}
                          />
                        </div>
                      ) : (
                        <div className="text-zinc-300 text-[13.5px] leading-relaxed max-w-full break-words prose prose-sm prose-invert prose-p:my-0 [&_p:empty:not(:first-child):not(:last-child)]:min-h-[1.6em] prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:underline hover:prose-a:text-blue-700 dark:hover:prose-a:text-blue-300 prose-a:rounded-sm prose-a:transition-colors prose-img:rounded-md prose-img:my-2 prose-img:max-w-full w-full pl-11 select-text cursor-text">
                          <CommentMarkdown
                            content={c.content || ''}
                            components={isReply ? replyMarkdownComponents : markdownComponents}
                            onToggleChecklist={(itemIndex, checked) => handleToggleCommentChecklist(c.id, itemIndex, checked)}
                          />
                        </div>
                      )}

                      {/* Reaction pills */}
                      {Object.keys(cGroups).length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 pl-11">
                          {Object.entries(cGroups).map(([emoji, data]) => (
                            <button
                              key={emoji}
                              title={data.users.join(', ')}
                              onClick={() => handleToggleReaction(c.id, emoji)}
                              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] border transition-colors cursor-pointer ${data.hasMe ? 'bg-indigo-500/15 border-indigo-500/60 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/25' : 'bg-muted/70 border-border text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground'}`}
                            >
                              {emoji} <span className="font-medium">{data.count}</span>
                            </button>
                          ))}
                          <button
                            onClick={(e) => {
                              const btn = e.currentTarget;
                              if (showEmojiPickerFor === c.id) {
                                setShowEmojiPickerFor(null);
                                setEmojiPickerAnchor(null);
                              } else {
                                setShowEmojiPickerFor(c.id);
                                setEmojiPickerAnchor(btn);
                              }
                            }}
                            className="flex items-center justify-center w-5 h-5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-accent text-xs transition-colors cursor-pointer"
                            title="Add reaction"
                          >
                            +
                          </button>
                        </div>
                      )}

                      {/* Action row */}
                      <div className="flex items-center gap-1 mt-1 pl-11 relative">
                        <button
                          onClick={() => handleToggleReaction(c.id, '👍')}
                          className={`flex items-center justify-center w-6 h-6 rounded hover:bg-accent cursor-pointer transition-colors ${cGroups['👍']?.hasMe ? 'text-indigo-600 dark:text-indigo-400' : 'text-muted-foreground hover:text-foreground'}`}
                          title="Like"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              const btn = e.currentTarget;
                              if (showEmojiPickerFor === c.id) {
                                setShowEmojiPickerFor(null);
                                setEmojiPickerAnchor(null);
                              } else {
                                setShowEmojiPickerFor(c.id);
                                setEmojiPickerAnchor(btn);
                              }
                            }}
                            className="flex items-center justify-center w-6 h-6 rounded hover:bg-accent cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                            title="React"
                          >
                            <SmilePlus className="w-3.5 h-3.5" />
                          </button>
                          {showEmojiPickerFor === c.id && emojiPickerAnchor && (
                            <EmojiPicker
                              anchorEl={emojiPickerAnchor}
                              onSelect={(emoji) => {
                                handleToggleReaction(c.id, emoji);
                                setShowEmojiPickerFor(null);
                                setEmojiPickerAnchor(null);
                              }}
                              onClose={() => {
                                setShowEmojiPickerFor(null);
                                setEmojiPickerAnchor(null);
                              }}
                              placement="auto"
                            />
                          )}
                        </div>
                        {!isReply && (
                          <button
                            onClick={() => setReplyingToId(replyingToId === c.id ? null : c.id)}
                            className="flex items-center gap-1.5 px-2 h-6 rounded hover:bg-zinc-700/80 cursor-pointer text-zinc-500 hover:text-zinc-300 transition-colors text-[11px] font-medium ml-1"
                          >
                            <MessageSquare className="w-3 h-3" /> Reply {((c.replies?.length ?? c.replyCount) > 0) && `(${c.replies?.length ?? c.replyCount})`}
                          </button>
                        )}
                      </div>

                      {/* Reply input */}
                      {!isReply && replyingToId === c.id && (
                        <CommentReplyInput
                          commentId={c.id}
                          workspaceUsers={workspaceUsers || []}
                          currentUser={currentUser}
                          onSubmit={async (content, mentionIds) => {
                            await handleSubmitReply(c.id, content, mentionIds);
                          }}
                          onCancel={() => setReplyingToId(null)}
                        />
                      )}

                      {/* Replies */}
                      {!isReply && c.replies?.length > 0 && (
                        <div
                          className="pl-4 flex flex-col gap-2 mt-1 border-l-2 min-w-0 max-w-full"
                          style={{
                            borderLeftColor: 'color-mix(in srgb, var(--accent) 55%, var(--border, #242429))',
                          }}
                        >
                          {c.replies.map((r: any) => renderComment(r, true))}
                        </div>
                      )}
                    </div>
                  );
                };

                return (
                  <>
                    {/* Combined Timeline */}
                    {(paginatedCombined.length > 0 || (!hasOlderActivities && subtask?.createdAt)) && (() => {
                      const rawItems: any[] = [];
                      if (!hasOlderActivities && subtask?.createdAt) {
                        const creationTime = new Date(subtask.createdAt).getTime();
                        rawItems.push({
                          isCreationEvent: true,
                          sortDate: paginatedCombined.length > 0
                            ? Math.min(isNaN(creationTime) ? Date.now() : creationTime, paginatedCombined[0].sortDate - 1)
                            : (isNaN(creationTime) ? Date.now() : creationTime),
                        });
                      }
                      rawItems.push(...paginatedCombined);

                      // Group rawItems by day (YYYY-MM-DD)
                      interface DayGroup {
                        dayKey: string;
                        date: Date | number | string;
                        isNew: boolean;
                        items: any[];
                      }

                      const dayGroups: DayGroup[] = [];
                      let currentDayGroup: DayGroup | null = null;

                      rawItems.forEach(item => {
                        const itemDate = item.sortDate || (item.createdAt ? new Date(item.createdAt).getTime() : Date.now());
                        const dayKey = getDayKey(itemDate);

                        if (!currentDayGroup || currentDayGroup.dayKey !== dayKey) {
                          const isNew = isTodayDate(itemDate);
                          currentDayGroup = {
                            dayKey,
                            date: itemDate,
                            isNew,
                            items: [item],
                          };
                          dayGroups.push(currentDayGroup);
                        } else {
                          currentDayGroup.items.push(item);
                        }
                      });

                      const renderTimelineItem = (item: any) => {
                            if (item.isCreationEvent) {
                              return (
                                <div key="subtask-initial-creation" className="flex gap-4 text-sm text-zinc-400 items-start mb-2">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
                                  <div className="flex-1 leading-relaxed">
                                    <span className="text-zinc-200 font-medium">{subtask.creator?.name || 'System'}</span> created this subtask
                                  </div>
                                  <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                    {new Date(subtask.createdAt || Date.now()).toLocaleDateString()}
                                  </span>
                                </div>
                              );
                            }
                            if (item.isShowMore) {
                              return (
                                <button
                                  key={`show-more-${item.blockId}`}
                                  onClick={() => setExpandedBlocks(prev => [...prev, item.blockId])}
                                  className="flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors w-full py-2 mb-2"
                                >
                                  <ChevronRight className="w-4 h-4" />
                                  Show more
                                </button>
                              );
                            }
                            if (item.isShowLess) {
                              return (
                                <button
                                  key={`show-less-${item.blockId}`}
                                  onClick={() => setExpandedBlocks(prev => prev.filter(id => id !== item.blockId))}
                                  className="flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors w-full py-2 mb-2"
                                >
                                  <ChevronDown className="w-4 h-4" />
                                  Show less
                                </button>
                              );
                            }
                            if (item.isActivityType) {
                            const act = item;
                            const timeStr = new Date(act.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            if (act.type === 'status_change') {
                              return (
                                <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start mb-2">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                  <div className="flex-1 leading-relaxed">
                                    <span className="inline-block px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1 mb-1">{act.author || 'Someone'}</span>
                                    changed status
                                    {act.oldStatus && (
                                      <> from <span
                                          className={`font-medium px-1.5 py-0.5 rounded text-[11px] mx-1 inline-block whitespace-nowrap ${!(listStatuses?.find((s: any) => (s.name || s.title || s.status) === act.oldStatus))?.color ? (STATUS_COLORS[(act.oldStatus || '').toUpperCase()] || 'bg-zinc-800 text-zinc-300') : 'on-solid text-white shadow-sm'}`}
                                          style={(listStatuses?.find((s: any) => (s.name || s.title || s.status) === act.oldStatus))?.color ? { backgroundColor: getHexColor((listStatuses?.find((s: any) => (s.name || s.title || s.status) === act.oldStatus))?.color) } : {}}
                                        >
                                          {act.oldStatus}
                                        </span></>
                                    )}
                                    {' '}to <span
                                        className={`font-medium px-1.5 py-0.5 rounded text-[11px] ml-1 inline-block whitespace-nowrap ${!(listStatuses?.find((s: any) => (s.name || s.title || s.status) === act.newStatus))?.color ? (STATUS_COLORS[(act.newStatus || '').toUpperCase()] || 'bg-blue-500/10 text-blue-400') : 'on-solid text-white shadow-sm'}`}
                                        style={(listStatuses?.find((s: any) => (s.name || s.title || s.status) === act.newStatus))?.color ? { backgroundColor: getHexColor((listStatuses?.find((s: any) => (s.name || s.title || s.status) === act.newStatus))?.color) } : {}}
                                      >
                                        {act.newStatus}
                                      </span>
                                  </div>
                                  <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                    {timeStr}
                                  </span>
                                </div>
                              );
                            }
                            if (act.type === 'assignment' || act.type === 'unassignment' || act.type === 'add_follower' || act.type === 'remove_follower' || act.type === 'followers_change') {
                              const actorName = act.author === currentUser?.name ? 'You' : (act.author || 'Someone');

                              return (
                                <div key={act.id} className="flex justify-between items-center text-sm text-zinc-400 py-1 mb-2">
                                  <div className="flex gap-2 items-center">
                                    <span className="text-zinc-500 text-lg leading-none mt-[-2px]">&bull;</span>
                                    <span>
                                      {actorName} {describeAssigneeActivity(act, currentUser?.name)}
                                    </span>
                                  </div>
                                  <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                    {timeStr}
                                  </span>
                                </div>
                              );
                            }
                            if (act.type === 'title_change') {
                              return renderTitleChangeActivity(act, currentUser?.name);
                            }
                            if (act.type === 'priority_change') {
                              return (
                                <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start mb-2">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                  <div className="flex-1 leading-relaxed">
                                    <span className="inline-block px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1 mb-1">{act.author || 'Someone'}</span>
                                    changed priority{' '}
                                    {act.oldPriority && (
                                      <>from <span className={`font-medium px-1 ${getPriorityConfig(act.oldPriority).color}`}>{getPriorityConfig(act.oldPriority).label}</span> </>
                                    )}
                                    to{' '}
                                    <span className={`font-medium ${getPriorityConfig(act.newPriority).color}`}>{getPriorityConfig(act.newPriority).label}</span>
                                  </div>
                                  <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                    {timeStr}
                                  </span>
                                </div>
                              );
                            }
                            if (act.type === 'create_subtask') {
                              return (
                                <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start mb-2">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                  <div className="flex-1 leading-relaxed">
                                    <span className="inline-block px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1 mb-1">{act.author || 'Someone'}</span>
                                    created subtask <span className="text-zinc-200 font-medium px-1">{act.subtaskTitle}</span>
                                  </div>
                                  <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                    {timeStr}
                                  </span>
                                </div>
                              );
                            }
                            if (act.type === 'team_role_change') {
                              return (
                                <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start mb-2">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-pink-500 shrink-0" />
                                  <div className="flex-1 leading-relaxed">
                                    <span className="inline-block px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1 mb-1">{act.author || 'Someone'}</span>
                                    updated team roles
                                  </div>
                                  <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                    {timeStr}
                                  </span>
                                </div>
                              );
                            }
                            if (act.type === 'attachment') {
                              return (
                                <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start mb-2">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
                                  <div className="flex-1 leading-relaxed">
                                    <span className="inline-block px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1 mb-1">{act.author || 'Someone'}</span>
                                    attached a file:{' '}
                                    <span className="text-zinc-300 font-medium">{act.fileName}</span>
                                  </div>
                                  <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                    {timeStr}
                                  </span>
                                </div>
                              );
                            }
                            if (act.type === 'audit_item_checked' || act.type === 'checklist_item_checked') {
                              const isAudit = act.type === 'audit_item_checked' || act.isAudit;
                              const actorName = act.author === currentUser?.name ? 'You' : (act.author || 'Someone');
                              const itemName = act.itemName || 'item';
                              return (
                                <div key={act.id} className="flex gap-4 text-sm text-zinc-400 items-start mb-2">
                                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                                  <div className="flex-1 leading-relaxed">
                                    <span className="inline-block px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium text-[11px] mr-1 mb-1">{actorName}</span>
                                    checked {isAudit ? 'audit item' : 'checklist item'} <span className="text-zinc-200 font-medium px-1">"{itemName}"</span>
                                  </div>
                                  <span className="text-xs text-zinc-500 shrink-0 whitespace-nowrap">
                                    {timeStr}
                                  </span>
                                </div>
                              );
                            }
                            return null;
                          } else {
                            return renderComment(item);
                          }
                        };

                        return (
                          <>
                            {dayGroups.map((dayGroup) => {
                              const isCollapsed = Boolean(collapsedDays[dayGroup.dayKey]);

                              let currentGroupKey: string | null = null;
                              let currentBlock: any[] = [];
                              const blocks: any[][] = [];

                              dayGroup.items.forEach(item => {
                                const key = item.isCreationEvent ? 'creation' : (item.isActivityType ? (item.type || 'activity') : 'comment');
                                if (currentGroupKey === null) {
                                  currentGroupKey = key;
                                  currentBlock.push(item);
                                } else if (currentGroupKey === key && item.isActivityType) {
                                  currentBlock.push(item);
                                } else {
                                  blocks.push(currentBlock);
                                  currentGroupKey = key;
                                  currentBlock = [item];
                                }
                              });
                              if (currentBlock.length > 0) blocks.push(currentBlock);

                              const dayTimelineItems: any[] = [];
                              blocks.forEach((block, bIdx) => {
                                const blockId = `${dayGroup.dayKey}-${bIdx}`;
                                const isExpanded = expandedBlocks.includes(blockId);
                                if (!block[0].isActivityType || block.length <= 1) {
                                  dayTimelineItems.push(...block);
                                } else if (isExpanded) {
                                  dayTimelineItems.push({ isShowLess: true, blockId });
                                  dayTimelineItems.push(...block);
                                } else {
                                  dayTimelineItems.push({ isShowMore: true, count: block.length - 1, blockId });
                                  dayTimelineItems.push(...block.slice(-1));
                                }
                              });

                                const visibleItems = dayGroup.items.filter(item => {
                                  if (item.isCreationEvent) return true;
                                  if (item.isActivityType) return isActivityVisible(item);
                                  return true; // rich comment
                                });
                                if (visibleItems.length === 0) return null;

                                const hasLogUpdateOrComment = dayGroup.items.some(item => {
                                  if (item.isCreationEvent) return false;
                                  if (item.isActivityType) return isActivityVisible(item);
                                  return true; // rich comment
                                });

                                return (
                                  <div key={`day-section-${dayGroup.dayKey}`} className="w-full">
                                    {hasLogUpdateOrComment && (
                                      <ActivityDayDivider
                                        date={dayGroup.date}
                                        isNew={dayGroup.isNew}
                                        isCollapsed={isCollapsed}
                                        itemCount={visibleItems.length}
                                        onToggleCollapse={() => toggleCollapseDay(dayGroup.dayKey)}
                                      />
                                    )}
                                    <AnimatePresence initial={false}>
                                      {(!isCollapsed || !hasLogUpdateOrComment) && (
                                        <motion.div
                                          key={`day-content-${dayGroup.dayKey}`}
                                          initial={{ height: 0, opacity: 0 }}
                                          animate={{ height: 'auto', opacity: 1 }}
                                          exit={{ height: 0, opacity: 0 }}
                                          transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
                                          className="overflow-hidden space-y-4 pt-1"
                                        >
                                          {dayTimelineItems.map((item) => renderTimelineItem(item))}
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                );
                            })}
                          </>
                        );
                  })()}
                </>
              );
            })()}

            </div>
          </div>

          <div className="p-4 bg-card border-t border-zinc-800/60 shrink-0">
            <div className="relative">
              {stagedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2.5 mb-2">
                  {stagedFiles.map((file, i) => {
                    const isImage = file.type.startsWith('image/');
                    const previewUrl = isImage ? URL.createObjectURL(file) : null;
                    const ext = getFileExtension(file.name);
                    const isSoftWarning = isImage ? file.size > IMAGE_SOFT_MAX_BYTES : file.size > ATTACHMENT_SOFT_MAX_BYTES;
                    const softLimitLabel = isImage ? '>3MB' : '>10MB';
                    const sizeFormatted = formatFileSize(file.size);
                    return (
                      <div key={i} className={`relative group flex items-center justify-center bg-zinc-900 rounded-lg border ${isSoftWarning ? 'border-amber-500/60 ring-1 ring-amber-500/30' : 'border-indigo-500/40 ring-1 ring-indigo-500/20'} w-16 h-16 shrink-0 overflow-hidden shadow-sm`}>
                        {isImage && previewUrl ? (
                          <>
                            <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
                            <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-white font-medium text-center py-0.5">
                              {sizeFormatted}
                            </span>
                            {isSoftWarning && (
                              <span className="absolute top-1 left-1 bg-amber-500 text-black text-[7px] font-bold px-1 rounded shadow" title={`Large image: ${sizeFormatted} (soft limit >3MB)`}>
                                {softLimitLabel}
                              </span>
                            )}
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center p-1 text-center w-full">
                            <FileText className={`w-4 h-4 ${isSoftWarning ? 'text-amber-400' : 'text-indigo-400'} mb-0.5`} />
                            <span className={`text-[8px] font-bold tracking-wider uppercase px-1 py-0.2 rounded ${isSoftWarning ? 'bg-amber-500/15 text-amber-400' : 'bg-indigo-500/15 text-indigo-400'}`}>
                              {ext}
                            </span>
                            <span className="text-[9px] text-zinc-300 font-medium truncate max-w-[50px] mt-0.5" title={file.name}>
                              {file.name}
                            </span>
                            <span className="text-[7px] text-zinc-500 font-mono mt-0.2">
                              {sizeFormatted}
                            </span>
                            {isSoftWarning && (
                              <span className="absolute top-1 left-1 bg-amber-500 text-black text-[7px] font-bold px-1 rounded shadow" title={`Large attachment: ${sizeFormatted} (soft limit >10MB)`}>
                                {softLimitLabel}
                              </span>
                            )}
                          </div>
                        )}
                        <button
                          onClick={() => setStagedFiles(prev => prev.filter((_, idx) => idx !== i))}
                          title="Remove"
                          className="absolute top-1 right-1 p-0.5 bg-black/80 hover:bg-red-600 border border-zinc-700/80 rounded-full text-zinc-300 hover:text-white shadow-sm backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {(() => {
                const filteredMentionUsers = (workspaceUsers || []).filter(u =>
                  (u.name || '').toLowerCase().includes(mentionSearch.toLowerCase()) ||
                  (u.email || '').toLowerCase().includes(mentionSearch.toLowerCase())
                );

                const handleSelectMentionUser = (u: any) => {
                  const matchLength = mentionSearch.length + 1;
                  commentEditorRef.current?.insertMention(u.name || '', matchLength, u.id);
                  setShowMentionMenu(false);
                  if (!mentionedUsers.some(m => m.id === u.id)) {
                    setMentionedUsers(prev => [...prev, { id: u.id, name: u.name }]);
                  }
                  triggerMentionConfetti(u);
                };

                return (
                  <>
                    {showMentionMenu && (
                      <div className="absolute bottom-full left-0 mb-2 w-72 bg-popover border border-border rounded-xl shadow-2xl overflow-hidden z-[100000] animate-in fade-in zoom-in-95 duration-100">
                        <div className="p-2 border-b border-border text-xs font-semibold text-muted-foreground bg-accent/40 flex items-center justify-between">
                          <span>People</span>
                          <span className="text-[10px] text-muted-foreground font-normal">↑↓ navigate, Enter/Tab select</span>
                        </div>
                        <div ref={subtaskMentionListRef} className="max-h-52 overflow-y-auto custom-scrollbar relative">
                          {filteredMentionUsers.map((u, idx) => {
                            const isSelected = idx === mentionSelectedIndex;
                            const targetUrl = u.confettiUrl || u.avatarUrl;
                            if (idx < 5 && targetUrl) {
                              preloadMentionConfettiImage(targetUrl);
                            }
                            return (
                              <div
                                key={u.id}
                                onMouseEnter={() => setMentionSelectedIndex(idx)}
                                onClick={() => handleSelectMentionUser(u)}
                                style={
                                  isSelected
                                    ? {
                                        backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)',
                                      }
                                    : undefined
                                }
                                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer text-sm transition-colors ${
                                  isSelected ? 'text-foreground font-medium' : 'text-foreground/80 hover:bg-accent/50'
                                }`}
                              >
                                {u.avatarUrl ? (
                                  <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                                ) : (
                                  <div
                                    style={{
                                      backgroundColor: 'color-mix(in srgb, var(--accent) 20%, transparent)',
                                      color: 'var(--accent)',
                                    }}
                                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                                  >
                                    {(u.name || '?').substring(0, 2).toUpperCase()}
                                  </div>
                                )}
                                <div className="flex flex-col min-w-0">
                                  <span className="text-xs font-medium truncate">{u.name}</span>
                                  {u.email && <span className="text-[10px] text-muted-foreground truncate">{u.email}</span>}
                                </div>
                              </div>
                            );
                          })}
                          {filteredMentionUsers.length === 0 && (
                            <div className="p-3 text-sm text-muted-foreground text-center">No users found</div>
                          )}
                        </div>
                      </div>
                    )}
                    <CommentEditor
                      ref={commentEditorRef}
                      id="subtask-comment"
                      value={comment}
                      onChange={(html, text, cursorPosition, textBefore) => {
                        setComment(html);
                        
                        // Mention logic
                        const textBeforeCursor = textBefore !== undefined
                          ? textBefore
                          : (text || "").substring(0, cursorPosition || 0);
                        const match = textBeforeCursor.match(/(?:^|\s)@([^\s@]*)$/);

                        if (match) {
                          setShowMentionMenu(true);
                          setMentionSearch(match[1]);
                          setMentionStartIndex(textBeforeCursor.lastIndexOf('@'));
                          setMentionSelectedIndex(0);
                        } else {
                          setShowMentionMenu(false);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (showMentionMenu && filteredMentionUsers.length > 0) {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setMentionSelectedIndex(prev => (prev + 1) % filteredMentionUsers.length);
                            return true;
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setMentionSelectedIndex(prev => (prev - 1 + filteredMentionUsers.length) % filteredMentionUsers.length);
                            return true;
                          }
                          if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault();
                            const targetUser = filteredMentionUsers[mentionSelectedIndex] || filteredMentionUsers[0];
                            if (targetUser) {
                              handleSelectMentionUser(targetUser);
                            }
                            return true;
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            setShowMentionMenu(false);
                            return true;
                          }
                        }
                        return false;
                      }}
                      onSubmit={handleAddComment}
                      onPasteFiles={addStagedFiles}
                      onDropFiles={addStagedFiles}
                      onUploadImage={uploadCommentImage}
                      onUploadImageUrl={copyCommentImage}
                      onUploadingChange={setIsUploadingInline}
                      disabled={isSubmittingComment}
                      placeholder={isSubmittingComment ? "Posting comment..." : "Write a comment..."}
                      footer={
                        <div className="flex items-center gap-1">
                          <ComposerToolButton onClick={() => commentFileInputRef.current?.click()} disabled={isUploading} title="Attach file or image">
                            <Paperclip className="w-4 h-4" />
                          </ComposerToolButton>
                          <ComposerToolButton
                            onClick={(e) => {
                              const btn = e.currentTarget;
                              setCommentEmojiAnchor(prev => prev ? null : btn);
                            }}
                            disabled={isSubmittingComment}
                            title="Add emoji"
                          >
                            <SmilePlus className="w-4 h-4" />
                          </ComposerToolButton>
                        </div>
                      }
                      footerEnd={
                        <ComposerSendButton
                          onClick={handleAddComment}
                          disabled={(isBlankCommentHtml(comment) && stagedFiles.length === 0) || isUploading || isUploadingInline || isSubmittingComment}
                          title={isUploadingInline ? 'Uploading image...' : 'Send comment'}
                        >
                          {isSubmittingComment ? 'Sending…' : 'Send'}
                        </ComposerSendButton>
                      }
                    />
                    {commentEmojiAnchor && (
                      <EmojiPicker
                        anchorEl={commentEmojiAnchor}
                        onSelect={(emoji) => {
                          commentEditorRef.current?.insertEmoji(emoji);
                          setCommentEmojiAnchor(null);
                        }}
                        onClose={() => setCommentEmojiAnchor(null)}
                        placement="top"
                      />
                    )}
                  </>
                );
              })()}
              <input type="file" ref={commentFileInputRef} className="hidden" onChange={handleCommentFileChange} />
            </div>
          </div>
        </div >
      </div >
      {commentToDelete && (
        <ConfirmDeleteModal
          isOpen={!!commentToDelete}
          onClose={() => setCommentToDelete(null)}
          onConfirm={() => handleDeleteComment(commentToDelete)}
          title="Delete Comment"
          itemName="this comment"
        />
      )}
      {/* Fullscreen Comment Modal */}
      <FullscreenCommentModal
        isOpen={!!activeFullscreenComment}
        onClose={() => setFullscreenCommentId(null)}
        comment={activeFullscreenComment}
        taskTitle={subtask?.title || parentTask?.title}
        parentTaskId={parentTask?.id || subtask?.id}
        currentUser={currentUser}
        workspaceUsers={workspaceUsers}
        onToggleReaction={handleToggleReaction}
        onSubmitReply={handleSubmitReply}
        onToggleChecklist={handleToggleCommentChecklist}
        onEdit={handleSaveEdit}
        onDelete={(cId) => setCommentToDelete(cId)}
        onPreviewImage={setLightboxImage}
      />
      {/* Lightbox Modal */}
      <ImageLightboxModal
        isOpen={!!lightboxImage}
        onClose={() => setLightboxImage(null)}
        currentSrc={lightboxImage}
        images={commentImages}
        onNavigate={setLightboxImage}
      />
      <ActionErrorModal
        isOpen={!!actionError}
        onClose={() => setActionError(null)}
        error={actionError}
      />
    </div>
  );
}

export function TaskDetailModal(props: Props) {
  const [mounted, setMounted] = useState(false);
  const [fullTask, setFullTask] = useState<Task | null>(props.task ?? null);
  const setModalTitle = useAppStore(state => state.setModalTitle);
  const lastTaskIdRef = useRef<string | null>(null);
  // Fields the user changed while the background fetch below was in flight; its (older) copy must not
  // overwrite them, or the edit appears to revert.
  const locallyEditedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
  }, []);

  // Dynamic Tab Title synchronization for Task Modal
  useEffect(() => {
    if (props.isOpen && (fullTask?.title || props.task?.title)) {
      setModalTitle(fullTask?.title || props.task?.title || 'Task');
    } else if (!props.isOpen) {
      setModalTitle(null);
    }
    return () => {
      setModalTitle(null);
    };
  }, [props.isOpen, fullTask?.title, props.task?.title, setModalTitle]);

  // Show modal instantly with prop data; then silently refresh in background
  useEffect(() => {
    if (props.isOpen && props.task?.id) {
      // If it's a new task, seed with prop immediately so modal renders without waiting
      if (lastTaskIdRef.current !== props.task.id) {
        lastTaskIdRef.current = props.task.id;
        setFullTask(props.task);
      }
      locallyEditedKeysRef.current = new Set();
      // Background refresh — don't block the modal with a loading state
      const loadFull = async () => {
        try {
          const res = await tasksApi.getTask(props.task!.id);
          if (res?.task) {
            setFullTask(prev => {
              if (!prev) return res.task;
              const canonicalStatus = props.task?.status || prev.status;
              const merged: any = { ...prev, ...res.task };
              locallyEditedKeysRef.current.forEach((key) => { merged[key] = (prev as any)[key]; });
              // The Kanban board status (props.task.status / prev.status) is canonical when the modal opens.
              // Background getTask is used only to enrich secondary details (comments, checklists, attachments, etc.)
              // and must not revert the live status unless the user explicitly changed it in this session.
              if (canonicalStatus && !locallyEditedKeysRef.current.has('status')) {
                const matchInList = props.listStatuses?.find(
                  (s: any) => (s.name || s.title || s.status || '').trim().toUpperCase() === canonicalStatus.trim().toUpperCase()
                );
                merged.status = matchInList ? (matchInList.name || matchInList.title || matchInList.status) : canonicalStatus;
              }
              return merged;
            });
          }
        } catch (err) {
          console.error(err);
        }
      };
      loadFull();
    } else if (!props.isOpen) {
      lastTaskIdRef.current = null;
      setFullTask(null);
    }
  }, [props.isOpen, props.task?.id]);

  // Sync prop changes (e.g. socket updates) without clobbering local optimistic state
  useEffect(() => {
    const incomingTask = props.task;
    if (props.isOpen && incomingTask && fullTask && incomingTask.id === fullTask.id) {
      setFullTask(prev => {
        if (!prev) return incomingTask;
        const merged = { ...prev, ...incomingTask };
        if (!incomingTask.subtasks && prev.subtasks) merged.subtasks = prev.subtasks;
        if (!incomingTask.checklists && prev.checklists) merged.checklists = prev.checklists;
        if (!incomingTask.comments && prev.comments) merged.comments = prev.comments;
        return merged;
      });
    }
  }, [props.task]);

  useEffect(() => {
    const handleTaskUpdated = (e: any) => {
      const incoming = e.detail?.task;
      if (!incoming || !fullTask || incoming.id !== fullTask.id) return;
      setFullTask(prev => prev ? { ...prev, ...incoming } : prev);
    };
    window.addEventListener('task:updated', handleTaskUpdated);
    return () => window.removeEventListener('task:updated', handleTaskUpdated);
  }, [fullTask?.id]);

  useEffect(() => {
    if (!props.socket || !fullTask?.id) return;
    const handleSocketTaskUpdated = (incoming: any) => {
      if (incoming && incoming.id === fullTask.id) {
        setFullTask(prev => {
          if (!prev) return prev;
          let status = incoming.status !== undefined ? incoming.status : prev.status;
          if (status && props.listStatuses) {
            const matchInList = props.listStatuses.find(
              (s: any) => (s.name || s.title || s.status || '').trim().toUpperCase() === status.trim().toUpperCase()
            );
            if (matchInList) status = matchInList.name || matchInList.title || matchInList.status;
          }
          return { ...prev, ...incoming, ...(status ? { status } : {}) };
        });
      }
    };
    const handleSocketTaskMovePreview = (data: { taskId: string; status: string }) => {
      if (data && data.taskId === fullTask.id && data.status) {
        let status = data.status;
        if (props.listStatuses) {
          const matchInList = props.listStatuses.find(
            (s: any) => (s.name || s.title || s.status || '').trim().toUpperCase() === status.trim().toUpperCase()
          );
          if (matchInList) status = matchInList.name || matchInList.title || matchInList.status;
        }
        setFullTask(prev => prev ? { ...prev, status } : prev);
      }
    };
    const handleSocketChecklistCreated = (payload: any) => {
      if (!payload || payload.taskId !== fullTask.id || !payload.checklist) return;
      setFullTask(prev => {
        if (!prev) return prev;
        let updated: any;
        if (!payload.subtaskId) {
          const exists = (prev.checklists || []).some(c => c.id === payload.checklist.id);
          if (exists) return prev;
          const checklists = [...(prev.checklists || []), payload.checklist];
          updated = { ...prev, checklists };
        } else {
          const subtasks = (prev.subtasks || []).map((st: any) => {
            if (st.id === payload.subtaskId) {
              const exists = (st.checklists || []).some((c: any) => c.id === payload.checklist.id);
              if (exists) return st;
              return { ...st, checklists: [...(st.checklists || []), payload.checklist] };
            }
            return st;
          });
          updated = { ...prev, subtasks };
        }
        if (props.onUpdateTask) props.onUpdateTask(updated);
        return updated;
      });
    };

    const handleSocketChecklistItemCreated = (payload: any) => {
      if (!payload || payload.taskId !== fullTask.id || !payload.item) return;
      setFullTask(prev => {
        if (!prev) return prev;
        let updated: any;
        if (!payload.subtaskId) {
          let found = false;
          const checklists = (prev.checklists || []).map(c => {
            if (c.id === payload.checklistId || (isNexusAuditChecklist(c) && (payload.item?.text?.startsWith('!') || ['instructions audit','design audit','ui ux audit','funnel audit'].includes(normalizeAuditName((payload.item?.text || '').replace(/^!\s*/, '')))))) {
              found = true;
              if ((c.items || []).some((i: any) => i.id === payload.item.id)) return c;
              const tempIdx = (c.items || []).findIndex((i: any) => typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text);
              if (tempIdx !== -1) {
                const newItems = [...c.items];
                newItems[tempIdx] = payload.item;
                return { ...c, items: newItems };
              }
              return { ...c, items: [...(c.items || []), payload.item] };
            }
            return c;
          });
          const isAudit = (payload.item?.text?.startsWith('!') || ['instructions audit','design audit','ui ux audit','funnel audit'].includes(normalizeAuditName((payload.item?.text || '').replace(/^!\s*/, ''))));
          const finalChecklists = found ? checklists : [
            ...(prev.checklists || []),
            {
              id: payload.checklistId,
              taskId: fullTask.id,
              name: isAudit ? 'Audit' : 'Checklist',
              createdAt: new Date().toISOString(),
              items: [payload.item],
            }
          ];
          updated = { ...prev, checklists: finalChecklists };
        } else {
          const subtasks = (prev.subtasks || []).map((st: any) => {
            if (st.id === payload.subtaskId) {
              let found = false;
              const checklists = (st.checklists || []).map((c: any) => {
                if (c.id === payload.checklistId || (isNexusAuditChecklist(c) && (payload.item?.text?.startsWith('!') || ['instructions audit','design audit','ui ux audit','funnel audit'].includes(normalizeAuditName((payload.item?.text || '').replace(/^!\s*/, '')))))) {
                  found = true;
                  if ((c.items || []).some((i: any) => i.id === payload.item.id)) return c;
                  const tempIdx = (c.items || []).findIndex((i: any) => typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text);
                  if (tempIdx !== -1) {
                    const newItems = [...c.items];
                    newItems[tempIdx] = payload.item;
                    return { ...c, items: newItems };
                  }
                  return { ...c, items: [...(c.items || []), payload.item] };
                }
                return c;
              });
              const isAudit = (payload.item?.text?.startsWith('!') || ['instructions audit','design audit','ui ux audit','funnel audit'].includes(normalizeAuditName((payload.item?.text || '').replace(/^!\s*/, ''))));
              const finalChecklists = found ? checklists : [
                ...(st.checklists || []),
                {
                  id: payload.checklistId,
                  taskId: fullTask.id,
                  subtaskId: payload.subtaskId,
                  name: isAudit ? 'Audit' : 'Checklist',
                  createdAt: new Date().toISOString(),
                  items: [payload.item],
                }
              ];
              return { ...st, checklists: finalChecklists };
            }
            return st;
          });
          updated = { ...prev, subtasks };
        }
        if (props.onUpdateTask) props.onUpdateTask(updated);
        return updated;
      });
    };

    const handleSocketChecklistUpdated = (payload: any) => {
      if (!payload || payload.taskId !== fullTask.id || !payload.item) return;
      setFullTask(prev => {
        if (!prev) return prev;
        let updated: any;
        if (!payload.subtaskId) {
          const checklists = (prev.checklists || []).map(c => {
            if (c.id === payload.checklistId || (isNexusAuditChecklist(c) && (payload.item?.text?.startsWith('!') || ['instructions audit','design audit','ui ux audit','funnel audit'].includes(normalizeAuditName((payload.item?.text || '').replace(/^!\s*/, '')))))) {
              const hasItem = (c.items || []).some((i: any) => i.id === payload.item.id || (typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text));
              if (hasItem) {
                const items = (c.items || []).map(i =>
                  (i.id === payload.item.id || (typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text))
                    ? { ...i, ...payload.item }
                    : i
                );
                return { ...c, items };
              } else {
                return { ...c, items: [...(c.items || []), payload.item] };
              }
            }
            return c;
          });
          updated = { ...prev, checklists };
        } else {
          const subtasks = (prev.subtasks || []).map((st: any) => {
            if (st.id === payload.subtaskId) {
              const checklists = (st.checklists || []).map((c: any) => {
                if (c.id === payload.checklistId || (isNexusAuditChecklist(c) && (payload.item?.text?.startsWith('!') || ['instructions audit','design audit','ui ux audit','funnel audit'].includes(normalizeAuditName((payload.item?.text || '').replace(/^!\s*/, '')))))) {
                  const hasItem = (c.items || []).some((i: any) => i.id === payload.item.id || (typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text));
                  if (hasItem) {
                    const items = (c.items || []).map((i: any) =>
                      (i.id === payload.item.id || (typeof i.id === 'string' && i.id.startsWith('temp-') && i.text === payload.item.text))
                        ? { ...i, ...payload.item }
                        : i
                    );
                    return { ...c, items };
                  } else {
                    return { ...c, items: [...(c.items || []), payload.item] };
                  }
                }
                return c;
              });
              return { ...st, checklists };
            }
            return st;
          });
          updated = { ...prev, subtasks };
        }
        if (props.onUpdateTask) props.onUpdateTask(updated);
        return updated;
      });
    };

    const handleSocketChecklistItemDeleted = (payload: any) => {
      if (!payload || payload.taskId !== fullTask.id) return;
      setFullTask(prev => {
        if (!prev) return prev;
        let updated: any;
        if (!payload.subtaskId) {
          const checklists = (prev.checklists || []).map((c: any) => {
            if (c.id === payload.checklistId || isNexusAuditChecklist(c)) {
              const items = (c.items || []).filter((i: any) => {
                if (i.id === payload.itemId) return false;
                if (payload.text && i.text === payload.text) return false;
                return true;
              });
              return { ...c, items };
            }
            return c;
          });
          updated = { ...prev, checklists };
        } else {
          const subtasks = (prev.subtasks || []).map((st: any) => {
            if (st.id === payload.subtaskId) {
              const checklists = (st.checklists || []).map((c: any) => {
                if (c.id === payload.checklistId || isNexusAuditChecklist(c)) {
                  const items = (c.items || []).filter((i: any) => {
                    if (i.id === payload.itemId) return false;
                    if (payload.text && i.text === payload.text) return false;
                    return true;
                  });
                  return { ...c, items };
                }
                return c;
              });
              return { ...st, checklists };
            }
            return st;
          });
          updated = { ...prev, subtasks };
        }
        if (props.onUpdateTask) props.onUpdateTask(updated);
        return updated;
      });
    };

    const handleSocketChecklistDeleted = (payload: any) => {
      if (!payload || payload.taskId !== fullTask.id) return;
      setFullTask(prev => {
        if (!prev) return prev;
        let updated: any;
        if (!payload.subtaskId) {
          const checklists = (prev.checklists || []).filter((c: any) => c.id !== payload.checklistId);
          updated = { ...prev, checklists };
        } else {
          const subtasks = (prev.subtasks || []).map((st: any) => {
            if (st.id === payload.subtaskId) {
              const checklists = (st.checklists || []).filter((c: any) => c.id !== payload.checklistId);
              return { ...st, checklists };
            }
            return st;
          });
          updated = { ...prev, subtasks };
        }
        if (props.onUpdateTask) props.onUpdateTask(updated);
        return updated;
      });
    };

    props.socket.on('task:updated', handleSocketTaskUpdated);
    props.socket.on('task_move_preview', handleSocketTaskMovePreview);
    props.socket.on('task:checklist_created', handleSocketChecklistCreated);
    props.socket.on('task:checklist_item_updated', handleSocketChecklistUpdated);
    props.socket.on('task:checklist_item_created', handleSocketChecklistItemCreated);
    props.socket.on('task:checklist_item_deleted', handleSocketChecklistItemDeleted);
    props.socket.on('task:checklist_deleted', handleSocketChecklistDeleted);

    return () => {
      props.socket.off('task:updated', handleSocketTaskUpdated);
      props.socket.off('task_move_preview', handleSocketTaskMovePreview);
      props.socket.off('task:checklist_created', handleSocketChecklistCreated);
      props.socket.off('task:checklist_item_updated', handleSocketChecklistUpdated);
      props.socket.off('task:checklist_item_created', handleSocketChecklistItemCreated);
      props.socket.off('task:checklist_item_deleted', handleSocketChecklistItemDeleted);
      props.socket.off('task:checklist_deleted', handleSocketChecklistDeleted);
    };
  }, [props.socket, fullTask?.id, props.listStatuses]);

  useEffect(() => {
    if (!props.isOpen) return;
    const handleOpenTaskDetail = async (e: any) => {
      const { taskId, subtaskId, task: providedTask } = e.detail || {};
      if (!taskId) return;
      if (props.onUpdateTask && providedTask) {
        props.onUpdateTask(providedTask);
      }
      if (providedTask && providedTask.id === taskId) {
        setFullTask(providedTask);
      } else {
        try {
          const res = await tasksApi.getTask(taskId);
          if (res?.task) {
            setFullTask(res.task);
          }
        } catch (err) {
          console.error('[TaskDetailModal] Failed to switch task:', err);
        }
      }
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('task', taskId);
        if (subtaskId) url.searchParams.set('subtask', subtaskId);
        else url.searchParams.delete('subtask');
        window.history.pushState(null, '', url.pathname + url.search);
      }
    };
    window.addEventListener('open-task-detail', handleOpenTaskDetail);
    return () => window.removeEventListener('open-task-detail', handleOpenTaskDetail);
  }, [props.isOpen]);

  useEffect(() => {
    if (props.mode === 'modal' && props.isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [props.isOpen, props.mode]);


  const handleUpdateTask = (updatedTask: Task) => {
    if (fullTask) {
      for (const key of Object.keys(updatedTask)) {
        if ((updatedTask as any)[key] !== (fullTask as any)[key]) locallyEditedKeysRef.current.add(key);
      }
    }
    setFullTask(updatedTask);
    if (props.onUpdateTask) props.onUpdateTask(updatedTask);
  };

  if (!mounted || typeof document === 'undefined') return null;

  if (props.mode === 'full') {
    const portalTarget = document.getElementById('nexus-task-modal-portal');
    const fullContent = (
      <AnimatePresence>
        {props.isOpen && fullTask && (
          <motion.div
            key="full-modal"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 1 }}
            transition={{ duration: 0 }}
            className="absolute inset-0 z-[80] bg-background flex flex-col cursor-default"
          >
            <TaskDetailModalContent
              {...props}
              task={fullTask}
              onUpdateTask={handleUpdateTask}
            />
          </motion.div>
        )}
      </AnimatePresence>
    );

    if (portalTarget) {
      return createPortal(fullContent, portalTarget);
    }
    return fullContent;
  }

  return createPortal(
    <AnimatePresence>
      {props.isOpen && fullTask && (
        <div
          key="modal-backdrop"
          data-task-detail-modal=""
          className="fixed inset-0 z-[99999] bg-black/80 flex items-center justify-center p-4 cursor-pointer"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              props.onClose();
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="w-full max-w-7xl h-[90vh] rounded-xl overflow-hidden shadow-2xl border border-border flex flex-col cursor-default"
          >
            <TaskDetailModalContent
              {...props}
              task={fullTask}
              onUpdateTask={handleUpdateTask}
            />
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

// Force hot reload

