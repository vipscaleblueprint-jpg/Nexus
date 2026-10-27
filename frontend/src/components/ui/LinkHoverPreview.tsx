'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link2, ExternalLink, Check, Globe } from 'lucide-react';
import { normalizeHref, openExternalLink } from '@/lib/links';

const GAP = 6;
const EDGE = 12;
const ESTIMATED_WIDTH = 320;
const ESTIMATED_HEIGHT = 72;

const KNOWN_SERVICES: Record<string, string> = {
  'analytics.google.com': 'Google Analytics',
  'drive.google.com': 'Google Drive',
  'docs.google.com': 'Google Docs',
  'sheets.google.com': 'Google Sheets',
  'slides.google.com': 'Google Slides',
  'mail.google.com': 'Gmail',
  'calendar.google.com': 'Google Calendar',
  'meet.google.com': 'Google Meet',
  'google.com': 'Google',
  'github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'figma.com': 'Figma',
  'notion.so': 'Notion',
  'slack.com': 'Slack',
  'linear.app': 'Linear',
  'trello.com': 'Trello',
  'asana.com': 'Asana',
  'clickup.com': 'ClickUp',
  'monday.com': 'Monday.com',
  'jira.atlassian.com': 'Jira',
  'confluence.atlassian.com': 'Confluence',
  'zoom.us': 'Zoom',
  'loom.com': 'Loom',
  'canva.com': 'Canva',
  'miro.com': 'Miro',
  'twitter.com': 'X (Twitter)',
  'x.com': 'X',
  'linkedin.com': 'LinkedIn',
  'facebook.com': 'Facebook',
  'instagram.com': 'Instagram',
  'reddit.com': 'Reddit',
  'stackoverflow.com': 'Stack Overflow',
  'wikipedia.org': 'Wikipedia',
  'dropbox.com': 'Dropbox',
  'vercel.com': 'Vercel',
  'supabase.com': 'Supabase',
};

export interface LinkMetadata {
  title: string;
  displayUrl: string;
  hostname: string;
  faviconUrl: string;
  normalizedHref: string;
}

