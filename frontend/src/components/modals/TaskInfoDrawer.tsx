'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  Image as ImageIcon,
  Link2,
  CheckSquare,
  ExternalLink,
  Copy,
  Check,
  Search,
  Calendar,
  Layers,
  Sparkles,
  Clock,
  User,
  ListTodo,
} from 'lucide-react';
import { extractImagesFromContent } from '@/lib/commentImages';
import { openExternalLink } from '@/lib/links';

export interface TaskInfoDrawerProps {
  task: any;
  comments: any[];
  onClose: () => void;
  onPreviewImage: (src: string) => void;
  workspaceUsers?: any[];
  currentUser?: any;
  isSubtask?: boolean;
}

export interface ExtractedImageItem {
  id: string;
  url: string;
  fileName?: string;
  createdAt: string | number | Date;
  authorName?: string;
  authorAvatar?: string;
  source: 'attachment' | 'comment' | 'description';
  commentId?: string;
}

export interface ExtractedLinkItem {
  id: string;
  url: string;
  title: string;
  domain: string;
  createdAt: string | number | Date;
  authorName?: string;
  authorAvatar?: string;
  source: 'description' | 'comment' | 'attachment';
  commentId?: string;
}

export interface ExtractedTasklistItem {
  id: string;
  title: string;
  completed: boolean;
  groupName: string;
  status?: string;
  createdAt: string | number | Date;
  assignees?: { id?: string; name?: string; avatarUrl?: string }[];
  source: 'checklist' | 'subtask' | 'comment';
}

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|png|gif|webp|svg|avif)(\?.*)?$/i;

function isImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return IMAGE_EXTENSION_REGEX.test(url) || url.startsWith('data:image/');
}

function extractDomain(url: string): string {
  try {
    const raw = url.trim();
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withProto);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return 'link';
  }
}

