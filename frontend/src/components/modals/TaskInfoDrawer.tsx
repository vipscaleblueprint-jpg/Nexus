'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Image as ImageIcon,
  Link2,
  ExternalLink,
  Copy,
  Check,
  Search,
  Clock,
  User,
  ClipboardList,
  Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { extractImagesFromContent } from '@/lib/commentImages';
import { openExternalLink } from '@/lib/links';
import { getThumbnailUrl } from '@/lib/thumbnail';
import { CommentContent } from '../ui/CommentContent';

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

/**
 * Identifies whether a comment is an authentic Daily Tracker / Work Log
 * report originating from the connected Google Spreadsheet (MA Daily Schedule)
 * or structured as a daily work log report (Action Done, Status, etc.).
 */
export function isDailyTrackerComment(comment: any): boolean {
  if (!comment || typeof comment.content !== 'string') return false;
  const raw = comment.content;
  const text = raw.replace(/<[^>]+>/g, '').trim();
  if (!text) return false;

  // The Google Spreadsheet webhook format (sheets.controller.ts and appscriptlatest.js):
  // "👤 <Name> | 📅 <DatePosted> | ✏️ <Edited>"
  // We strictly require both 👤 and 📅, or | 📅 and ✏️ so normal human comments are never captured.
  if (text.includes('👤') && text.includes('📅')) return true;
  if (text.includes('| 📅') && (text.includes('| ✏️') || text.includes('✏️'))) return true;

  return false;
}

/**
 * Accurately parses the actual work date from the daily tracker comment content
 * (e.g. from `📅 Nov 4, 2026, 10:50 AM - 11:10 AM`), falling back to comment.createdAt.
 * Never lumps items into broken month-only buckets like "NOVEMBER 2026".
 */
export function parseTrackerDateInfo(comment: any): {
  dateObj: Date;
  dateHeader: string;
  timeRange: string;
  sortTime: number;
} {
  const content = (comment?.content || '').replace(/<[^>]+>/g, '');

  // 1. Try extracting exact date and time range from 📅 <datePart>
  const match = content.match(/📅\s*([^|✏️\n\r]+)/);
  if (match) {
    const rawDatePart = match[1].trim(); // e.g. "Nov 4, 2026, 10:50 AM - 11:10 AM" or "Nov 4, 2026"
    const dMatch = rawDatePart.match(/([A-Za-z]{3,}\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/);
    if (dMatch) {
      const parsedDate = new Date(dMatch[1]);
      if (!isNaN(parsedDate.getTime())) {
        const timePart = rawDatePart.replace(dMatch[0], '').replace(/^,\s*/, '').trim();

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const startOfYesterday = startOfToday - 86400000;
        const targetDay = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate()).getTime();

        let dateHeader = parsedDate.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });

        if (targetDay === startOfToday) {
          dateHeader = `Today · ${parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        } else if (targetDay === startOfYesterday) {
          dateHeader = `Yesterday · ${parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        }

        return {
          dateObj: parsedDate,
          dateHeader,
          timeRange: timePart,
          sortTime: targetDay,
        };
      }
    }
  }

  // 2. Fallback to comment.createdAt
  const created = new Date(comment?.createdAt || Date.now());
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const targetDay = new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime();

  let dateHeader = isNaN(created.getTime())
    ? 'Recent'
    : created.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

  if (targetDay === startOfToday) {
    dateHeader = `Today · ${created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } else if (targetDay === startOfYesterday) {
    dateHeader = `Yesterday · ${created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  return {
    dateObj: created,
    dateHeader,
    timeRange: '',
    sortTime: targetDay,
  };
}

/**
 * Groups tracker reports by exact Day (supports ascending or descending order).
 * Ensures every individual day (e.g. "Wed, Nov 4, 2026") has its own header.
 */
function groupReportsByDay(reports: any[], ascending: boolean = false): { group: string; items: any[] }[] {
  const groups: Record<string, { group: string; sortTime: number; items: any[] }> = {};

  for (const report of reports) {
    const { dateHeader, sortTime } = parseTrackerDateInfo(report);
    if (!groups[dateHeader]) {
      groups[dateHeader] = {
        group: dateHeader,
        sortTime,
        items: [],
      };
    }
    groups[dateHeader].items.push(report);
  }

  return Object.values(groups)
    .sort((a, b) => (ascending ? a.sortTime - b.sortTime : b.sortTime - a.sortTime))
    .map((g) => ({
      group: g.group,
      items: g.items.sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        return ascending ? timeA - timeB : timeB - timeA;
      }),
    }));
}

