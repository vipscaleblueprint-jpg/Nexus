'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useState, useMemo } from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Film } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { commentHtmlForMarkdown, normalizeHref, rehypeLinkify, rehypeUnknownTagsToText, parseNexusTaskLink } from '@/lib/links';
import { extractImagesFromContent } from '@/lib/commentImages';
import { UserMentionChip } from './UserMentionChip';
import { TaskMentionChip } from './TaskMentionChip';
import { BlurUpImage } from './BlurUpImage';

// Shared across instances so a feed of many comments requests the user list only once
let usersRequested = false;

// Preserves loaded/preloaded URLs across re-renders and unmounts so images don't reset
const preloadedMediaUrls = new Set<string>();

const keepMentionUrls = (url: string) => (url.startsWith('mention://') ? url : defaultUrlTransform(url));

interface CommentMediaContextValue {
  onPreviewImage?: (src: string, allImages?: string[]) => void;
  allImages: string[];
  autoLoadImages: boolean;
}

const CommentMediaContext = React.createContext<CommentMediaContextValue>({
  allImages: [],
  autoLoadImages: false,
});

function CommentMarkdownImage(props: any) {
  const { src, alt } = props;
  const { onPreviewImage, allImages } = React.useContext(CommentMediaContext);
  const srcString = typeof src === 'string' ? src : '';

  return (
    <BlurUpImage
      src={srcString}
      alt={alt}
      onPreview={(url) => {
        if (onPreviewImage) {
          onPreviewImage(url, allImages);
        } else {
          window.open(url, '_blank');
        }
      }}
    />
  );
}

function PreloadableMarkdownVideo({ src }: { src: string }) {
  const { onPreviewImage, autoLoadImages } = React.useContext(CommentMediaContext);
  const [shouldLoad, setShouldLoad] = useState(() => autoLoadImages || (src ? preloadedMediaUrls.has(src) : false));
  const [prevSrc, setPrevSrc] = useState(src);

  if (prevSrc !== src) {
    setPrevSrc(src);
    if (autoLoadImages || (src && preloadedMediaUrls.has(src))) {
      setShouldLoad(true);
    }
  }

  const handleStartLoad = () => {
    if (src) preloadedMediaUrls.add(src);
    setShouldLoad(true);
  };

  if (!shouldLoad) {
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleStartLoad();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            handleStartLoad();
          }
        }}
        className="mt-2 mb-2 inline-flex items-center justify-center w-[200px] h-[150px] bg-zinc-900/80 border border-zinc-700/50 rounded-lg cursor-pointer hover:border-zinc-500 transition-colors group/video-load relative select-none"
        title="Click to load video"
      >
        <Film className="w-10 h-10 text-zinc-500 opacity-50" />
        <span className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/video-load:opacity-100 transition-opacity backdrop-blur-[2px] rounded-lg">
          <span className="text-xs font-medium text-white bg-black/60 px-2 py-1 rounded-md">Click to load video</span>
        </span>
      </span>
    );
  }

  return (
    <div
      className="my-2 inline-block relative group/video cursor-pointer max-w-full rounded-lg overflow-hidden align-middle select-none"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (onPreviewImage) {
          onPreviewImage(src);
        } else {
          window.open(src, '_blank');
        }
      }}
    >
      <video
        src={src}
        controls
        className="max-w-full md:max-w-md max-h-[300px] rounded-lg border border-zinc-800/70 bg-black/60 shadow-sm"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function CommentLinkOrMedia({ node, href, children, ...rest }: any) {
  void node;
  const target = href || '';
  if (target.match(/\.(mp4|webm|ogg|mov)(\?.*)?$/i)) {
    return <PreloadableMarkdownVideo src={target} />;
  }
  if (target.match(/\.(jpe?g|png|gif|webp|svg|avif)(\?.*)?$/i)) {
    return (
      <CommentMarkdownImage
        src={target}
        alt={typeof children === 'string' && !children.startsWith('http') ? children : 'attachment'}
      />
    );
  }
  if (target.startsWith('mention://')) {
    return <UserMentionChip userId={target.replace('mention://', '')}>{children}</UserMentionChip>;
  }
  const nexus = parseNexusTaskLink(target);
  if (nexus) {
    return (
      <TaskMentionChip
        taskId={nexus.taskId}
        mentionType={nexus.isSubtask ? 'subtask' : 'task'}
        initialLabel={typeof children === 'string' && !children.startsWith('http') ? children : undefined}
      />
    );
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
}

function CommentSpan({ node, ...rest }: any) {
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
}

// Static, immutable components map passed to ReactMarkdown so nodes are NEVER remounted
const staticMarkdownComponents: Components = {
  a: CommentLinkOrMedia,
  img: CommentMarkdownImage,
  span: CommentSpan,
};

export interface CommentContentProps {
  content: string;
  className?: string;
  onPreviewImage?: (src: string, allImages?: string[]) => void;
  autoLoadImages?: boolean;
}

/**
 * Renders stored comment HTML/markdown outside the task modal (Activity feed, notification bell):
 * @mentions become the hoverable profile chip instead of a dead mention:// link, URLs are linkified,
 * and images/videos support click-to-preload so heavy media feeds do not download all assets at once.
 */
export function CommentContent({
  content,
  className = '',
  onPreviewImage,
  autoLoadImages = false,
}: CommentContentProps) {
  const hasLoadedUsers = useAppStore(state => state.hasLoadedUsers);

  useEffect(() => {
    if (hasLoadedUsers || usersRequested || !content.includes('mention://')) return;
    usersRequested = true;
    const { hydrateUsersFromCache, loadUsers } = useAppStore.getState();
    hydrateUsersFromCache();
    loadUsers();
  }, [hasLoadedUsers, content]);

  const contentImages = useMemo(() => extractImagesFromContent(content), [content]);

  const mediaContextValue = useMemo(() => ({
    onPreviewImage,
    allImages: contentImages,
    autoLoadImages,
  }), [onPreviewImage, contentImages, autoLoadImages]);

  return (
    <div className={`select-text [&_p:empty:not(:first-child):not(:last-child)]:min-h-[1.6em] ${className}`}>
      <CommentMediaContext.Provider value={mediaContextValue}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, rehypeUnknownTagsToText, rehypeLinkify]}
          components={staticMarkdownComponents}
          urlTransform={keepMentionUrls}
        >
          {commentHtmlForMarkdown(content)}
        </ReactMarkdown>
      </CommentMediaContext.Provider>
    </div>
  );
}
