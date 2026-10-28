import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip, X, FileText, Check, Loader2, SmilePlus, IndentDecrease, IndentIncrease, CheckSquare, ShieldAlert } from 'lucide-react';
import { CommentEditor, CommentEditorRef, ComposerToolButton } from '../ui/CommentEditor';
import { EmojiPicker } from '../ui/EmojiPicker';
import { uploadApi } from '@/api/upload';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';
import { isBlankCommentHtml, trimCommentHtml } from '@/lib/links';
import { getFileExtension } from '../ui/CommentAttachmentCard';
import { validateUploadFile, formatFileSize, ATTACHMENT_SOFT_MAX_BYTES, IMAGE_SOFT_MAX_BYTES, MAX_FILES_PER_BATCH } from '@/lib/fileValidation';

export interface ParsedCommentAttachment {
  id: string;
  name: string;
  url: string;
  type: 'image' | 'video' | 'file';
  rawMarkdown: string;
}

export function parseCommentContent(content: string): {
  text: string;
  attachments: ParsedCommentAttachment[];
} {
  if (!content) return { text: '', attachments: [] };

  const attachments: ParsedCommentAttachment[] = [];
  let match: RegExpExecArray | null;

  // Images stay inline where they were placed. Older comments appended them as markdown,
  // which the editor can't read, so turn those into <img> tags it can show and move.
  const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  content = content.replace(
    /!\[(.*?)\]\((https?:\/\/[^\s\)]+|\/uploads\/[^\s\)]+)\)/g,
    (_m, alt: string, url: string) => `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt || 'image')}">`
  );

  // 1. Extract HTML videos: <video ... src="url" ...></video>
  const videoRegex = /<video[^>]*src=["']([^"']+)["'][^>]*>(?:<\/video>)?/gi;
  while ((match = videoRegex.exec(content)) !== null) {
    const url = match[1];
    const fileName = url.split('/').pop() || 'video';
    attachments.push({
      id: `att-vid-${attachments.length}-${Date.now()}`,
      name: fileName,
      url,
      type: 'video',
      rawMarkdown: match[0],
    });
  }

  // 2. Extract markdown file attachments: [filename](url) where url is an uploaded file/doc
  const fileRegex = /(?<!\!)\[(.*?)\]\((https?:\/\/[^\s\)]+|\/uploads\/[^\s\)]+)\)/g;
  while ((match = fileRegex.exec(content)) !== null) {
    const name = match[1];
    const url = match[2];
    if (url.startsWith('mention://')) continue;
    const isUpload = url.includes('/uploads/') || /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar|tar|gz|mp3|wav|ogg)$/i.test(url);
    if (isUpload) {
      attachments.push({
        id: `att-file-${attachments.length}-${Date.now()}`,
        name: name || 'file',
        url,
        type: 'file',
        rawMarkdown: match[0],
      });
    }
  }

  // Remove the extracted raw attachments from text
  let cleanedText = content;
  for (const att of attachments) {
    cleanedText = cleanedText.split(att.rawMarkdown).join('');
  }

  cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n').trim();
  if (cleanedText === '<p></p>' || cleanedText === '<p><br></p>' || cleanedText === '<p> </p>') {
    cleanedText = '';
  }

  return { text: cleanedText, attachments };
}

interface EditCommentFormProps {
  commentId: string;
  initialContent: string;
  workspaceUsers?: any[];
  currentUser?: any;
  onSave: (newContent: string) => Promise<void>;
  onCancel: () => void;
  onPreviewImage?: (url: string) => void;
}

