'use client';

import React from 'react';
import { NexusLogoLoader } from '@/components/ui/NexusLogo';

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
    <div className="bg-card/95 border border-border rounded-2xl px-7 py-6 shadow-2xl flex flex-col items-center">
      <NexusLogoLoader size={48} label={label} />
    </div>
  </div>
);
