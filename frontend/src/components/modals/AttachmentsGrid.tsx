import React, { useState } from 'react';
import { X, File, ImageIcon } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';

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
}

export function AttachmentsGrid({ attachments, onDelete }: AttachmentsGridProps) {
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());

  if (attachments.length === 0) {
    return null;
  }

  const handleItemClick = (att: Attachment) => {
    const isImage = att.mimeType.startsWith('image/');
    if (isImage && !loadedImages.has(att.id)) {
      setLoadedImages((prev) => {
        const newSet = new Set(prev);
        newSet.add(att.id);
        return newSet;
      });
    } else {
      setPreviewAttachment(att);
    }
  };

  return (
    <div className="mt-4 w-full">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {attachments.map((att) => {
          const isImage = att.mimeType.startsWith('image/');
          const isLoaded = loadedImages.has(att.id);
          
          return (
            <div
              key={att.id}
              onClick={() => handleItemClick(att)}
              className="group relative aspect-square bg-zinc-800/50 border border-zinc-700/50 rounded-lg overflow-hidden cursor-pointer hover:border-zinc-500 transition-colors flex flex-col"
            >
              {/* Thumbnail area */}
              <div className="flex-1 w-full bg-zinc-900 flex flex-col items-center justify-center overflow-hidden relative">
                {isImage ? (
                  isLoaded ? (
                    <>
                      <img src={att.fileUrl} alt={att.fileName} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-zinc-900/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-[2px]">
                        <span className="text-xs font-medium text-white bg-black/60 px-2 py-1 rounded-md">Click to preview</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <ImageIcon className="w-10 h-10 text-zinc-500 opacity-50" />
                      <div className="absolute inset-0 bg-zinc-900/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-[2px]">
                        <span className="text-xs font-medium text-white bg-black/60 px-2 py-1 rounded-md">Click to load image</span>
                      </div>
                    </>
                  )
                ) : (
                  <File className="w-10 h-10 text-zinc-500" />
                )}
              </div>

              {/* Info bar at bottom */}
              <div className="absolute bottom-0 left-0 right-0 bg-zinc-900/90 backdrop-blur-sm p-2 border-t border-zinc-800/50 flex flex-col">
                <span className="text-xs font-medium text-zinc-200 truncate" title={att.fileName}>
                  {att.fileName}
                </span>
                <span className="text-[10px] text-zinc-500 uppercase">
                  {att.mimeType.split('/')[1] || 'FILE'}
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

      {/* Lightbox Preview */}
      <Dialog.Root open={!!previewAttachment} onOpenChange={(open) => !open && setPreviewAttachment(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/90 z-[9999] animate-in fade-in backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[10000] w-full max-w-[95vw] h-full max-h-[95vh] flex flex-col items-center justify-center outline-none">
            {previewAttachment && (
              <>
                <div className="absolute top-4 right-4 flex items-center gap-3 z-10">
                  <a
                    href={previewAttachment.fileUrl}
                    download={previewAttachment.fileName}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 bg-zinc-800/80 hover:bg-zinc-700 text-white rounded-full transition-colors backdrop-blur-md"
                    title="Download"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  </a>
                  <Dialog.Close asChild>
                    <button className="p-2 bg-zinc-800/80 hover:bg-zinc-700 text-white rounded-full transition-colors backdrop-blur-md">
                      <X className="w-5 h-5" />
                    </button>
                  </Dialog.Close>
                </div>
                
                <div className="relative w-full h-full flex items-center justify-center p-4">
                  {previewAttachment.mimeType.startsWith('image/') ? (
                    <img 
                      src={previewAttachment.fileUrl} 
                      alt={previewAttachment.fileName}
                      className="max-w-full max-h-full object-contain rounded-md shadow-2xl"
                    />
                  ) : previewAttachment.mimeType.startsWith('video/') ? (
                    <video 
                      src={previewAttachment.fileUrl} 
                      controls
                      autoPlay
                      className="max-w-full max-h-full rounded-md shadow-2xl"
                    />
                  ) : (
                    <div className="flex flex-col items-center p-12 bg-zinc-900 rounded-xl border border-zinc-800">
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
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