function formatRelativeTime(dateInput: string | number | Date): string {
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return 'Just now';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 4) return `${diffWeeks}w ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function getTimeGroupKey(dateInput: string | number | Date): string {
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return 'Earlier';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfThisWeek = startOfToday - (now.getDay() === 0 ? 6 : now.getDay() - 1) * 86400000;

  const time = date.getTime();
  if (time >= startOfToday) return 'Today';
  if (time >= startOfYesterday) return 'Yesterday';
  if (time >= startOfThisWeek) return 'This Week';

  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function groupItemsByTime<T extends { createdAt: string | number | Date }>(items: T[]): { group: string; items: T[] }[] {
  const groups: Record<string, T[]> = {};
  const groupOrder: string[] = [];

  for (const item of items) {
    const key = getTimeGroupKey(item.createdAt);
    if (!groups[key]) {
      groups[key] = [];
      groupOrder.push(key);
    }
    groups[key].push(item);
  }

  return groupOrder.map((group) => ({
    group,
    items: groups[group],
  }));
}

export function TaskInfoDrawer({
  task,
  comments,
  onClose,
  onPreviewImage,
  workspaceUsers = [],
  currentUser,
  isSubtask = false,
}: TaskInfoDrawerProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'images' | 'links' | 'tasklists'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);

  // 1. Extract Images
  const extractedImages: ExtractedImageItem[] = useMemo(() => {
    const results: ExtractedImageItem[] = [];
    const seenUrls = new Set<string>();

    const addImage = (img: ExtractedImageItem) => {
      if (!img.url || seenUrls.has(img.url)) return;
      seenUrls.add(img.url);
      results.push(img);
    };

    // From Task Attachments
    if (Array.isArray(task?.attachments)) {
      task.attachments.forEach((att: any) => {
        const mime = (att.mimeType || '').toLowerCase();
        const isImg = mime.startsWith('image/') || isImageUrl(att.fileName) || isImageUrl(att.fileUrl);
        if (isImg) {
          addImage({
            id: att.id || att.fileKey,
            url: att.fileUrl,
            fileName: att.fileName || 'Task Attachment',
            createdAt: att.createdAt || task.createdAt || Date.now(),
            authorName: att.uploadedBy?.name || task.creator?.name,
            authorAvatar: att.uploadedBy?.avatarUrl || task.creator?.avatarUrl,
            source: 'attachment',
          });
        }
      });
    }

    // From Task Description
    if (task?.description) {
      const descImages = extractImagesFromContent(task.description);
      descImages.forEach((url, i) => {
        addImage({
          id: `desc-img-${i}`,
          url,
          fileName: 'Description Image',
          createdAt: task.createdAt || Date.now(),
          authorName: task.creator?.name,
          authorAvatar: task.creator?.avatarUrl,
          source: 'description',
        });
      });
    }

    // From Comments & Replies
    if (Array.isArray(comments)) {
      comments.forEach((c: any) => {
        // Comment attachments
        if (Array.isArray(c.attachments)) {
          c.attachments.forEach((att: any) => {
            const mime = (att.mimeType || '').toLowerCase();
            const isImg = mime.startsWith('image/') || isImageUrl(att.fileName) || isImageUrl(att.fileUrl);
            if (isImg) {
              addImage({
                id: att.id || `${c.id}-att-${att.fileKey}`,
                url: att.fileUrl,
                fileName: att.fileName || 'Comment Attachment',
                createdAt: c.createdAt,
                authorName: c.user?.name,
                authorAvatar: c.user?.avatarUrl,
                source: 'comment',
                commentId: c.id,
              });
            }
          });
        }

        // Inline content images
        if (c.content) {
          const inlineImages = extractImagesFromContent(c.content);
          inlineImages.forEach((url, idx) => {
            addImage({
              id: `${c.id}-inline-${idx}`,
              url,
              fileName: 'Comment Image',
              createdAt: c.createdAt,
              authorName: c.user?.name,
              authorAvatar: c.user?.avatarUrl,
              source: 'comment',
              commentId: c.id,
            });
          });
        }

        // Replies
        if (Array.isArray(c.replies)) {
          c.replies.forEach((r: any) => {
            if (Array.isArray(r.attachments)) {
              r.attachments.forEach((att: any) => {
                const mime = (att.mimeType || '').toLowerCase();
                const isImg = mime.startsWith('image/') || isImageUrl(att.fileName) || isImageUrl(att.fileUrl);
                if (isImg) {
                  addImage({
                    id: att.id || `${r.id}-att-${att.fileKey}`,
                    url: att.fileUrl,
                    fileName: att.fileName || 'Reply Attachment',
                    createdAt: r.createdAt,
                    authorName: r.user?.name,
                    authorAvatar: r.user?.avatarUrl,
                    source: 'comment',
                    commentId: r.id,
                  });
                }
              });
            }
            if (r.content) {
              const inlineImages = extractImagesFromContent(r.content);
              inlineImages.forEach((url, idx) => {
                addImage({
                  id: `${r.id}-inline-${idx}`,
                  url,
                  fileName: 'Reply Image',
                  createdAt: r.createdAt,
                  authorName: r.user?.name,
                  authorAvatar: r.user?.avatarUrl,
                  source: 'comment',
                  commentId: r.id,
                });
              });
            }
          });
        }
      });
    }

    // Sort newest first
    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [task, comments]);

  // 2. Extract Links
  const extractedLinks: ExtractedLinkItem[] = useMemo(() => {
    const results: ExtractedLinkItem[] = [];
    const seenUrls = new Set<string>();

    const addLink = (link: ExtractedLinkItem) => {
      const trimmedUrl = (link.url || '').trim();
      if (!trimmedUrl || trimmedUrl.startsWith('mention://') || seenUrls.has(trimmedUrl)) return;
      if (isImageUrl(trimmedUrl)) return; // Exclude direct image files since they are in Images tab
      seenUrls.add(trimmedUrl);
      results.push(link);
    };

    const parseLinksFromText = (
      text: string,
      createdAt: any,
      authorName?: string,
      authorAvatar?: string,
      source: 'description' | 'comment' = 'comment',
      commentId?: string
    ) => {
      if (!text || typeof text !== 'string') return;

      // 1. Markdown links: [Title](url)
      const mdRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/gi;
      let mdMatch: RegExpExecArray | null;
      while ((mdMatch = mdRegex.exec(text)) !== null) {
        const title = mdMatch[1];
        const url = mdMatch[2];
        addLink({
          id: `md-${url}-${mdMatch.index}`,
          url,
          title: title || extractDomain(url),
          domain: extractDomain(url),
          createdAt,
          authorName,
          authorAvatar,
          source,
          commentId,
        });
      }

      // 2. HTML anchor links: <a href="url">Title</a>
      const htmlRegex = /<a\b[^>]*?\bhref=["'](https?:\/\/[^"']+)["'][^>]*>(.*?)<\/a>/gi;
      let htmlMatch: RegExpExecArray | null;
      while ((htmlMatch = htmlRegex.exec(text)) !== null) {
        const url = htmlMatch[1];
        const rawTitle = htmlMatch[2]?.replace(/<[^>]+>/g, '').trim();
        addLink({
          id: `html-${url}-${htmlMatch.index}`,
          url,
          title: rawTitle || extractDomain(url),
          domain: extractDomain(url),
          createdAt,
          authorName,
          authorAvatar,
          source,
          commentId,
        });
      }

      // 3. Raw URLs
      const urlRegex = /\bhttps?:\/\/[^\s<>"']+/gi;
      let rawMatch: RegExpExecArray | null;
      while ((rawMatch = urlRegex.exec(text)) !== null) {
        const rawUrl = rawMatch[0].replace(/[.,;:!?)\]}'"]+$/, '');
        if (rawUrl && !seenUrls.has(rawUrl)) {
          addLink({
            id: `raw-${rawUrl}-${rawMatch.index}`,
            url: rawUrl,
            title: extractDomain(rawUrl),
            domain: extractDomain(rawUrl),
            createdAt,
            authorName,
            authorAvatar,
            source,
            commentId,
          });
        }
      }
    };

    // From Task Description
    if (task?.description) {
      parseLinksFromText(
        task.description,
        task.createdAt || Date.now(),
        task.creator?.name,
        task.creator?.avatarUrl,
        'description'
      );
    }

    // From Non-Image Attachments (e.g. documents, PDFs with fileUrl)
    if (Array.isArray(task?.attachments)) {
      task.attachments.forEach((att: any) => {
        if (att.fileUrl && !isImageUrl(att.fileUrl)) {
          addLink({
            id: `att-link-${att.id}`,
            url: att.fileUrl,
            title: att.fileName || extractDomain(att.fileUrl),
            domain: extractDomain(att.fileUrl),
            createdAt: att.createdAt || task.createdAt || Date.now(),
            authorName: att.uploadedBy?.name || task.creator?.name,
            authorAvatar: att.uploadedBy?.avatarUrl || task.creator?.avatarUrl,
            source: 'attachment',
          });
        }
      });
    }

    // From Comments & Replies
    if (Array.isArray(comments)) {
      comments.forEach((c: any) => {
        parseLinksFromText(c.content, c.createdAt, c.user?.name, c.user?.avatarUrl, 'comment', c.id);
        if (Array.isArray(c.replies)) {
          c.replies.forEach((r: any) => {
            parseLinksFromText(r.content, r.createdAt, r.user?.name, r.user?.avatarUrl, 'comment', r.id);
          });
        }
      });
    }

    // Sort newest first
    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [task, comments]);

  // 3. Extract Tasklists
  const extractedTasklists: ExtractedTasklistItem[] = useMemo(() => {
    const results: ExtractedTasklistItem[] = [];

    // From Checklists
    if (Array.isArray(task?.checklists)) {
      task.checklists.forEach((chk: any) => {
        const groupName = chk.name || 'Checklist';
        if (Array.isArray(chk.items)) {
          chk.items.forEach((item: any) => {
            results.push({
              id: item.id,
              title: item.text,
              completed: Boolean(item.completed),
              groupName,
              createdAt: item.createdAt || chk.createdAt || task.createdAt || Date.now(),
              assignees: item.checkedBy ? [item.checkedBy] : [],
              source: 'checklist',
            });
          });
        }
      });
    }

    // From Subtasks
    if (Array.isArray(task?.subtasks)) {
      task.subtasks.forEach((st: any) => {
        results.push({
          id: st.id,
          title: st.title,
          completed: Boolean(st.completed || st.status === 'COMPLETE' || st.status === 'DONE'),
          groupName: 'Subtasks',
          status: st.status || 'PENDING',
          createdAt: st.createdAt || task.createdAt || Date.now(),
          assignees: st.assignees || (st.User ? [st.User] : []),
          source: 'subtask',
        });
      });
    }

    // From Comment Task Lists
    if (Array.isArray(comments)) {
      comments.forEach((c: any) => {
        if (!c.content) return;
        // GFM task list regex: - [ ] text or - [x] text
        const taskRegex = /^[-*]\s*\[([ xX])\]\s*(.+)$/gm;
        let match: RegExpExecArray | null;
        let itemIndex = 0;
        while ((match = taskRegex.exec(c.content)) !== null) {
          const isDone = match[1].toLowerCase() === 'x';
          const title = match[2]?.trim();
          if (title) {
            results.push({
              id: `comment-${c.id}-task-${itemIndex++}`,
              title,
              completed: isDone,
              groupName: `Comment by ${c.user?.name || 'User'}`,
              createdAt: c.createdAt,
              assignees: c.user ? [c.user] : [],
              source: 'comment',
            });
          }
        }
      });
    }

    // Sort newest first
    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [task, comments]);

  // Search filtering
  const query = searchQuery.trim().toLowerCase();

  const filteredImages = useMemo(() => {
    if (!query) return extractedImages;
    return extractedImages.filter(
      (img) =>
        img.fileName?.toLowerCase().includes(query) ||
        img.authorName?.toLowerCase().includes(query)
    );
  }, [extractedImages, query]);

  const filteredLinks = useMemo(() => {
    if (!query) return extractedLinks;
    return extractedLinks.filter(
      (link) =>
        link.title.toLowerCase().includes(query) ||
        link.domain.toLowerCase().includes(query) ||
        link.url.toLowerCase().includes(query) ||
        link.authorName?.toLowerCase().includes(query)
    );
  }, [extractedLinks, query]);

  const filteredTasklists = useMemo(() => {
    if (!query) return extractedTasklists;
    return extractedTasklists.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.groupName.toLowerCase().includes(query) ||
        item.assignees?.some((a) => a.name?.toLowerCase().includes(query))
    );
  }, [extractedTasklists, query]);

  // Grouped by time
  const imageTimeGroups = useMemo(() => groupItemsByTime(filteredImages), [filteredImages]);
  const linkTimeGroups = useMemo(() => groupItemsByTime(filteredLinks), [filteredLinks]);
  const tasklistTimeGroups = useMemo(() => groupItemsByTime(filteredTasklists), [filteredTasklists]);

  // Copy Link Handler
  const handleCopyLink = useCallback((id: string, url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url);
      setCopiedLinkId(id);
      setTimeout(() => setCopiedLinkId((prev) => (prev === id ? null : prev)), 2000);
    }
  }, []);

  // Summary counts
  const totalImages = extractedImages.length;
  const totalLinks = extractedLinks.length;
  const totalTasklists = extractedTasklists.length;
  const completedTasklists = extractedTasklists.filter((t) => t.completed).length;

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden text-zinc-200">
      {/* Top Header: Messenger Chat Info Style */}
      <div className="px-4 py-3.5 border-b border-zinc-800/60 shrink-0 flex items-center justify-between bg-card">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 -ml-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70 rounded-lg transition-colors cursor-pointer shrink-0"
            title="Back to Activity Feed"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-zinc-100 truncate">
              {isSubtask ? 'Subtask Info' : 'Chat info'}
            </h3>
            <p className="text-[11px] text-zinc-400 truncate">
              {task?.title || 'Task Details'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {task?.status && (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-zinc-800/90 border border-zinc-700/60 text-zinc-300">
              {task.status}
            </span>
          )}
        </div>
      </div>

      {/* Overview & Media Preview Collage (Messenger Image 2 Style) */}
      <div className="p-4 border-b border-zinc-800/60 bg-zinc-900/30 shrink-0 space-y-3">
        {/* Recent Media Collage (up to 4 thumbnails) */}
        {extractedImages.length > 0 ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-indigo-400" />
                <span>Recent Media</span>
              </span>
              <button
                type="button"
                onClick={() => setActiveTab('images')}
                className="text-[11px] text-blue-400 hover:text-blue-300 font-medium transition-colors cursor-pointer"
              >
                View all ({totalImages})
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2 h-20">
              {extractedImages.slice(0, 4).map((img, idx) => (
                <div
                  key={img.id || idx}
                  onClick={() => onPreviewImage(img.url)}
                  className="relative group rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900 cursor-pointer aspect-square"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.fileName || 'Media'}
                    className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-[10px] text-white font-medium bg-black/60 px-1.5 py-0.5 rounded">
                      View
                    </span>
                  </div>
                  {idx === 3 && extractedImages.length > 4 && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                      <span className="text-xs font-bold text-white">
                        +{extractedImages.length - 3}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-zinc-500 py-1">
            <Clock className="w-3.5 h-3.5" />
            <span>Created {new Date(task?.createdAt || Date.now()).toLocaleDateString()}</span>
          </div>
        )}

        {/* Quick Summary Pill Row */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <button
            type="button"
            onClick={() => setActiveTab('images')}
            className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
              activeTab === 'images'
                ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-300'
                : 'bg-zinc-800/40 border-zinc-800/60 hover:bg-zinc-800/70 text-zinc-400'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <ImageIcon className="w-3.5 h-3.5 shrink-0" />
              <span>Images</span>
            </div>
            <div className="text-base font-semibold text-zinc-200 mt-0.5">
              {totalImages}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('links')}
            className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
              activeTab === 'links'
                ? 'bg-blue-500/10 border-blue-500/40 text-blue-300'
                : 'bg-zinc-800/40 border-zinc-800/60 hover:bg-zinc-800/70 text-zinc-400'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Link2 className="w-3.5 h-3.5 shrink-0" />
              <span>Links</span>
            </div>
            <div className="text-base font-semibold text-zinc-200 mt-0.5">
              {totalLinks}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tasklists')}
            className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
              activeTab === 'tasklists'
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                : 'bg-zinc-800/40 border-zinc-800/60 hover:bg-zinc-800/70 text-zinc-400'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <CheckSquare className="w-3.5 h-3.5 shrink-0" />
              <span>Tasklists</span>
            </div>
            <div className="text-base font-semibold text-zinc-200 mt-0.5">
              {completedTasklists}/{totalTasklists}
            </div>
          </button>
        </div>
      </div>

      {/* Tabs / Separators & Search Bar */}
      <div className="px-4 py-2.5 border-b border-zinc-800/60 shrink-0 space-y-2.5 bg-card">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-zinc-900/60 rounded-lg border border-zinc-800/60">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer text-center ${
              activeTab === 'all'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('images')}
            className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer text-center flex items-center justify-center gap-1 ${
              activeTab === 'images'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <span>Images</span>
            {totalImages > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-700/60 text-zinc-300">
                {totalImages}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('links')}
            className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer text-center flex items-center justify-center gap-1 ${
              activeTab === 'links'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <span>Links</span>
            {totalLinks > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-700/60 text-zinc-300">
                {totalLinks}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('tasklists')}
            className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer text-center flex items-center justify-center gap-1 ${
              activeTab === 'tasklists'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
            }`}
          >
            <span>Tasks</span>
            {totalTasklists > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-700/60 text-zinc-300">
                {totalTasklists}
              </span>
            )}
          </button>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search images, links, or task items..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/20"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area with Chronological Time Separators */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-6">
        {/* --- VIEW: ALL / OVERVIEW --- */}
        {activeTab === 'all' && (
          <div className="space-y-6">
            {/* 1. Images Section */}
            <div>
              <div className="flex items-center justify-between pb-2 mb-3 border-b border-zinc-800/50">
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-indigo-400" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                    Images & Media ({totalImages})
                  </h4>
                </div>
                {totalImages > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('images')}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                  >
                    See all
                  </button>
                )}
              </div>

              {filteredImages.length === 0 ? (
                <div className="text-xs text-zinc-500 py-3 text-center bg-zinc-900/30 rounded-lg border border-zinc-800/40">
                  No images found
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2.5">
                  {filteredImages.slice(0, 6).map((img) => (
                    <div
                      key={img.id}
                      onClick={() => onPreviewImage(img.url)}
                      className="group relative rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900 aspect-square cursor-pointer"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt={img.fileName || 'Image'}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2 flex flex-col justify-end">
                        <span className="text-[10px] text-zinc-200 font-medium truncate">
                          {img.authorName || 'User'}
                        </span>
                        <span className="text-[9px] text-zinc-400">
                          {formatRelativeTime(img.createdAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 2. Links Section */}
            <div>
              <div className="flex items-center justify-between pb-2 mb-3 border-b border-zinc-800/50">
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-blue-400" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                    Shared Links ({totalLinks})
                  </h4>
                </div>
                {totalLinks > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('links')}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                  >
                    See all
                  </button>
                )}
              </div>

              {filteredLinks.length === 0 ? (
                <div className="text-xs text-zinc-500 py-3 text-center bg-zinc-900/30 rounded-lg border border-zinc-800/40">
                  No shared links found
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredLinks.slice(0, 4).map((link) => (
                    <div
                      key={link.id}
                      onClick={() => openExternalLink(link.url)}
                      className="p-2.5 rounded-lg border border-zinc-800/70 bg-zinc-900/40 hover:bg-zinc-800/60 hover:border-zinc-700 transition-all flex items-start justify-between gap-3 cursor-pointer group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[10px] font-semibold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
                            {link.domain}
                          </span>
                          <span className="text-[11px] text-zinc-400">
                            · {formatRelativeTime(link.createdAt)}
                          </span>
                        </div>
                        <div className="text-xs font-medium text-zinc-200 group-hover:text-blue-300 transition-colors truncate">
                          {link.title}
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate mt-0.5">
                          {link.url}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => handleCopyLink(link.id, link.url, e)}
                          title="Copy Link"
                          className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 rounded-md transition-colors cursor-pointer"
                        >
                          {copiedLinkId === link.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <span className="p-1.5 text-zinc-400 group-hover:text-zinc-200">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 3. Tasklists Section */}
            <div>
              <div className="flex items-center justify-between pb-2 mb-3 border-b border-zinc-800/50">
                <div className="flex items-center gap-2">
                  <CheckSquare className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                    Checklists & Subtasks ({totalTasklists})
                  </h4>
                </div>
                {totalTasklists > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('tasklists')}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                  >
                    See all
                  </button>
                )}
              </div>

              {filteredTasklists.length === 0 ? (
                <div className="text-xs text-zinc-500 py-3 text-center bg-zinc-900/30 rounded-lg border border-zinc-800/40">
                  No tasklist items found
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredTasklists.slice(0, 5).map((t) => (
                    <div
                      key={t.id}
                      className="p-2.5 rounded-lg border border-zinc-800/70 bg-zinc-900/40 flex items-start gap-2.5"
                    >
                      <div className="pt-0.5">
                        <div
                          className={`w-4 h-4 rounded flex items-center justify-center border ${
                            t.completed
                              ? 'bg-emerald-600 border-emerald-500 text-white'
                              : 'border-zinc-600 bg-zinc-800/60'
                          }`}
                        >
                          {t.completed && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-xs font-medium ${
                            t.completed ? 'line-through text-zinc-500' : 'text-zinc-200'
                          }`}
                        >
                          {t.title}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-zinc-400 mt-1">
                          <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700/50">
                            {t.groupName}
                          </span>
                          <span>· {formatRelativeTime(t.createdAt)}</span>
                          {t.assignees && t.assignees.length > 0 && (
                            <span className="text-zinc-400">
                              · {t.assignees[0]?.name || 'Assigned'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- VIEW: IMAGES TAB (Separated by Time) --- */}
        {activeTab === 'images' && (
          <div className="space-y-6">
            {imageTimeGroups.length === 0 ? (
              <div className="text-center py-12 text-zinc-500">
                <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-40 text-zinc-400" />
                <p className="text-xs font-medium">No images shared on this task yet</p>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Images attached to comments or the task description will appear here.
                </p>
              </div>
            ) : (
              imageTimeGroups.map(({ group, items }) => (
                <div key={group} className="space-y-3">
                  {/* Time Separator */}
                  <div className="sticky top-0 z-10 py-1 bg-card/95 backdrop-blur-sm flex items-center gap-2 border-b border-zinc-800/80">
                    <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                      {group}
                    </span>
                    <span className="text-[10px] text-zinc-400">({items.length})</span>
                  </div>

                  {/* Image Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {items.map((img) => (
                      <div
                        key={img.id}
                        onClick={() => onPreviewImage(img.url)}
                        className="group relative rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900 aspect-square cursor-pointer shadow-sm hover:border-zinc-700 transition-all"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt={img.fileName || 'Image'}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                        {/* Gradient Overlay with Author and Time (Messenger style) */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2.5 flex flex-col justify-between">
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={(e) => handleCopyLink(img.id, img.url, e)}
                              title="Copy Image URL"
                              className="p-1 rounded bg-black/60 hover:bg-black/80 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                            >
                              {copiedLinkId === img.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-white truncate">
                              {img.authorName || 'Shared'}
                            </div>
                            <div className="text-[10px] text-zinc-300 flex items-center gap-1 mt-0.5">
                              <Clock className="w-3 h-3" />
                              <span>{formatRelativeTime(img.createdAt)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Always-visible compact time badge */}
                        <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-medium text-zinc-300 backdrop-blur-sm group-hover:opacity-0 transition-opacity">
                          {formatRelativeTime(img.createdAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* --- VIEW: LINKS TAB (Separated by Time) --- */}
        {activeTab === 'links' && (
          <div className="space-y-6">
            {linkTimeGroups.length === 0 ? (
              <div className="text-center py-12 text-zinc-500">
                <Link2 className="w-8 h-8 mx-auto mb-2 opacity-40 text-zinc-400" />
                <p className="text-xs font-medium">No links found on this task</p>
                <p className="text-[11px] text-zinc-500 mt-1">
                  URLs pasted in comments, attachments, or description will appear here.
                </p>
              </div>
            ) : (
              linkTimeGroups.map(({ group, items }) => (
                <div key={group} className="space-y-3">
                  {/* Time Separator */}
                  <div className="sticky top-0 z-10 py-1 bg-card/95 backdrop-blur-sm flex items-center gap-2 border-b border-zinc-800/80">
                    <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                      {group}
                    </span>
                    <span className="text-[10px] text-zinc-400">({items.length})</span>
                  </div>

                  {/* Links List */}
                  <div className="space-y-2">
                    {items.map((link) => (
                      <div
                        key={link.id}
                        onClick={() => openExternalLink(link.url)}
                        className="p-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 hover:bg-zinc-800/60 hover:border-zinc-700 transition-all flex items-start justify-between gap-3 cursor-pointer group shadow-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-semibold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
                              {link.domain}
                            </span>
                            <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                              <User className="w-3 h-3 text-zinc-500" />
                              <span>{link.authorName || 'Teammate'}</span>
                            </span>
                            <span className="text-[11px] text-zinc-500">
                              · {formatRelativeTime(link.createdAt)}
                            </span>
                          </div>

                          <div className="text-xs font-medium text-zinc-100 group-hover:text-blue-300 transition-colors truncate">
                            {link.title}
                          </div>
                          <div className="text-[11px] text-zinc-500 truncate mt-0.5 font-mono">
                            {link.url}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0 pt-0.5">
                          <button
                            type="button"
                            onClick={(e) => handleCopyLink(link.id, link.url, e)}
                            title="Copy link"
                            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60 rounded-md transition-colors cursor-pointer"
                          >
                            {copiedLinkId === link.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <span
                            title="Open link"
                            className="p-1.5 text-zinc-400 group-hover:text-zinc-100"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* --- VIEW: TASKLISTS TAB (Separated by Time & Group) --- */}
        {activeTab === 'tasklists' && (
          <div className="space-y-6">
            {tasklistTimeGroups.length === 0 ? (
              <div className="text-center py-12 text-zinc-500">
                <CheckSquare className="w-8 h-8 mx-auto mb-2 opacity-40 text-zinc-400" />
                <p className="text-xs font-medium">No checklists or subtasks found</p>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Task checklists, subtasks, and comment checklists will appear here.
                </p>
              </div>
            ) : (
              tasklistTimeGroups.map(({ group, items }) => (
                <div key={group} className="space-y-3">
                  {/* Time Separator */}
                  <div className="sticky top-0 z-10 py-1 bg-card/95 backdrop-blur-sm flex items-center gap-2 border-b border-zinc-800/80">
                    <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                      {group}
                    </span>
                    <span className="text-[10px] text-zinc-400">({items.length})</span>
                  </div>

                  {/* Tasklist Items */}
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 hover:bg-zinc-800/40 transition-colors flex items-start gap-3 shadow-sm"
                      >
                        <div className="pt-0.5">
                          <div
                            className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                              item.completed
                                ? 'bg-emerald-600 border-emerald-500 text-white'
                                : 'border-zinc-600 bg-zinc-800/60'
                            }`}
                          >
                            {item.completed && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div
                            className={`text-xs font-medium ${
                              item.completed
                                ? 'line-through text-zinc-500'
                                : 'text-zinc-100'
                            }`}
                          >
                            {item.title}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-400 mt-1.5">
                            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700/50 font-medium">
                              {item.groupName}
                            </span>
                            {item.status && (
                              <span className="px-1.5 py-0.5 rounded bg-zinc-800/90 text-zinc-400 border border-zinc-700/40">
                                {item.status}
                              </span>
                            )}
                            <span className="flex items-center gap-1 text-zinc-500">
                              <Clock className="w-3 h-3" />
                              <span>{formatRelativeTime(item.createdAt)}</span>
                            </span>
                            {item.assignees && item.assignees.length > 0 && (
                              <span className="flex items-center gap-1 text-zinc-400">
                                <User className="w-3 h-3 text-zinc-500" />
                                <span>{item.assignees[0]?.name}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

