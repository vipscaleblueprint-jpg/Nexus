'use client';

import { useState } from 'react';
import { Space, Folder, Doc, Page, List } from '@/lib/types';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import { EntityType } from '@/components/modals/CreateEntityModal';
import {
  Layers,
  Folder as FolderIcon,
  FileText,
  List as ListIcon,
  Plus,
  Search,
  ChevronRight,
  FileCode,
  Calendar,
  Sparkles,
} from 'lucide-react';

interface WorkspaceDashboardProps {
  activeView: 'all' | 'spaces' | 'folders' | 'docs' | 'lists';
  spaces: Space[];
  loading: boolean;
  onOpenCreate: (type: EntityType, spaceId?: string, folderId?: string, docId?: string) => void;
}

// Helper to recursively collect all folders
function getAllFolders(spaces: Space[]): Folder[] {
  const folders: Folder[] = [];
  function collect(fList: Folder[]) {
    fList.forEach((f) => {
      folders.push(f);
      if (f.subfolders && f.subfolders.length > 0) {
        collect(f.subfolders);
      }
    });
  }
  spaces.forEach((s) => {
    if (s.folders) collect(s.folders);
  });
  return folders;
}

// Helper to collect all docs
function getAllDocs(spaces: Space[]): Doc[] {
  const docs: Doc[] = [];
  function collectFromFolders(fList: Folder[]) {
    fList.forEach((f) => {
      if (f.docs) docs.push(...f.docs);
      if (f.subfolders) collectFromFolders(f.subfolders);
    });
  }
  spaces.forEach((s) => {
    if (s.docs) docs.push(...s.docs);
    if (s.folders) collectFromFolders(s.folders);
  });
  return docs;
}

// Helper to collect all task lists
function getAllLists(spaces: Space[]): List[] {
  const lists: List[] = [];
  function collectFromFolders(fList: Folder[]) {
    fList.forEach((f) => {
      if (f.lists) lists.push(...f.lists);
      if (f.subfolders) collectFromFolders(f.subfolders);
    });
  }
  spaces.forEach((s) => {
    if (s.lists) lists.push(...s.lists);
    if (s.folders) collectFromFolders(s.folders);
  });
  return lists;
}

