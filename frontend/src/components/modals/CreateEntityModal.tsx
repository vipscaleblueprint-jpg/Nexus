'use client';

import { useState, useEffect } from 'react';
import { spacesApi } from '@/api';
import { Space, Folder, Doc } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { X, Layers, Folder as FolderIcon, List as ListIcon, FileText, FileCode, Plus } from 'lucide-react';

export type EntityType = 'SPACE' | 'FOLDER' | 'LIST' | 'DOC' | 'PAGE';

interface CreateEntityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialType?: EntityType;
  spaces?: Space[];
  targetSpaceId?: string;
  targetFolderId?: string;
  targetDocId?: string;
}

export function CreateEntityModal({
  isOpen,
  onClose,
  onSuccess,
  initialType = 'SPACE',
  spaces = [],
  targetSpaceId,
  targetFolderId,
  targetDocId,
}: CreateEntityModalProps) {
  const { currentUser } = useAppStore();
  const [type, setType] = useState<EntityType>(initialType);
  const [title, setTitle] = useState('');
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(targetSpaceId || '');
  const [selectedFolderId, setSelectedFolderId] = useState<string>(targetFolderId || '');
  const [selectedDocId, setSelectedDocId] = useState<string>(targetDocId || '');
  const [color, setColor] = useState('#4F46E5');
  const [icon, setIcon] = useState('rocket');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setType(initialType);
    if (targetSpaceId) setSelectedSpaceId(targetSpaceId);
    if (targetFolderId) setSelectedFolderId(targetFolderId);
    if (targetDocId) setSelectedDocId(targetDocId);
    setTitle('');
    setError(null);
  }, [isOpen, initialType, targetSpaceId, targetFolderId, targetDocId]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Please provide a title or name.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      if (type === 'SPACE') {
        await spacesApi.createSpace({
          name: title.trim(),
          color,
          icon,
          ownerId: currentUser?.id || 'admin',
        });
      } else if (type === 'FOLDER') {
        await spacesApi.createFolder({
          name: title.trim(),
          spaceId: selectedSpaceId || undefined,
          parentFolderId: selectedFolderId || undefined,
        });
      } else if (type === 'LIST') {
        await spacesApi.createList({
          name: title.trim(),
          spaceId: selectedSpaceId || undefined,
          folderId: selectedFolderId || undefined,
        });
      } else if (type === 'DOC') {
        await spacesApi.createDoc({
          title: title.trim(),
          spaceId: selectedSpaceId || undefined,
          folderId: selectedFolderId || undefined,
        });
      } else if (type === 'PAGE') {
        if (!selectedDocId) {
          setError('Please select a target Document to add this page into.');
          setLoading(false);
          return;
        }
        await spacesApi.createPage({
          title: title.trim(),
          docId: selectedDocId,
        });
      }

      setLoading(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Failed to create item');
    }
  }

  // Collect all docs across spaces for page creation dropdown
  const allDocs: Doc[] = [];
  spaces.forEach((s) => {
    if (s.docs) allDocs.push(...s.docs);
    s.folders?.forEach((f) => {
      if (f.docs) allDocs.push(...f.docs);
    });
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-sans">
      <div className="w-full max-w-md bg-[#18181c] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden text-zinc-200">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-white">Create New Item</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Entity Type Selector */}
        <div className="flex border-b border-zinc-800 bg-zinc-900/60 p-1 text-xs">
          <button
            type="button"
            onClick={() => setType('SPACE')}
            className={`flex-1 py-2 rounded font-medium flex items-center justify-center gap-1.5 transition-colors ${
              type === 'SPACE' ? 'bg-zinc-800 text-indigo-400 font-bold shadow' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Space</span>
          </button>
          <button
            type="button"
            onClick={() => setType('FOLDER')}
            className={`flex-1 py-2 rounded font-medium flex items-center justify-center gap-1.5 transition-colors ${
              type === 'FOLDER' ? 'bg-zinc-800 text-amber-400 font-bold shadow' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FolderIcon className="w-3.5 h-3.5" />
            <span>Folder</span>
          </button>
          <button
            type="button"
            onClick={() => setType('LIST')}
            className={`flex-1 py-2 rounded font-medium flex items-center justify-center gap-1.5 transition-colors ${
              type === 'LIST' ? 'bg-zinc-800 text-blue-400 font-bold shadow' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ListIcon className="w-3.5 h-3.5" />
            <span>List</span>
          </button>
          <button
            type="button"
            onClick={() => setType('DOC')}
            className={`flex-1 py-2 rounded font-medium flex items-center justify-center gap-1.5 transition-colors ${
              type === 'DOC' ? 'bg-zinc-800 text-purple-400 font-bold shadow' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Doc</span>
          </button>
          <button
            type="button"
            onClick={() => setType('PAGE')}
            className={`flex-1 py-2 rounded font-medium flex items-center justify-center gap-1.5 transition-colors ${
              type === 'PAGE' ? 'bg-zinc-800 text-emerald-400 font-bold shadow' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Page</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 text-xs bg-red-950/60 border border-red-800 text-red-300 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
              {type === 'SPACE' ? 'Space Name' : type === 'FOLDER' ? 'Folder Name' : type === 'LIST' ? 'List Name' : type === 'DOC' ? 'Document Title' : 'Page Title'}
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Enter ${type.toLowerCase()} name...`}
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700/80 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Additional Options for Space */}
          {type === 'SPACE' && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Theme Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-9 h-9 bg-zinc-900 border border-zinc-700 rounded cursor-pointer"
                  />
                  <span className="text-xs font-mono text-zinc-400">{color}</span>
                </div>
              </div>
            </div>
          )}

          {/* Parent Selection for Folder, List, Doc */}
          {(type === 'FOLDER' || type === 'LIST' || type === 'DOC') && spaces.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Assign to Space</label>
              <select
                value={selectedSpaceId}
                onChange={(e) => setSelectedSpaceId(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="">-- Select Space --</option>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Target Doc Selection for Page */}
          {type === 'PAGE' && (
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">Belongs to Document</label>
              <select
                value={selectedDocId}
                onChange={(e) => setSelectedDocId(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="">-- Select Document --</option>
                {allDocs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md disabled:opacity-50 transition-colors"
            >
              {loading ? 'Creating...' : `Create ${type}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
