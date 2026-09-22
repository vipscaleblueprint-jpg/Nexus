import { NodeViewWrapper, NodeViewContent, NodeViewProps } from '@tiptap/react';
import React from 'react';
import { ChevronRight } from 'lucide-react';

export const ToggleNode = ({ node, updateAttributes }: NodeViewProps) => {
  const isOpen = node.attrs.open;

  const handleToggle = (e: React.MouseEvent) => {
    // Prevent default so we don't steal focus from the editor
    e.preventDefault();
    e.stopPropagation();
    updateAttributes({ open: !isOpen });
  };

  return (
    <NodeViewWrapper className={`mb-2 toggle-node ${isOpen ? 'is-open' : 'is-closed'}`}>
      <style>{`
        /* 
          Use reliable CSS-based display toggling. 
          By only targeting .is-closed, we avoid forcing nested closed toggles to open.
        */
        .toggle-node.is-closed div[data-type="toggle-content"] {
          display: none !important;
        }
      `}</style>
      
      <div className="flex items-start gap-2 toggle-wrapper">
        <button
          contentEditable={false}
          onMouseDown={(e) => {
            // Prevent editor focus loss on click
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={handleToggle}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer select-none"
        >
          <ChevronRight
            className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-90' : 'rotate-0'}`}
          />
        </button>
        <div className="flex-1 min-w-0">
          <NodeViewContent
            as="div"
            className="flex flex-col gap-1 toggle-content-wrapper"
          />
        </div>
      </div>
    </NodeViewWrapper>
  );
};
