'use client';

// Static, non-editable rendering of a doc block's stored HTML, used while the block's Tiptap editor is not
// mounted (lazy journal blocks) or not created yet. It uses the editor's typography and draws task mentions
// with the same chip design as TaskMentionNode, so swapping in the live editor causes no visible change.
//
// Stored HTML comes from users and integrations, so it is never injected: it is parsed into an inert
// document and converted to React elements through an allowlist (text is escaped by React).
import React, { memo, useMemo } from 'react';
import { AlignLeft, CheckCircle2, Flag, Shield, Users2 } from 'lucide-react';
import { BLOCK_EDITOR_CONTENT_CLASS } from '@/components/ui/BlockEditor';
import { CustomCircleDot, CustomCircleDotted } from '@/components/modals/TaskDetailModal';
import { getStatusColor } from '@/components/editor/nodes/TaskMentionNode';
import { getPriorityConfig } from '@/lib/priority';
import { parseNexusTaskLink } from '@/lib/links';
import { LinkWithPreview } from '@/components/ui/LinkHoverPreview';

const PASS_THROUGH_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'mark', 'sub', 'sup',
]);
const TAG_ALIASES: Record<string, string> = { b: 'strong', i: 'em', strike: 's', del: 's' };
// Inline colours set by the editor's colour / highlight tools; anything else in `style` is dropped
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function safeStyle(el: Element): React.CSSProperties | undefined {
  const style: React.CSSProperties = {};
  const color = (el as HTMLElement).style?.color;
  const background = (el as HTMLElement).style?.backgroundColor;
  if (color && SAFE_COLOR.test(color.trim())) style.color = color;
  if (background && SAFE_COLOR.test(background.trim())) style.backgroundColor = background;
  return Object.keys(style).length ? style : undefined;
}

/** Same markup and classes as TaskMentionNode's chip, without its data loading or dropdowns. */
function MentionChipPreview({ el }: { el: Element }) {
  const mentionType = el.getAttribute('data-mention-type') || 'task';
  const label = el.getAttribute('data-label') || (el.textContent || '').replace(/^@/, '');
  const rawStatus = el.getAttribute('data-task-status') || '';
  const status = parseJson<{ name?: string; NAME?: string; color?: string; COLOR?: string }>(rawStatus.startsWith('{') ? rawStatus : null);

  if (mentionType === 'status') {
    const headerColor = status?.color || '#3b82f6';
    return (
      <span>
        <span
          className="inline-flex items-center justify-center px-1.5 py-[2px] leading-none rounded-sm uppercase font-bold text-[10px] tracking-wide align-middle"
          style={{ background: `linear-gradient(90deg, ${headerColor} 0%, ${headerColor}cc 100%)`, color: '#fff' }}
        >
          {status?.name || label || 'STATUS'}
        </span>
        <span className="pl-1">&#8203;</span>
      </span>
    );
  }

  const statusName = status ? status.name || status.NAME || rawStatus : rawStatus;
  const statusColor = (status && (status.color || status.COLOR)) || getStatusColor(statusName);
  const priority = el.getAttribute('data-task-priority') || '';
  const assignees = parseJson<{ id: string; name?: string; avatarUrl?: string }[]>(el.getAttribute('data-task-assignees')) || [];
  const isSubtask = mentionType === 'subtask';
  const isClosed = ['CLOSED', 'DONE'].includes((statusName || '').toUpperCase());
  const chipBg = isSubtask ? 'bg-[var(--task-chip-sub)]' : 'bg-[var(--task-chip)]';
  const chipRing = isSubtask ? 'border-[var(--task-chip-sub)]' : 'border-[var(--task-chip)]';
  const titleClass = `border-b border-transparent pb-[1px] align-middle ${isSubtask ? 'text-[13px] font-normal text-zinc-400' : 'text-[15px] font-medium text-zinc-100'}`;

  return (
    <span>
      <span className={`relative inline align-middle px-1.5 py-[2px] rounded-md box-decoration-clone leading-relaxed ${chipBg} ${isClosed ? 'opacity-75' : ''}`}>
        {isClosed && (
          <span className="absolute top-1/2 left-1.5 right-1.5 h-[1.5px] bg-zinc-500/70 -translate-y-1/2 pointer-events-none z-50 rounded-full" />
        )}
        <span className="inline-flex items-center justify-center shrink-0 mr-1.5 align-middle relative z-10">
          {['Closed', 'CLOSED', 'DONE'].includes(rawStatus) ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: statusColor, fill: 'transparent' }} />
          ) : rawStatus.toUpperCase() === 'KYC' ? (
            <CustomCircleDotted className="w-3.5 h-3.5 shrink-0" style={{ color: statusColor }} />
          ) : (
            <CustomCircleDot className="w-3.5 h-3.5 shrink-0" style={{ color: statusColor }} />
          )}
        </span>
        <span
          className={`${titleClass} mr-1.5 truncate max-w-[220px] sm:max-w-[340px] md:max-w-[440px] shrink min-w-[50px] inline-block align-middle`}
          title={label}
        >
          {label}
        </span>
        {/* Controls */}
        <span className="whitespace-nowrap inline-flex items-center align-middle shrink-0">
        <span className="inline-flex items-center justify-center p-0.5 text-zinc-500 rounded mr-1.5 align-middle">
          <AlignLeft className="w-3.5 h-3.5" />
        </span>
        {statusName && (
          <span
            className={`px-2 py-[3px] rounded text-[10px] font-bold uppercase tracking-wider text-[#fff] shrink-0 mr-1.5 inline-flex items-center align-middle leading-none ${isSubtask ? 'opacity-60' : ''}`}
            style={{ backgroundColor: statusColor }}
          >
            {statusName}
          </span>
        )}
        <span className="inline-flex items-center justify-center w-5 h-5 rounded mr-1.5 align-middle">
          <Flag className={`w-3.5 h-3.5 shrink-0 ${priority ? getPriorityConfig(priority).iconColor : 'text-zinc-400 dark:text-zinc-500'}`} />
        </span>
        <span className="inline-flex items-center justify-center shrink-0 mr-1.5 align-middle">
          <span className="w-5 h-5 rounded border border-zinc-700 border-dashed text-zinc-400 flex items-center justify-center bg-transparent z-10 shrink-0">
            <Shield className="w-3 h-3" />
          </span>
        </span>
        <span className="inline-flex items-center -space-x-1 shrink-0 align-middle">
          {assignees.length > 0 ? (
            assignees.slice(0, 3).map((user, i) => (
              <span
                key={user.id || i}
                className={`w-5 h-5 rounded-full overflow-hidden border-2 ${chipRing} z-10 shrink-0 bg-zinc-200 dark:bg-zinc-600 flex items-center justify-center relative`}
                style={{ zIndex: 10 - i, marginLeft: i > 0 ? '-4px' : '0' }}
              >
                {user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.avatarUrl} alt={user.name || ''} className="w-full h-full object-cover rounded-full" />
                ) : (
                  <span className="text-[9px] font-medium text-zinc-700 dark:text-zinc-300">{user.name?.charAt(0).toUpperCase()}</span>
                )}
              </span>
            ))
          ) : (
            <span className="w-5 h-5 rounded border border-zinc-700 border-dashed text-zinc-400 flex items-center justify-center bg-transparent z-10 shrink-0">
              <Users2 className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
            </span>
          )}
        </span>
        </span>
      </span>
      <span className="pl-1">&#8203;</span>
    </span>
  );
}

