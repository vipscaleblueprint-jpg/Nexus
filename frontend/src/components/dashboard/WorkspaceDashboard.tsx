'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  List as ListIcon,
  FileText,
  Folder as FolderIcon,
  Rocket,
  Plus,
  Search,
  CheckSquare,
  Layers,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { Space, Folder, List, Doc } from '@/lib/types';
import { EntityType } from '@/components/modals/CreateEntityModal';
import {
  ListSkeleton,
  DocSkeleton,
  DashboardSkeleton,
  CardSkeleton,
} from '@/components/ui/Skeleton';

export interface WorkspaceDashboardProps {
  activeView?: 'all' | 'spaces' | 'lists' | 'docs';
  spaces: Space[];
  loading: boolean;
  onOpenCreate: (type: EntityType, spaceId?: string, folderId?: string, docId?: string) => void;
}

function collectAllLists(spaces: Space[]): { list: List; spaceName?: string; folderName?: string }[] {
  const result: { list: List; spaceName?: string; folderName?: string }[] = [];

  function processFolders(folders: Folder[], spaceName?: string, parentFolderName?: string) {
    folders.forEach((f) => {
      const currentFolderName = parentFolderName ? `${parentFolderName} / ${f.name}` : f.name;
      if (f.lists) {
        f.lists.forEach((l) => result.push({ list: l, spaceName, folderName: currentFolderName }));
      }
      if (f.subfolders) {
        processFolders(f.subfolders, spaceName, currentFolderName);
      }
    });
  }

  spaces.forEach((s) => {
    if (s.lists) {
      s.lists.forEach((l) => result.push({ list: l, spaceName: s.name }));
    }
    if (s.folders) {
      processFolders(s.folders, s.name);
    }
  });

  return result;
}

function collectAllDocs(spaces: Space[]): { doc: Doc; spaceName?: string; folderName?: string }[] {
  const result: { doc: Doc; spaceName?: string; folderName?: string }[] = [];

  function processFolders(folders: Folder[], spaceName?: string, parentFolderName?: string) {
    folders.forEach((f) => {
      const currentFolderName = parentFolderName ? `${parentFolderName} / ${f.name}` : f.name;
      if (f.docs) {
        f.docs.forEach((d) => result.push({ doc: d, spaceName, folderName: currentFolderName }));
      }
      if (f.subfolders) {
        processFolders(f.subfolders, spaceName, currentFolderName);
      }
    });
  }

  spaces.forEach((s) => {
    if (s.docs) {
      s.docs.forEach((d) => result.push({ doc: d, spaceName: s.name }));
    }
    if (s.folders) {
      processFolders(s.folders, s.name);
    }
  });

  return result;
}

