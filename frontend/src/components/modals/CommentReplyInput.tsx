import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip, SmilePlus, X, FileText } from 'lucide-react';
import { User as UserModel } from '@/lib/types';
import { CommentEditor, CommentEditorRef, ComposerSendButton, ComposerToolButton } from '../ui/CommentEditor';
import { EmojiPicker } from '../ui/EmojiPicker';
import { getFileExtension } from '../ui/CommentAttachmentCard';
import { uploadApi } from '@/api/upload';
import {
  validateUploadFile,
  formatFileSize,
  ATTACHMENT_SOFT_MAX_BYTES,
  IMAGE_SOFT_MAX_BYTES,
  MAX_FILES_PER_BATCH,
} from '@/lib/fileValidation';
import { isBlankCommentHtml, trimCommentHtml } from '@/lib/links';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';
import { isSystemUser } from '@/lib/taskTokens';
import { triggerMentionConfetti, preloadMentionConfettiImage } from '../ui/MentionConfetti';

interface CommentReplyInputProps {
  commentId?: string;
  workspaceUsers?: UserModel[];
  currentUser?: UserModel | null;
  onSubmit: (content: string, mentionIds: string[]) => Promise<void>;
  onCancel: () => void;
  placeholder?: string;
}

interface StagedReplyFile {
  id: string;
  file: File;
  previewUrl: string | null;
}

