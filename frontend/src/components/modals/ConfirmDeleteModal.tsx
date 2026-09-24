'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
  itemName: string;
}

export function ConfirmDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  itemName,
}: ConfirmDeleteModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);



  const handleConfirm = async () => {
    try {
      setIsDeleting(true);
      await onConfirm();
      onClose();
    } catch (err) {
      console.error('Failed to delete:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 cursor-pointer"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="w-full max-w-md bg-[#18181b] rounded-xl shadow-2xl border border-red-900/50 flex flex-col overflow-hidden cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-red-900/30 bg-red-950/20">
          <h2 className="text-sm font-bold text-red-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-red-900/40 text-red-400/70 hover:text-red-400 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 text-zinc-300 text-sm">
          <p>
            Are you sure you want to delete <span className="font-bold text-white">"{itemName}"</span>?
          </p>
          <p className="mt-2 text-zinc-500 text-xs">
            This action cannot be undone. All nested contents will also be permanently deleted.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-800/60 bg-[#121214]">
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isDeleting}
            className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg shadow disabled:opacity-50 flex items-center gap-2 transition-colors"
          >
            {isDeleting ? 'Deleting...' : 'Delete Permanently'}
          </button>
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
