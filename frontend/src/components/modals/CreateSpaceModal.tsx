'use client';

import { useState } from 'react';
import { spacesApi } from '@/api';
import { useAppStore } from '@/lib/store';
import { X, Layers } from 'lucide-react';

interface CreateSpaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateSpaceModal({ isOpen, onClose, onSuccess }: CreateSpaceModalProps) {
  const { currentUser } = useAppStore();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#4F46E5');
  const [icon, setIcon] = useState('rocket');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter a space name.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      await spacesApi.createSpace({
        name: name.trim(),
        color,
        icon,
        ownerId: currentUser?.id || 'admin',
      });
      setLoading(false);
      setName('');
      onSuccess();
      onClose();
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Failed to create space');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-sans">
      <div className="w-full max-w-md bg-[#18181c] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-zinc-200">
        <div className="px-5 py-4 border-b border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2 text-indigo-400">
            <Layers className="w-5 h-5" />
            <h3 className="text-base font-bold text-white">Create Space</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 text-xs bg-red-950/60 border border-red-800 text-red-300 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Space Name</label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Engineering, Marketing..."
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700/80 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Theme Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-10 bg-zinc-900 border border-zinc-700 rounded-lg cursor-pointer p-1"
              />
              <span className="text-xs font-mono text-zinc-400 bg-zinc-900 px-2.5 py-1.5 rounded-md border border-zinc-800">
                {color}
              </span>
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg disabled:opacity-50 transition-colors"
            >
              {loading ? 'Creating...' : 'Create Space'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
