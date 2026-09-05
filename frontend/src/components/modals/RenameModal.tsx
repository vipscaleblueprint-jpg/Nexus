'use client';

import { useState, useEffect } from 'react';
import { Pencil, X } from 'lucide-react';

interface RenameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (newName: string) => Promise<void>;
  title: string;
  initialName: string;
}

export function RenameModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  initialName,
}: RenameModalProps) {
  const [name, setName] = useState(initialName);
  const [isRenaming, setIsRenaming] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
    }
  }, [isOpen, initialName]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    try {
      setIsRenaming(true);
      await onConfirm(name.trim());
      onClose();
    } catch (err) {
      console.error('Failed to rename:', err);
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#18181b] rounded-xl shadow-2xl border border-zinc-800/60 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60 bg-[#121214]">
          <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
            <Pencil className="w-4 h-4 text-zinc-400" />
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5">
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wide">
                New Name
              </label>
              <input
                id="name"
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter new name..."
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                disabled={isRenaming}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-zinc-800/60">
            <button
              type="button"
              onClick={onClose}
              disabled={isRenaming}
              className="px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isRenaming}
              className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
              {isRenaming ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
