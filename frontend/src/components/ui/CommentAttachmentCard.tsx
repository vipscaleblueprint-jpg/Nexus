'use client';

import React from 'react';
import {
  FileText,
  FileCode,
  File,
  Download,
  Paperclip,
} from 'lucide-react';
import { normalizeHref } from '@/lib/links';

// Recognized attachment extensions
export const ATTACHMENT_EXT_REGEX =
  /\.(pdf|docx?|xlsx?|pptx?|csv|tsv|txt|rtf|zip|rar|7z|tar|gz|bz2|json|xml|yaml|yml|md|mp3|wav|ogg|m4a|flac|aac|epub|iso|dmg)(\?.*)?$/i;

const IMAGE_EXT_REGEX = /\.(jpe?g|png|gif|webp|svg|avif)(\?.*)?$/i;
const VIDEO_EXT_REGEX = /\.(mp4|webm|ogg|mov)(\?.*)?$/i;

/** Checks whether a link target or label qualifies as a downloadable file attachment rather than plain words/web link. */
export function isAttachmentUrl(url: string, label?: string): boolean {
  if (!url || url.startsWith('mention://')) return false;
  if (IMAGE_EXT_REGEX.test(url) || VIDEO_EXT_REGEX.test(url)) return false;
  if (ATTACHMENT_EXT_REGEX.test(url)) return true;
  if (label && ATTACHMENT_EXT_REGEX.test(label)) return true;
  if (url.includes('/uploads/') || url.includes('/api/upload')) return true;
  return false;
}