export function CommentReplyInput({
  commentId,
  workspaceUsers = [],
  onSubmit,
  onCancel,
  placeholder = 'Write a reply...',
}: CommentReplyInputProps) {
  const [replyHtml, setReplyHtml] = useState('');
  const [stagedFiles, setStagedFiles] = useState<StagedReplyFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingInline, setIsUploadingInline] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);

  const commentEditorRef = useRef<CommentEditorRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const stagedFilesRef = useRef<StagedReplyFile[]>([]);
  const prevStagedCountRef = useRef(0);

  useEffect(() => {
    stagedFilesRef.current = stagedFiles;
  }, [stagedFiles]);

  // Clean up any preview object URLs on unmount
  useEffect(() => {
    return () => {
      stagedFilesRef.current.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  // Ensure workspace users are fetched from store if missing or not passed
  const storeUsers = useAppStore((s) => s.workspaceUsers);
  const loadUsers = useAppStore((s) => s.loadUsers);
  const hydrateUsersFromCache = useAppStore((s) => s.hydrateUsersFromCache);

  useEffect(() => {
    if (storeUsers.length === 0) {
      hydrateUsersFromCache();
      loadUsers();
    }
  }, [storeUsers.length, hydrateUsersFromCache, loadUsers]);

  const allUsers = useMemo(() => {
    if (workspaceUsers && workspaceUsers.length > 0) return workspaceUsers;
    return storeUsers || [];
  }, [workspaceUsers, storeUsers]);

  // Filtered users for mention search (exclude system/bot accounts)
  const filteredUsers = useMemo(() => {
    const list = (allUsers || []).filter((u) => !isSystemUser(u));
    if (!mentionSearch) return list;
    const q = mentionSearch.toLowerCase();
    return list.filter((u) =>
      (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
    );
  }, [allUsers, mentionSearch]);

  const uploadCommentImage = useCallback(
    (file: File) => uploadApi.uploadFile(file, 'comments').then((res) => res.url),
    []
  );
  const copyCommentImage = useCallback(
    (url: string) => uploadApi.uploadFromUrl(url, 'comments').then((res) => res.url),
    []
  );

  // Calculate position for the portaled mention dropdown so it never gets clipped by overflow-y-auto
  const updateMenuPosition = useCallback(() => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const dropdownHeight = 220;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const showAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

    setMenuPosition({
      top: showAbove
        ? Math.max(10, rect.top - dropdownHeight - 6)
        : Math.min(rect.bottom + 6, window.innerHeight - dropdownHeight - 10),
      left: Math.max(16, Math.min(rect.left, window.innerWidth - 300)),
      width: Math.min(300, Math.max(240, rect.width)),
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

  // Smoothly scroll reply box into view on mount and when staged files change
  const scrollIntoViewSmooth = useCallback(() => {
    if (bottomAnchorRef.current) {
      bottomAnchorRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, []);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => scrollIntoViewSmooth());
    const t1 = setTimeout(scrollIntoViewSmooth, 80);
    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(t1);
    };
  }, [scrollIntoViewSmooth]);

  useEffect(() => {
    if (stagedFiles.length !== prevStagedCountRef.current) {
      prevStagedCountRef.current = stagedFiles.length;
      const timer = setTimeout(scrollIntoViewSmooth, 60);
      return () => clearTimeout(timer);
    }
  }, [stagedFiles.length, scrollIntoViewSmooth]);

  const addStagedFiles = useCallback((newFiles: File[]) => {
    if (newFiles.length === 0) return;

    setStagedFiles((prev) => {
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
        const alreadyAdded = next.some(
          (existing) =>
            existing.file.name === f.name &&
            existing.file.size === f.size &&
            existing.file.lastModified === f.lastModified
        );
        if (!alreadyAdded) {
          next.push({
            id: `reply-file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            file: f,
            previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
          });
        }
      }
      return next;
    });
  }, []);

  const removeStagedFile = useCallback((id: string) => {
    setStagedFiles((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      const validImages: File[] = [];
      const validOthers: File[] = [];

      for (const file of files) {
        const check = validateUploadFile(file);
        if (!check.valid) {
          toast.error(check.error || `File ${file.name} is not allowed`);
          continue;
        }
        if (check.isSoftWarning && check.softWarning) {
          toast.warning(check.softWarning);
        }
        if (check.isImage) {
          validImages.push(file);
        } else {
          validOthers.push(file);
        }
      }

      if (validImages.length > 0) {
        commentEditorRef.current?.insertImages(validImages);
      }
      if (validOthers.length > 0) {
        addStagedFiles(validOthers);
      }
    }
    e.target.value = '';
  };

  const handleCancel = useCallback(() => {
    stagedFilesRef.current.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    setStagedFiles([]);
    setEmojiAnchor(null);
    setShowMentionMenu(false);
    onCancel();
  }, [onCancel]);

  const handleSelectMentionUser = useCallback(
    (u: UserModel) => {
      const matchLength = mentionSearch.length + 1;
      commentEditorRef.current?.insertMention(u.name || 'Someone', matchLength, u.id);
      setShowMentionMenu(false);
      setMentionSearch('');
      triggerMentionConfetti(u as UserModel & { confettiUrl?: string });
    },
    [mentionSearch]
  );

  const handleSubmit = async () => {
    const hasText = !isBlankCommentHtml(replyHtml);
    const hasFiles = stagedFiles.length > 0;
    if ((!hasText && !hasFiles) || isSubmitting || isUploadingInline) return;

    setIsSubmitting(true);
    try {
      let finalContent = hasText ? trimCommentHtml(replyHtml) : '';

      if (stagedFiles.length > 0) {
        for (const item of stagedFiles) {
          const res = await uploadApi.uploadFile(item.file, 'comments');
          if (res?.url) {
            if (item.file.type.startsWith('image/')) {
              finalContent += `\n\n![${item.file.name}](${res.url})`;
            } else if (item.file.type.startsWith('video/')) {
              finalContent += `\n\n<video controls src="${res.url}" class="w-full max-w-[250px] rounded-md mt-2"></video>`;
            } else {
              finalContent += `\n\n[${item.file.name}](${res.url})`;
            }
          }
        }
      }

      finalContent = finalContent.trim();
      if (!finalContent) {
        setIsSubmitting(false);
        return;
      }

      // Extract active mention:// user IDs directly from the final HTML
      const finalMentionIds: string[] = [];
      const mentionHrefRegex = /href=["']mention:\/\/([^"']+)["']/gi;
      let m: RegExpExecArray | null;
      while ((m = mentionHrefRegex.exec(finalContent)) !== null) {
        const uid = m[1]?.trim();
        if (uid && uid !== 'unknown' && !finalMentionIds.includes(uid)) {
          finalMentionIds.push(uid);
        }
      }

      await onSubmit(finalContent, finalMentionIds);

      stagedFiles.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      setStagedFiles([]);
      setReplyHtml('');
      commentEditorRef.current?.clear?.();
      setShowMentionMenu(false);
      setEmojiAnchor(null);
    } catch (err: unknown) {
      console.error('Failed to submit reply:', err);
      const message = err instanceof Error ? err.message : 'Failed to post reply';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasContent = !isBlankCommentHtml(replyHtml) || stagedFiles.length > 0;

  return (
    <div
      ref={wrapperRef}
      className="flex flex-col gap-1.5 mt-1.5 relative w-full min-w-0 max-w-full"
    >
      {/* Staged Attachments Strip */}
      {stagedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stagedFiles.map((item) => {
            const { file, previewUrl, id } = item;
            const isImage = file.type.startsWith('image/');
            const ext = getFileExtension(file.name);
            const isSoftWarning = isImage ? file.size > IMAGE_SOFT_MAX_BYTES : file.size > ATTACHMENT_SOFT_MAX_BYTES;
            const softLimitLabel = isImage ? '>3MB' : '>10MB';
            const sizeFormatted = formatFileSize(file.size);
            return (
              <div
                key={id}
                className={`relative group flex items-center justify-center bg-zinc-900 rounded-lg border ${
                  isSoftWarning
                    ? 'border-amber-500/60 ring-1 ring-amber-500/30'
                    : 'border-indigo-500/40 ring-1 ring-indigo-500/20'
                } w-12 h-12 shrink-0 overflow-hidden shadow-sm`}
              >
                {isImage && previewUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-white font-medium text-center py-0.5">
                      {sizeFormatted}
                    </span>
                    {isSoftWarning && (
                      <span
                        className="absolute top-1 left-1 bg-amber-500 text-black text-[7px] font-bold px-1 rounded shadow"
                        title={`Large image: ${sizeFormatted} (soft limit >3MB)`}
                      >
                        {softLimitLabel}
                      </span>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center p-1 text-center w-full">
                    <FileText className={`w-4 h-4 ${isSoftWarning ? 'text-amber-400' : 'text-indigo-400'} mb-0.5`} />
                    <span
                      className={`text-[8px] font-bold tracking-wider uppercase px-1 py-0.2 rounded ${
                        isSoftWarning ? 'bg-amber-500/15 text-amber-400' : 'bg-indigo-500/15 text-indigo-400'
                      }`}
                    >
                      {ext}
                    </span>
                    <span className="text-[9px] text-zinc-300 font-medium truncate max-w-[50px] mt-0.5" title={file.name}>
                      {file.name}
                    </span>
                    <span className="text-[7px] text-zinc-500 font-mono mt-0.2">{sizeFormatted}</span>
                    {isSoftWarning && (
                      <span
                        className="absolute top-1 left-1 bg-amber-500 text-black text-[7px] font-bold px-1 rounded shadow"
                        title={`Large attachment: ${sizeFormatted} (soft limit >10MB)`}
                      >
                        {softLimitLabel}
                      </span>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeStagedFile(id)}
                  disabled={isSubmitting}
                  title="Remove"
                  className="absolute top-1 right-1 p-0.5 bg-black/80 hover:bg-red-600 border border-zinc-700/80 rounded-full text-zinc-300 hover:text-white shadow-sm backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all cursor-pointer disabled:opacity-50"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Mini Rich-Text CommentEditor matching main & subtask comment sections */}
      <CommentEditor
        ref={commentEditorRef}
        id={`reply-${commentId || 'default'}`}
        value={replyHtml}
        autoFocus
        compact
        disabled={isSubmitting}
        placeholder={isSubmitting ? 'Posting reply...' : placeholder}
        onChange={(html, text, cursorPosition, textBefore) => {
          setReplyHtml(html);
          const textStr = text || '';
          const textBeforeCursor =
            textBefore !== undefined
              ? textBefore
              : cursorPosition !== undefined && cursorPosition >= 0
                ? textStr.substring(0, Math.min(textStr.length, cursorPosition))
                : textStr;
          const match = textBeforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
          if (match) {
            updateMenuPosition();
            setShowMentionMenu(true);
            setMentionSearch(match[1]);
            setSelectedIndex(0);
          } else {
            setShowMentionMenu(false);
          }
        }}
        onKeyDown={(e) => {
          if (showMentionMenu && filteredUsers.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelectedIndex((prev) => (prev + 1) % filteredUsers.length);
              return true;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelectedIndex((prev) => (prev - 1 + filteredUsers.length) % filteredUsers.length);
              return true;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              const target = filteredUsers[selectedIndex] || filteredUsers[0];
              if (target) handleSelectMentionUser(target);
              return true;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setShowMentionMenu(false);
              return true;
            }
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (emojiAnchor) {
              setEmojiAnchor(null);
              return true;
            }
            if (!isSubmitting) {
              handleCancel();
            }
            return true;
          }
          return false;
        }}
        onSubmit={handleSubmit}
        onPasteFiles={addStagedFiles}
        onDropFiles={addStagedFiles}
        onUploadImage={uploadCommentImage}
        onUploadImageUrl={copyCommentImage}
        onUploadingChange={setIsUploadingInline}
        footer={
          <div className="flex items-center gap-0.5">
            <ComposerToolButton
              onClick={() => fileInputRef.current?.click()}
              disabled={isSubmitting}
              title="Attach file or image"
              className="!h-6 !w-6"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </ComposerToolButton>
            <ComposerToolButton
              onClick={(e) => {
                const btn = e.currentTarget;
                setEmojiAnchor((prev) => (prev ? null : btn));
              }}
              disabled={isSubmitting}
              title="Add emoji"
              className="!h-6 !w-6"
            >
              <SmilePlus className="w-3.5 h-3.5" />
            </ComposerToolButton>
          </div>
        }
        footerEnd={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSubmitting}
              className="h-6 px-2 rounded-md text-[11px] font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/70 transition-colors cursor-pointer disabled:opacity-50"
              title="Cancel reply (Esc)"
            >
              Cancel
            </button>
            <ComposerSendButton
              onClick={handleSubmit}
              disabled={!hasContent || isUploadingInline || isSubmitting}
              title={isUploadingInline ? 'Uploading image...' : 'Send reply'}
              className="!h-6 !pl-2 !pr-2.5 !gap-1 !text-[11px] !rounded-md"
            >
              {isSubmitting ? 'Sending…' : 'Send'}
            </ComposerSendButton>
          </div>
        }
      />

      <input
        type="file"
        ref={fileInputRef}
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {emojiAnchor && (
        <EmojiPicker
          anchorEl={emojiAnchor}
          onSelect={(emoji) => {
            commentEditorRef.current?.insertEmoji(emoji);
            setEmojiAnchor(null);
          }}
          onClose={() => setEmojiAnchor(null)}
          placement="top"
        />
      )}

      {/* Portaled Mention Dropdown */}
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
              const targetUrl = (u as UserModel & { confettiUrl?: string }).confettiUrl || u.avatarUrl;
              if (idx < 5 && targetUrl) {
                preloadMentionConfettiImage(targetUrl);
              }
              return (
                <div
                  key={u.id}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onMouseDown={(e) => e.preventDefault()}
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
                    {u.email && <span className="text-[10px] text-muted-foreground truncate">{u.email}</span>}
                  </div>
                </div>
              );
            })}
            {filteredUsers.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground text-center">No users found</div>
            )}
          </div>
        </div>,
        document.body
      )}

      <div
        ref={bottomAnchorRef}
        style={{ scrollMarginBottom: '24px' }}
        className="h-px w-full pointer-events-none opacity-0"
        aria-hidden="true"
      />
    </div>
  );
}