/**
 * Groups images and links by day in chronological order.
 */
function groupGenericItemsByDay<T extends { createdAt: string | number | Date }>(items: T[]): { group: string; items: T[] }[] {
  const groups: Record<string, { group: string; sortTime: number; items: T[] }> = {};

  for (const item of items) {
    const d = new Date(item.createdAt);
    if (isNaN(d.getTime())) {
      if (!groups['Earlier']) groups['Earlier'] = { group: 'Earlier', sortTime: 0, items: [] };
      groups['Earlier'].items.push(item);
      continue;
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const targetDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

    let groupTitle = d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    if (targetDay === startOfToday) {
      groupTitle = `Today · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else if (targetDay === startOfYesterday) {
      groupTitle = `Yesterday · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }

    if (!groups[groupTitle]) {
      groups[groupTitle] = { group: groupTitle, sortTime: targetDay, items: [] };
    }
    groups[groupTitle].items.push(item);
  }

  return Object.values(groups)
    .sort((a, b) => b.sortTime - a.sortTime)
    .map((g) => ({ group: g.group, items: g.items }));
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

export function TaskInfoDrawer({
  task,
  comments,
  onClose,
  onPreviewImage,
  workspaceUsers = [],
  currentUser,
  isSubtask = false,
}: TaskInfoDrawerProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'images' | 'links' | 'tracker'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [copiedCommentId, setCopiedCommentId] = useState<string | null>(null);

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

    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [task, comments]);

  // 2. Extract Links
  const extractedLinks: ExtractedLinkItem[] = useMemo(() => {
    const results: ExtractedLinkItem[] = [];
    const seenUrls = new Set<string>();

    const addLink = (link: ExtractedLinkItem) => {
      const trimmedUrl = (link.url || '').trim();
      if (!trimmedUrl || trimmedUrl.startsWith('mention://') || seenUrls.has(trimmedUrl)) return;
      if (isImageUrl(trimmedUrl)) return;
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

    if (task?.description) {
      parseLinksFromText(
        task.description,
        task.createdAt || Date.now(),
        task.creator?.name,
        task.creator?.avatarUrl,
        'description'
      );
    }

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

    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [task, comments]);

  // 3. Tracker Reports strictly filtered from Google Sheets / Work Logs (chronological ascending)
  const dailyTrackerReports = useMemo(() => {
    if (!Array.isArray(comments)) return [];
    return [...comments]
      .filter((c) => isDailyTrackerComment(c))
      .sort((a, b) => {
        const dateA = parseTrackerDateInfo(a).sortTime;
        const dateB = parseTrackerDateInfo(b).sortTime;
        if (dateA !== dateB) return dateA - dateB;
        return new Date(a.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      });
  }, [comments]);

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

  const filteredTrackerReports = useMemo(() => {
    if (!query) return dailyTrackerReports;
    return dailyTrackerReports.filter(
      (c) =>
        c.content?.toLowerCase().includes(query) ||
        c.user?.name?.toLowerCase().includes(query)
    );
  }, [dailyTrackerReports, query]);

  // Pagination for Tracker reports (scrolling up loads older reports, identical to Task comments)
  const TRACKER_PAGE_SIZE = 15;
  const [visibleTrackerCount, setVisibleTrackerCount] = useState(TRACKER_PAGE_SIZE);
  const [isLoadingOlderReports, setIsLoadingOlderReports] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const hasOlderTrackerReports = filteredTrackerReports.length > visibleTrackerCount;
  const olderReportsCount = Math.max(0, filteredTrackerReports.length - visibleTrackerCount);

  // Paginated subset of tracker reports (most recent `visibleTrackerCount` items)
  const paginatedTrackerReports = useMemo(() => {
    if (filteredTrackerReports.length <= visibleTrackerCount) {
      return filteredTrackerReports;
    }
    return filteredTrackerReports.slice(filteredTrackerReports.length - visibleTrackerCount);
  }, [filteredTrackerReports, visibleTrackerCount]);

  // Grouped chronologically by exact day
  const imageTimeGroups = useMemo(() => groupGenericItemsByDay(filteredImages), [filteredImages]);
  const linkTimeGroups = useMemo(() => groupGenericItemsByDay(filteredLinks), [filteredLinks]);
  const trackerDayGroups = useMemo(
    () => groupReportsByDay(paginatedTrackerReports, true),
    [paginatedTrackerReports]
  );

  const loadOlderTrackerReports = useCallback(() => {
    if (!hasOlderTrackerReports || isLoadingOlderReports) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    setIsLoadingOlderReports(true);
    const prevScrollHeight = container.scrollHeight;
    const prevScrollTop = container.scrollTop;

    setTimeout(() => {
      setVisibleTrackerCount((prev) => Math.min(filteredTrackerReports.length, prev + TRACKER_PAGE_SIZE));
      setIsLoadingOlderReports(false);

      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          const newScrollHeight = scrollContainerRef.current.scrollHeight;
          scrollContainerRef.current.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        }
      });
    }, 120);
  }, [hasOlderTrackerReports, isLoadingOlderReports, filteredTrackerReports.length]);

  const handleContainerScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (activeTab !== 'tracker') return;
      const { scrollTop } = e.currentTarget;
      if (scrollTop < 60 && hasOlderTrackerReports && !isLoadingOlderReports) {
        loadOlderTrackerReports();
      }
    },
    [activeTab, hasOlderTrackerReports, isLoadingOlderReports, loadOlderTrackerReports]
  );

  useEffect(() => {
    if (activeTab === 'tracker') {
      const scrollToBottom = () => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
      };
      requestAnimationFrame(scrollToBottom);
      const timer = setTimeout(scrollToBottom, 60);
      return () => clearTimeout(timer);
    }
  }, [activeTab]);

  // Copy Handlers
  const handleCopyLink = useCallback((id: string, url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url);
      setCopiedLinkId(id);
      setTimeout(() => setCopiedLinkId((prev) => (prev === id ? null : prev)), 2000);
    }
  }, []);

  const handleCopyReport = useCallback((id: string, text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator?.clipboard?.writeText) {
      const plainText = text.replace(/<[^>]+>/g, '').trim();
      navigator.clipboard.writeText(plainText || text);
      setCopiedCommentId(id);
      setTimeout(() => setCopiedCommentId((prev) => (prev === id ? null : prev)), 2000);
    }
  }, []);

  const totalImages = extractedImages.length;
  const totalLinks = extractedLinks.length;
  const totalReports = dailyTrackerReports.length;

  const tabList = [
    { key: 'all', label: 'Overview', count: 0 },
    { key: 'images', label: 'Images', count: totalImages },
    { key: 'links', label: 'Links', count: totalLinks },
    { key: 'tracker', label: 'Tracker', count: totalReports },
  ] as const;

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden text-zinc-200 transition-colors duration-150">
      {/* Tabs & Search Bar */}
      <div className="px-4 py-2.5 border-b border-zinc-800/60 shrink-0 space-y-2.5 bg-card transition-colors">
        {/* Navigation Tabs with Spring Animated Indicator */}
        <div className="flex items-center gap-1 p-1 bg-zinc-900/60 rounded-lg border border-zinc-800/60 relative">
          {tabList.map((t) => {
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`relative flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer text-center flex items-center justify-center gap-1 z-10 ${
                  isActive
                    ? 'text-zinc-100 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTaskInfoTabPill"
                    className="absolute inset-0 bg-zinc-800 rounded-md shadow-sm -z-10"
                    transition={{ type: 'spring', bounce: 0.15, duration: 0.28 }}
                  />
                )}
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search images, links, or tracker reports..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/20 transition-colors"
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

      {/* Main Content Area with Animated Transitions */}
      <div
        ref={scrollContainerRef}
        onScroll={handleContainerScroll}
        className="flex-1 overflow-y-auto p-4 custom-scrollbar"
      >
        <AnimatePresence mode="wait">
          {/* --- VIEW: ALL / OVERVIEW --- */}
          {activeTab === 'all' && (
            <motion.div
              key="view-all"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="space-y-6"
            >
              {/* 1. Images Section */}
              <div>
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-zinc-800/50">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                      Images & Media
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
                        className="group relative rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900 aspect-square cursor-pointer shadow-xs hover:border-zinc-700 transition-all"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={getThumbnailUrl(img.url, 360, 40)}
                          alt={img.fileName || 'Image'}
                          loading="lazy"
                          onError={(e) => {
                            const target = e.currentTarget;
                            if (target.src !== img.url) target.src = img.url;
                          }}
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
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                      Shared Links
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
                        className="p-2.5 rounded-lg border border-zinc-800/70 bg-zinc-900/40 hover:bg-zinc-800/60 hover:border-zinc-700 transition-all flex items-start justify-between gap-3 cursor-pointer group shadow-xs"
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
                            <AnimatePresence mode="wait">
                              {copiedLinkId === link.id ? (
                                <motion.span
                                  key="checked"
                                  initial={{ scale: 0.6, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  exit={{ scale: 0.6, opacity: 0 }}
                                  transition={{ duration: 0.15 }}
                                >
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                </motion.span>
                              ) : (
                                <motion.span
                                  key="copy"
                                  initial={{ scale: 0.8, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  exit={{ scale: 0.8, opacity: 0 }}
                                  transition={{ duration: 0.12 }}
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </motion.span>
                              )}
                            </AnimatePresence>
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

              {/* 3. Tracker Reports Section (Strictly from Spreadsheet / Work Logs) */}
              <div>
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-zinc-800/50">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                      Tracker Reports
                    </h4>
                  </div>
                  {totalReports > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('tracker')}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                    >
                      See all
                    </button>
                  )}
                </div>

                {filteredTrackerReports.length === 0 ? (
                  <div className="text-xs text-zinc-500 py-3 text-center bg-zinc-900/30 rounded-lg border border-zinc-800/40">
                    No tracker reports found for this task
                  </div>
                ) : (
                  <div className="space-y-3">
                    {[...filteredTrackerReports].reverse().slice(0, 3).map((report) => {
                      const { dateHeader, timeRange } = parseTrackerDateInfo(report);
                      return (
                        <div
                          key={report.id}
                          className="p-3.5 rounded-xl border border-zinc-800/70 bg-zinc-900/40 space-y-2.5 shadow-xs hover:border-zinc-700/80 transition-all"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[11px] text-zinc-300 font-medium">
                                {dateHeader}
                              </span>
                              {timeRange && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0 font-mono">
                                  {timeRange}
                                </span>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={(e) => handleCopyReport(report.id, report.content, e)}
                              title="Copy report"
                              className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                            >
                              <AnimatePresence mode="wait">
                                {copiedCommentId === report.id ? (
                                  <motion.span
                                    key="checked-c"
                                    initial={{ scale: 0.6, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.6, opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                  >
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  </motion.span>
                                ) : (
                                  <motion.span
                                    key="copy-c"
                                    initial={{ scale: 0.8, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.8, opacity: 0 }}
                                    transition={{ duration: 0.12 }}
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </motion.span>
                                )}
                              </AnimatePresence>
                            </button>
                          </div>

                          <div className="text-xs text-zinc-300 leading-relaxed overflow-hidden break-words line-clamp-6">
                            <CommentContent
                              content={report.content}
                              onPreviewImage={onPreviewImage}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* --- VIEW: IMAGES TAB (Separated by Day) --- */}
          {activeTab === 'images' && (
            <motion.div
              key="view-images"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="space-y-6"
            >
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
                    <div className="sticky top-0 z-10 py-1.5 bg-card/95 backdrop-blur-sm flex items-center gap-2 border-b border-zinc-800/80 transition-colors">
                      <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                        {group}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {items.map((img) => (
                        <div
                          key={img.id}
                          onClick={() => onPreviewImage(img.url)}
                          className="group relative rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900 aspect-square cursor-pointer shadow-xs hover:border-zinc-700 transition-all"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={getThumbnailUrl(img.url, 480, 45)}
                            alt={img.fileName || 'Image'}
                            loading="lazy"
                            onError={(e) => {
                              const target = e.currentTarget;
                              if (target.src !== img.url) target.src = img.url;
                            }}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2.5 flex flex-col justify-between">
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={(e) => handleCopyLink(img.id, img.url, e)}
                                title="Copy Image URL"
                                className="p-1 rounded bg-black/60 hover:bg-black/80 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                              >
                                <AnimatePresence mode="wait">
                                  {copiedLinkId === img.id ? (
                                    <motion.span
                                      key="checked-img"
                                      initial={{ scale: 0.6, opacity: 0 }}
                                      animate={{ scale: 1, opacity: 1 }}
                                      exit={{ scale: 0.6, opacity: 0 }}
                                      transition={{ duration: 0.15 }}
                                    >
                                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    </motion.span>
                                  ) : (
                                    <motion.span
                                      key="copy-img"
                                      initial={{ scale: 0.8, opacity: 0 }}
                                      animate={{ scale: 1, opacity: 1 }}
                                      exit={{ scale: 0.8, opacity: 0 }}
                                      transition={{ duration: 0.12 }}
                                    >
                                      <Copy className="w-3.5 h-3.5" />
                                    </motion.span>
                                  )}
                                </AnimatePresence>
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

                          <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-medium text-zinc-300 backdrop-blur-sm group-hover:opacity-0 transition-opacity">
                            {formatRelativeTime(img.createdAt)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </motion.div>
          )}

          {/* --- VIEW: LINKS TAB (Separated by Day) --- */}
          {activeTab === 'links' && (
            <motion.div
              key="view-links"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="space-y-6"
            >
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
                    <div className="sticky top-0 z-10 py-1.5 bg-card/95 backdrop-blur-sm flex items-center gap-2 border-b border-zinc-800/80 transition-colors">
                      <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                        {group}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {items.map((link) => (
                        <div
                          key={link.id}
                          onClick={() => openExternalLink(link.url)}
                          className="p-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 hover:bg-zinc-800/60 hover:border-zinc-700 transition-all flex items-start justify-between gap-3 cursor-pointer group shadow-xs"
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
                              <AnimatePresence mode="wait">
                                {copiedLinkId === link.id ? (
                                  <motion.span
                                    key="checked-l"
                                    initial={{ scale: 0.6, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.6, opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                  >
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  </motion.span>
                                ) : (
                                  <motion.span
                                    key="copy-l"
                                    initial={{ scale: 0.8, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.8, opacity: 0 }}
                                    transition={{ duration: 0.12 }}
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </motion.span>
                                )}
                              </AnimatePresence>
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
            </motion.div>
          )}

          {/* --- VIEW: TRACKER TAB (Strictly Google Sheets Work Logs, Grouped by Day, Paginated on Scroll Up) --- */}
          {activeTab === 'tracker' && (
            <motion.div
              key="view-tracker"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="space-y-6"
            >
              {/* Pagination trigger when scrolling up / Load earlier reports button */}
              {hasOlderTrackerReports && (
                <div className="py-2.5 flex justify-center items-center">
                  {isLoadingOlderReports ? (
                    <div className="flex items-center gap-2 text-xs text-zinc-500 py-1">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                      <span>Loading earlier reports...</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={loadOlderTrackerReports}
                      className="text-[11px] font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800/40 hover:bg-zinc-800/80 border border-zinc-800 transition-all flex items-center gap-1.5 py-1 px-3 rounded-full cursor-pointer shadow-xs"
                    >
                      <Clock className="w-3 h-3 text-zinc-500" />
                      <span>Load earlier tracker reports ({olderReportsCount} remaining)</span>
                    </button>
                  )}
                </div>
              )}

              {trackerDayGroups.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">
                  <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-40 text-zinc-400" />
                  <p className="text-xs font-semibold">No tracker reports found</p>
                  <p className="text-[11px] text-zinc-500 mt-1 max-w-sm mx-auto">
                    Tracker schedule reports synced from the MA Daily Schedule spreadsheet will appear here organized by work date.
                  </p>
                </div>
              ) : (
                trackerDayGroups.map(({ group, items }) => (
                  <div key={group} className="space-y-3">
                    {/* Exact Day Separator: e.g. "Wed, Nov 4, 2026" */}
                    <div className="sticky top-0 z-10 py-1.5 bg-card/95 backdrop-blur-sm flex items-center gap-2 border-b border-zinc-800/80 transition-colors">
                      <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                        {group}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {items.map((report) => {
                        const { timeRange } = parseTrackerDateInfo(report);
                        return (
                          <div
                            key={report.id}
                            className="p-3.5 rounded-xl border border-zinc-800/80 bg-zinc-900/40 hover:border-zinc-700/80 transition-all space-y-2.5 shadow-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {timeRange ? (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono font-medium shrink-0">
                                    {timeRange}
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-zinc-400 font-medium">
                                    Work Log
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[10px] text-zinc-500 hidden sm:inline">
                                  {new Date(report.createdAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => handleCopyReport(report.id, report.content, e)}
                                  title="Copy report"
                                  className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                                >
                                  <AnimatePresence mode="wait">
                                    {copiedCommentId === report.id ? (
                                      <motion.span
                                        key="checked-cmt"
                                        initial={{ scale: 0.6, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        exit={{ scale: 0.6, opacity: 0 }}
                                        transition={{ duration: 0.15 }}
                                      >
                                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                                      </motion.span>
                                    ) : (
                                      <motion.span
                                        key="copy-cmt"
                                        initial={{ scale: 0.8, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        exit={{ scale: 0.8, opacity: 0 }}
                                        transition={{ duration: 0.12 }}
                                      >
                                        <Copy className="w-3.5 h-3.5" />
                                      </motion.span>
                                    )}
                                  </AnimatePresence>
                                </button>
                              </div>
                            </div>

                            <div className="text-xs text-zinc-200 leading-relaxed overflow-hidden break-words">
                              <CommentContent
                                content={report.content}
                                onPreviewImage={onPreviewImage}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
