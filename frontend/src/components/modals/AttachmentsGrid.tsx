/* eslint-disable @next/next/no-img-element */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { X, File, ChevronDown, ChevronUp } from 'lucide-react';
import { ImageLightboxModal } from './ImageLightboxModal';
import { getThumbnailUrl } from '@/lib/thumbnail';

interface Attachment {
  id: string;
  fileName: string;
  fileUrl: string;
  fileKey: string;
  fileSize: number;
  mimeType: string;
}

interface AttachmentsGridProps {
  attachments: Attachment[];
  onDelete: (id: string) => void;
  initialLimit?: number;
}

const DEFAULT_INITIAL_LIMIT = 10;
const BATCH_SIZE = 10;

export function AttachmentsGrid({
  attachments,
  onDelete,
  initialLimit = DEFAULT_INITIAL_LIMIT,
}: AttachmentsGridProps) {
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(initialLimit);

  // Reset limit whenever the task attachments list changes
  useEffect(() => {
    setVisibleLimit(initialLimit);
  }, [attachments, initialLimit]);

  const imageAttachments = useMemo(() => {
    return (attachments || []).filter((att) => {
      const mime = (att.mimeType || '').toLowerCase();
      const name = (att.fileName || '').toLowerCase();
      const url = (att.fileUrl || '').toLowerCase();
      return (
        mime.startsWith('image/') ||
        /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(name) ||
        /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(url)
      );
    });
  }, [attachments]);

  const imageAttachmentUrls = useMemo(() => {
    return imageAttachments.map((a) => a.fileUrl);
  }, [imageAttachments]);

  const visibleAttachments = useMemo(() => {
    return (attachments || []).slice(0, visibleLimit);
  }, [attachments, visibleLimit]);

  const hasMore = (attachments || []).length > visibleLimit;
  const remainingCount = Math.max(0, (attachments || []).length - visibleLimit);
  const isExpanded = visibleLimit > initialLimit;

  const handleNavigateImage = useCallback(
    (newUrl: string) => {
      const target = imageAttachments.find(
        (a) => a.fileUrl === newUrl || decodeURIComponent(a.fileUrl) === decodeURIComponent(newUrl)
      );
      if (target) {
        setPreviewAttachment(target);
      }
    },
    [imageAttachments]
  );

  const isImageAttachment = useMemo(() => {
    if (!previewAttachment) return false;
    const mime = (previewAttachment.mimeType || '').toLowerCase();
    const name = (previewAttachment.fileName || '').toLowerCase();
    const url = (previewAttachment.fileUrl || '').toLowerCase();
    return (
      mime.startsWith('image/') ||
      /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(name) ||
      /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(url)
    );
  }, [previewAttachment]);

  if (!attachments || attachments.length === 0) {
    return null;
  }

  const handleItemClick = (att: Attachment) => {
    setPreviewAttachment(att);
  };

  return (
    <div className="mt-4 w-full">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {visibleAttachments.map((att) => {
          const isImage =
            (att.mimeType || '').startsWith('image/') ||
            /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(att.fileName || '') ||
            /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(att.fileUrl || '');

          return (
            <div
              key={att.id}
              onClick={() => handleItemClick(att)}
              className="group relative aspect-square bg-zinc-800/50 border border-zinc-700/50 rounded-lg overflow-hidden cursor-pointer hover:border-zinc-500 transition-colors flex flex-col"
            >
              {/* Thumbnail area - only fetched for visible attachments */}
              <div className="flex-1 w-full bg-secondary flex flex-col items-center justify-center overflow-hidden relative">
                {isImage ? (
                  <>
                    <img
                      src={getThumbnailUrl(att.fileUrl, 320, 35)}
                      alt={att.fileName}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-secondary/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-[2px]">
                      <span className="text-xs font-medium text-white bg-black/60 px-2 py-1 rounded-md">
                        Click to preview
                      </span>
                    </div>
                  </>
                ) : (
                  <File className="w-10 h-10 text-zinc-500" />
                )}
              </div>

              {/* Info bar at bottom */}
              <div className="absolute bottom-0 left-0 right-0 bg-secondary/90 backdrop-blur-sm p-2 border-t border-zinc-800/50 flex flex-col">
                <span className="text-xs font-medium text-zinc-200 truncate" title={att.fileName}>
                  {att.fileName}
                </span>
                <span className="text-[10px] text-zinc-500 uppercase">
                  {att.mimeType?.split('/')[1] || 'FILE'}
                </span>
              </div>

              {/* Delete button (shows on hover) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(att.id);
                }}
                className="absolute top-1.5 right-1.5 p-1 bg-red-500/80 hover:bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete Attachment"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Show more / Show less buttons */}
      {(hasMore || isExpanded) && (
        <div className="flex items-center justify-center gap-2.5 mt-4 pt-1">
          {hasMore && (
            <button
              type="button"
              onClick={() => setVisibleLimit((prev) => prev + BATCH_SIZE)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 border border-zinc-700/60 shadow-xs transition-all cursor-pointer hover:border-zinc-500"
            >
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              <span>Show more ({remainingCount} remaining)</span>
            </button>
          )}

          {hasMore && remainingCount > BATCH_SIZE && (
            <button
              type="button"
              onClick={() => setVisibleLimit(attachments.length)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-900/60 hover:bg-zinc-800 text-xs font-medium text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-all cursor-pointer"
            >
              <span>Show all ({attachments.length})</span>
            </button>
          )}

          {isExpanded && (
            <button
              type="button"
              onClick={() => setVisibleLimit(initialLimit)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/60 hover:bg-zinc-800 text-xs font-medium text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-all cursor-pointer"
            >
              <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
              <span>Show less</span>
            </button>
          )}
        </div>
      )}

      {/* Lightbox Preview */}
      <ImageLightboxModal
        isOpen={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
        currentSrc={previewAttachment?.fileUrl || null}
        fileName={previewAttachment?.fileName}
        images={isImageAttachment ? imageAttachmentUrls : []}
        onNavigate={handleNavigateImage}
      >
        {previewAttachment && !isImageAttachment && !previewAttachment.mimeType?.startsWith('video/') && (
          <div className="flex flex-col items-center p-12 bg-secondary rounded-xl border border-zinc-800">
            <File className="w-24 h-24 text-zinc-600 mb-6" />
            <h3 className="text-xl font-medium text-zinc-200 mb-2">{previewAttachment.fileName}</h3>
            <p className="text-zinc-500 mb-8 uppercase tracking-widest">{previewAttachment.mimeType}</p>
            <a
              href={previewAttachment.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors shadow-lg shadow-blue-500/20"
            >
              Open File in Browser
            </a>
          </div>
        )}
      </ImageLightboxModal>
    </div>
  );
}
