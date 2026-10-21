'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface TimelinePaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  className?: string;
  compact?: boolean;
  itemLabel?: string;
}

export function TimelinePagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  className = '',
  compact = false,
  itemLabel = 'items',
}: TimelinePaginationProps) {
  if (totalPages <= 1) return null;

  const startIdx = (currentPage - 1) * itemsPerPage + 1;
  const endIdx = Math.min(currentPage * itemsPerPage, totalItems);

  // Compact mode for tight panels (like SubtasksSection inline comments)
  if (compact) {
    return (
      <div className={`flex items-center justify-between py-1.5 px-1 text-[11px] text-zinc-400 select-none ${className}`}>
        <span className="text-zinc-500 text-[10px]">
          {startIdx}–{endIdx} of {totalItems}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            className="p-1 rounded hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title="Previous page"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-semibold text-zinc-300 px-1">
            {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            className="p-1 rounded hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title="Next page"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Full pagination bar for TaskDetailModal activity feed
  return (
    <div className={`flex items-center justify-between px-3 py-2 bg-zinc-900/60 border border-zinc-800/80 rounded-lg text-xs text-zinc-400 select-none shadow-sm ${className}`}>
      <div className="text-[11px] text-zinc-400 font-medium">
        Showing <span className="text-zinc-200 font-semibold">{startIdx}</span>–<span className="text-zinc-200 font-semibold">{endIdx}</span> of <span className="text-zinc-200 font-semibold">{totalItems}</span> {itemLabel}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="h-7 px-2 flex items-center gap-0.5 rounded-md text-[11px] font-medium text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-zinc-800 hover:text-zinc-200 transition-colors cursor-pointer border border-zinc-800/60"
        >
          <ChevronLeft className="w-3 h-3" />
          <span>Prev</span>
        </button>

        <div className="flex items-center gap-0.5">
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let pageNum = i + 1;
            if (totalPages > 5) {
              if (currentPage > 3) pageNum = currentPage - 2 + i;
              if (currentPage > totalPages - 2) pageNum = totalPages - 4 + i;
            }
            if (pageNum < 1 || pageNum > totalPages) return null;

            const isActive = currentPage === pageNum;
            return (
              <button
                key={pageNum}
                type="button"
                onClick={() => onPageChange(pageNum)}
                className={`w-7 h-7 flex items-center justify-center rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-sm'
                    : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200 border border-transparent'
                }`}
              >
                {pageNum}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="h-7 px-2 flex items-center gap-0.5 rounded-md text-[11px] font-medium text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-zinc-800 hover:text-zinc-200 transition-colors cursor-pointer border border-zinc-800/60"
        >
          <span>Next</span>
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