export function EditCommentForm({
  commentId,
  initialContent,
  workspaceUsers = [],
  currentUser,
  onSave,
  onCancel,
  onPreviewImage,
}: EditCommentFormProps) {
  // Ensure workspace users are fetched from store if missing or not loaded
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

  const initialParsed = useMemo(() => parseCommentContent(initialContent), [initialContent]);

  const [text, setText] = useState(initialParsed.text);
  const [existingAttachments, setExistingAttachments] = useState<ParsedCommentAttachment[]>(initialParsed.attachments);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingInline, setIsUploadingInline] = useState(false);

  // Mention state
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const commentEditorRef = useRef<CommentEditorRef>(null);
  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);

  // Filtered users for mention search
  const filteredUsers = useMemo(() => {
    if (!mentionSearch) return allUsers;
    const q = mentionSearch.toLowerCase();
    return allUsers.filter((u: any) =>
      (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
    );
  }, [allUsers, mentionSearch]);

  // Reset highlight index when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [mentionSearch]);

  // Calculate position for the portaled mention dropdown so it never gets clipped by overflow-y-auto
  const updateMenuPosition = useCallback(() => {
    if (!editorWrapperRef.current) return;
    const rect = editorWrapperRef.current.getBoundingClientRect();
    const dropdownHeight = 220;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const showAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

    setMenuPosition({
      top: showAbove ? Math.max(10, rect.top - dropdownHeight - 6) : Math.min(rect.bottom + 6, window.innerHeight - dropdownHeight - 10),
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
      if (editorWrapperRef.current && editorWrapperRef.current.contains(target)) return;
      setShowMentionMenu(false);
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [showMentionMenu]);

  // Insert a selected user mention
  const insertSelectedMention = useCallback((user: any) => {
    const matchLength = mentionSearch.length + 1; // '@' plus search query
    commentEditorRef.current?.insertMention(user.name || 'Someone', matchLength, user.id);
    setShowMentionMenu(false);
    setMentionSearch('');
  }, [mentionSearch]);

  // Images go inline at the cursor; other files are staged as attachments
  const addFiles = (newFiles: File[]) => {
    const validImages: File[] = [];
    const validOthers: File[] = [];

    for (const f of newFiles) {
      const check = validateUploadFile(f);
      if (!check.valid) {
        toast.error(check.error || `File ${f.name} is not allowed`);
        continue;
      }
      if (check.isSoftWarning && check.softWarning) {
        toast.warning(check.softWarning);
      }
      if (check.isImage) {
        validImages.push(f);
      } else {
        validOthers.push(f);
      }
    }

    if (validImages.length > 0) commentEditorRef.current?.insertImages(validImages);
    if (validOthers.length > 0) {
      setStagedFiles(prev => {
        const next = [...prev];
        for (const f of validOthers) {
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
    }
  };

  // Handle files pasted from clipboard
  const handlePasteFiles = (newFiles: File[]) => {
    addFiles(newFiles);
  };

  const uploadImage = useCallback((file: File) => uploadApi.uploadFile(file, 'comments').then(res => res.url), []);
  const copyImage = useCallback((url: string) => uploadApi.uploadFromUrl(url, 'comments').then(res => res.url), []);

  // Outer container paste capture so pasting works anywhere inside the edit form
  const handleOuterPasteCapture = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (isSaving) return;
    const data = event.clipboardData;
    if (!data) return;
    // Rich text pasted from another app is left to the editor, which keeps text and images in order
    const html = data.getData('text/html');
    if (html && new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim()) return;
    let files = Array.from(data.files || []);
    if (files.length === 0) {
      files = Array.from(data.items || [])
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter((f): f is File => !!f);
    }
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const formattedFiles = files.map((file, i) => {
      if (file.name && file.name !== 'image.png') return file;
      const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      return new File([file], `pasted-image-${Date.now()}${i ? `-${i}` : ''}.${ext}`, { type: file.type });
    });
    addFiles(formattedFiles);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  const [isDraggingOverForm, setIsDraggingOverForm] = useState(false);
  const formDragCounterRef = useRef(0);

  const handleFormDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (isSaving) return;
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      formDragCounterRef.current += 1;
      setIsDraggingOverForm(true);
    }
  };

  const handleFormDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (isSaving) return;
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleFormDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (isSaving) return;
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      formDragCounterRef.current = Math.max(0, formDragCounterRef.current - 1);
      if (formDragCounterRef.current === 0) {
        setIsDraggingOverForm(false);
      }
    }
  };

  const handleFormDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (isSaving) return;
    formDragCounterRef.current = 0;
    setIsDraggingOverForm(false);
    if ((e.nativeEvent as any)._commentDropHandled) return;
    (e.nativeEvent as any)._commentDropHandled = true;
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    addFiles(files);
  };

  const hasText = !isBlankCommentHtml(text);
  const hasAttachments = existingAttachments.length > 0 || stagedFiles.length > 0;
  const hasAnyContent = hasText || hasAttachments;

  const hasTextChanged = text.trim() !== initialParsed.text.trim();
  const hasAttachmentsChanged = existingAttachments.length !== initialParsed.attachments.length || stagedFiles.length > 0;
  const hasChanged = hasTextChanged || hasAttachmentsChanged;

  const handleSave = async () => {
    if (isSaving || isUploadingInline || !hasAnyContent || !hasChanged) return;
    setIsSaving(true);

    try {
      let finalContent = hasText ? trimCommentHtml(text) : '';

      // 1. Append remaining existing attachments
      for (const att of existingAttachments) {
        if (att.type === 'image') {
          finalContent += `\n\n![${att.name}](${att.url})`;
        } else if (att.type === 'video') {
          finalContent += `\n\n<video controls src="${att.url}" class="w-full max-w-[250px] rounded-md mt-2"></video>`;
        } else {
          finalContent += `\n\n[${att.name}](${att.url})`;
        }
      }

      // 2. Upload and append any newly staged files
      if (stagedFiles.length > 0) {
        for (const file of stagedFiles) {
          const res = await uploadApi.uploadFile(file, 'comments');
          if (file.type.startsWith('image/')) {
            finalContent += `\n\n![${file.name}](${res.url})`;
          } else if (file.type.startsWith('video/')) {
            finalContent += `\n\n<video controls src="${res.url}" class="w-full max-w-[250px] rounded-md mt-2"></video>`;
          } else {
            finalContent += `\n\n[${file.name}](${res.url})`;
          }
        }
      }

      finalContent = finalContent.trim();
      if (!finalContent) {
        toast.error('Comment cannot be empty');
        setIsSaving(false);
        return;
      }

      await onSave(finalContent);
    } catch (err: any) {
      console.error('Failed to save comment edit:', err);
      toast.error(err.message || 'Failed to update comment');
      setIsSaving(false);
    }
  };

  // Keyboard navigation for mentions and Escape to cancel
  const handleEditorKeyDownCapture = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (showMentionMenu && filteredUsers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex(prev => (prev + 1) % filteredUsers.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex(prev => (prev - 1 + filteredUsers.length) % filteredUsers.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        const user = filteredUsers[selectedIndex] || filteredUsers[0];
        if (user) insertSelectedMention(user);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setShowMentionMenu(false);
        return;
      }
    }

    if (e.key === 'Escape' && !isSaving) {
      e.preventDefault();
      onCancel();
    }
  };

  // Handle enter key submit: if mention menu is open, select mention instead of saving
  const handleEditorSubmit = () => {
    if (showMentionMenu && filteredUsers.length > 0) {
      const user = filteredUsers[selectedIndex] || filteredUsers[0];
      if (user) {
        insertSelectedMention(user);
        return;
      }
    }
    handleSave();
  };

  const totalAttachmentsCount = existingAttachments.length + stagedFiles.length;
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const prevAttachmentsCount = useRef(totalAttachmentsCount);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (bottomAnchorRef.current) {
      bottomAnchorRef.current.scrollIntoView({
        behavior,
        block: 'nearest',
      });
    }
  }, []);

  // When form mounts (user clicks Edit), automatically scroll bottom of edit form into view
  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      scrollToBottom('smooth');
    });
    const t1 = setTimeout(() => scrollToBottom('smooth'), 80);
    const t2 = setTimeout(() => scrollToBottom('smooth'), 220);
    const t3 = setTimeout(() => scrollToBottom('smooth'), 450);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [scrollToBottom]);

  // Scroll into view whenever attachments/images change
  useEffect(() => {
    if (totalAttachmentsCount !== prevAttachmentsCount.current) {
      prevAttachmentsCount.current = totalAttachmentsCount;
      const timer = setTimeout(() => scrollToBottom('smooth'), 60);
      return () => clearTimeout(timer);
    }
  }, [totalAttachmentsCount, scrollToBottom]);

  const canSave = !isSaving && !isUploadingInline && hasAnyContent && hasChanged;

  return (
    <div
      onPasteCapture={handleOuterPasteCapture}
      onDragEnter={handleFormDragEnter}
      onDragOver={handleFormDragOver}
      onDragLeave={handleFormDragLeave}
      onDrop={handleFormDrop}
      style={{
        borderColor: isDraggingOverForm
          ? 'var(--accent)'
          : 'color-mix(in srgb, var(--accent) 40%, var(--border, #3f3f46))',
        backgroundColor: 'color-mix(in srgb, var(--accent) 3.5%, var(--surface, #18181b))',
        boxShadow: isDraggingOverForm
          ? '0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent)'
          : '0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent)',
      }}
      className="relative flex flex-col gap-2.5 w-full p-3 rounded-xl border transition-all"
    >
      {isDraggingOverForm && (
        <div
          style={{
            borderColor: 'var(--accent)',
            boxShadow: '0 0 24px color-mix(in srgb, var(--accent) 35%, transparent)',
          }}
          className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl bg-zinc-950/90 backdrop-blur-sm border-2 border-dashed pointer-events-none animate-in fade-in zoom-in-95 duration-150 p-4 text-center"
        >
          <p className="text-sm font-semibold text-zinc-100">Drop files to add</p>
          <p className="text-xs text-zinc-400 mt-0.5">Images placed inline &bull; Files attached</p>
          <div className="flex items-center gap-1.5 mt-2 text-[10px] text-zinc-400 bg-zinc-900/80 px-2.5 py-0.5 rounded-full border border-zinc-800">
            <ShieldAlert className="w-3 h-3 text-amber-400 shrink-0" />
            <span>Max image: 10MB &bull; Max file: 25MB &bull; No executables or videos</span>
          </div>
        </div>
      )}

      {/* Editor Container with Mention Detection */}
      <div
        ref={editorWrapperRef}
        onKeyDownCapture={handleEditorKeyDownCapture}
        className="relative w-full"
      >
        <CommentEditor
          ref={commentEditorRef}
          id={`edit-${commentId}`}
          value={text}
          onChange={(html, textContent, cursorPosition, textBefore) => {
            setText(html);
            const textStr = textContent || '';
            const textBeforeCursor = textBefore !== undefined
              ? textBefore
              : (cursorPosition !== undefined && cursorPosition >= 0)
                ? textStr.substring(0, Math.min(textStr.length, cursorPosition))
                : textStr;

            // Trigger mention dropdown when '@' follows start of text or whitespace
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
          onPasteFiles={handlePasteFiles}
          onDropFiles={addFiles}
          onUploadImage={uploadImage}
          onUploadImageUrl={copyImage}
          onUploadingChange={setIsUploadingInline}
          onSubmit={handleEditorSubmit}
          autoFocus
          disabled={isSaving}
          placeholder="Edit comment or type @ to mention..."
        />
      </div>

      {/* Portaled Mention Dropdown (immune to overflow-y-auto clipping) */}
      {showMentionMenu && menuPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={mentionMenuRef}
          style={{
            position: 'fixed',
            top: menuPosition.top,
            left: menuPosition.left,
            width: menuPosition.width,
            zIndex: 999999,
          }}
          onMouseDown={(e) => e.preventDefault()}
          className="bg-popover border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="p-2 border-b border-border text-xs font-semibold text-muted-foreground bg-accent/40 flex items-center justify-between">
            <span>People</span>
            <span className="text-[10px] text-muted-foreground font-normal">↑↓ navigate, Enter/Tab select</span>
          </div>
          <div ref={mentionListRef} className="max-h-48 overflow-y-auto custom-scrollbar relative">
            {filteredUsers.map((u: any, idx: number) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={u.id}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertSelectedMention(u)}
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
                    <span className="text-xs font-medium truncate">{u.name || 'Unknown User'}</span>
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

      {/* Existing and Staged Attachments Strip (positioned below editor, above toolbar) */}
      {totalAttachmentsCount > 0 && (
        <div className="flex flex-wrap gap-2.5 pt-2 pb-1 border-t border-zinc-800/60">
          {/* Existing Attachments */}
          {existingAttachments.map((att) => {
            const ext = getFileExtension(att.name || att.url);
            return (
              <div
                key={att.id}
                className="relative group flex items-center justify-center bg-zinc-900 rounded-lg border border-zinc-700/60 w-16 h-16 shrink-0 overflow-hidden shadow-sm"
              >
                {att.type === 'image' ? (
                  <>
                    <img
                      src={att.url}
                      alt={att.name}
                      className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => onPreviewImage?.(att.url)}
                      title="Click to preview"
                    />
                    <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-white font-medium text-center py-0.5">
                      Image
                    </span>
                  </>
                ) : att.type === 'video' ? (
                  <>
                    <video src={att.url} className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] text-white font-medium text-center py-0.5">
                      Video
                    </span>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center p-1 text-center w-full">
                    <FileText className="w-4.5 h-4.5 text-zinc-400 mb-0.5" />
                    <span className="text-[8px] font-bold tracking-wider uppercase px-1 py-0.2 rounded bg-zinc-800 text-zinc-400">
                      {ext}
                    </span>
                    <span className="text-[9px] text-zinc-400 font-mono truncate max-w-[50px] mt-0.5" title={att.name}>{att.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setExistingAttachments(prev => prev.filter(a => a.id !== att.id))}
                  title="Remove attachment"
                  className="absolute top-1 right-1 p-0.5 bg-black/80 hover:bg-red-600 border border-zinc-700/80 rounded-full text-zinc-300 hover:text-white shadow-sm backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {/* Newly Staged Files */}
          {stagedFiles.map((file, idx) => {
            const isImage = file.type.startsWith('image/');
            const previewUrl = isImage ? URL.createObjectURL(file) : null;
            const ext = getFileExtension(file.name);
            const isSoftWarning = isImage ? file.size > IMAGE_SOFT_MAX_BYTES : file.size > ATTACHMENT_SOFT_MAX_BYTES;
            const softLimitLabel = isImage ? '>3MB' : '>10MB';
            const sizeFormatted = formatFileSize(file.size);
            return (
              <div
                key={idx}
                style={!isSoftWarning ? {
                  borderColor: 'color-mix(in srgb, var(--accent) 50%, var(--border, #3f3f46))',
                  boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent)',
                } : undefined}
                className={`relative group flex items-center justify-center bg-zinc-900 rounded-lg border ${isSoftWarning ? 'border-amber-500/60 ring-1 ring-amber-500/30' : ''} w-16 h-16 shrink-0 overflow-hidden shadow-sm`}
              >
                {isImage && previewUrl ? (
                  <>
                    <img
                      src={previewUrl}
                      alt={file.name}
                      className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => onPreviewImage?.(previewUrl)}
                      title="Click to preview"
                    />
                    <span
                      style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 85%, black)' }}
                      className="absolute bottom-0 inset-x-0 text-[8px] text-white font-medium text-center py-0.5"
                    >
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
                    <FileText
                      style={!isSoftWarning ? { color: 'var(--accent)' } : undefined}
                      className={`w-4 h-4 ${isSoftWarning ? 'text-amber-400' : ''} mb-0.5`}
                    />
                    <span
                      style={!isSoftWarning ? {
                        backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                        color: 'var(--accent)',
                      } : undefined}
                      className={`text-[8px] font-bold tracking-wider uppercase px-1 py-0.2 rounded ${isSoftWarning ? 'bg-amber-500/15 text-amber-400' : ''}`}
                    >
                      {ext}
                    </span>
                    <span className="text-[9px] text-zinc-300 font-medium truncate max-w-[50px] mt-0.5" title={file.name}>{file.name}</span>
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
                  type="button"
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

      {/* Action Toolbar */}
      <div className="flex flex-col gap-2 pt-2 border-t border-zinc-800/60">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <input
              type="file"
              ref={fileInputRef}
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            <ComposerToolButton
              onClick={() => fileInputRef.current?.click()}
              disabled={isSaving}
              title="Attach files or images"
            >
              <Paperclip className="w-4 h-4" />
            </ComposerToolButton>
            <div className="relative">
              <ComposerToolButton
                onClick={(e) => {
                  const btn = e.currentTarget;
                  setEmojiAnchor(prev => prev ? null : btn);
                }}
                disabled={isSaving}
                title="Add emoji"
              >
                <SmilePlus className="w-4 h-4" />
              </ComposerToolButton>
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
            </div>

            <div className="w-px h-3.5 bg-zinc-700/60 mx-0.5" />

            <ComposerToolButton
              onClick={() => commentEditorRef.current?.outdent()}
              disabled={isSaving}
              title="Decrease indent (Ctrl+[)"
            >
              <IndentDecrease className="w-4 h-4" />
            </ComposerToolButton>
            <ComposerToolButton
              onClick={() => commentEditorRef.current?.indent()}
              disabled={isSaving}
              title="Increase indent (Ctrl+])"
            >
              <IndentIncrease className="w-4 h-4" />
            </ComposerToolButton>

            <div className="w-px h-3.5 bg-zinc-700/60 mx-0.5" />

            <ComposerToolButton
              onClick={() => commentEditorRef.current?.toggleTaskList()}
              disabled={isSaving}
              title="Checklist"
            >
              <CheckSquare className="w-4 h-4" />
            </ComposerToolButton>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="px-3 py-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 hover:bg-zinc-700 hover:text-white text-zinc-300 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              style={
                canSave
                  ? {
                      backgroundColor: 'var(--accent)',
                      color: 'var(--on-accent, #ffffff)',
                    }
                  : undefined
              }
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-md transition-all flex items-center gap-1.5 shrink-0 ${
                canSave
                  ? 'hover:opacity-90 active:scale-95 cursor-pointer text-white shadow-[0_2px_8px_color-mix(in_srgb,var(--accent)_30%,transparent)]'
                  : 'bg-zinc-800/80 text-zinc-500 border border-zinc-700/40 cursor-not-allowed'
              }`}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Micro instructions line */}
        <div className="flex items-center gap-2 text-[11px] text-zinc-500 flex-wrap select-none px-0.5">
          <span>• Type <span className="text-zinc-400 font-medium">@</span> to mention</span>
          <span>• Indent <span className="text-zinc-400 font-mono text-[10px]">(Ctrl+[ / Ctrl+])</span></span>
          <span className="inline-flex items-center gap-1">
            • Paste images <span className="text-zinc-400 font-mono text-[10px]">(Ctrl+V)</span>
          </span>
        </div>
      </div>

      {/* Invisible bottom anchor for auto-scrolling the bottom into view on edit */}
      <div
        ref={bottomAnchorRef}
        data-edit-bottom="true"
        style={{ scrollMarginBottom: '32px' }}
        className="h-px w-full pointer-events-none opacity-0"
        aria-hidden="true"
      />
    </div>
  );
}
