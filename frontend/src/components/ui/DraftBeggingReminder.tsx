'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowLeft, FileText } from 'lucide-react';
import { useAppStore } from '@/lib/store';

export function DraftBeggingReminder() {
  const router = useRouter();
  const pathname = usePathname();
  const { drafts, currentUser } = useAppStore();
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const updatePosition = useCallback(() => {
    if (typeof window === 'undefined') return;

    // On small mobile screens, let default CSS handle bottom placement
    if (window.innerWidth < 768) {
      setCoords(null);
      return;
    }

    const activityLink = document.getElementById('sidebar-activity-link');
    if (activityLink) {
      const rect = activityLink.getBoundingClientRect();
      setCoords({
        top: Math.max(16, rect.top - 6),
        left: rect.right + 14,
      });
    } else {
      // Fallback if sidebar element is not in DOM
      setCoords({
        top: 72,
        left: 275,
      });
    }
  }, []);

  useEffect(() => {
    // Only proceed if user is logged in, not on login page, not already on activity drafts, and has drafts
    if (!currentUser || pathname === '/login' || pathname === '/activity') {
      return;
    }

    if (drafts.length === 0) {
      return;
    }

    try {
      const dismissed = sessionStorage.getItem('nexus_draft_reminder_dismissed');
      if (dismissed === 'true') {
        return;
      }

      const timer = setTimeout(() => {
        setIsVisible(true);
        updatePosition();
      }, 1200);

      return () => clearTimeout(timer);
    } catch {
      // Ignore storage access errors
    }
  }, [drafts.length, currentUser, pathname, updatePosition]);

  useEffect(() => {
    if (!isVisible) return;
    updatePosition();

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isVisible, updatePosition]);

  const handleClose = () => {
    setIsVisible(false);
    try {
      sessionStorage.setItem('nexus_draft_reminder_dismissed', 'true');
    } catch {}
  };

  const handleGoToDrafts = () => {
    setIsVisible(false);
    router.push('/activity?category=drafts');
  };

  if (!isVisible || drafts.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.92, x: -12 }}
        animate={{ opacity: 1, scale: 1, x: 0 }}
        exit={{ opacity: 0, scale: 0.92, x: -12 }}
        transition={{ type: 'spring', damping: 24, stiffness: 300 }}
        style={
          coords
            ? {
                top: `${coords.top}px`,
                left: `${coords.left}px`,
              }
            : undefined
        }
        className={`fixed z-[160] max-w-[320px] sm:max-w-[340px] select-none ${
          !coords ? 'bottom-20 left-4 right-4 md:bottom-auto md:left-auto' : ''
        }`}
      >
        <div className="relative rounded-xl bg-card/95 border border-amber-500/40 shadow-xl shadow-black/10 dark:shadow-[0_12px_36px_rgba(0,0,0,0.65)] backdrop-blur-md p-4 text-zinc-100 overflow-visible">
          {/* Subtle warm glow in background */}
          <div className="absolute -top-10 -left-10 w-28 h-28 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

          {/* Left arrow pointer notch pointing directly at the Activity menu item */}
          <div className="hidden md:block absolute top-5 -left-1.5 w-3 h-3 bg-card border-l border-t border-amber-500/40 -rotate-45 pointer-events-none z-10" />

          {/* Header row: Left pointing arrow badge + Professional Title + Close Button */}
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <motion.div
                animate={{ x: [0, -3, 0] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                className="flex items-center justify-center p-1.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5 stroke-[2.5]" />
              </motion.div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 tracking-wide uppercase">
                <FileText className="w-3.5 h-3.5 text-amber-400/80" />
                <span>Unsaved Activity Draft</span>
              </div>
            </div>

            <button
              onClick={handleClose}
              className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Professional Notification Body */}
          <div className="text-xs text-zinc-300 leading-relaxed pl-0.5">
            <p>
              {drafts.length === 1
                ? 'You have an active unsaved draft in your Activity journal. Would you like to resume and complete it?'
                : `You have ${drafts.length} unsaved drafts in your Activity journal. Would you like to review and complete them?`}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="mt-3.5 flex items-center gap-2 pt-2.5 border-t border-zinc-800/80">
            <button
              onClick={handleGoToDrafts}
              className="flex-1 py-1.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-950 font-semibold text-xs shadow-sm transition-colors flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
            >
              <span>Resume Draft</span>
            </button>
            <button
              onClick={handleClose}
              className="py-1.5 px-3 rounded-lg bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100 border border-zinc-700/60 text-xs font-medium transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
