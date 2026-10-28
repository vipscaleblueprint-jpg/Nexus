'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  UserPlus,
  UserMinus,
  Check,
  CheckCircle2,
  ShieldCheck,
  RefreshCw,
  Clock,
  CheckSquare,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { format } from 'date-fns';
import { CommentContent } from '@/components/ui/CommentContent';
import { useAppStore } from '@/lib/store';

export interface ActivityCardProps {
  id: string;
  type: string;
  actorId?: string;
  actorName: string;
  actorAvatar?: string | null;
  taskTitle: string;
  isSubtask?: boolean;
  subtaskTitle?: string;
  title: string;
  content?: string | null;
  isRead: boolean;
  isGreyed?: boolean;
  createdAt: string;
  details?: any;
  compact?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onClear?: (e: React.MouseEvent) => void;
  onMarkAsRead?: (e: React.MouseEvent) => void;
  onPreviewImage?: (src: string, allImages?: string[]) => void;
  customStatusColor?: string;
}

const AVATAR_PALETTE = [
  'bg-[#d97706]', // amber/orange (Mimi)
  'bg-[#7c3aed]', // purple/violet (Cherilyn, Ria, Hannah, Pau2x)
  'bg-[#16a34a]', // green (Patrick)
  'bg-[#0d9488]', // teal (Jon)
  'bg-[#2563eb]', // blue
  'bg-[#e11d48]', // rose
  'bg-[#ea580c]', // orange-red
  'bg-[#6366f1]', // indigo
];

export function getAvatarBg(name: string): string {
  if (!name) return AVATAR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export function StatusPill({
  status,
  color,
  isGreyed = false,
}: {
  status: string;
  color?: string;
  isGreyed?: boolean;
}) {
  if (!status) return null;
  const clean = status.trim().toUpperCase().replace(/_/g, ' ');

  // Default / fallback
  let pillClasses =
    'bg-amber-500/15 text-amber-500 dark:text-amber-400 border-amber-500/30 [.theme-light_&]:bg-amber-50 [.theme-light_&]:text-amber-700 [.theme-light_&]:border-amber-200';

  if (
    clean === 'CLOSED' ||
    clean === 'DONE' ||
    clean === 'COMPLETE' ||
    clean === 'COMPLETED'
  ) {
    pillClasses =
      'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 border-emerald-500/30 [.theme-light_&]:bg-emerald-50 [.theme-light_&]:text-emerald-700 [.theme-light_&]:border-emerald-200';
  } else if (clean === 'IN PROGRESS' || clean === 'IN_PROGRESS') {
    pillClasses =
      'bg-blue-500/15 text-blue-500 dark:text-blue-400 border-blue-500/30 [.theme-light_&]:bg-blue-50 [.theme-light_&]:text-blue-700 [.theme-light_&]:border-blue-200';
  } else if (clean === 'WAITING' || clean === 'PENDING') {
    pillClasses =
      'bg-amber-500/15 text-amber-500 dark:text-amber-400 border-amber-500/30 [.theme-light_&]:bg-amber-50 [.theme-light_&]:text-amber-700 [.theme-light_&]:border-amber-200';
  } else if (clean === 'IN REVIEW' || clean === 'IN_REVIEW' || clean === 'REVIEW') {
    pillClasses =
      'bg-orange-500/15 text-orange-500 dark:text-orange-400 border-orange-500/30 [.theme-light_&]:bg-orange-50 [.theme-light_&]:text-orange-700 [.theme-light_&]:border-orange-200';
  }

  const greyedModifier = isGreyed ? 'opacity-80 saturate-[0.85]' : '';

  if (color) {
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider select-none leading-none border ${greyedModifier}`}
        style={{
          backgroundColor: `${color}20`,
          color: color,
          borderColor: `${color}40`,
        }}
      >
        {clean}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider select-none leading-none border ${pillClasses} ${greyedModifier}`}
    >
      {clean}
    </span>
  );
}

