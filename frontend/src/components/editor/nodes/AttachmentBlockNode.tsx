import { NodeViewWrapper } from '@tiptap/react';
import React, { useState } from 'react';
import { Paperclip, Image as ImageIcon, File, X, Download } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';

export function AttachmentBlockNode(props: any) {
  const { node } = props;
  const url = node.attrs.url;
  const fileName = node.attrs.fileName || 'Attachment';
  const fileType = node.attrs.fileType || '';
  const isImage = fileType.startsWith('image/');
  
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <NodeViewWrapper className="attachment-node my-4" draggable="true" data-drag-handle>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden relative group">
        {!isPreviewMode && (
          <div className="flex items-center gap-3 p-3">
            <div className="flex-1 flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded bg-zinc-800 flex items-center justify-center shrink-0">
                {isImage ? <ImageIcon className="w-5 h-5 text-zinc-400" /> : <File className="w-5 h-5 text-zinc-400" />}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium text-zinc-200 truncate">{fileName}</span>
                <span className="text-xs text-zinc-500 uppercase">{fileType.split('/')[1] || 'FILE'}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2 shrink-0">
              {isImage && (
                <button
                  type="button"
                  onClick={() => setIsPreviewMode(true)}
                  className="px-3 py-1.5 rounded-md bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 text-xs font-medium transition-colors cursor-pointer"
                >
                  Click to preview
                </button>
              )}
              <a 
                href={url} 
                target="_blank" 
                rel="noreferrer"
                className="w-8 h-8 rounded-md bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
                title="Download file"
              >
                <Download className="w-4 h-4" />
              </a>
            </div>
          </div>
        )}

        {isPreviewMode && isImage && (
          <div className="relative">
            <div 
              className="w-full max-h-[300px] overflow-hidden bg-black/50 flex items-center justify-center cursor-zoom-in"
              onClick={() => setIsModalOpen(true)}
            >
              <img 
                src={url} 
                alt={fileName} 
                className="w-full h-auto object-contain max-h-[300px]"
                loading="lazy"
              />
            </div>
            <button 
              onClick={() => setIsPreviewMode(false)}
              className="absolute top-2 right-2 w-8 h-8 bg-black/70 hover:bg-black text-white rounded-md flex items-center justify-center transition-colors shadow-xl"
              title="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <Dialog.Root open={isModalOpen} onOpenChange={setIsModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/90 z-[9998] animate-in fade-in" />
          <Dialog.Content className="fixed inset-4 z-[9999] flex items-center justify-center animate-in zoom-in-95 outline-none pointer-events-none">
            <div className="relative max-w-full max-h-full pointer-events-auto flex items-center justify-center">
              <img 
                src={url} 
                alt={fileName} 
                className="max-w-full max-h-full object-contain rounded shadow-2xl"
              />
              <button
                onClick={() => setIsModalOpen(false)}
                className="absolute -top-4 -right-4 w-10 h-10 rounded-full bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center border border-zinc-700 shadow-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </NodeViewWrapper>
  );
}
