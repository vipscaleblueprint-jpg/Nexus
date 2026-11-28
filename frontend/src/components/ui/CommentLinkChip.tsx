'use client';

import React from 'react';
import { MessageSquare } from 'lucide-react';

/** Scrolls the comment into view at the top of its scroll container and flashes a highlight. Returns false if the comment isn't on screen. */
export function scrollToCommentInPage(commentId: string): boolean {
  if (typeof document === 'undefined') return false;
  const el =
    document.getElementById(`comment-${commentId}`) ||
    (document.querySelector(`[data-comment-id="${commentId}"]`) as HTMLElement | null);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('.ring-indigo-500\/80').forEach(n => n.classList.remove('ring-2', 'ring-indigo-500/80'));
  el.classList.add('ring-2', 'ring-indigo-500/80', 'transition-all', 'duration-500');
  window.setTimeout(() => el.classList.remove('ring-2', 'ring-indigo-500/80'), 2500);
  return true;
}

export function CommentLinkChip({ commentId, href }: { commentId: string; href: string }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.stopPropagation();
        if (scrollToCommentInPage(commentId)) e.preventDefault();
      }}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-500/10 text-indigo-500 dark:text-indigo-300 hover:bg-indigo-500/20 text-[0.9em] font-medium no-underline align-baseline cursor-pointer"
      title="Jump to comment"
    >
      <MessageSquare className="w-3 h-3" /> Comment link
    </a>
  );
}
