'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Minimize2,
  Pencil,
  Trash2,
  Maximize
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { User as UserModel } from '@/lib/types';
import { EmojiPicker } from '../ui/EmojiPicker';
import { EditCommentForm } from './EditCommentForm';
import { UserMentionChip } from '../ui/UserMentionChip';
import { TaskMentionChip } from '../ui/TaskMentionChip';
import { LinkWithPreview } from '../ui/LinkHoverPreview';
import {
  commentHtmlForMarkdown,
  normalizeHref,
  rehypeLinkify,
  rehypeUnknownTagsToText,
  parseNexusTaskLink,
} from '@/lib/links';

const COMMENT_REMARK_PLUGINS = [remarkGfm];
const COMMENT_REHYPE_PLUGINS = [rehypeRaw, rehypeUnknownTagsToText, rehypeLinkify];
const keepUrl = (url: string) => url;

interface FullscreenCommentModalProps {
  isOpen: boolean;
  onClose: () => void;
  comment: any | null;
  taskTitle?: string;
  parentTaskId?: string;
  currentUser: UserModel | null;
  workspaceUsers?: UserModel[];
  onToggleReaction: (commentId: string, emoji: string) => Promise<void>;
  onToggleChecklist?: (commentId: string, itemIndex: number, checked: boolean) => void;
  onSubmitReply?: (commentId: string, replyHtml: string) => Promise<void> | void;
  onEdit?: (commentId: string, newContent: string) => void;
  onDelete?: (commentId: string) => void;
  onPreviewImage: (imageUrl: string) => void;
}

function FullscreenMarkdownImage({
  src,
  alt,
  onPreviewImage,
}: {
  src: string;
  alt?: string;
  onPreviewImage: (src: string) => void;
}) {
  const [aspect, setAspect] = useState<'portrait' | 'landscape' | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const checkDimensions = (img: HTMLImageElement) => {
    if (img.naturalWidth && img.naturalHeight) {
      if (img.naturalHeight > img.naturalWidth) {
        setAspect('portrait');
      } else {
        setAspect('landscape');
      }
    }
  };

  useEffect(() => {
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      checkDimensions(imgRef.current);
    }
  }, [src]);

  const isPortrait = aspect === 'portrait';

  return (
    <span className="my-6 w-full flex flex-col items-center">
      <span
        className={`relative group/fullscreen-img rounded-2xl overflow-hidden border border-border bg-card/60 shadow-xl cursor-pointer flex items-center justify-center p-3 sm:p-4 transition-all duration-200 hover:border-indigo-500/50 ${
          isPortrait
            ? 'w-full max-w-[580px] sm:max-w-[660px] md:max-w-[740px]'
            : 'w-full max-w-5xl'
        }`}
        onClick={() => onPreviewImage(src)}
        title="Click to view full screen"
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt || 'attachment'}
          loading="lazy"
          onLoad={(e) => checkDimensions(e.currentTarget)}
          className={`rounded-xl hover:scale-[1.006] transition-all duration-200 ${
            isPortrait
              ? 'w-full h-auto max-h-none object-contain shadow-sm'
              : 'w-full max-h-[85vh] object-contain'
          }`}
        />
        <span className="absolute top-4 right-4 bg-background/85 backdrop-blur-md border border-border text-foreground px-3 py-1.5 rounded-lg text-xs font-semibold opacity-0 group-hover/fullscreen-img:opacity-100 transition-opacity flex items-center gap-1.5 shadow-md pointer-events-none">
          <Maximize className="w-3.5 h-3.5" />
          <span>Click to zoom</span>
        </span>
      </span>
    </span>
  );
}