function toReact(node: Node, key: number): React.ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === 'span' && el.getAttribute('data-type') === 'mention') return <MentionChipPreview key={key} el={el} />;
  if (tag === 'br') return <br key={key} />;

  const children = Array.from(el.childNodes).map((child, i) => toReact(child, i));
  const mapped = TAG_ALIASES[tag] || tag;
  if (PASS_THROUGH_TAGS.has(mapped)) return React.createElement(mapped, { key, style: safeStyle(el) }, ...children);
  // Links render as text styled like links (no navigation from a preview); Nexus links render as task chips
  if (tag === 'a') {
    const href = el.getAttribute('href') || '';
    const nexus = parseNexusTaskLink(href);
    if (nexus) {
      const mockSpan = document.createElement('span');
      mockSpan.setAttribute('data-type', 'mention');
      mockSpan.setAttribute('data-id', nexus.taskId);
      mockSpan.setAttribute('data-mention-type', nexus.isSubtask ? 'subtask' : 'task');
      const labelText = typeof el.textContent === 'string' && !el.textContent.startsWith('http') ? el.textContent : '';
      if (labelText) mockSpan.setAttribute('data-label', labelText);
      return <MentionChipPreview key={key} el={mockSpan} />;
    }
    return <LinkWithPreview key={key} href={href} className="underline text-blue-400">{children}</LinkWithPreview>;
  }
  // data-badge keeps the badge pill shape (globals.css); its colours come through safeStyle
  if (tag === 'span') return <span key={key} style={safeStyle(el)} data-badge={el.hasAttribute('data-badge') ? '' : undefined}>{children}</span>;
  return <React.Fragment key={key}>{children}</React.Fragment>;
}

export const BlockHtmlPreview = memo(function BlockHtmlPreview({ content }: { content: string }) {
  const rendered = useMemo(() => {
    // Tiptap JSON content has no cheap static form; it stays blank until the editor mounts
    if (!content || content.startsWith('{"type":"doc"') || typeof DOMParser === 'undefined') return null;
    const doc = new DOMParser().parseFromString(content, 'text/html');
    return Array.from(doc.body.childNodes).map((child, i) => toReact(child, i));
  }, [content]);

  return (
    <div className="w-full relative">
      <div className={BLOCK_EDITOR_CONTENT_CLASS}>{rendered}</div>
    </div>
  );
});
