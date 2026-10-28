import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Send, SmilePlus, ImageIcon, X, Loader2 } from 'lucide-react';
import { User as UserModel } from '@/lib/types';
import { EmojiPicker } from '../ui/EmojiPicker';
import { uploadApi } from '@/api/upload';
import { validateUploadFile, formatFileSize, MAX_FILES_PER_BATCH, isImageFile } from '@/lib/fileValidation';
import { toast } from '@/lib/toast';

interface CommentReplyInputProps {
  commentId?: string;
  workspaceUsers?: UserModel[];
  currentUser?: UserModel | null;
  onSubmit: (content: string, mentionIds: string[]) => Promise<void>;
  onCancel: () => void;
  placeholder?: string;
}

interface StagedImage {
  id: string;
  file: File;
  previewUrl: string;
}

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameClipboardFile(file: File, index: number = 0): File {
  if (file.name && file.name !== 'image.png') return file;
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return new File([file], `reply-image-${Date.now()}${index ? `-${index}` : ''}.${ext}`, { type: file.type });
}

export function CommentReplyInput({
  workspaceUsers = [],
  onSubmit,
  onCancel,
  placeholder = 'Write a reply...',
}: CommentReplyInputProps) {
  const [text, setText] = useState('');
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionedUsers, setMentionedUsers] = useState<{ id: string; name: string }[]>([]);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);
  const stagedImagesRef = useRef<StagedImage[]>([]);

  useEffect(() => {
    stagedImagesRef.current = stagedImages;
  }, [stagedImages]);

  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);

  // Filtered users for mention search
  const filteredUsers = useMemo(() => {
    if (!mentionSearch) return workspaceUsers;
    const q = mentionSearch.toLowerCase();
    return workspaceUsers.filter((u) =>
      (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
    );
  }, [workspaceUsers, mentionSearch]);

  // Clean up preview object URLs on unmount
  useEffect(() => {
    return () => {
      stagedImagesRef.current.forEach(img => {
        URL.revokeObjectURL(img.previewUrl);
      });
    };
  }, []);

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

  const mentionListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMentionMenu || !mentionListRef.current) return;
    const container = mentionListRef.current;
    const selectedEl = container.children[selectedIndex] as HTMLElement | undefined;
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
  }, [selectedIndex, showMentionMenu]);

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

  // Helper to validate and stage new image files
  const addFiles = useCallback((filesToProcess: File[]) => {
    if (filesToProcess.length === 0) return;

    setStagedImages(prev => {
      if (prev.length >= MAX_FILES_PER_BATCH) {
        toast.error(`Maximum of ${MAX_FILES_PER_BATCH} images allowed per reply.`);
        return prev;
      }

      const availableSlots = MAX_FILES_PER_BATCH - prev.length;
      if (filesToProcess.length > availableSlots) {
        toast.error(`Only ${availableSlots} more image(s) can be added.`);
      }

      const slice = filesToProcess.slice(0, availableSlots);
      const nextStaged: StagedImage[] = [];

      slice.forEach((file, idx) => {
        const named = nameClipboardFile(file, idx);
        const check = validateUploadFile(named);
        if (!check.valid) {
          toast.error(check.error || `File ${named.name} is not allowed`);
          return;
        }
        if (!check.isImage) {
          toast.error(`"${named.name}" is not an image. Only images are supported in replies.`);
          return;
        }
        if (check.isSoftWarning && check.softWarning) {
          toast.warning(check.softWarning);
        }

        const previewUrl = URL.createObjectURL(named);
        nextStaged.push({
          id: `reply-img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          file: named,
          previewUrl,
        });
      });

      return [...prev, ...nextStaged];
    });
  }, []);

  const removeStagedImage = useCallback((id: string) => {
    setStagedImages(prev => {
      const target = prev.find(img => img.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter(img => img.id !== id);
    });
  }, []);

  const handleCancel = useCallback(() => {
    stagedImagesRef.current.forEach(img => URL.revokeObjectURL(img.previewUrl));
    setStagedImages([]);
    onCancel();
  }, [onCancel]);

  // Intercept paste on wrapper/input to capture clipboard images directly
  const handlePasteCapture = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    if (isSubmitting) return;
    const data = e.clipboardData;
    if (!data) return;

    let files = Array.from(data.files || []);
    if (files.length === 0 && data.items) {
      files = Array.from(data.items)
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter((f): f is File => !!f);
    }

    const imageFiles = files.filter(f => f.type.startsWith('image/') || isImageFile(f));
    if (imageFiles.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      addFiles(imageFiles);
    }
  }, [isSubmitting, addFiles]);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (isSubmitting) return;
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      dragCounterRef.current += 1;
      setIsDraggingOver(true);
    }
  }, [isSubmitting]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (isSubmitting) return;
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, [isSubmitting]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (isSubmitting) return;
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
        setIsDraggingOver(false);
      }
    }
  }, [isSubmitting]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (isSubmitting) return;
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    addFiles(files);
  }, [isSubmitting, addFiles]);

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

  const insertEmoji = (emoji: string) => {
    if (!inputRef.current) return;
    const cursor = inputRef.current.selectionStart ?? text.length;
    const end = inputRef.current.selectionEnd ?? cursor;
    const textBefore = text.substring(0, cursor);
    const textAfter = text.substring(end);
    const newText = textBefore + emoji + textAfter;
    setText(newText);
    setEmojiAnchor(null);
    const newCursor = cursor + emoji.length;
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCursor, newCursor);
    }, 0);
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
    const hasText = Boolean(text.trim());
    const hasImages = stagedImages.length > 0;
    if ((!hasText && !hasImages) || isSubmitting) return;

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

      // Upload any staged images and append markdown image tags
      if (stagedImages.length > 0) {
        for (const item of stagedImages) {
          const res = await uploadApi.uploadFile(item.file, 'comments');
          if (res?.url) {
            const imgMarkdown = `![${item.file.name || 'image'}](${res.url})`;
            formatted = formatted ? `${formatted}\n\n${imgMarkdown}` : imgMarkdown;
          }
        }
      }

      await onSubmit(formatted, finalMentionIds);

      // Clean up object URLs and state on success
      stagedImages.forEach(img => URL.revokeObjectURL(img.previewUrl));
      setStagedImages([]);
      setText('');
      setMentionedUsers([]);
      setShowMentionMenu(false);
    } catch (err: unknown) {
      console.error('Failed to submit reply with image:', err);
      const message = err instanceof Error ? err.message : 'Failed to post reply';
      toast.error(message);
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
      handleCancel();
      return;
    }
  };

  return (
    <div
      ref={wrapperRef}
      onPasteCapture={handlePasteCapture}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="pl-11 flex flex-col gap-1.5 mt-1.5 relative w-full min-w-0 max-w-full"
    >
      {/* Drag & drop overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg bg-zinc-950/90 backdrop-blur-sm border-2 border-dashed border-indigo-500 text-xs font-semibold text-zinc-200 pointer-events-none gap-2 shadow-lg animate-in fade-in zoom-in-95 duration-100">
          <ImageIcon className="w-4 h-4 text-indigo-400" />
          <span>Drop image here to add to reply</span>
        </div>
      )}

      {/* Staged Images Preview Strip */}
      {stagedImages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5 pb-1">
          {stagedImages.map((img) => (
            <div
              key={img.id}
              className="relative group/preview w-16 h-16 rounded-lg overflow-hidden border border-zinc-700/80 bg-zinc-900 shrink-0 shadow-sm"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.previewUrl}
                alt={img.file.name}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeStagedImage(img.id)}
                disabled={isSubmitting}
                className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/80 hover:bg-red-600 text-zinc-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
                title="Remove image"
              >
                <X className="w-2.5 h-2.5" />
              </button>
              <div className="absolute bottom-0 inset-x-0 bg-black/75 text-[8px] text-zinc-300 font-mono text-center truncate px-0.5 py-0.5">
                {formatFileSize(img.file.size)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Input and Action Row */}
      <div className="flex items-center gap-1.5 w-full min-w-0">
        <input
          ref={inputRef}
          autoFocus
          value={text}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={stagedImages.length > 0 ? 'Add a reply caption (optional)...' : placeholder}
          disabled={isSubmitting}
          className="flex-1 min-w-0 bg-zinc-800/60 border border-zinc-700/60 rounded-md px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-[var(--accent)] transition-colors disabled:opacity-50"
        />

        {/* Hidden file input for image attachment */}
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              addFiles(Array.from(e.target.files));
              e.target.value = '';
            }
          }}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isSubmitting}
          className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors flex items-center justify-center cursor-pointer disabled:opacity-50 shrink-0"
          title="Attach image"
        >
          <ImageIcon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={(e) => {
            const btn = e.currentTarget;
            setEmojiAnchor(prev => (prev ? null : btn));
          }}
          disabled={isSubmitting}
          className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors flex items-center justify-center cursor-pointer disabled:opacity-50 shrink-0"
          title="Add emoji"
        >
          <SmilePlus className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={(!text.trim() && stagedImages.length === 0) || isSubmitting}
          style={{
            backgroundColor: 'var(--accent)',
            color: 'var(--on-accent, #ffffff)',
          }}
          className="p-1.5 rounded-md transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer flex items-center justify-center shrink-0 min-w-[28px] min-h-[28px]"
          title="Send reply"
        >
          {isSubmitting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={handleCancel}
          disabled={isSubmitting}
          className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors flex items-center justify-center cursor-pointer disabled:opacity-50 shrink-0 text-xs"
          title="Cancel reply (Esc)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {emojiAnchor && (
        <EmojiPicker
          anchorEl={emojiAnchor}
          onSelect={insertEmoji}
          onClose={() => setEmojiAnchor(null)}
          placement="top"
        />
      )}

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
          className="bg-popover border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="p-2 border-b border-border text-xs font-semibold text-muted-foreground bg-accent/40 flex items-center justify-between">
            <span>People</span>
            <span className="text-[10px] text-muted-foreground font-normal">↑↓ navigate, Enter/Tab select</span>
          </div>
          <div ref={mentionListRef} className="max-h-52 overflow-y-auto custom-scrollbar relative">
            {filteredUsers.map((u, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={u.id}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertMention(u)}
                  style={
                    isSelected
                      ? {
                          backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)',
                        }
                      : undefined
                  }
                  className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer text-sm transition-colors ${
                    isSelected ? 'text-white' : 'text-zinc-200 hover:bg-zinc-800/60'
                  }`}
                >
                  {u.avatarUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
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
