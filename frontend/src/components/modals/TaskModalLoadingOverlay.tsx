'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Centered loading overlay displayed while TaskDetailModal's bundle or task payload is loading.
 */
export const TaskModalLoadingOverlay: React.FC<{ label?: string }> = ({
  label = 'Loading task...',
}) => (
  <div
    role="status"
    aria-live="polite"
    className="fixed inset-0 z-[99999] bg-black/75 backdrop-blur-[2px] flex items-center justify-center p-4"
  >
    <div className="bg-zinc-900/95 border border-zinc-800 rounded-2xl px-6 py-5 shadow-2xl flex flex-col items-center gap-3">
      <Loader2 className="size-7 animate-spin text-[#0099ff]" />
      <p className="text-sm font-medium text-zinc-200">{label}</p>
    </div>
  </div>
);