export function ActivityCard({
  id,
  type,
  actorId,
  actorName,
  actorAvatar,
  taskTitle,
  isSubtask = false,
  subtaskTitle,
  title,
  content,
  isRead,
  isGreyed = false,
  createdAt,
  details,
  compact = false,
  onClick,
  onMouseEnter,
  onClear,
  onMarkAsRead,
  onPreviewImage,
  customStatusColor,
}: ActivityCardProps) {
  const currentUser = useAppStore((state) => state.currentUser);
  const normType = (type || '').toUpperCase();
  const initial = (actorName || 'U').trim().charAt(0).toUpperCase();
  const avatarBg = getAvatarBg(actorName);

  const [isExpanded, setIsExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const contentWrapperRef = useRef<HTMLDivElement>(null);

  const maxHeight = compact ? 120 : 160;

  useEffect(() => {
    const el = contentWrapperRef.current;
    if (!el) return;

    const checkOverflow = () => {
      if (el.scrollHeight > maxHeight + 10) {
        setCanExpand(true);
      } else {
        setCanExpand(false);
      }
    };

    checkOverflow();

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);
    return () => observer.disconnect();
  }, [content, maxHeight]);

  // Determine micro-badge icon
  let MicroIcon = MessageSquare;
  if (normType === 'UNASSIGNMENT' || (normType === 'ASSIGNMENT' && title.includes('unassigned'))) {
    MicroIcon = UserMinus;
  } else if (normType === 'ASSIGNMENT') {
    MicroIcon = UserPlus;
  } else if (
    normType === 'STATUS_CHANGE' ||
    title.toLowerCase().includes('changed status')
  ) {
    MicroIcon = RefreshCw;
  } else if (normType === 'AUDIT_ITEM_CHECKED' || title.toLowerCase().includes('auditing')) {
    MicroIcon = CheckCircle2;
  } else if (
    normType === 'CHECKLIST_ITEM_CHECKED' ||
    normType === 'CHECKLIST_ITEM_ASSIGNED' ||
    title.toLowerCase().includes('checklist')
  ) {
    MicroIcon = Check;
  } else if (
    normType === 'COMMENT' ||
    normType === 'REPLY' ||
    normType === 'MENTION'
  ) {
    MicroIcon = MessageSquare;
  }

  // Format timestamp (time only as shown in screenshots: "9:42 AM", "10:26 PM")
  let formattedTime = '';
  try {
    const d = new Date(createdAt);
    if (!isNaN(d.getTime())) {
      formattedTime = format(d, 'h:mm a');
    }
  } catch {
    formattedTime = '';
  }

  // Check for Mention - only true if this notification is an actual mention for the recipient
  const isMention =
    normType === 'MENTION' ||
    title.toLowerCase().includes('mentioned you');

  // Check if current user is the actor
  const isActorCurrentUser = Boolean(
    (currentUser?.id &&
      (actorId === currentUser.id ||
        details?.userId === currentUser.id ||
        (actorName && currentUser.name && actorName.trim().toLowerCase() === currentUser.name.trim().toLowerCase()))) ||
      (actorName && actorName.trim().toLowerCase() === 'you')
  );

  // Check if content or details mention someone
  const contentText = `${content || ''} ${details?.text || ''}`;
  const hasMention =
    /mention:\/\/[A-Za-z0-9_-]+/i.test(contentText) ||
    (Array.isArray(details?.mentionedUserIds) && details.mentionedUserIds.length > 0) ||
    (Array.isArray(details?.mentionedUsers) && details.mentionedUsers.length > 0) ||
    /(?:^|\s)@([a-zA-Z0-9_\-]+)/i.test(contentText);

  // Check for "You mentioned" - current user commented or replied and mentioned someone
  const isYouMentioned =
    !isMention &&
    isActorCurrentUser &&
    hasMention &&
    (normType === 'COMMENT' ||
      normType === 'REPLY' ||
      title.toLowerCase().includes('commented') ||
      title.toLowerCase().includes('replied'));

  // Extract display task / subtask title
  const effectiveTaskTitle = subtaskTitle || taskTitle || 'task';
  const effectiveIsSubtask = isSubtask || title.toLowerCase().includes('subtask');

  // Parse title & status details
  const renderTitleContent = () => {
    const actorClass = isGreyed
      ? 'font-medium text-zinc-400 dark:text-zinc-400'
      : 'font-medium text-foreground';
    const actionClass = isGreyed
      ? 'text-zinc-500 dark:text-zinc-500 font-normal'
      : 'text-muted-foreground font-normal';
    const taskClass = isGreyed
      ? 'font-medium text-zinc-300 dark:text-zinc-300'
      : 'font-medium text-foreground';
    const mentionClass = isGreyed
      ? 'bg-blue-500/10 text-blue-400/80 border-blue-500/20'
      : 'bg-blue-500/15 text-blue-400 border-blue-500/30 [.theme-light_&]:bg-blue-50 [.theme-light_&]:text-blue-700 [.theme-light_&]:border-blue-200';

    // 1. Status Change
    if (
      normType === 'STATUS_CHANGE' ||
      title.toLowerCase().includes('changed status')
    ) {
      let oldStatus = details?.oldStatus;
      let newStatus = details?.newStatus;

      if (!newStatus) {
        const arrowMatch = title.match(/([A-Z\s_\-]+)\s*(?:→|->)\s*([A-Z\s_\-]+)/i);
        if (arrowMatch) {
          oldStatus = arrowMatch[1].trim();
          newStatus = arrowMatch[2].trim();
        } else {
          const fromToMatch = title.match(/status from\s+(.+?)\s+to\s+(.+?)(?:\s+on|\s*$)/i);
          if (fromToMatch) {
            oldStatus = fromToMatch[1].trim();
            newStatus = fromToMatch[2].trim();
          } else {
            const toMatch = title.match(/status to\s+(.+?)(?:\s+on|\s*$)/i);
            if (toMatch) {
              newStatus = toMatch[1].trim();
            }
          }
        }
      }

      return (
        <span className="leading-snug">
          <span className={actorClass}>{actorName}</span>
          <span className={actionClass}> changed status on </span>
          {effectiveIsSubtask && <span className={actionClass}>subtask </span>}
          <span className={taskClass}>{effectiveTaskTitle}</span>
          {newStatus && (
            <span className="inline-flex items-center ml-1.5 align-middle gap-1 flex-wrap">
              {oldStatus && (
                <>
                  <StatusPill status={oldStatus} isGreyed={isGreyed} />
                  <span className={`${isGreyed ? 'text-zinc-600' : 'text-muted-foreground/60'} font-normal select-none`}>→</span>
                </>
              )}
              <StatusPill status={newStatus} color={customStatusColor} isGreyed={isGreyed} />
            </span>
          )}
        </span>
      );
    }

    // 2. Audit Item Checked
    if (normType === 'AUDIT_ITEM_CHECKED' || title.toLowerCase().includes('auditing')) {
      let auditText = 'design and instructions';
      const rawText = title.toLowerCase();
      if (rawText.includes('all auditing')) {
        auditText = 'all';
      } else {
        const types: string[] = [];
        if (rawText.includes('funnel')) types.push('funnel');
        if (rawText.includes('design')) types.push('design');
        if (rawText.includes('instruction')) types.push('instructions');
        if (rawText.includes('ui') || rawText.includes('ux')) types.push('UI UX');
        if (types.length > 1) {
          const last = types.pop();
          auditText = `${types.join(', ')} and ${last}`;
        } else if (types.length === 1) {
          auditText = types[0];
        }
      }

      return (
        <span className="leading-snug">
          <span className={actorClass}>{actorName}</span>
          <span className={actionClass}> checked {auditText} auditing on </span>
          {effectiveIsSubtask && <span className={actionClass}>subtask </span>}
          <span className={taskClass}>{effectiveTaskTitle}</span>
        </span>
      );
    }

    // 3. Checklist Item Completed
    if (
      normType === 'CHECKLIST_ITEM_CHECKED' ||
      title.toLowerCase().includes('checklist items in') ||
      title.toLowerCase().includes('checklist item in')
    ) {
      let countText = 'checklist items';
      const match = title.match(/completed\s+(\d+)\s+checklist items?/i);
      if (match) {
        countText = `${match[1]} checklist items`;
      } else {
        const singleMatch = title.match(/completed\s+(.+?)\s+in/i);
        if (singleMatch) {
          countText = singleMatch[1];
        }
      }

      return (
        <span className="leading-snug">
          <span className={actorClass}>{actorName}</span>
          <span className={actionClass}> completed {countText} in </span>
          <span className={taskClass}>{effectiveTaskTitle}</span>
        </span>
      );
    }

    // 4. Assigned / Unassigned
    if (
      normType === 'ASSIGNMENT' ||
      normType === 'UNASSIGNMENT' ||
      title.toLowerCase().includes('assigned you') ||
      title.toLowerCase().includes('unassigned you')
    ) {
      const isUnassign =
        normType === 'UNASSIGNMENT' || title.toLowerCase().includes('unassigned');

      return (
        <span className="leading-snug">
          <span className={actorClass}>{actorName}</span>
          <span className={actionClass}>
            {' '}
            {isUnassign ? 'unassigned you from' : 'assigned you to'}{' '}
          </span>
          {effectiveIsSubtask && <span className={actionClass}>subtask </span>}
          <span className={taskClass}>{effectiveTaskTitle}</span>
        </span>
      );
    }

    // 5. Reply
    if (
      normType === 'REPLY' ||
      title.toLowerCase().includes('replied to your comment')
    ) {
      return (
        <span className="leading-snug">
          <span className={actorClass}>{actorName}</span>
          <span className={actionClass}> replied to your comment on </span>
          {effectiveIsSubtask && <span className={actionClass}>subtask </span>}
          <span className={taskClass}>{effectiveTaskTitle}</span>
          {isMention ? (
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ml-1.5 align-middle select-none ${mentionClass}`}>
              Mentioned you
            </span>
          ) : isYouMentioned ? (
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ml-1.5 align-middle select-none ${mentionClass}`}>
              You mentioned
            </span>
          ) : null}
        </span>
      );
    }

    // 6. Comment
    if (
      normType === 'COMMENT' ||
      normType === 'MENTION' ||
      title.toLowerCase().includes('commented on')
    ) {
      return (
        <span className="leading-snug">
          <span className={actorClass}>{actorName}</span>
          <span className={actionClass}> commented on </span>
          {effectiveIsSubtask && <span className={actionClass}>subtask </span>}
          <span className={taskClass}>{effectiveTaskTitle}</span>
          {isMention ? (
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ml-1.5 align-middle select-none ${mentionClass}`}>
              Mentioned you
            </span>
          ) : isYouMentioned ? (
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ml-1.5 align-middle select-none ${mentionClass}`}>
              You mentioned
            </span>
          ) : null}
        </span>
      );
    }

    // 7. General Fallback
    let restOfTitle = title;
    if (restOfTitle.startsWith(actorName)) {
      restOfTitle = restOfTitle.substring(actorName.length).trim();
    }

    return (
      <span className="leading-snug">
        <span className={actorClass}>{actorName}</span>
        <span className={actionClass}> {restOfTitle}</span>
        {isMention ? (
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ml-1.5 align-middle select-none ${mentionClass}`}>
            Mentioned you
          </span>
        ) : isYouMentioned ? (
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ml-1.5 align-middle select-none ${mentionClass}`}>
            You mentioned
          </span>
        ) : null}
      </span>
    );
  };

  return (
    <div
      onClick={onClick}
      className={`group/card relative flex items-start cursor-pointer rounded-xl transition-all duration-150 shadow-xs border ${
        compact ? 'p-3 gap-2.5' : 'p-3.5 sm:p-4 gap-3 sm:gap-3.5'
      } ${
        isGreyed
          ? 'bg-card/40 dark:bg-zinc-900/30 border-border/40 hover:bg-card hover:border-border/80 opacity-[0.85] hover:opacity-100'
          : 'bg-card border-border hover:bg-[var(--hover-subtle)] hover:border-border'
      }`}
    >
      {/* Blue unread dot on far left */}
      {!isRead && (
        <div className="shrink-0 flex items-center justify-center pt-2.5 sm:pt-3">
          <span
            className="w-2 h-2 rounded-full bg-blue-500 shadow-sm"
            title="Unread"
          />
        </div>
      )}

      {/* Avatar with dark/light micro-badge */}
      <div className={`shrink-0 relative transition-all duration-150 ${isGreyed ? 'opacity-70 saturate-[0.8]' : ''}`}>
        {actorAvatar ? (
          <img
            src={actorAvatar}
            alt=""
            className={`${
              compact ? 'size-8' : 'size-9 sm:size-9'
            } rounded-full object-cover shrink-0 ring-2 ring-card shadow-xs`}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              if (e.currentTarget.nextElementSibling) {
                (e.currentTarget.nextElementSibling as HTMLElement).style.display =
                  'flex';
              }
            }}
          />
        ) : null}
        <div
          className={`${
            compact ? 'size-8 text-xs' : 'size-9 text-xs sm:text-sm'
          } rounded-full ${avatarBg} text-white on-solid flex items-center justify-center font-medium shrink-0 ring-2 ring-card shadow-xs select-none`}
          style={{ display: actorAvatar ? 'none' : 'flex' }}
        >
          {initial}
        </div>

        {/* Micro-badge icon in bottom-right corner of avatar */}
        <div className={`absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-card border border-border text-muted-foreground flex items-center justify-center shadow-xs ${
          isGreyed ? 'opacity-70' : ''
        }`}>
          <MicroIcon className="size-2.5 stroke-[2.2]" />
        </div>
      </div>

      {/* Content Column */}
      <div className="flex-1 min-w-0">
        {/* Top Line: Actor + Action + Target + Mention + Status Pills + Timestamp */}
        <div className="flex items-start justify-between gap-3">
          <div className={`${compact ? 'text-xs' : 'text-sm'} text-foreground min-w-0 pr-1`}>
            {renderTitleContent()}
          </div>

          {/* Timestamp right-aligned */}
          {formattedTime && (
            <div className={`shrink-0 text-xs font-normal pt-0.5 ml-auto select-none ${
              isGreyed ? 'text-zinc-500 dark:text-zinc-600' : 'text-muted-foreground'
            }`}>
              {formattedTime}
            </div>
          )}
        </div>

        {/* Comment quote box with height limit & See more toggle */}
        {content && (
          <div className="mt-2.5">
            <div
              ref={contentWrapperRef}
              style={{ maxHeight: !isExpanded && canExpand ? maxHeight : undefined }}
              className={`relative px-3 py-2.5 rounded-xl border font-normal leading-relaxed transition-all duration-200 ${
                isGreyed
                  ? 'bg-background/40 dark:bg-black/30 border-border/40 text-zinc-400 dark:text-zinc-400'
                  : 'bg-background/60 border-border text-foreground'
              } ${
                compact ? 'text-xs' : 'text-sm'
              } ${!isExpanded && canExpand ? 'overflow-hidden' : ''}`}
            >
              <CommentContent
                content={content}
                className={`${
                  compact ? 'text-xs' : 'text-sm'
                } ${
                  isGreyed ? 'text-zinc-400 dark:text-zinc-400' : 'text-foreground'
                } max-w-full prose prose-sm dark:prose-invert prose-p:my-0.5 prose-a:text-blue-500 [.theme-light_&]:prose-a:text-blue-600 prose-a:underline [&_a]:text-blue-500 [.theme-light_&]:[&_a]:text-blue-600 [&_a]:underline`}
                onPreviewImage={onPreviewImage}
              />

              {/* Bottom gradient fade when truncated */}
              {!isExpanded && canExpand && (
                <div className={`absolute bottom-0 left-0 right-0 h-10 ${
                  isGreyed
                    ? 'bg-gradient-to-t from-background/95 dark:from-zinc-950/95 via-background/60 dark:via-zinc-950/60 to-transparent'
                    : 'bg-gradient-to-t from-background/95 via-background/60 to-transparent'
                } pointer-events-none rounded-b-xl`} />
              )}
            </div>

            {/* See more / See less button */}
            {canExpand && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(!isExpanded);
                }}
                className="mt-1 text-[11px] font-medium text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:underline inline-flex items-center gap-1 cursor-pointer select-none"
              >
                <span>{isExpanded ? 'See less' : 'See more'}</span>
                {isExpanded ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
