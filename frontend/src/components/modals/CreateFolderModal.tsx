'use client';

import { useState, useEffect } from 'react';
import { spacesApi } from '@/api';
import { Space, Folder } from '@/lib/types';
import { X, Folder as FolderIcon } from 'lucide-react';

interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  spaces?: Space[];
  defaultSpaceId?: string;
  defaultParentFolderId?: string;
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

export function CreateFolderModal({
  isOpen,
  onClose,
  onSuccess,
  spaces = [],
  defaultSpaceId,
  defaultParentFolderId,
}: CreateFolderModalProps) {
  const [name, setName] = useState('');
  const [spaceId, setSpaceId] = useState<string>(defaultSpaceId || '');
  const [parentFolderId, setParentFolderId] = useState<string>(defaultParentFolderId || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allFolders = getAllFolders(spaces);

  useEffect(() => {
    if (defaultSpaceId) setSpaceId(defaultSpaceId);
    if (defaultParentFolderId) setParentFolderId(defaultParentFolderId);
    setName('');
    setError(null);
  }, [isOpen, defaultSpaceId, defaultParentFolderId]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter a folder name.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      await spacesApi.createFolder({
        name: name.trim(),
        spaceId: spaceId || undefined,
        parentFolderId: parentFolderId || undefined,
      });
      setLoading(false);
      setName('');
      onSuccess();
      onClose();
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Failed to create folder');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-sans">
      <div className="w-full max-w-md bg-[#18181c] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-zinc-200">
        <div className="px-5 py-4 border-b border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-400">
            <FolderIcon className="w-5 h-5" />
            <h3 className="text-base font-bold text-white">Create Folder</h3>
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
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Folder Name</label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 Projects, Design Assets..."
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700/80 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          {/* Space Selector */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Space Parent (Optional)</label>
            <select
              value={spaceId}
              onChange={(e) => {
                setSpaceId(e.target.value);
                setParentFolderId(''); // Clear folder parent if space changes
              }}
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700/80 rounded-xl text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
            >
              <option value="">-- No Space / Root Workspace --</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Parent Folder Selector */}
          {allFolders.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Parent Folder (Optional)</label>
              <select
                value={parentFolderId}
                onChange={(e) => {
                  setParentFolderId(e.target.value);
                  if (e.target.value) setSpaceId(''); // Clear space if parent folder selected
                }}
                className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700/80 rounded-xl text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
              >
                <option value="">-- No Parent Folder (Root Level) --</option>
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
              className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg disabled:opacity-50 transition-colors"
            >
              {loading ? 'Creating...' : 'Create Folder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
