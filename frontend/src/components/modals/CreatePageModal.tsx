'use client';

import { useState, useEffect } from 'react';
import { spacesApi } from '@/api';
import { Doc } from '@/lib/types';
import { X, FileCode } from 'lucide-react';

interface CreatePageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  allDocs?: Doc[];
  defaultDocId?: string;
  defaultParentPageId?: string;
}

export function CreatePageModal({
  isOpen,
  onClose,
  onSuccess,
  allDocs = [],
  defaultDocId,
  defaultParentPageId,
}: CreatePageModalProps) {
  const [title, setTitle] = useState('');
  const [docId, setDocId] = useState<string>(defaultDocId || '');
  const [parentPageId, setParentPageId] = useState<string>(defaultParentPageId || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (defaultDocId) setDocId(defaultDocId);
    if (defaultParentPageId) setParentPageId(defaultParentPageId);
    setTitle('');
    setError(null);
  }, [isOpen, defaultDocId, defaultParentPageId]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Please enter a page title.');
      return;
    }
    if (!docId) {
      setError('Please select a target Document container.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      await spacesApi.createPage({
        title: title.trim(),
        docId,
        parentPageId: parentPageId || undefined,
      });
      setLoading(false);
      setTitle('');
      onSuccess();
      onClose();
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Failed to create page');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-sans">
      <div className="w-full max-w-md bg-[#18181c] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-zinc-200">
        <div className="px-5 py-4 border-b border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-400">
            <FileCode className="w-5 h-5" />
            <h3 className="text-base font-bold text-white">Create Page</h3>
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
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Page Title</label>
            <input
              type="text"
              required
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Getting Started, Overview..."
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700/80 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Document Container</label>
            <select
              required
              value={docId}
              onChange={(e) => setDocId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700/80 rounded-xl text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="">-- Select Document Container --</option>
              {allDocs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
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
              className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg disabled:opacity-50 transition-colors"
            >
              {loading ? 'Creating...' : 'Create Page'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
