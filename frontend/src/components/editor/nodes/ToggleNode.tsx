import { NodeViewWrapper, NodeViewContent, NodeViewProps } from '@tiptap/react';
import React from 'react';
import { ChevronRight } from 'lucide-react';

export const ToggleNode = ({ node, updateAttributes }: NodeViewProps) => {
  return (
    <NodeViewWrapper className="mb-2 group/toggle flex items-start gap-2">
      <button
        contentEditable={false}
        onClick={(e) => {
          e.preventDefault();
          updateAttributes({ open: !node.attrs.open });
        }}
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer select-none"
      >
        <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${node.attrs.open ? 'rotate-90' : 'rotate-0'}`} />
      </button>
      <div className="flex-1 min-w-0">
        <NodeViewContent 
          className={`flex flex-col gap-1 [&>*:nth-child(n+2)]:${node.attrs.open ? 'block' : 'hidden'} [&>*:first-child]:font-semibold`} 
        />
      </div>
    </NodeViewWrapper>
  );
};