/** Extracts a clean file extension string (e.g. 'PDF', 'ZIP', 'DOCX'). */
export function getFileExtension(filenameOrUrl: string): string {
  try {
    const clean = filenameOrUrl.split(/[?#]/)[0];
    const match = clean.match(/\.([0-9a-z]+)$/i);
    return match ? match[1].toUpperCase() : 'FILE';
  } catch {
    return 'FILE';
  }
}

/** Derives a human-friendly filename from URL and text label. */
export function getAttachmentFileName(url: string, label?: string): string {
  if (label && typeof label === 'string' && !label.startsWith('http://') && !label.startsWith('https://')) {
    return label.trim();
  }
  try {
    const clean = url.split(/[?#]/)[0];
    const parts = clean.split('/');
    const last = parts[parts.length - 1];
    return decodeURIComponent(last) || 'attachment';
  } catch {
    return 'attachment';
  }
}

interface FileTheme {
  icon: React.ComponentType<{ className?: string }>;
  badgeBg: string;
  badgeText: string;
  iconBg: string;
  iconColor: string;
  borderHover: string;
}

function getFileTheme(ext: string): FileTheme {
  const e = ext.toLowerCase();

  // PDFs: Red
  if (e === 'pdf') {
    return {
      icon: FileText,
      badgeBg: 'bg-red-500/15',
      badgeText: 'text-red-400',
      iconBg: 'bg-red-500/10 border-red-500/20',
      iconColor: 'text-red-400',
      borderHover: 'hover:border-red-500/40',
    };
  }

  // Spreadsheets / Data: Emerald / Green
  if (['xls', 'xlsx', 'csv', 'tsv'].includes(e)) {
    return {
      icon: FileText,
      badgeBg: 'bg-emerald-500/15',
      badgeText: 'text-emerald-400',
      iconBg: 'bg-emerald-500/10 border-emerald-500/20',
      iconColor: 'text-emerald-400',
      borderHover: 'hover:border-emerald-500/40',
    };
  }

  // Documents: Indigo / Blue
  if (['doc', 'docx', 'txt', 'rtf', 'md'].includes(e)) {
    return {
      icon: FileText,
      badgeBg: 'bg-blue-500/15',
      badgeText: 'text-blue-400',
      iconBg: 'bg-blue-500/10 border-blue-500/20',
      iconColor: 'text-blue-400',
      borderHover: 'hover:border-blue-500/40',
    };
  }

  // Presentations: Amber / Orange
  if (['ppt', 'pptx'].includes(e)) {
    return {
      icon: FileText,
      badgeBg: 'bg-orange-500/15',
      badgeText: 'text-orange-400',
      iconBg: 'bg-orange-500/10 border-orange-500/20',
      iconColor: 'text-orange-400',
      borderHover: 'hover:border-orange-500/40',
    };
  }

  // Archives / Compressed: Amber / Yellow
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(e)) {
    return {
      icon: Paperclip,
      badgeBg: 'bg-amber-500/15',
      badgeText: 'text-amber-400',
      iconBg: 'bg-amber-500/10 border-amber-500/20',
      iconColor: 'text-amber-400',
      borderHover: 'hover:border-amber-500/40',
    };
  }

  // Code / Config: Violet
  if (['json', 'xml', 'yaml', 'yml', 'js', 'ts', 'jsx', 'tsx', 'py', 'sql', 'sh'].includes(e)) {
    return {
      icon: FileCode,
      badgeBg: 'bg-violet-500/15',
      badgeText: 'text-violet-400',
      iconBg: 'bg-violet-500/10 border-violet-500/20',
      iconColor: 'text-violet-400',
      borderHover: 'hover:border-violet-500/40',
    };
  }

  // Default / Generic: Zinc / Slate
  return {
    icon: File,
    badgeBg: 'bg-zinc-700/30',
    badgeText: 'text-zinc-400',
    iconBg: 'bg-zinc-800/80 border-zinc-700/40',
    iconColor: 'text-zinc-400',
    borderHover: 'hover:border-zinc-500/50',
  };
}

export interface CommentAttachmentCardProps {
  href: string;
  fileName?: string;
  fileSize?: string | number;
  className?: string;
}

/**
 * A distinctive, interactive card rendering file attachments in comment bodies.
 * Clearly contrasts with plain words, standard web links, and inline images.
 */
export function CommentAttachmentCard({
  href,
  fileName,
  fileSize,
  className = '',
}: CommentAttachmentCardProps) {
  const targetUrl = normalizeHref(href);
  const displayName = getAttachmentFileName(href, fileName);
  const ext = getFileExtension(displayName || href);
  const theme = getFileTheme(ext);
  const IconComponent = theme.icon;

  return (
    <a
      href={targetUrl}
      target="_blank"
      rel="noopener noreferrer"
      download={displayName}
      onClick={(e) => e.stopPropagation()}
      title={`Download ${displayName}`}
      className={`group/att my-2 inline-flex items-center gap-3 rounded-xl border border-zinc-700/60 bg-zinc-900/80 px-3 py-2 text-zinc-200 no-underline shadow-sm transition-all hover:bg-zinc-800/90 hover:shadow-md ${theme.borderHover} select-none max-w-full sm:max-w-[380px] ${className}`}
    >
      {/* File type icon badge */}
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${theme.iconBg} ${theme.iconColor} shadow-inner transition-transform group-hover/att:scale-105`}
      >
        <IconComponent className="h-4.5 w-4.5" />
      </div>

      {/* File info */}
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="truncate text-xs font-medium text-zinc-100 group-hover/att:text-indigo-300 transition-colors">
          {displayName}
        </span>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span
            className={`rounded px-1.5 py-0.2 text-[9px] font-bold tracking-wider uppercase ${theme.badgeBg} ${theme.badgeText}`}
          >
            {ext}
          </span>
          <span className="text-[10px] text-zinc-500 font-mono">
            {fileSize ? fileSize : 'Attachment'}
          </span>
        </div>
      </div>

      {/* Action button */}
      <div className="flex shrink-0 items-center gap-1 pl-1 text-zinc-400 group-hover/att:text-zinc-200">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-800/60 border border-zinc-700/50 group-hover/att:bg-indigo-600 group-hover/att:text-white group-hover/att:border-indigo-500 transition-all shadow-sm"
          title="Download file"
        >
          <Download className="h-3.5 w-3.5" />
        </div>
      </div>
    </a>
  );
}
