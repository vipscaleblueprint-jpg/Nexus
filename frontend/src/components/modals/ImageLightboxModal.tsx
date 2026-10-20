import React, { useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Download, ExternalLink } from 'lucide-react';

export interface ImageLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSrc: string | null;
  fileName?: string;
  images?: string[];
  onNavigate?: (newSrc: string) => void;
  children?: React.ReactNode;
}

export function ImageLightboxModal({
  isOpen,
  onClose,
  currentSrc,
  fileName,
  images = [],
  onNavigate,
  children,
}: ImageLightboxModalProps) {
  const currentIndex = useMemo(() => {
    if (!currentSrc || !images || images.length === 0) return -1;
    const directIdx = images.indexOf(currentSrc);
    if (directIdx !== -1) return directIdx;
    return images.findIndex(
      (img) => decodeURIComponent(img) === decodeURIComponent(currentSrc)
    );
  }, [currentSrc, images]);

  const isVideo = useMemo(() => {
    if (!currentSrc) return false;
    return /\.(mp4|webm|ogg|mov)$/i.test(currentSrc);
  }, [currentSrc]);

  // An image has previous only if there is an image above / before it (index > 0)
  const hasPrev = !children && currentIndex > 0;
  // An image has next only if there is an image underneath / after it (index < length - 1)
  const hasNext = !children && currentIndex !== -1 && currentIndex < images.length - 1;

  const handlePrev = useCallback(() => {
    if (hasPrev && onNavigate) {
      onNavigate(images[currentIndex - 1]);
    }
  }, [hasPrev, onNavigate, images, currentIndex]);

  const handleNext = useCallback(() => {
    if (hasNext && onNavigate) {
      onNavigate(images[currentIndex + 1]);
    }
  }, [hasNext, onNavigate, images, currentIndex]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && hasPrev) {
        e.preventDefault();
        handlePrev();
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && hasNext) {
        e.preventDefault();
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hasPrev, hasNext, handlePrev, handleNext, onClose]);

  if (!isOpen || (!currentSrc && !children)) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200000] bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm cursor-pointer select-none"
      onClick={onClose}
    >
      {/* Top right control bar */}
      <div
        className="absolute top-4 sm:top-6 right-4 sm:right-6 flex items-center gap-2.5 z-20"
        onClick={(e) => e.stopPropagation()}
      >
        {currentSrc && (
          <>
            <a
              href={currentSrc}
              download={fileName || 'image'}
              target="_blank"
              rel="noreferrer"
              className="p-2 sm:p-2.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-300 hover:text-white shadow-lg backdrop-blur-md transition-all cursor-pointer flex items-center justify-center"
              title="Download"
            >
              <Download className="w-5 h-5" />
            </a>
            <a
              href={currentSrc}
              target="_blank"
              rel="noreferrer"
              className="p-2 sm:p-2.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-300 hover:text-white shadow-lg backdrop-blur-md transition-all cursor-pointer flex items-center justify-center"
              title="Open original in new tab"
            >
              <ExternalLink className="w-5 h-5" />
            </a>
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          className="p-2 sm:p-2.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-300 hover:text-white shadow-lg backdrop-blur-md transition-all cursor-pointer flex items-center justify-center"
          title="Close (Esc)"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Left Navigation Arrow (<) - only displayed if there is an image above / before */}
      {hasPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handlePrev();
          }}
          className="absolute left-4 sm:left-8 top-1/2 -translate-y-1/2 z-20 p-3 sm:p-3.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-300 hover:text-white shadow-2xl backdrop-blur-md transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center group"
          aria-label="Previous image"
          title="Previous image"
        >
          <ChevronLeft className="w-6 h-6 sm:w-7 sm:h-7 transition-transform group-hover:-translate-x-0.5" />
        </button>
      )}

      {/* Right Navigation Arrow (>) - only displayed if there is an image underneath / after */}
      {hasNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleNext();
          }}
          className="absolute right-4 sm:right-8 top-1/2 -translate-y-1/2 z-20 p-3 sm:p-3.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/60 text-zinc-300 hover:text-white shadow-2xl backdrop-blur-md transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center group"
          aria-label="Next image"
          title="Next image"
        >
          <ChevronRight className="w-6 h-6 sm:w-7 sm:h-7 transition-transform group-hover:translate-x-0.5" />
        </button>
      )}

      {/* Image count indicator */}
      {images.length > 1 && currentIndex !== -1 && (
        <div className="absolute bottom-5 sm:bottom-6 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-zinc-900/80 border border-zinc-700/60 text-xs font-medium text-zinc-300 shadow-xl backdrop-blur-md select-none pointer-events-none z-20">
          {currentIndex + 1} / {images.length}
        </div>
      )}

      {/* Content Area */}
      <div className="relative w-full h-full flex items-center justify-center p-4">
        {children ? (
          <div onClick={(e) => e.stopPropagation()}>{children}</div>
        ) : isVideo && currentSrc ? (
          <video
            controls
            autoPlay
            src={currentSrc}
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl cursor-default"
            onClick={(e) => e.stopPropagation()}
          />
        ) : currentSrc ? (
          <img
            src={currentSrc}
            alt={fileName || 'Expanded view'}
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl cursor-default transition-all duration-150"
            onClick={(e) => e.stopPropagation()}
          />
        ) : null}
      </div>
    </div>,
    document.body
  );
}