export function WorkspaceDashboard({
  activeView = 'all',
  spaces = [],
  loading = false,
  onOpenCreate,
}: WorkspaceDashboardProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentTab, setCurrentTab] = useState<'all' | 'spaces' | 'lists' | 'docs'>(activeView);

  if (loading) {
    if (currentTab === 'lists') return <ListSkeleton />;
    if (currentTab === 'docs') return <DocSkeleton />;
    return <DashboardSkeleton />;
  }

  const allLists = collectAllLists(spaces);
  const allDocs = collectAllDocs(spaces);

  const filteredLists = allLists.filter((item) =>
    item.list.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredDocs = allDocs.filter((item) =>
    item.doc.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredSpaces = spaces.filter((s) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header & Quick Action */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <h1 className="text-2xl font-bold text-zinc-100">Workspace Dashboard</h1>
          </div>
          <p className="text-xs text-zinc-400">
            Manage your spaces, task lists, and collaborative documentation in one place.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onOpenCreate('LIST')}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-colors"
          >
            <Plus className="w-4 h-4" />
            New List
          </button>

          <button
            onClick={() => onOpenCreate('DOC')}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Doc
          </button>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-1 bg-zinc-900/80 p-1 rounded-lg border border-zinc-800">
          {(['all', 'spaces', 'lists', 'docs'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setCurrentTab(tab)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors ${
                currentTab === tab
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="relative flex-1 sm:max-w-xs">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search lists, docs, or spaces..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-zinc-900/80 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
      </div>

      {/* Lists Section */}
      {(currentTab === 'all' || currentTab === 'lists') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListIcon className="w-4 h-4 text-blue-400" />
              <h2 className="text-base font-semibold text-zinc-200">Lists ({filteredLists.length})</h2>
            </div>
            <button
              onClick={() => onOpenCreate('LIST')}
              className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Create List
            </button>
          </div>

          {filteredLists.length === 0 ? (
            <div className="p-8 rounded-xl bg-[#18181c] border border-zinc-800/80 text-center space-y-2">
              <CheckSquare className="w-8 h-8 text-zinc-600 mx-auto opacity-50" />
              <p className="text-xs font-medium text-zinc-400">No task lists found</p>
              <p className="text-[11px] text-zinc-600">Create a list to organize your team tasks and board views.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredLists.map(({ list, spaceName, folderName }) => (
                <Link
                  key={list.id}
                  href={`/lists/${list.id}`}
                  className="group p-4 rounded-xl bg-[#18181c] border border-zinc-800/80 hover:border-blue-500/50 transition-all shadow-md flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-blue-500/15 text-blue-400">
                          <ListIcon className="w-4 h-4" />
                        </div>
                        <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-blue-400 transition-colors">
                          {list.name}
                        </h3>
                      </div>
                      <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
                    </div>

                    <p className="text-[11px] text-zinc-500 truncate">
                      {[spaceName, folderName].filter(Boolean).join(' / ') || 'Workspace List'}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-400">
                    <span>{list.tasks?.length ?? 0} tasks</span>
                    <span className="text-blue-400 group-hover:underline">Open Board →</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Docs Section */}
      {(currentTab === 'all' || currentTab === 'docs') && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple-400" />
              <h2 className="text-base font-semibold text-zinc-200">Docs ({filteredDocs.length})</h2>
            </div>
            <button
              onClick={() => onOpenCreate('DOC')}
              className="text-xs text-purple-400 hover:text-purple-300 font-medium flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Doc
            </button>
          </div>

          {filteredDocs.length === 0 ? (
            <div className="p-8 rounded-xl bg-[#18181c] border border-zinc-800/80 text-center space-y-2">
              <FileText className="w-8 h-8 text-zinc-600 mx-auto opacity-50" />
              <p className="text-xs font-medium text-zinc-400">No documents found</p>
              <p className="text-[11px] text-zinc-600">Create a doc to collaborate on specs, notes, and wiki pages.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocs.map(({ doc, spaceName, folderName }) => (
                <Link
                  key={doc.id}
                  href={`/docs/${doc.id}`}
                  className="group p-4 rounded-xl bg-[#18181c] border border-zinc-800/80 hover:border-purple-500/50 transition-all shadow-md flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-lg bg-purple-500/15 text-purple-400">
                          <FileText className="w-4 h-4" />
                        </div>
                        <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-purple-400 transition-colors">
                          {doc.title}
                        </h3>
                      </div>
                      <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
                    </div>

                    <p className="text-[11px] text-zinc-500 truncate">
                      {[spaceName, folderName].filter(Boolean).join(' / ') || 'Workspace Doc'}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-400">
                    <span>{doc.pages?.length ?? 0} pages</span>
                    <span className="text-purple-400 group-hover:underline">View Document →</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Spaces Overview */}
      {(currentTab === 'all' || currentTab === 'spaces') && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              <h2 className="text-base font-semibold text-zinc-200">Spaces ({filteredSpaces.length})</h2>
            </div>
            <button
              onClick={() => onOpenCreate('SPACE')}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Space
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSpaces.map((space) => (
              <div
                key={space.id}
                className="p-4 rounded-xl bg-[#18181c] border border-zinc-800/80 space-y-3 shadow-md"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-xs"
                      style={{ backgroundColor: space.color || '#6366F1' }}
                    >
                      {space.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-200">{space.name}</h3>
                      <p className="text-[10px] text-zinc-500">
                        {space.folders?.length ?? 0} folders · {space.lists?.length ?? 0} lists
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