export function WorkspaceDashboard({
  activeView,
  spaces,
  loading,
  onOpenCreate,
}: WorkspaceDashboardProps) {
  const [searchTerm, setSearchTerm] = useState('');

  if (loading) {
    return <DashboardSkeleton />;
  }

  const allFolders = getAllFolders(spaces);
  const allDocs = getAllDocs(spaces);
  const allLists = getAllLists(spaces);

  // Filter items by search query
  const filteredSpaces = spaces.filter((s) =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const filteredFolders = allFolders.filter((f) =>
    f.name.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const filteredDocs = allDocs.filter((d) =>
    d.title.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const filteredLists = allLists.filter((l) =>
    l.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto font-sans text-zinc-200">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#18181c] p-6 rounded-2xl border border-zinc-800/80 shadow-xl">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <h1 className="text-2xl font-extrabold text-white tracking-tight capitalize">
              {activeView === 'all' ? 'Workspace Overview' : `${activeView} Dashboard`}
            </h1>
          </div>
          <p className="text-xs text-zinc-400">
            Manage, organize, and view your project hierarchy, folders, documents, and lists in real-time.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search workspace..."
              className="pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-700/80 rounded-xl text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 w-48 sm:w-64 transition-colors"
            />
          </div>

          <button
            onClick={() => onOpenCreate('SPACE')}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg flex items-center gap-1.5 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Create Item</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#18181c] border border-zinc-800/80 flex items-center justify-between shadow-md">
          <div>
            <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block">Spaces</span>
            <span className="text-2xl font-black text-indigo-400">{spaces.length}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-950/60 border border-indigo-800/50 flex items-center justify-center text-indigo-400">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#18181c] border border-zinc-800/80 flex items-center justify-between shadow-md">
          <div>
            <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block">Folders</span>
            <span className="text-2xl font-black text-amber-400">{allFolders.length}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-950/60 border border-amber-800/50 flex items-center justify-center text-amber-400">
            <FolderIcon className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#18181c] border border-zinc-800/80 flex items-center justify-between shadow-md">
          <div>
            <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block">Docs & Pages</span>
            <span className="text-2xl font-black text-purple-400">{allDocs.length}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-950/60 border border-purple-800/50 flex items-center justify-center text-purple-400">
            <FileText className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#18181c] border border-zinc-800/80 flex items-center justify-between shadow-md">
          <div>
            <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block">Task Lists</span>
            <span className="text-2xl font-black text-blue-400">{allLists.length}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-950/60 border border-blue-800/50 flex items-center justify-center text-blue-400">
            <ListIcon className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* VIEW SECTION: SPACES */}
      {(activeView === 'all' || activeView === 'spaces') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span>Spaces ({filteredSpaces.length})</span>
            </h2>
            <button
              onClick={() => onOpenCreate('SPACE')}
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Space</span>
            </button>
          </div>

          {filteredSpaces.length === 0 ? (
            <div className="p-8 text-center bg-[#18181c] rounded-xl border border-zinc-800/80 space-y-3">
              <p className="text-xs text-zinc-400">No spaces found.</p>
              <button
                onClick={() => onOpenCreate('SPACE')}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold shadow"
              >
                Create First Space
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSpaces.map((space) => (
                <div
                  key={space.id}
                  className="p-5 rounded-2xl bg-[#18181c] border border-zinc-800/80 hover:border-zinc-700/80 shadow-lg space-y-4 transition-all hover:scale-[1.01]"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0 shadow"
                        style={{ backgroundColor: space.color || '#4F46E5' }}
                      />
                      <h3 className="text-sm font-bold text-white truncate">{space.name}</h3>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                      SPACE
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 py-2 bg-zinc-900/60 rounded-xl border border-zinc-800/60 text-center text-xs">
                    <div>
                      <span className="block text-[10px] text-zinc-500 uppercase font-bold">Folders</span>
                      <span className="font-bold text-amber-400">{space.folders?.length || 0}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-zinc-500 uppercase font-bold">Lists</span>
                      <span className="font-bold text-blue-400">{space.lists?.length || 0}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-zinc-500 uppercase font-bold">Docs</span>
                      <span className="font-bold text-purple-400">{space.docs?.length || 0}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      onClick={() => onOpenCreate('FOLDER', space.id)}
                      className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-amber-300 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Folder</span>
                    </button>
                    <button
                      onClick={() => onOpenCreate('DOC', space.id)}
                      className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-purple-300 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Doc</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW SECTION: FOLDERS */}
      {(activeView === 'all' || activeView === 'folders') && (
        <div className="space-y-3 pt-4 border-t border-zinc-800/60">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FolderIcon className="w-4 h-4 text-amber-400" />
              <span>Folders ({filteredFolders.length})</span>
            </h2>
            <button
              onClick={() => onOpenCreate('FOLDER')}
              className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Folder</span>
            </button>
          </div>

          {filteredFolders.length === 0 ? (
            <div className="p-8 text-center bg-[#18181c] rounded-xl border border-zinc-800/80 space-y-3">
              <p className="text-xs text-zinc-400">No folders created yet.</p>
              <button
                onClick={() => onOpenCreate('FOLDER')}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold shadow"
              >
                Create Folder
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredFolders.map((folder) => (
                <div
                  key={folder.id}
                  className="p-5 rounded-2xl bg-[#18181c] border border-zinc-800/80 hover:border-zinc-700/80 shadow-lg space-y-3 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <FolderIcon className="w-4 h-4 text-amber-400 shrink-0" />
                      <h3 className="text-sm font-bold text-white truncate">{folder.name}</h3>
                    </div>
                    <span className="text-[10px] font-mono text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40">
                      FOLDER
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-zinc-400 pt-1">
                    <span>Nested Subfolders: <strong className="text-zinc-200">{folder.subfolders?.length || 0}</strong></span>
                    <span>Docs: <strong className="text-zinc-200">{folder.docs?.length || 0}</strong></span>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800/60">
                    <button
                      onClick={() => onOpenCreate('DOC', undefined, folder.id)}
                      className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-purple-300 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Doc</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW SECTION: DOCS & PAGES */}
      {(activeView === 'all' || activeView === 'docs') && (
        <div className="space-y-3 pt-4 border-t border-zinc-800/60">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple-400" />
              <span>Documents & Pages ({filteredDocs.length})</span>
            </h2>
            <button
              onClick={() => onOpenCreate('DOC')}
              className="text-xs font-semibold text-purple-400 hover:text-purple-300 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Document</span>
            </button>
          </div>

          {filteredDocs.length === 0 ? (
            <div className="p-8 text-center bg-[#18181c] rounded-xl border border-zinc-800/80 space-y-3">
              <p className="text-xs text-zinc-400">No documents created yet.</p>
              <button
                onClick={() => onOpenCreate('DOC')}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold shadow"
              >
                Create Document
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="p-5 rounded-2xl bg-[#18181c] border border-zinc-800/80 hover:border-zinc-700/80 shadow-lg space-y-3 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <FileText className="w-4 h-4 text-purple-400 shrink-0" />
                      <h3 className="text-sm font-bold text-white truncate">{doc.title}</h3>
                    </div>
                    <span className="text-[10px] font-mono text-purple-400 bg-purple-950/40 px-2 py-0.5 rounded border border-purple-800/40">
                      DOC CONTAINER
                    </span>
                  </div>

                  {/* Pages list inside document container */}
                  <div className="space-y-1.5 bg-zinc-900/60 p-3 rounded-xl border border-zinc-800/60">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">
                      Pages ({doc.pages?.length || 0})
                    </span>

                    {(!doc.pages || doc.pages.length === 0) ? (
                      <p className="text-[11px] text-zinc-500 italic">No pages inside doc yet.</p>
                    ) : (
                      doc.pages.map((page) => (
                        <div key={page.id} className="flex items-center justify-between text-xs text-zinc-300 py-0.5">
                          <span className="flex items-center gap-1.5 truncate">
                            <FileCode className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span className="truncate text-[11px]">{page.title}</span>
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      onClick={() => onOpenCreate('PAGE', undefined, undefined, doc.id)}
                      className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-emerald-300 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Page</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW SECTION: TASK LISTS */}
      {(activeView === 'all' || activeView === 'lists') && (
        <div className="space-y-3 pt-4 border-t border-zinc-800/60">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <ListIcon className="w-4 h-4 text-blue-400" />
              <span>Task Lists ({filteredLists.length})</span>
            </h2>
            <button
              onClick={() => onOpenCreate('LIST')}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Task List</span>
            </button>
          </div>

          {filteredLists.length === 0 ? (
            <div className="p-8 text-center bg-[#18181c] rounded-xl border border-zinc-800/80 space-y-3">
              <p className="text-xs text-zinc-400">No task lists created yet.</p>
              <button
                onClick={() => onOpenCreate('LIST')}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold shadow"
              >
                Create Task List
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredLists.map((list) => (
                <div
                  key={list.id}
                  className="p-5 rounded-2xl bg-[#18181c] border border-zinc-800/80 hover:border-zinc-700/80 shadow-lg space-y-3 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <ListIcon className="w-4 h-4 text-blue-400 shrink-0" />
                      <h3 className="text-sm font-bold text-white truncate">{list.name}</h3>
                    </div>
                    <span className="text-[10px] font-mono text-blue-400 bg-blue-950/40 px-2 py-0.5 rounded border border-blue-800/40">
                      TASK LIST
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
