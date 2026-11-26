'use client';

import React from 'react';

const MASK_STYLE: React.CSSProperties = {
  maskImage: "url('/nexus-logo.png')",
  WebkitMaskImage: "url('/nexus-logo.png')",
  maskSize: 'contain',
  WebkitMaskSize: 'contain',
  maskRepeat: 'no-repeat',
  WebkitMaskRepeat: 'no-repeat',
  maskPosition: 'center',
  WebkitMaskPosition: 'center',
};

interface NexusLogoProps {
  size?: number;
  className?: string;
}

/**
 * Static Nexus emblem adapted automatically to dark and light mode.
 */
export const NexusLogo: React.FC<NexusLogoProps> = ({ size = 24, className = '' }) => {
  return (
    <span
      role="img"
      aria-label="Nexus"
      style={{ width: size, height: size, ...MASK_STYLE }}
      className={`inline-block shrink-0 bg-zinc-900 dark:bg-white ${className}`}
    />
  );
};

interface NexusLogoLoaderProps {
  size?: number;
  label?: string;
  inline?: boolean;
  className?: string;
}

/**
 * Static Nexus emblem that fills/colors upward from bottom to top while loading.
 */
export const NexusLogoLoader: React.FC<NexusLogoLoaderProps> = ({
  size = 48,
  label,
  inline = false,
  className = '',
}) => {
  const emblem = (
    <span
      className="relative inline-block shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* Base unfilled silhouette */}
      <span
        style={MASK_STYLE}
        className="absolute inset-0 bg-zinc-400/80 dark:bg-zinc-800 transition-colors"
      />
      {/* Rising colored fill */}
      <span
        style={MASK_STYLE}
        className="nexus-logo-fill-layer absolute inset-0 bg-gradient-to-t from-indigo-600 via-sky-500 to-cyan-500 dark:from-indigo-400 dark:via-sky-400 dark:to-cyan-300"
      />
    </span>
  );

  if (inline) {
    return emblem;
  }

  return (
    <div className={`flex flex-col items-center justify-center gap-3 select-none ${className}`}>
      {emblem}
      {label && (
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400 tracking-wide">
          {label}
        </span>
      )}
    </div>
  );
};
