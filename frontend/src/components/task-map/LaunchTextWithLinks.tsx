'use client';

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { LaunchMapAssignee } from '@/api/taskMap';
import { getAssigneeAvatarColor } from '@/lib/taskTokens';

const SAFE_URL_RE = /^https?:\/\//i;
const TOKEN_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;!?'"`])/gi;

function formatLinkLabel(url: string, explicitLabel?: string): string {
  if (explicitLabel && explicitLabel.trim() && !SAFE_URL_RE.test(explicitLabel.trim())) {
    return explicitLabel.trim();
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    const combined = `${host}${path}`;
    return combined.length > 36 ? `${combined.slice(0, 33)}...` : combined;
  } catch {
    return url.length > 36 ? `${url.slice(0, 33)}...` : url;
  }
}

interface LaunchTextWithLinksProps {
  text?: string | null;
  className?: string;
  emptyLabel?: string;
}

export const LaunchTextWithLinks: React.FC<LaunchTextWithLinksProps> = ({
  text,
  className = '',
  emptyLabel = '—',
}) => {
  const value = (text || '').trim();
  if (!value) {
    return <span className="text-[var(--muted)]/70">{emptyLabel}</span>;
  }

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(TOKEN_RE.source, 'gi');

  while ((match = re.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(value.slice(lastIndex, match.index));
    }
    const mdLabel = match[1];
    const mdUrl = match[2];
    const bareUrl = match[3];
    const rawUrl = (mdUrl || bareUrl || '').trim();
    if (SAFE_URL_RE.test(rawUrl)) {
      const label = formatLinkLabel(rawUrl, mdLabel);
      nodes.push(
        <a
          key={`${match.index}-${rawUrl}`}
          href={rawUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={rawUrl}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded bg-[var(--accent-tint)] text-[var(--accent)] hover:underline font-medium align-baseline break-all"
        >
          <span className="truncate max-w-[220px]">{label}</span>
          <ExternalLink className="size-2.5 shrink-0" />
        </a>
      );
    } else {
      nodes.push(match[0]);
    }
    lastIndex = re.lastIndex;
  }

  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }

  return (
    <span className={`whitespace-pre-line break-words ${className}`}>
      {nodes}
    </span>
  );
};

interface LaunchAssigneeChipsProps {
  assignees: LaunchMapAssignee[];
  maxVisible?: number;
  emptyLabel?: string;
}

export const LaunchAssigneeChips: React.FC<LaunchAssigneeChipsProps> = ({
  assignees,
  maxVisible = 4,
  emptyLabel = 'Unassigned',
}) => {
  if (!assignees || assignees.length === 0) {
    return <span className="text-[11px] text-[var(--muted)]/75">{emptyLabel}</span>;
  }

  const visible = assignees.slice(0, maxVisible);
  const overflow = assignees.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((u) => {
        const avatar = u.avatarUrl || u.imageUrl;
        const initial = (u.name || '?').trim().charAt(0).toUpperCase();
        return (
          <span
            key={u.id}
            title={u.name}
            className="inline-flex items-center gap-1 pl-0.5 pr-1.5 py-0.5 rounded-full bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text)] max-w-[130px]"
          >
            {avatar ? (
              <img
                src={avatar}
                alt={u.name}
                className="size-4 rounded-full object-cover shrink-0"
              />
            ) : (
              <span
                className={`size-4 rounded-full ${getAssigneeAvatarColor(
                  u.name
                )} text-white text-[9px] font-bold flex items-center justify-center shrink-0`}
              >
                {initial}
              </span>
            )}
            <span className="truncate">{u.name}</span>
          </span>
        );
      })}
      {overflow > 0 && (
        <span className="px-1.5 py-0.5 rounded-full bg-[var(--bg)] border border-[var(--border)] text-[10px] font-mono text-[var(--muted)]">
          +{overflow}
        </span>
      )}
    </div>
  );
};
