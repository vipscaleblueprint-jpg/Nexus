'use client';

import { useEffect, useState } from 'react';
import { UserPlus, X, Copy, Check } from 'lucide-react';

interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function InviteModal({ isOpen, onClose }: InviteModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Read during render rather than from an effect: the modal only mounts its
  // body on the client, and window is unavailable during prerender.
  const inviteUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/login`;

  const handleClose = () => {
    setCopied(false);
    onClose();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked outside secure contexts; the field stays
      // selectable so the link can still be copied by hand.
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#18181c] border border-zinc-800/80 rounded-2xl shadow-2xl text-zinc-100 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-zinc-800/80 border border-zinc-700">
              <UserPlus className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h2 id="invite-title" className="text-sm font-bold tracking-tight text-white">
                Invite to Workspace
              </h2>
              <p className="text-[11px] text-zinc-400">Share the sign-in link</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="invite-url" className="text-[11px] font-medium text-zinc-400 block mb-1">
              Workspace link
            </label>
            <div className="flex items-center gap-2">
              <input
                id="invite-url"
                type="text"
                value={inviteUrl}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 bg-[#131316] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-700 font-mono"
              />
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-200 hover:bg-white text-zinc-950 font-semibold text-xs transition-colors shrink-0 cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Anyone with this link can reach the sign-in page. Accounts are still created by an
            administrator — there is no self-serve invite endpoint yet.
          </p>
        </div>
      </div>
    </div>
  );
}
