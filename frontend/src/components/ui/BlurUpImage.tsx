'use client';
/* eslint-disable @next/next/no-img-element */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Loader2, Maximize2, ImageIcon } from 'lucide-react';
import { getThumbnailUrl, isVectorOrDataUrl } from '@/lib/thumbnail';

interface BlurUpImageProps {
  src: string;
  alt?: string;
  className?: string;
  onPreview?: (src: string) => void;
}

export function BlurUpImage({
  src,
  alt = 'attachment',
  className = '',
  onPreview,
}: BlurUpImageProps) {
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const thumbUrl = useMemo(() => {
    if (useFallback || isVectorOrDataUrl(src)) {
      return src;
    }
    return getThumbnailUrl(src, 360, 35);
  }, [src, useFallback]);

  // Clean filename for alt/title display
  const cleanFileName = useMemo(() => {
    if (alt && alt !== 'attachment' && alt !== 'image') return alt;
    try {
      const urlObj = new URL(src, 'http://localhost');
      const last = urlObj.pathname.split('/').filter(Boolean).pop();
      if (last && /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(last)) {
        return decodeURIComponent(last);
      }
    } catch {
      // ignore
    }
    return alt || 'Image';
  }, [src, alt]);

  // Check if image is already cached by browser
  useEffect(() => {
    if (imgRef.current && imgRef.current.complete) {
      if (imgRef.current.naturalWidth > 0) {
        setThumbLoaded(true);
      }
    }
  }, [thumbUrl]);

  const handleImageError = () => {
    if (!useFallback && !isVectorOrDataUrl(src)) {
      // If thumbnail proxy fails, retry once with direct original src
      setUseFallback(true);
      setThumbLoaded(false);
    } else {
      setFailed(true);
    }
  };

  const handleRetry = () => {
    setFailed(false);
    setUseFallback(false);
    setThumbLoaded(false);
  };

  if (failed) {
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleRetry();
        }}
        className="my-1.5 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-700/60 bg-zinc-900/80 text-xs text-zinc-300 hover:border-zinc-500 cursor-pointer select-none"
        title="Failed to load image. Click to retry."
      >
        <ImageIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        <span className="truncate max-w-[200px]">{cleanFileName}</span>
        <span className="text-zinc-500 text-[11px]">· unavailable (click to retry)</span>
      </span>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`my-2 inline-block relative group/image cursor-pointer max-w-full rounded-lg overflow-hidden align-middle select-none ${className}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (onPreview) {
          onPreview(src);
        } else {
          window.open(src, '_blank');
        }
      }}
      title={cleanFileName ? `${cleanFileName} · Click to preview original` : 'Click to preview original'}
    >
      {/* Loading skeleton while thumbnail loads */}
      {!thumbLoaded && (
        <span className="inline-flex items-center justify-center w-[200px] h-[140px] bg-zinc-900/80 border border-zinc-800/80 rounded-lg animate-pulse">
          <span className="flex flex-col items-center gap-2 text-zinc-500">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
            <span className="text-[11px] font-medium text-zinc-400">Loading preview...</span>
          </span>
        </span>
      )}

      {/* 1-15kb Compressed Thumbnail with BlurUP effect */}
      <img
        ref={imgRef}
        src={thumbUrl}
        alt={cleanFileName}
        loading="lazy"
        decoding="async"
        onLoad={() => setThumbLoaded(true)}
        onError={handleImageError}
        className={`max-w-full md:max-w-md max-h-[360px] object-contain rounded-lg border border-zinc-800/70 bg-zinc-950/40 shadow-sm transition-all duration-300 ${
          thumbLoaded
            ? 'block group-hover/image:brightness-95 filter blur-0 opacity-100'
            : 'invisible absolute h-0 w-0 opacity-0 pointer-events-none'
        }`}
      />

      {/* Hover preview badge */}
      {thumbLoaded && (
        <span className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/image:opacity-100 transition-opacity backdrop-blur-[1px] rounded-lg pointer-events-none">
          <span className="text-xs font-medium text-white bg-black/75 border border-white/10 px-2.5 py-1 rounded-md shadow-md flex items-center gap-1.5">
            <Maximize2 className="w-3.5 h-3.5" />
            Click to preview
          </span>
        </span>
      )}
    </div>
  );
}
