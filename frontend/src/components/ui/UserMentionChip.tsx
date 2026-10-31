'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Mail, Users, Briefcase, Shield, Sparkles } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { triggerMentionConfetti } from './MentionConfetti';

const HOVER_OPEN_DELAY = 300;
const HOVER_CLOSE_DELAY = 150;

interface UserMentionChipProps {
  userId: string;
  children: React.ReactNode;
}

const formatEnum = (value?: string) =>
  (value || '').toLowerCase().split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/**
 * Renders an @mention in comments. Hovering previews the user's profile card; clicking pins it open.
 * The card is portalled above the task modal (z-[99999]) so it works in both modal and full-page mode.
 */
export function UserMentionChip({ userId, children }: UserMentionChipProps) {
  const userFromIndex = useAppStore(state => state.workspaceUsersIndex[userId]);
  const workspaceUsers = useAppStore(state => state.workspaceUsers);
  const currentUser = useAppStore(state => state.currentUser);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => clearTimer, []);

  const scheduleOpen = () => {
    clearTimer();
    timerRef.current = setTimeout(() => setOpen(true), HOVER_OPEN_DELAY);
  };

  const scheduleClose = () => {
    if (pinned) return;
    clearTimer();
    timerRef.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY);
  };

  // Strip leading '@' for clean pill display (avatar already signifies a user mention)
  const stripLeadingAt = (text: React.ReactNode): React.ReactNode => {
    if (typeof text === 'string') {
      return text.replace(/^\s*@/, '');
    }
    if (Array.isArray(text) && text.length > 0 && typeof text[0] === 'string') {
      return [text[0].replace(/^\s*@/, ''), ...text.slice(1)];
    }
    return text;
  };

  // Split children if text extends beyond the mention name (e.g. "@Pau2x to double check")
  let mentionText: React.ReactNode = children;
  let trailingText: React.ReactNode = null;

  if (typeof children === 'string') {
    const match = children.match(/^(\s*@[^\s<]+)([\s\S]*)$/);
    if (match) {
      mentionText = match[1];
      trailingText = match[2];
    }
  }

  const cleanMentionName = stripLeadingAt(mentionText);
  const user = userFromIndex || (
    typeof cleanMentionName === 'string' && cleanMentionName.trim()
      ? workspaceUsers.find(u => u.name && u.name.trim().toLowerCase() === cleanMentionName.trim().toLowerCase())
      : undefined
  );
  const displayName = user?.name || cleanMentionName || 'User';

  // Check if this mention is directed to the logged in user
  const isMe = Boolean(
    currentUser?.id &&
    (userId === currentUser.id ||
      user?.id === currentUser.id ||
      (user?.name && currentUser.name && user.name.trim().toLowerCase() === currentUser.name.trim().toLowerCase()))
  );

  const chipClass = isMe
    ? 'bg-blue-600/25 hover:bg-blue-600/35 text-blue-200 border border-blue-500/40 font-semibold px-1.5 py-0.5 rounded select-none inline-flex items-center gap-1 mx-0.5 align-baseline shadow-xs ring-1 ring-blue-500/30 [.theme-light_&]:bg-blue-100 [.theme-light_&]:text-blue-800 [.theme-light_&]:border-blue-300'
    : 'bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 font-semibold px-1.5 py-0.5 rounded select-none inline-flex items-center gap-1 mx-0.5 align-baseline [.theme-light_&]:bg-blue-50 [.theme-light_&]:text-blue-700 [.theme-light_&]:border [.theme-light_&]:border-blue-200/60';

  // Unknown or not-yet-loaded user: keep the static chip with micro-icon and trailing text separated
  if (!user) {
    return (
      <>
        <span className={`${chipClass} cursor-default`}>
          <span className="w-3.5 h-3.5 rounded-full bg-blue-500/20 text-blue-300 text-[9px] font-bold inline-flex items-center justify-center shrink-0 -ml-0.5 select-none">
            @
          </span>
          <span>{cleanMentionName}</span>
        </span>
        {trailingText}
      </>
    );
  }

  const avatar = user.imageUrl || user.avatarUrl;
  const initials = (user.name || '?').split(' ').map(p => p[0]).join('').substring(0, 2).toUpperCase();
  const roles = (user.roles || []).filter(Boolean);

  const microAvatar = avatar ? (
    <img src={avatar} alt="" className="w-3.5 h-3.5 rounded-full object-cover shrink-0 -ml-0.5 select-none" />
  ) : (
    <span className="w-3.5 h-3.5 rounded-full bg-blue-500/25 text-blue-300 text-[8.5px] font-bold inline-flex items-center justify-center shrink-0 -ml-0.5 select-none">
      {initials}
    </span>
  );

  return (
    <>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setPinned(false);
        }}
      >
        <Popover.Trigger asChild>
          <span
            role="button"
            tabIndex={0}
            className={`${chipClass} cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500/20`}
            onMouseEnter={scheduleOpen}
            onMouseLeave={scheduleClose}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              clearTimer();
              setPinned(true);
              setOpen(true);
              if (user) {
                triggerMentionConfetti(user, { x: e.clientX, y: e.clientY });
              }
            }}
          >
            {microAvatar}
            <span>{displayName}</span>
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onMouseEnter={clearTimer}
          onMouseLeave={scheduleClose}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="z-[100000] w-64 p-4 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-100 cursor-default"
        >
          <div className="flex items-center gap-3">
            {avatar ? (
              <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-10 h-10 shrink-0 bg-indigo-500/20 text-indigo-400 flex items-center justify-center rounded-full font-bold text-xs">
                {initials}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-sm font-semibold text-zinc-100 truncate">{user.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      triggerMentionConfetti(user, { x: e.clientX, y: e.clientY });
                    }}
                    className="p-1 rounded-md text-zinc-400 hover:text-amber-300 hover:bg-zinc-800 transition-colors"
                    title="Celebrate mention"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  </button>
                  {!user.isActive && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-zinc-800 text-zinc-500">Inactive</span>
                  )}
                </div>
              </div>
              {user.email && (
                <a
                  href={`mailto:${user.email}`}
                  className="flex items-center gap-1 text-xs text-zinc-400 hover:text-blue-400 transition-colors truncate"
                >
                  <Mail className="w-3 h-3 shrink-0" />
                  <span className="truncate">{user.email}</span>
                </a>
              )}
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-zinc-800/60 flex flex-col gap-1.5 text-xs text-zinc-300">
            {user.teamName && (
              <div className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span className="truncate">{user.teamName}</span>
              </div>
            )}
            {user.employmentType && (
              <div className="flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span>{formatEnum(user.employmentType)}</span>
              </div>
            )}
            {user.systemRole && (
              <div className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span>{formatEnum(user.systemRole)}</span>
              </div>
            )}
            {roles.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {roles.map(role => (
                  <span key={role} className="text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-zinc-800/80 text-zinc-300">
                    {role}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    {trailingText}
  </>
  );
}
