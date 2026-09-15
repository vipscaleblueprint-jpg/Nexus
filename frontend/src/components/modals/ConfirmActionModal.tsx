'use client';

import { useState } from 'react';
import { AlertTriangle, X, Info } from 'lucide-react';

interface ConfirmActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  isDestructive?: boolean;
}

export function ConfirmActionModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  isDestructive = false,
}: ConfirmActionModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    try {
      setIsProcessing(true);
      await onConfirm();
      onClose();
    } catch (err) {
      console.error('Action failed:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const headerColors = isDestructive 
    ? 'border-red-900/30 bg-red-950/20 text-red-400' 
    : 'border-indigo-900/30 bg-indigo-950/20 text-indigo-400';

  const buttonColors = isDestructive
    ? 'bg-red-600 hover:bg-red-500'
    : 'bg-indigo-600 hover:bg-indigo-500';

  const Icon = isDestructive ? AlertTriangle : Info;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={`w-full max-w-md bg-[#18181b] rounded-xl shadow-2xl border flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${isDestructive ? 'border-red-900/50' : 'border-indigo-900/50'}`}>
        <div className={`flex items-center justify-between px-4 py-3 border-b ${headerColors}`}>
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Icon className="w-4 h-4" />
            {title}
          </h2>
          <button
            onClick={onClose}
            className={`p-1 rounded-md transition-colors ${isDestructive ? 'hover:bg-red-900/40 text-red-400/70 hover:text-red-400' : 'hover:bg-indigo-900/40 text-indigo-400/70 hover:text-indigo-400'}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 text-zinc-300 text-sm">
          {message}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-800/60 bg-[#121214]">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isProcessing}
            className={`px-4 py-2 text-xs font-bold text-white rounded-lg shadow disabled:opacity-50 flex items-center gap-2 transition-colors ${buttonColors}`}
          >
            {isProcessing ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
