import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Send } from 'lucide-react';
import { User as UserModel } from '@/lib/types';

interface CommentReplyInputProps {
  commentId?: string;
  workspaceUsers?: UserModel[];
  currentUser?: UserModel | null;
  onSubmit: (content: string, mentionIds: string[]) => Promise<void>;
  onCancel: () => void;
  placeholder?: string;
}

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function CommentReplyInput({
  workspaceUsers = [],
  onSubmit,
  onCancel,
  placeholder = 'Write a reply...',
}: CommentReplyInputProps) {
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionedUsers, setMentionedUsers] = useState<{ id: string; name: string }[]>([]);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);

  // Filtered users for mention search
  const filteredUsers = useMemo(() => {
    if (!mentionSearch) return workspaceUsers;
    const q = mentionSearch.toLowerCase();
    return workspaceUsers.filter((u) =>
      (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
    );
  }, [workspaceUsers, mentionSearch]);

  // Calculate position for the portaled mention dropdown so it never gets clipped by overflow-y-auto
  const updateMenuPosition = useCallback(() => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const dropdownHeight = 220;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const showAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

    setMenuPosition({
      top: showAbove ? Math.max(10, rect.top - dropdownHeight - 6) : Math.min(rect.bottom + 6, window.innerHeight - dropdownHeight - 10),
      left: Math.max(16, Math.min(rect.left, window.innerWidth - 300)),
      width: 288,
    });
  }, []);

  useEffect(() => {
    if (showMentionMenu) {
      updateMenuPosition();
      window.addEventListener('resize', updateMenuPosition);
      window.addEventListener('scroll', updateMenuPosition, true);
      return () => {
        window.removeEventListener('resize', updateMenuPosition);
        window.removeEventListener('scroll', updateMenuPosition, true);
      };
    }
  }, [showMentionMenu, updateMenuPosition]);

  // Close mention menu when clicking outside
  useEffect(() => {
    if (!showMentionMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (mentionMenuRef.current && mentionMenuRef.current.contains(target)) return;
      if (wrapperRef.current && wrapperRef.current.contains(target)) return;
      setShowMentionMenu(false);
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [showMentionMenu]);

  // Insert a selected user mention into the reply text
  const insertMention = (user: UserModel | { id: string; name: string }) => {
    if (!inputRef.current) return;
    const cursor = inputRef.current.selectionStart ?? text.length;
    const textBefore = text.substring(0, cursor);
    const textAfter = text.substring(cursor);
    const atIndex = textBefore.lastIndexOf('@');
    if (atIndex !== -1) {
      const replacement = `@${user.name} `;
      const newText = textBefore.substring(0, atIndex) + replacement + textAfter;
      setText(newText);
      if (!mentionedUsers.some(m => m.id === user.id)) {
        setMentionedUsers(prev => [...prev, { id: user.id, name: user.name }]);
      }
      setShowMentionMenu(false);
      setMentionSearch('');
      const newCursor = atIndex + replacement.length;
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(newCursor, newCursor);
      }, 0);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newText = e.target.value;
    setText(newText);
    const cursor = e.target.selectionStart ?? newText.length;
    const textBeforeCursor = newText.substring(0, cursor);
    const match = textBeforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
    if (match) {
      updateMenuPosition();
      setShowMentionMenu(true);
      setMentionSearch(match[1]);
      setSelectedIndex(0);
    } else {
      setShowMentionMenu(false);
    }
  };

  const handleSubmit = async () => {
    if (!text.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      // Format mentions as <a href="mention://userId">@Name</a> and collect IDs
      let formatted = text.trim();
      const finalMentionIds: string[] = [];

      // Check against all workspace members to match @Name mentions accurately
      const usersToCheck = [...mentionedUsers, ...workspaceUsers];
      const seenUserIds = new Set<string>();

      for (const u of usersToCheck) {
        if (!u?.name || !u?.id || seenUserIds.has(u.id)) continue;
        seenUserIds.add(u.id);

        const mentionPattern = new RegExp(`@${escapeRegex(u.name)}\\b`, 'gi');
        if (mentionPattern.test(formatted)) {
          formatted = formatted.replace(mentionPattern, `<a href="mention://${u.id}">@${u.name}</a>`);
          if (!finalMentionIds.includes(u.id)) {
            finalMentionIds.push(u.id);
          }
        }
      }

      await onSubmit(formatted, finalMentionIds);
      setText('');
      setMentionedUsers([]);
      setShowMentionMenu(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showMentionMenu && filteredUsers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % filteredUsers.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filteredUsers.length) % filteredUsers.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const target = filteredUsers[selectedIndex] || filteredUsers[0];
        if (target) insertMention(target);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentionMenu(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
  };

  return (
    <div ref={wrapperRef} className="pl-11 flex gap-2 mt-1 relative w-full min-w-0 max-w-full">
      <input
        ref={inputRef}
        autoFocus
        value={text}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isSubmitting}
        className="flex-1 min-w-0 bg-zinc-800/60 border border-zinc-700/60 rounded-md px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-indigo-500/60 transition-colors disabled:opacity-50"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!text.trim() || isSubmitting}
        className="p-1.5 bg-indigo-600 hover:bg-indigo-700 rounded-md text-white transition-colors disabled:opacity-50 disabled:hover:bg-indigo-600 cursor-pointer"
        title="Send reply"
      >
        <Send className="w-3.5 h-3.5" />
      </button>

      {/* Portaled Mention Dropdown matching the ClickUp/Nexus design system */}
      {showMentionMenu && menuPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={mentionMenuRef}
          style={{
            position: 'fixed',
            top: menuPosition.top,
            left: menuPosition.left,
            width: menuPosition.width,
            maxHeight: 220,
            zIndex: 999999,
          }}
          onMouseDown={(e) => e.preventDefault()}
          className="bg-card border border-zinc-700/60 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="p-2 border-b border-zinc-800/60 text-xs font-semibold text-zinc-400 bg-zinc-900/60 flex items-center justify-between">
            <span>People</span>
            <span className="text-[10px] text-zinc-500 font-normal">↑↓ navigate, Enter/Tab select</span>
          </div>
          <div className="max-h-52 overflow-y-auto custom-scrollbar">
            {filteredUsers.map((u, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={u.id}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertMention(u)}
                  className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer text-sm transition-colors ${
                    isSelected ? 'bg-indigo-600/30 text-white' : 'text-zinc-200 hover:bg-zinc-800/60'
                  }`}
                >
                  {u.avatarUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px] font-bold shrink-0">
                      {(u.name || '?').substring(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-medium truncate">{u.name}</span>
                    {u.email && <span className="text-[10px] text-zinc-500 truncate">{u.email}</span>}
                  </div>
                </div>
              );
            })}
            {filteredUsers.length === 0 && (
              <div className="p-3 text-sm text-zinc-500 text-center">No users found</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
