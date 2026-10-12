'use client';

import React, { useEffect } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useAppStore } from '@/lib/store';
import { normalizeHref, rehypeLinkify, rehypeUnknownTagsToText } from '@/lib/links';
import { UserMentionChip } from './UserMentionChip';

// Shared across instances so a feed of many comments requests the user list only once
let usersRequested = false;

const keepMentionUrls = (url: string) => (url.startsWith('mention://') ? url : defaultUrlTransform(url));

const components: Components = {
  a: ({ node, href, children, ...rest }) => {
    void node;
    const target = href || '';
    if (target.startsWith('mention://')) {
      return <UserMentionChip userId={target.replace('mention://', '')}>{children}</UserMentionChip>;
    }
    return (
      <a
        {...rest}
        href={normalizeHref(target)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 hover:bg-blue-500/15 hover:text-blue-300 rounded-sm transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </a>
    );
  },
};

interface CommentContentProps {
  content: string;
  className?: string;
}

/**
 * Renders stored comment HTML/markdown outside the task modal (Activity feed, notification bell):
 * @mentions become the hoverable profile chip instead of a dead mention:// link, and URLs are linkified.
 */
export function CommentContent({ content, className = '' }: CommentContentProps) {
  const hasLoadedUsers = useAppStore(state => state.hasLoadedUsers);

  useEffect(() => {
    if (hasLoadedUsers || usersRequested || !content.includes('mention://')) return;
    usersRequested = true;
    const { hydrateUsersFromCache, loadUsers } = useAppStore.getState();
    hydrateUsersFromCache();
    loadUsers();
  }, [hasLoadedUsers, content]);

  return (
    <div className={`select-text ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeUnknownTagsToText, rehypeLinkify]}
        components={components}
        urlTransform={keepMentionUrls}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
