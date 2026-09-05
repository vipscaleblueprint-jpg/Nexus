'use client';

import { useState, useEffect } from 'react';
import { spacesApi } from '@/api';
import { Space, Folder } from '@/lib/types';
import { X, FileText } from 'lucide-react';

interface CreateDocModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  spaces?: Space[];
  defaultSpaceId?: string;
  defaultFolderId?: string;
}

function getAllFolders(spaces: Space[]): Folder[] {
  const folders: Folder[] = [];
  function collect(fList: Folder[]) {
    fList.forEach((f) => {
      folders.push(f);
      if (f.subfolders && f.subfolders.length > 0) collect(f.subfolders);
    });
  }
  spaces.forEach((s) => {
    if (s.folders) collect(s.folders);
  });
  return folders;
}

export function CreateDocModal({
  isOpen,
  onClose,
  onSuccess,
  spaces = [],
  defaultSpaceId,
  defaultFolderId,
}: CreateDocModalProps) {
  const [title, setTitle] = useState('');
  const [spaceId, setSpaceId] = useState<string>(defaultSpaceId || '');
  const [folderId, setFolderId] = useState<string>(defaultFolderId || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allFolders = getAllFolders(spaces);

  useEffect(() => {
    if (defaultSpaceId) setSpaceId(defaultSpaceId);
    if (defaultFolderId) setFolderId(defaultFolderId);
    setTitle('');
    setError(null);
  }, [isOpen, defaultSpaceId, defaultFolderId]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Please enter a document title.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      await spacesApi.createDoc({
        title: title.trim(),
        spaceId: spaceId && spaceId !== 'root-space' ? spaceId : undefined,
        folderId: folderId || undefined,
      });
      setLoading(false);
      setTitle('');
      onSuccess();
      onClose();
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Failed to create document');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-sans">
      <div className="w-full max-w-md bg-[#18181c] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-zinc-200">
        <div className="px-5 py-4 border-b border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2 text-purple-400">
            <FileText className="w-5 h-5" />
            <h3 className="text-base font-bold text-white">Create Document Container</h3>
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
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Document Title</label>
            <input
              type="text"
              required
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Product Knowledge Base, API Specs..."
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700/80 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 transition-colors"
            />
          </div>

          {/* Space Selector */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Space Parent (Optional)</label>
            <select
              value={spaceId}
              onChange={(e) => {
                setSpaceId(e.target.value);
                setFolderId(''); // Clear folder if space selected
              }}
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700/80 rounded-xl text-xs text-zinc-200 focus:outline-none focus:border-purple-500"
            >
              <option value="">-- No Space / Root Workspace --</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Folder Selector */}
          {allFolders.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Parent Folder (Optional)</label>
              <select
                value={folderId}
                onChange={(e) => {
                  setFolderId(e.target.value);
                  if (e.target.value) setSpaceId(''); // Clear space if folder selected
                }}
                className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700/80 rounded-xl text-xs text-zinc-200 focus:outline-none focus:border-purple-500"
              >
                <option value="">-- No Folder (Root Level) --</option>
                {allFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    📁 {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}

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
              className="px-5 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white shadow-lg disabled:opacity-50 transition-colors"
            >
              {loading ? 'Creating...' : 'Create Document'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