export function parseLinkMetadata(href: string, anchorText?: string): LinkMetadata {
  const normalized = normalizeHref(href);
  let url: URL | null = null;
  try {
    url = new URL(normalized);
  } catch {
    // fallback for relative or unparseable URLs
  }

  const hostname = url?.hostname ? url.hostname.toLowerCase().replace(/^www\./, '') : '';
  const pathname = url?.pathname === '/' ? '' : (url?.pathname || '');
  const displayUrl = hostname
    ? `${hostname}${pathname}${url?.search || ''}${url?.hash || ''}`
    : href;

  let title = '';
  if (anchorText && typeof anchorText === 'string') {
    const trimmed = anchorText.trim();
    if (trimmed && !trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('www.')) {
      title = trimmed;
    }
  }

  if (!title) {
    if (hostname && KNOWN_SERVICES[hostname]) {
      title = KNOWN_SERVICES[hostname];
    } else if (hostname) {
      title = hostname.charAt(0).toUpperCase() + hostname.slice(1);
    } else {
      title = href;
    }
  }

  const faviconUrl = hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=32` : '';

  return {
    title,
    displayUrl,
    hostname,
    faviconUrl,
    normalizedHref: normalized,
  };
}

function computePosition(triggerRect: DOMRect, cardWidth: number, cardHeight: number) {
  if (typeof window === 'undefined') return { top: 0, left: 0 };

  // Requirement: Move the hovered URL preview ABOVE the trigger link by default
  let top = triggerRect.top - GAP - cardHeight;
  if (top < EDGE) {
    // If not enough room above the viewport, flip to below
    const below = triggerRect.bottom + GAP;
    if (below + cardHeight <= window.innerHeight - EDGE) {
      top = below;
    } else {
      top = Math.max(EDGE, window.innerHeight - EDGE - cardHeight);
    }
  }

  let left = triggerRect.left;
  if (left + cardWidth > window.innerWidth - EDGE) {
    left = window.innerWidth - EDGE - cardWidth;
  }
  if (left < EDGE) {
    left = EDGE;
  }

  return { top, left };
}

interface LinkPreviewCardProps {
  metadata: LinkMetadata;
  triggerRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClose: () => void;
}

function LinkPreviewCard({ metadata, triggerRect, onMouseEnter, onMouseLeave, onClose }: LinkPreviewCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [showCopyTooltip, setShowCopyTooltip] = useState(false);
  const [showOpenTooltip, setShowOpenTooltip] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronously compute initial position so the card never starts at -9999 or jumps
  const [coords, setCoords] = useState(() => computePosition(triggerRect, ESTIMATED_WIDTH, ESTIMATED_HEIGHT));

  // useLayoutEffect runs synchronously before paint to measure actual dimensions without visual flash
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const actualWidth = card.offsetWidth || ESTIMATED_WIDTH;
    const actualHeight = card.offsetHeight || ESTIMATED_HEIGHT;
    setCoords(computePosition(triggerRect, actualWidth, actualHeight));
  }, [triggerRect]);

  // Dismiss immediately when scrolling anywhere or pressing Escape
  useEffect(() => {
    const handleScrollOrKey = (e: Event) => {
      // If user scrolls or presses Escape, close immediately so it doesn't linger or float
      if (e.type === 'keydown') {
        if ((e as KeyboardEvent).key === 'Escape') {
          onClose();
        }
        return;
      }
      onClose();
    };

    window.addEventListener('scroll', handleScrollOrKey, true);
    window.addEventListener('resize', handleScrollOrKey);
    window.addEventListener('keydown', handleScrollOrKey);

    return () => {
      window.removeEventListener('scroll', handleScrollOrKey, true);
      window.removeEventListener('resize', handleScrollOrKey);
      window.removeEventListener('keydown', handleScrollOrKey);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, [onClose]);

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!metadata.normalizedHref) return;

    navigator.clipboard.writeText(metadata.normalizedHref);
    setCopied(true);
    setShowCopyTooltip(true);

    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => {
      setCopied(false);
    }, 1500);
  };

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openExternalLink(metadata.normalizedHref);
    onClose();
  };

  return (
    <div
      ref={cardRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        zIndex: 999999,
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
      }}
      className="w-max min-w-[280px] max-w-[360px] rounded-xl p-3 border shadow-xl shadow-black/10 dark:shadow-2xl dark:shadow-black/70 select-none opacity-100 transition-opacity duration-75"
    >
      {/* Top Row: Title + Action Buttons */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <span
          className="text-xs font-semibold truncate max-w-[210px] leading-tight"
          style={{ color: 'var(--text)' }}
          title={metadata.title}
        >
          {metadata.title}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          {/* Copy Link Button */}
          <div className="relative flex items-center justify-center">
            {showCopyTooltip && (
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 pointer-events-none z-50 flex flex-col items-center">
                <div
                  className="text-[10px] font-medium px-2 py-0.5 rounded shadow-lg border whitespace-nowrap"
                  style={{
                    backgroundColor: 'var(--bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)',
                  }}
                >
                  {copied ? 'Copied!' : 'Copy link'}
                </div>
                <div
                  className="w-0 h-0 border-x-4 border-x-transparent border-t-4"
                  style={{ borderTopColor: 'var(--border)' }}
                />
              </div>
            )}
            <button
              type="button"
              onClick={handleCopy}
              onMouseEnter={() => setShowCopyTooltip(true)}
              onMouseLeave={() => setShowCopyTooltip(false)}
              className="p-1.5 rounded-md transition-colors cursor-pointer hover:bg-[var(--hover-subtle)]"
              style={{
                color: copied ? 'var(--success)' : 'var(--muted)',
                backgroundColor: copied ? 'color-mix(in srgb, var(--success) 15%, transparent)' : undefined,
              }}
              title={copied ? 'Copied!' : 'Copy link'}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Open / Redirect Button */}
          <div className="relative flex items-center justify-center">
            {showOpenTooltip && (
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 pointer-events-none z-50 flex flex-col items-center">
                <div
                  className="text-[10px] font-medium px-2 py-0.5 rounded shadow-lg border whitespace-nowrap"
                  style={{
                    backgroundColor: 'var(--bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)',
                  }}
                >
                  Open in new tab
                </div>
                <div
                  className="w-0 h-0 border-x-4 border-x-transparent border-t-4"
                  style={{ borderTopColor: 'var(--border)' }}
                />
              </div>
            )}
            <button
              type="button"
              onClick={handleOpen}
              onMouseEnter={() => setShowOpenTooltip(true)}
              onMouseLeave={() => setShowOpenTooltip(false)}
              className="p-1.5 rounded-md transition-colors cursor-pointer hover:bg-[var(--hover-subtle)]"
              style={{ color: 'var(--muted)' }}
              title="Open in new tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Row: Favicon + URL */}
      <div
        onClick={handleOpen}
        className="flex items-center gap-2 group/url cursor-pointer rounded px-1.5 -mx-1 py-1 hover:bg-[var(--hover-subtle)] transition-colors"
        title="Click to open link"
      >
        {metadata.faviconUrl && !faviconFailed ? (
          <img
            src={metadata.faviconUrl}
            alt=""
            onError={() => setFaviconFailed(true)}
            className="w-3.5 h-3.5 rounded-[2px] object-contain shrink-0"
          />
        ) : (
          <Globe
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: 'var(--muted)' }}
          />
        )}
        <span
          className="text-[11px] font-mono truncate group-hover/url:text-blue-600 dark:group-hover/url:text-blue-400 transition-colors max-w-[310px]"
          style={{ color: 'var(--muted)' }}
        >
          {metadata.displayUrl}
        </span>
      </div>
    </div>
  );
}

export interface LinkWithPreviewProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href?: string;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Drop-in replacement for <a> tags.
 * Displays a hovering card with Copy Link & Redirect buttons on mouse hover.
 */
export function LinkWithPreview({
  href = '',
  children,
  className = '',
  onClick,
  ...rest
}: LinkWithPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const openTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const anchorText = typeof children === 'string' ? children : '';
  const metadata = React.useMemo(() => parseLinkMetadata(href, anchorText), [href, anchorText]);

  const handleMouseEnter = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);

    openTimeoutRef.current = setTimeout(() => {
      if (linkRef.current) {
        setTriggerRect(linkRef.current.getBoundingClientRect());
        setIsOpen(true);
      }
    }, 120);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);

    // Fast 100ms dismissal so it doesn't linger after unfocusing
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 100);
  }, []);

  const handleCardMouseEnter = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const handleCardMouseLeave = useCallback(() => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 100);
  }, []);

  const handleClose = useCallback(() => {
    if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    setIsOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  return (
    <>
      <a
        ref={linkRef}
        {...rest}
        href={metadata.normalizedHref}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={(e) => {
          handleClose();
          if (onClick) onClick(e);
        }}
        className={className}
      >
        {children}
      </a>

      {isOpen && triggerRect && typeof document !== 'undefined' &&
        createPortal(
          <LinkPreviewCard
            metadata={metadata}
            triggerRect={triggerRect}
            onMouseEnter={handleCardMouseEnter}
            onMouseLeave={handleCardMouseLeave}
            onClose={handleClose}
          />,
          document.body
        )}
    </>
  );
}

/**
 * Hook to attach hover preview to raw HTML <a> links inside any container (e.g. TipTap BlockEditor).
 */
export function useDomLinkPreview(containerRef: React.RefObject<HTMLElement | null>, activeDependency?: any) {
  const [activeLink, setActiveLink] = useState<{
    rect: DOMRect;
    metadata: LinkMetadata;
  } | null>(null);

  const openTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeTargetRef = useRef<HTMLElement | null>(null);

  const closeImmediately = useCallback(() => {
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    activeTargetRef.current = null;
    setActiveLink(null);
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    const attach = (container: HTMLElement) => {
      const handleMouseOver = (e: MouseEvent) => {
        const target = (e.target as HTMLElement | null)?.closest?.('a[href]');
        if (!target || !container.contains(target)) return;
        if (target.closest('[data-node-view-wrapper]') || target.closest('[data-type="mention"]')) return;

        const href = target.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('mention:')) return;

        if (activeTargetRef.current === target) {
          if (closeTimeoutRef.current) {
            clearTimeout(closeTimeoutRef.current);
            closeTimeoutRef.current = null;
          }
          return;
        }

        if (closeTimeoutRef.current) {
          clearTimeout(closeTimeoutRef.current);
          closeTimeoutRef.current = null;
        }
        if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);

        openTimeoutRef.current = setTimeout(() => {
          activeTargetRef.current = target as HTMLElement;
          const rect = target.getBoundingClientRect();
          const text = target.textContent || '';
          const meta = parseLinkMetadata(href, text);
          setActiveLink({ rect, metadata: meta });
        }, 120);
      };

      const handleMouseOut = (e: MouseEvent) => {
        const target = (e.target as HTMLElement | null)?.closest?.('a[href]');
        if (!target || !container.contains(target)) return;

        const related = e.relatedTarget as Node | null;
        if (related && target.contains(related)) return;

        if (openTimeoutRef.current) {
          clearTimeout(openTimeoutRef.current);
          openTimeoutRef.current = null;
        }
        if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);

        closeTimeoutRef.current = setTimeout(() => {
          activeTargetRef.current = null;
          setActiveLink(null);
        }, 100);
      };

      const handleClick = (e: MouseEvent) => {
        const target = (e.target as HTMLElement | null)?.closest?.('a[href]');
        if (target && container.contains(target)) {
          closeImmediately();
        }
      };

      container.addEventListener('mouseover', handleMouseOver);
      container.addEventListener('mouseout', handleMouseOut);
      container.addEventListener('click', handleClick);

      return () => {
        container.removeEventListener('mouseover', handleMouseOver);
        container.removeEventListener('mouseout', handleMouseOut);
        container.removeEventListener('click', handleClick);
        if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
        if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
      };
    };

    if (containerRef.current) {
      cleanup = attach(containerRef.current);
    } else {
      let frameId: number;
      let attempts = 0;
      const poll = () => {
        if (cancelled) return;
        if (containerRef.current) {
          cleanup = attach(containerRef.current);
        } else if (attempts < 50) {
          attempts++;
          frameId = requestAnimationFrame(poll);
        }
      };
      frameId = requestAnimationFrame(poll);
      return () => {
        cancelled = true;
        cancelAnimationFrame(frameId);
        if (cleanup) cleanup();
      };
    }

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [containerRef, activeDependency, closeImmediately]);

  const handleCardMouseEnter = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const handleCardMouseLeave = useCallback(() => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => {
      activeTargetRef.current = null;
      setActiveLink(null);
    }, 100);
  }, []);

  const renderCard = () => {
    if (!activeLink || typeof document === 'undefined') return null;
    return createPortal(
      <LinkPreviewCard
        metadata={activeLink.metadata}
        triggerRect={activeLink.rect}
        onMouseEnter={handleCardMouseEnter}
        onMouseLeave={handleCardMouseLeave}
        onClose={closeImmediately}
      />,
      document.body
    );
  };

  return { renderCard };
}