export function FullscreenCommentModal({
  isOpen,
  onClose,
  comment,
  taskTitle,
  parentTaskId,
  currentUser,
  workspaceUsers = [],
  onToggleReaction,
  onToggleChecklist,
  onEdit,
  onDelete,
  onPreviewImage,
}: FullscreenCommentModalProps) {
  const [mounted, setMounted] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiPickerAnchor, setEmojiPickerAnchor] = useState<HTMLElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const markdownContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showEmojiPicker) {
          setShowEmojiPicker(false);
          setEmojiPickerAnchor(null);
          return;
        }
        if (isEditing) {
          setIsEditing(false);
          return;
        }
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showEmojiPicker, isEditing, onClose]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  // Reset editing mode when comment changes
  useEffect(() => {
    setIsEditing(false);
  }, [comment?.id]);

  // Markdown components with large, high-res image rendering and portrait/landscape adaptation
  const markdownComponents = useMemo(() => ({
    a: (props: any) => {
      const { node, ...rest } = props;
      const href = rest.href || '';
      if (href.match(/\.(mp4|webm|ogg|mov)(\?.*)?$/i)) {
        return (
          <span className="my-6 w-full flex flex-col items-center">
            <video
              src={href}
              controls
              className="w-full max-h-[85vh] rounded-2xl border border-border bg-black/60 shadow-xl"
            />
          </span>
        );
      }
      if (href.match(/\.(jpe?g|png|gif|webp|svg|avif)(\?.*)?$/i)) {
        return (
          <FullscreenMarkdownImage
            src={href}
            alt="attachment"
            onPreviewImage={onPreviewImage}
          />
        );
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
            parentTaskId={nexus.subtaskId ? (parentTaskId || nexus.taskId) : undefined}
            initialLabel={typeof rest.children === 'string' && !rest.children.startsWith('http') ? rest.children : undefined}
          />
        );
      }
      return (
        <LinkWithPreview
          {...rest}
          href={normalizeHref(href)}
          className="text-blue-600 dark:text-blue-400 hover:underline underline-offset-2 transition-colors inline-flex items-center gap-1 font-medium"
          onClick={(e) => e.stopPropagation()}
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
      const src = rest.src || '';
      return (
        <FullscreenMarkdownImage
          src={src}
          alt={rest.alt || 'attachment'}
          onPreviewImage={onPreviewImage}
        />
      );
    },
    video: (props: any) => {
      const { node, ...rest } = props;
      const src = rest.src || '';
      return (
        <span className="my-6 w-full flex flex-col items-center">
          <video
            {...rest}
            src={src}
            controls
            className="w-full max-h-[85vh] rounded-2xl border border-border bg-black/60 shadow-xl"
          />
        </span>
      );
    },
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
              if (!onToggleChecklist || !comment?.id) return;
              const target = e.target as HTMLInputElement;
              const newChecked = target.checked;
              const container = markdownContainerRef.current;
              if (!container) return;
              const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
              const clickedIndex = checkboxes.indexOf(target);
              if (clickedIndex !== -1) {
                onToggleChecklist(comment.id, clickedIndex, newChecked);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="cursor-pointer transition-transform active:scale-95 accent-indigo-600 dark:accent-indigo-500 rounded"
          />
        );
      }
      return <input {...props} />;
    },
  }), [onPreviewImage, parentTaskId, onToggleChecklist, comment?.id]);

  if (!mounted || typeof document === 'undefined') return null;

  // Process reactions
  const cGroups: Record<string, { count: number; users: string[]; hasMe: boolean }> = {};
  if (comment?.reactions) {
    comment.reactions.forEach((r: any) => {
      if (!cGroups[r.emoji]) cGroups[r.emoji] = { count: 0, users: [], hasMe: false };
      cGroups[r.emoji].count++;
      cGroups[r.emoji].users.push(r.user?.name || '?');
      if (r.userId === currentUser?.id) cGroups[r.emoji].hasMe = true;
    });
  }

  const isAuthor = comment?.user?.id === currentUser?.id;
  const createdAtFormatted = comment?.createdAt
    ? `${new Date(comment.createdAt).toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })} at ${new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : '';

  return createPortal(
    <AnimatePresence>
      {isOpen && comment && (
        <div className="fixed inset-0 z-[100000] flex flex-col justify-between">
          {/* Animated Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 dark:bg-black/85 backdrop-blur-md"
          />

          {/* Fullscreen Takeover Window - Fully responsive to light and dark theme */}
          <motion.div
            initial={{ opacity: 0, scale: 0.99, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.99, y: 12 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full h-full flex flex-col bg-background text-foreground overflow-hidden"
          >
            {/* Floating Top-Right Controls - Only shown when hovering its location */}
            <div className="absolute top-4 right-6 z-50 flex items-center gap-2 opacity-0 hover:opacity-100 transition-opacity duration-150 pointer-events-auto">
              {isAuthor && onEdit && !isEditing && (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-foreground bg-card/90 hover:bg-card border border-border shadow-md backdrop-blur-md transition-all cursor-pointer"
                  title="Edit comment"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Edit</span>
                </button>
              )}

              {isAuthor && onDelete && (
                <button
                  type="button"
                  onClick={() => {
                    onDelete(comment.id);
                    onClose();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:text-red-400 bg-card/90 hover:bg-card border border-border shadow-md backdrop-blur-md transition-all cursor-pointer"
                  title="Delete comment"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground bg-card/90 hover:bg-card border border-border shadow-lg backdrop-blur-md cursor-pointer transition-all active:scale-95"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Literal Fullscreen Reading Canvas */}
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-10 lg:p-14 w-full"
            >
              <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
                {/* Author Row */}
                <div className="flex items-center justify-between gap-4 border-b border-border pb-5">
                  <div className="flex items-center gap-3.5">
                    {comment.user?.avatarUrl ? (
                      <img
                        src={comment.user.avatarUrl}
                        alt={comment.user.name}
                        className="w-12 h-12 rounded-full object-cover shrink-0 ring-2 ring-border shadow-sm"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-indigo-600 shrink-0 flex items-center justify-center text-white text-base font-bold shadow-sm">
                        {(comment.user?.name || 'U').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground font-semibold text-lg">
                          {comment.user?.name || 'Someone'}
                        </span>
                        {isAuthor && (
                          <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full border border-border font-medium">
                            You
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground mt-0.5">{createdAtFormatted}</span>
                    </div>
                  </div>

                </div>

                {/* Comment Content / Edit Form */}
                {isEditing ? (
                  <div className="w-full">
                    <EditCommentForm
                      commentId={comment.id}
                      initialContent={comment.content || ''}
                      workspaceUsers={workspaceUsers}
                      currentUser={currentUser}
                      onSave={async (newContent) => {
                        if (onEdit) onEdit(comment.id, newContent);
                        setIsEditing(false);
                      }}
                      onCancel={() => setIsEditing(false)}
                      onPreviewImage={onPreviewImage}
                    />
                  </div>
                ) : (
                  <div
                    ref={markdownContainerRef}
                    className="text-foreground text-[15px] md:text-base leading-relaxed max-w-none break-words select-text cursor-text prose prose-zinc dark:prose-invert prose-p:my-2 prose-a:text-blue-600 dark:prose-a:text-blue-400"
                  >
                    <ReactMarkdown
                      remarkPlugins={COMMENT_REMARK_PLUGINS}
                      rehypePlugins={COMMENT_REHYPE_PLUGINS}
                      components={markdownComponents}
                      urlTransform={keepUrl}
                    >
                      {commentHtmlForMarkdown(comment.content || '')}
                    </ReactMarkdown>
                  </div>
                )}

                {/* Reactions Pills */}
                {Object.keys(cGroups).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-4 border-t border-border">
                    {Object.entries(cGroups).map(([emoji, data]) => (
                      <button
                        key={emoji}
                        type="button"
                        title={data.users.join(', ')}
                        onClick={() => onToggleReaction(comment.id, emoji)}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border transition-colors cursor-pointer ${
                          data.hasMe
                            ? 'bg-indigo-500/15 border-indigo-500/60 text-indigo-600 dark:text-indigo-300 font-semibold hover:bg-indigo-500/25'
                            : 'bg-card border-border text-foreground hover:bg-muted'
                        }`}
                      >
                        <span className="text-sm">{emoji}</span>
                        <span>{data.count}</span>
                      </button>
                    ))}

                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          setEmojiPickerAnchor(e.currentTarget);
                          setShowEmojiPicker(prev => !prev);
                        }}
                        className="flex items-center justify-center w-7 h-7 rounded-full border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted text-sm transition-colors cursor-pointer"
                        title="Add reaction"
                      >
                        +
                      </button>
                      {showEmojiPicker && emojiPickerAnchor && (
                        <EmojiPicker
                          anchorEl={emojiPickerAnchor}
                          onSelect={(emoji) => {
                            onToggleReaction(comment.id, emoji);
                            setShowEmojiPicker(false);
                            setEmojiPickerAnchor(null);
                          }}
                          onClose={() => {
                            setShowEmojiPicker(false);
                            setEmojiPickerAnchor(null);
                          }}
                          placement="auto"
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
