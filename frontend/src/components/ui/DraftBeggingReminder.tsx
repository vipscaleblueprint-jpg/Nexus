'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowUp } from 'lucide-react';
import { useAppStore } from '@/lib/store';

export function DraftBeggingReminder() {
  const router = useRouter();
  const pathname = usePathname();
  const { drafts, currentUser } = useAppStore();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Only proceed if user is logged in, not on login page, not already on activity drafts, and has drafts
    if (!currentUser || pathname === '/login' || pathname === '/activity') {
      return;
    }

    if (drafts.length === 0) {
      return;
    }

    // Check session storage so it ONLY shows once when opening Nexus, not on every page reload
    try {
      const alreadyShown = sessionStorage.getItem('nexus_draft_begging_shown');
      if (alreadyShown === 'true') {
        return;
      }

      // Small delay for natural entrance after app hydration
      const timer = setTimeout(() => {
        setIsVisible(true);
        sessionStorage.setItem('nexus_draft_begging_shown', 'true');
      }, 1800);

      return () => clearTimeout(timer);
    } catch {
      // Ignore storage access errors
    }
  }, [drafts.length, currentUser, pathname]);

  const handleClose = () => {
    setIsVisible(false);
  };

  const handleGoToDrafts = () => {
    setIsVisible(false);
    router.push('/activity?category=drafts');
  };

  if (!isVisible || drafts.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.85, y: 30 }}
        transition={{ type: 'spring', damping: 20, stiffness: 260 }}
        className="fixed bottom-6 left-6 z-[95] max-w-[320px] sm:max-w-[340px] select-none"
      >
        {/* Playful Jumping Container */}
        <motion.div
          animate={{
            y: [0, -8, 0, -4, 0],
          }}
          transition={{
            duration: 2.2,
            repeat: Infinity,
            repeatType: 'loop',
            ease: 'easeInOut',
          }}
          className="relative rounded-2xl bg-[#141417]/95 border-2 border-amber-500/60 shadow-[0_12px_40px_rgba(0,0,0,0.7)] backdrop-blur-md p-4 text-zinc-100 overflow-visible"
        >
          {/* Subtle amber glow in background */}
          <div className="absolute -top-12 -left-12 w-32 h-32 bg-amber-500/15 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -bottom-10 -right-10 w-28 h-28 bg-pink-500/10 rounded-full blur-xl pointer-events-none" />

          {/* Top arrow pointer notch pointing UP towards the sidebar Activity */}
          <div className="absolute -top-2 left-6 w-3.5 h-3.5 bg-[#141417] border-t-2 border-l-2 border-amber-500/60 rotate-45 pointer-events-none" />

          {/* Top header row: Arrow pointing UP at sidebar Activity + Close Button */}
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
              {/* Animated Arrow pointing UP towards the sidebar Activity */}
              <motion.div
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
                className="flex items-center justify-center p-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 shadow-sm"
              >
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              </motion.div>
              <span>ACTIVITY IS UP THERE!</span>
            </div>

            <button
              onClick={handleClose}
              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Concise, Dramatic Begging Text */}
          <div className="space-y-1.5 text-xs sm:text-[13px] leading-relaxed text-zinc-200">
            <p className="font-semibold text-amber-300 flex items-center gap-1.5 text-xs sm:text-sm">
              <span>🥺🙏 PLEASE! I AM BEGGING YOU!</span>
            </p>
            <p className="text-zinc-300 text-xs leading-relaxed">
              😭💔 Don&apos;t abandon your unsaved draft! Click <span className="text-amber-300 font-semibold underline decoration-amber-400/50">Activity</span> up there and finish what you started! 🙇‍♂️✨
            </p>
          </div>

          {/* Action Buttons */}
          <div className="mt-3 flex items-center gap-2 pt-2 border-t border-zinc-800/80">
            <button
              onClick={handleGoToDrafts}
              className="flex-1 py-1.5 px-3 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
            >
              <span>Take Me To My Drafts! 🏃‍♂️💨</span>
            </button>
            <button
              onClick={handleClose}
              className="py-1.5 px-3 rounded-lg bg-zinc-800/80 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
            >
              Dismiss 💔
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
