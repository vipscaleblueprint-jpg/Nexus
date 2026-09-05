'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { InviteModal } from '@/components/modals/InviteModal';
import { CreateSpaceModal } from '@/components/modals/CreateSpaceModal';
import { CreateFolderModal } from '@/components/modals/CreateFolderModal';
import { CreateListModal } from '@/components/modals/CreateListModal';
import { CreateDocModal } from '@/components/modals/CreateDocModal';
import { CreatePageModal } from '@/components/modals/CreatePageModal';
import { ConfirmDeleteModal } from '@/components/modals/ConfirmDeleteModal';
import { RenameModal } from '@/components/modals/RenameModal';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Space, Folder, Doc, Page, List, User } from '@/lib/types';
import { spacesApi, usersApi } from '@/api';
import { useAppStore } from '@/lib/store';
import {
  Home,
  Users,
  Settings,
  KeyRound,
  UserPlus,
  LucideIcon,
  Folder as FolderIcon,
  FileText,
  List as ListIcon,
  ChevronDown,
  ChevronRight,
  Layers,
  Plus,
  Activity,
  CheckSquare,
  Sparkles,
  Hash,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
} from 'lucide-react';

interface SidebarProps {
  spaces?: Space[];
  userRoster?: User[];
}

interface PanelItem {
  href: string;
  label: string;
  Icon: LucideIcon;
}

interface Section {
  id: string;
  label: string;
  Icon: LucideIcon;
  href: string;
  items: PanelItem[];
}

const SECTIONS: Section[] = [
  {
    id: 'home',
    label: 'Home',
    Icon: Home,
    href: '/',
    items: [{ href: '/', label: 'Home Dashboard', Icon: Home }],
  },
  {
    id: 'spaces',
    label: 'Spaces',
    Icon: Layers,
    href: '/spaces',
    items: [{ href: '/spaces', label: 'All Spaces', Icon: Layers }],
  },
  {
    id: 'folders',
    label: 'Folders',
    Icon: FolderIcon,
    href: '/folders',
    items: [{ href: '/folders', label: 'All Folders', Icon: FolderIcon }],
  },
  {
    id: 'docs',
    label: 'Docs',
    Icon: FileText,
    href: '/docs',
    items: [{ href: '/docs', label: 'All Documents', Icon: FileText }],
  },
  {
    id: 'lists',
    label: 'Lists',
    Icon: ListIcon,
    href: '/lists',
    items: [{ href: '/lists', label: 'All Task Lists', Icon: ListIcon }],
  },
  {
    id: 'directory',
    label: 'Directory',
    Icon: Users,
    href: '/team',
    items: [{ href: '/team', label: 'Member Directory', Icon: Users }],
  },
  {
    id: 'account',
    label: 'Account',
    Icon: Settings,
    href: '/settings',
    items: [{ href: '/settings', label: 'Account Settings', Icon: KeyRound }],
  },
];

// Helper to recursively collect all folders across spaces
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

// Helper to collect all docs across spaces & folders
function getAllDocs(spaces: Space[]): Doc[] {
  const seen = new Set<string>();
  const docs: Doc[] = [];
  function collectFromFolders(fList: Folder[]) {
    fList.forEach((f) => {
      if (f.docs) f.docs.forEach((d) => { if (!seen.has(d.id)) { seen.add(d.id); docs.push(d); } });
      if (f.subfolders) collectFromFolders(f.subfolders);
    });
  }
  spaces.forEach((s) => {
    if (s.docs) s.docs.forEach((d) => { if (!seen.has(d.id)) { seen.add(d.id); docs.push(d); } });
    if (s.folders) collectFromFolders(s.folders);
  });
  return docs;
}

// Helper to collect all task lists across spaces & folders
function getAllLists(spaces: Space[]): List[] {
  const seen = new Set<string>();
  const lists: List[] = [];
  function collectFromFolders(fList: Folder[]) {
    fList.forEach((f) => {
      if (f.lists) f.lists.forEach((l) => { if (!seen.has(l.id)) { seen.add(l.id); lists.push(l); } });
      if (f.subfolders) collectFromFolders(f.subfolders);
    });
  }
  spaces.forEach((s) => {
    if (s.lists) s.lists.forEach((l) => { if (!seen.has(l.id)) { seen.add(l.id); lists.push(l); } });
    if (s.folders) collectFromFolders(s.folders);
  });
  return lists;
}

export function Sidebar({ spaces: initialSpaces = [], userRoster = [] }: SidebarProps) {
  const pathname = usePathname();
  const { currentUser, spaces: globalSpaces, loadSpaces: globalLoadSpaces } = useAppStore();
  
  // We can just use globalSpaces instead of syncing local state.
  // But to not break the rest of the component, we'll assign it to spaces.
  const spaces = globalSpaces.length > 0 ? globalSpaces : initialSpaces;
  
  const [users, setUsers] = useState<User[]>(userRoster);
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  // Individual Modals State
  const [isCreateSpaceOpen, setIsCreateSpaceOpen] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [isCreateListOpen, setIsCreateListOpen] = useState(false);
  const [isCreateDocOpen, setIsCreateDocOpen] = useState(false);
  const [isCreatePageOpen, setIsCreatePageOpen] = useState(false);

  const [activeSpaceId, setActiveSpaceId] = useState<string | undefined>();
  const [activeFolderId, setActiveFolderId] = useState<string | undefined>();
  const [activeDocId, setActiveDocId] = useState<string | undefined>();

  // Global Action State
  const [actionEntity, setActionEntity] = useState<{
    type: 'space' | 'folder' | 'doc' | 'page' | 'list';
    id: string;
    name: string;
  } | null>(null);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  useEffect(() => {
    if (userRoster && userRoster.length > 0) {
      setUsers(userRoster);
    }
  }, [userRoster]);

  // Fetch users only once on mount if empty
  useEffect(() => {
    let isSubscribed = true;

    if (userRoster.length === 0) {
      usersApi
        .getUsers()
        .then((res) => {
          if (isSubscribed && res.users) setUsers(res.users);
        })
        .catch((err) => console.warn('Failed to load users in Sidebar:', err));
    }

    return () => {
      isSubscribed = false;
    };
  }, []);

  const loadSpaces = async () => {
    await globalLoadSpaces();
  };

  const handleAction = async (action: 'rename' | 'duplicate' | 'delete', type: 'space' | 'folder' | 'doc' | 'page' | 'list', id: string, name: string) => {
    if (action === 'rename') {
      setActionEntity({ type, id, name });
      setIsRenameOpen(true);
    } else if (action === 'delete') {
      setActionEntity({ type, id, name });
      setIsDeleteOpen(true);
    } else if (action === 'duplicate') {
      try {
        if (type === 'space') await spacesApi.duplicateSpace(id);
        else if (type === 'folder') await spacesApi.duplicateFolder(id);
        else if (type === 'doc') await spacesApi.duplicateDoc(id);
        else if (type === 'page') await spacesApi.duplicatePage(id);
        else if (type === 'list') await spacesApi.duplicateList(id);
        loadSpaces();
      } catch (err) {
        console.error('Failed to duplicate:', err);
      }
    }
  };

  const handleConfirmRename = async (newName: string) => {
    if (!actionEntity) return;
    const { type, id } = actionEntity;
    if (type === 'space') await spacesApi.updateSpace(id, { name: newName });
    else if (type === 'folder') await spacesApi.updateFolder(id, { name: newName });
    else if (type === 'doc') await spacesApi.updateDoc(id, { title: newName });
    else if (type === 'page') await spacesApi.updatePage(id, { title: newName });
    else if (type === 'list') await spacesApi.updateList(id, { name: newName });
    loadSpaces();
  };

  const handleConfirmDelete = async () => {
    if (!actionEntity) return;
    const { type, id } = actionEntity;
    if (type === 'space') await spacesApi.deleteSpace(id);
    else if (type === 'folder') await spacesApi.deleteFolder(id);
    else if (type === 'doc') await spacesApi.deleteDoc(id);
    else if (type === 'page') await spacesApi.deletePage(id);
    else if (type === 'list') await spacesApi.deleteList(id);
    loadSpaces();
  };

  const activeSection =
    SECTIONS.find((s) => s.href === pathname || s.items.some((i) => i.href === pathname)) ?? SECTIONS[0];

  const allFolders = getAllFolders(spaces);
  const allDocs = getAllDocs(spaces);
  const allLists = getAllLists(spaces);

  return (
    <div className="flex h-screen shrink-0 z-20 font-sans">
      {/* Main Navigation Rail (Primary Nav) */}
      <nav
        aria-label="Primary Main Navigation"
        className="w-16 h-full bg-[#0f0f11] border-r border-zinc-800/60 flex flex-col items-center py-3 gap-1 select-none"
      >
        <div className="w-9 h-9 mb-2 rounded-lg bg-zinc-200 text-zinc-950 font-extrabold flex items-center justify-center text-sm shadow-md shrink-0">
          ⚡
        </div>

        {SECTIONS.map(({ id, label, Icon, href }) => {
          const isActive = activeSection.id === id;
          return (
            <Link
              key={id}
              href={href}
              aria-current={isActive ? 'page' : undefined}
              title={label}
              className={`w-12 py-2 rounded-lg flex flex-col items-center gap-1 transition-colors ${
                isActive
                  ? 'bg-zinc-800 text-white font-semibold shadow'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[9px] font-medium leading-none">{label}</span>
            </Link>
          );
        })}

        <button
          onClick={() => setIsInviteOpen(true)}
          title="Invite"
          className="mt-auto w-12 py-2 rounded-lg flex flex-col items-center gap-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          <span className="text-[9px] font-medium leading-none">Invite</span>
        </button>
      </nav>

      {/* Sub-Sidebar Panel (Permanently Expanded / Non-Collapsible) */}
      <aside className="w-64 h-full bg-[#161619] border-r border-zinc-800/60 text-zinc-300 flex flex-col select-none shadow-2xl">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-tight text-zinc-100 flex items-center gap-2 cursor-pointer">
            <span>{activeSection.label}</span>
          </h2>

          <button
            onClick={() => setIsCreateSpaceOpen(true)}
            className="p-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center gap-0.5 text-xs font-semibold px-2 transition-colors border border-zinc-700/60"
            title="Create New Item"
          >
            <Plus className="w-3.5 h-3.5" />
            <ChevronDown className="w-3 h-3 text-zinc-400" />
          </button>
        </div>

        <div className="p-3 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* 1. HOME SECTION (OPTIMIZED CLICKUP / SLACK LAYOUT) */}
          {activeSection.id === 'home' && (
            <div className="space-y-4 text-xs font-sans">
              {/* Top Navigation Items: Activity & My Tasks ONLY */}
              <div className="space-y-0.5">
                <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-zinc-900 text-zinc-200 font-semibold cursor-pointer transition-colors">
                  <div className="flex items-center gap-2 cursor-pointer">
                    <Activity className="w-4 h-4 text-zinc-400" />
                    <span>Activity</span>
                  </div>
                  <span className="bg-[#ec4899] text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full shadow">
                    99+
                  </span>
                </div>

                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors">
                  <CheckSquare className="w-4 h-4 text-zinc-400" />
                  <span>My Tasks</span>
                </div>
              </div>

              {/* Spaces Section (DYNAMIC DB SPACES) */}
              <div className="border-t border-zinc-800/80 pt-3 space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                    Spaces
                  </span>
                  <button
                    onClick={() => setIsCreateSpaceOpen(true)}
                    className="p-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                    title="Create Space"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <Link href="/lists" className="flex items-center gap-2 px-2 py-1 text-zinc-300 font-medium hover:bg-zinc-900 rounded-lg cursor-pointer transition-colors">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate">All Tasks</span>
                  <span className="text-[10px] text-zinc-500 font-mono ml-auto truncate">
                    {spaces.length > 0 ? `- ${spaces[0].name}` : ''}
                  </span>
                </Link>

                <div className="space-y-1">
                  {spaces.map((space) => (
                    <SpaceTreeItem
                      key={space.id}
                      space={space}
                      onAddFolder={(sId, fId) => {
                        setActiveSpaceId(sId);
                        setActiveFolderId(fId);
                        setIsCreateFolderOpen(true);
                      }}
                      onAddDoc={(sId, fId) => {
                        setActiveSpaceId(sId);
                        setActiveFolderId(fId);
                        setIsCreateDocOpen(true);
                      }}
                      onAddPage={(dId) => {
                        setActiveDocId(dId);
                        setIsCreatePageOpen(true);
                      }}
                      onAddList={(sId, fId) => {
                        setActiveSpaceId(sId);
                        setActiveFolderId(fId);
                        setIsCreateListOpen(true);
                      }}
                      onAction={handleAction}
                    />
                  ))}

                  <button
                    onClick={() => setIsCreateSpaceOpen(true)}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-zinc-400 hover:text-white hover:bg-zinc-900 rounded-lg transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 text-zinc-500" />
                    <span>New Space</span>
                  </button>
                </div>
              </div>

              {/* Direct Messages Section (DYNAMIC DB USERS - MAX 3 ITEMS) */}
              <div className="border-t border-zinc-800/80 pt-3 space-y-1.5">
                <div className="px-1 text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                  Direct Messages ({users.slice(0, 3).length})
                </div>

                <div className="space-y-1">
                  {users.length === 0 ? (
                    <p className="text-zinc-500 text-[11px] px-1 italic">No users found in database.</p>
                  ) : (
                    users.slice(0, 3).map((u) => {
                      const isSelf = u.id === currentUser?.id;
                      const initial = u.name ? u.name.charAt(0).toUpperCase() : 'U';

                      return (
                        <div
                          key={u.id}
                          className="flex items-center gap-2 px-2 py-1 text-zinc-300 hover:bg-zinc-900 rounded-lg cursor-pointer"
                        >
                          <div className="relative shrink-0">
                            {u.avatarUrl || (u as any).imageUrl ? (
                              <img
                                src={u.avatarUrl || (u as any).imageUrl}
                                alt={u.name}
                                className="w-5 h-5 rounded-full object-cover shadow"
                              />
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-[10px] shadow">
                                {initial}
                              </div>
                            )}
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 absolute -bottom-0.5 -right-0.5 ring-2 ring-[#161619]" />
                          </div>
                          <span className="truncate text-xs">
                            {u.name} {isSelf ? '— You' : ''}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 2. SPACES NAVIGATION */}
          {activeSection.id === 'spaces' && (
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-indigo-400 px-1 uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  <span>All Spaces ({spaces.length})</span>
                </span>
                <button
                  onClick={() => setIsCreateSpaceOpen(true)}
                  title="Create Space"
                  className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {spaces.length === 0 ? (
                <p className="text-zinc-500 text-[11px] px-1 italic">No spaces created yet.</p>
              ) : (
                <div className="space-y-1">
                  {spaces.map((space) => (
                    <SpaceTreeItem
                      key={space.id}
                      space={space}
                      onAddFolder={(sId, fId) => {
                        setActiveSpaceId(sId);
                        setActiveFolderId(fId);
                        setIsCreateFolderOpen(true);
                      }}
                      onAddDoc={(sId, fId) => {
                        setActiveSpaceId(sId);
                        setActiveFolderId(fId);
                        setIsCreateDocOpen(true);
                      }}
                      onAddPage={(dId) => {
                        setActiveDocId(dId);
                        setIsCreatePageOpen(true);
                      }}
                      onAddList={(sId, fId) => {
                        setActiveSpaceId(sId);
                        setActiveFolderId(fId);
                        setIsCreateListOpen(true);
                      }}
                      onAction={handleAction}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 3. FOLDERS NAVIGATION */}
          {activeSection.id === 'folders' && (
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-amber-400 px-1 uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <FolderIcon className="w-3.5 h-3.5" />
                  <span>All Folders ({allFolders.length})</span>
                </span>
                <button
                  onClick={() => setIsCreateFolderOpen(true)}
                  title="Create Folder"
                  className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {allFolders.length === 0 ? (
                <p className="text-zinc-500 text-[11px] px-1 italic">No folders created yet.</p>
              ) : (
                <div className="space-y-1">
                  {allFolders.map((folder) => (
                    <FolderTreeItem
                      key={folder.id}
                      folder={folder}
                      spaceId={folder.spaceId || ''}
                      onAddFolder={(sId, fId) => {
                        setActiveSpaceId(sId);
                        setActiveFolderId(fId);
                        setIsCreateFolderOpen(true);
                      }}
                      onAddDoc={(sId, fId) => {
                        setActiveSpaceId(sId);
                        setActiveFolderId(fId);
                        setIsCreateDocOpen(true);
                      }}
                      onAddPage={(dId) => {
                        setActiveDocId(dId);
                        setIsCreatePageOpen(true);
                      }}
                      onAddList={(sId, fId) => {
                        setActiveSpaceId(sId);
                        setActiveFolderId(fId);
                        setIsCreateListOpen(true);
                      }}
                      onAction={handleAction}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 4. DOCS NAVIGATION */}
          {activeSection.id === 'docs' && (
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-purple-400 px-1 uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  <span>All Documents ({allDocs.length})</span>
                </span>
                <button
                  onClick={() => setIsCreateDocOpen(true)}
                  title="Create Document Container"
                  className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {allDocs.length === 0 ? (
                <p className="text-zinc-500 text-[11px] px-1 italic">No documents created yet.</p>
              ) : (
                <div className="space-y-1">
                  {allDocs.map((doc) => (
                    <DocTreeItem
                      key={doc.id}
                      doc={doc}
                      onAddPage={(dId) => {
                        setActiveDocId(dId);
                        setIsCreatePageOpen(true);
                      }}
                      onAction={handleAction}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 5. LISTS NAVIGATION */}
          {activeSection.id === 'lists' && (
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-blue-400 px-1 uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <ListIcon className="w-3.5 h-3.5" />
                  <span>All Task Lists ({allLists.length})</span>
                </span>
                <button
                  onClick={() => setIsCreateListOpen(true)}
                  title="Create Task List"
                  className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {allLists.length === 0 ? (
                <p className="text-zinc-500 text-[11px] px-1 italic">No task lists created yet.</p>
              ) : (
                <div className="space-y-1">
                  {allLists.map((list) => (
                    <div
                      key={list.id}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800/60 hover:border-zinc-700 text-zinc-300 hover:text-white cursor-pointer transition-colors"
                    >
                      <ListIcon className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span className="truncate text-xs font-medium">{list.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-zinc-800/60">
          <span className="block text-[10px] text-zinc-500 font-mono">
            Nexus Enterprise V1.0
          </span>
        </div>
      </aside>

      <InviteModal isOpen={isInviteOpen} onClose={() => setIsInviteOpen(false)} />

      {/* DEDICATED CUSTOM MODALS FOR EACH ENTITY TYPE */}
      <CreateSpaceModal
        isOpen={isCreateSpaceOpen}
        onClose={() => setIsCreateSpaceOpen(false)}
        onSuccess={loadSpaces}
      />
      <CreateFolderModal
        isOpen={isCreateFolderOpen}
        onClose={() => setIsCreateFolderOpen(false)}
        onSuccess={loadSpaces}
        spaces={spaces}
        defaultSpaceId={activeSpaceId}
      />
      <CreateListModal
        isOpen={isCreateListOpen}
        onClose={() => setIsCreateListOpen(false)}
        onSuccess={loadSpaces}
        spaces={spaces}
        defaultSpaceId={activeSpaceId}
        defaultFolderId={activeFolderId}
      />
      <CreateDocModal
        isOpen={isCreateDocOpen}
        onClose={() => setIsCreateDocOpen(false)}
        onSuccess={loadSpaces}
        spaces={spaces}
        defaultSpaceId={activeSpaceId}
        defaultFolderId={activeFolderId}
      />
      <CreatePageModal
        isOpen={isCreatePageOpen}
        onClose={() => setIsCreatePageOpen(false)}
        onSuccess={loadSpaces}
        allDocs={allDocs}
        defaultDocId={activeDocId}
      />

      <RenameModal
        isOpen={isRenameOpen}
        onClose={() => setIsRenameOpen(false)}
        onConfirm={handleConfirmRename}
        title={`Rename ${actionEntity?.type}`}
        initialName={actionEntity?.name || ''}
      />

      <ConfirmDeleteModal
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={handleConfirmDelete}
        title={`Delete ${actionEntity?.type}`}
        itemName={actionEntity?.name || ''}
      />
    </div>
  );
}

function SpaceTreeItem({
  space,
  onAddFolder,
  onAddDoc,
  onAddPage,
  onAddList,
  onAction,
}: {
  space: Space;
  onAddFolder: (spaceId: string, folderId?: string) => void;
  onAddDoc: (spaceId: string, folderId?: string) => void;
  onAddPage: (docId: string) => void;
  onAddList: (spaceId: string, folderId?: string) => void;
  onAction: (action: 'rename' | 'duplicate' | 'delete', type: 'space' | 'folder' | 'doc' | 'page' | 'list', id: string, name: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="space-y-0.5 text-xs">
      <div className="group flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-zinc-900 text-zinc-200 font-medium cursor-pointer transition-colors">
        <div onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-1.5 truncate flex-1">
          <div className="relative w-3.5 h-3.5 flex items-center justify-center shrink-0">
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
            </div>
            <div className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: space.color || '#3B82F6' }} />
            </div>
          </div>
          <span className="truncate">{space.name}</span>
        </div>

        {/* Quick Actions under Space */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
          {space.id !== 'root-space' && (
            <ActionMenu icon={<MoreHorizontal className="w-3.5 h-3.5" />}>
              <button onClick={(e) => { e.stopPropagation(); onAction('rename', 'space', space.id, space.name); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer">
                <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                Rename
              </button>
              <button onClick={(e) => { e.stopPropagation(); onAction('duplicate', 'space', space.id, space.name); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer">
                <Copy className="w-3.5 h-3.5 text-zinc-400" />
                Duplicate
              </button>
              <button onClick={(e) => { e.stopPropagation(); onAction('delete', 'space', space.id, space.name); }} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 hover:text-red-300 flex items-center gap-2 cursor-pointer">
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </ActionMenu>
          )}
          <ActionMenu>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddFolder(space.id);
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer"
            >
              <FolderIcon className="w-3.5 h-3.5 text-amber-400" />
              Folder
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddDoc(space.id);
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-purple-400" />
              Doc
            </button>
          </ActionMenu>
        </div>
      </div>

      {isOpen && (
        <div className="pl-4 space-y-0.5 border-l border-zinc-800/80 ml-2">
          {/* Folders */}
          {space.folders?.map((folder) => (
            <FolderTreeItem 
              key={folder.id} 
              folder={folder} 
              spaceId={space.id}
              onAddFolder={onAddFolder}
              onAddDoc={onAddDoc} 
              onAddPage={onAddPage} 
              onAddList={onAddList}
              onAction={onAction}
            />
          ))}

          {/* Direct Lists (Only those without a folderId) */}
          {space.lists?.filter(list => !list.folderId).map((list) => (
            <ListTreeItem key={list.id} list={list} onAction={onAction} />
          ))}

          {/* Direct Docs (Only those without a folderId) */}
          {space.docs?.filter(doc => !doc.folderId).map((doc) => (
            <DocTreeItem key={doc.id} doc={doc} onAddPage={onAddPage} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderTreeItem({
  folder,
  spaceId,
  onAddFolder,
  onAddDoc,
  onAddPage,
  onAddList,
  onAction,
}: {
  folder: Folder;
  spaceId: string;
  onAddFolder: (spaceId: string, folderId?: string) => void;
  onAddDoc: (spaceId: string, folderId?: string) => void;
  onAddPage: (docId: string) => void;
  onAddList: (spaceId: string, folderId?: string) => void;
  onAction: (action: 'rename' | 'duplicate' | 'delete', type: 'space' | 'folder' | 'doc' | 'page' | 'list', id: string, name: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="space-y-0.5 text-xs">
      <div className="group flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-900 text-zinc-300 cursor-pointer transition-colors">
        <div onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-1.5 truncate flex-1">
          <div className="relative w-3.5 h-3.5 flex items-center justify-center shrink-0">
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              {isOpen ? <ChevronDown className="w-3 h-3 text-zinc-500" /> : <ChevronRight className="w-3 h-3 text-zinc-500" />}
            </div>
            <div className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity">
              <FolderIcon className="w-3.5 h-3.5 text-amber-400" />
            </div>
          </div>
          <span className="truncate text-[11px]">{folder.name}</span>
        </div>

        {/* Quick Actions under Folder */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
          <ActionMenu icon={<MoreHorizontal className="w-3.5 h-3.5" />}>
            <button onClick={(e) => { onAction('rename', 'folder', folder.id, folder.name); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer">
              <Pencil className="w-3.5 h-3.5 text-zinc-400" />
              Rename
            </button>
            <button onClick={(e) => { onAction('duplicate', 'folder', folder.id, folder.name); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer">
              <Copy className="w-3.5 h-3.5 text-zinc-400" />
              Duplicate
            </button>
            <button onClick={(e) => { onAction('delete', 'folder', folder.id, folder.name); }} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 hover:text-red-300 flex items-center gap-2 cursor-pointer">
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </ActionMenu>
          <ActionMenu>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddFolder(spaceId, folder.id);
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer"
            >
              <FolderIcon className="w-3.5 h-3.5 text-amber-400" />
              Subfolder
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddDoc(spaceId, folder.id);
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-purple-400" />
              Doc
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddList(spaceId, folder.id);
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer"
            >
              <ListIcon className="w-3.5 h-3.5 text-blue-400" />
              Board
            </button>
          </ActionMenu>
        </div>
      </div>

      {isOpen && (
        <div className="pl-4 space-y-0.5 border-l border-zinc-800/80 ml-2">
          {/* Nested Subfolders (Recursive) */}
          {folder.subfolders?.map((sub) => (
            <FolderTreeItem 
              key={sub.id} 
              folder={sub} 
              spaceId={spaceId}
              onAddFolder={onAddFolder}
              onAddDoc={onAddDoc} 
              onAddPage={onAddPage} 
              onAddList={onAddList}
              onAction={onAction}
            />
          ))}

          {/* Lists */}
          {folder.lists?.map((list) => (
            <ListTreeItem key={list.id} list={list} onAction={onAction} />
          ))}

          {/* Docs */}
          {folder.docs?.map((doc) => (
            <DocTreeItem key={doc.id} doc={doc} onAddPage={onAddPage} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocTreeItem({
  doc,
  onAddPage,
  onAction,
}: {
  doc: Doc;
  onAddPage: (docId: string) => void;
  onAction: (action: 'rename' | 'duplicate' | 'delete', type: 'space' | 'folder' | 'doc' | 'page' | 'list', id: string, name: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const hasPages = doc.pages && doc.pages.length > 0;

  return (
    <div className="space-y-0.5 text-xs">
      <div className="group flex items-center justify-between px-2 py-1 text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors">
        <div onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-1.5 shrink-0 cursor-pointer">
          {hasPages ? (
            <div className="relative w-3 h-3 flex items-center justify-center shrink-0">
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {isOpen ? <ChevronDown className="w-3 h-3 text-zinc-500" /> : <ChevronRight className="w-3 h-3 text-zinc-500" />}
              </div>
              <div className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity">
                <FileText className="w-3 h-3 text-purple-400" />
              </div>
            </div>
          ) : (
            <FileText className="w-3 h-3 text-purple-400 shrink-0" />
          )}
        </div>
        <Link href={`/docs/${doc.id}`} className="truncate flex-1 cursor-pointer">
          <span className="truncate text-[11px] font-medium">{doc.title}</span>
        </Link>

        {/* Quick Actions under Doc */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
          <ActionMenu icon={<MoreHorizontal className="w-3.5 h-3.5" />}>
            <button onClick={() => onAction('rename', 'doc', doc.id, doc.title)} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer">
              <Pencil className="w-3.5 h-3.5 text-zinc-400" />
              Rename
            </button>
            <button onClick={() => onAction('duplicate', 'doc', doc.id, doc.title)} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer">
              <Copy className="w-3.5 h-3.5 text-zinc-400" />
              Duplicate
            </button>
            <button onClick={() => onAction('delete', 'doc', doc.id, doc.title)} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 hover:text-red-300 flex items-center gap-2 cursor-pointer">
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </ActionMenu>
          <ActionMenu>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddPage(doc.id);
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              Page
            </button>
          </ActionMenu>
        </div>
      </div>

      {isOpen && hasPages && (
        <div className="pl-4 space-y-0.5 border-l border-zinc-800/80 ml-2">
          {doc.pages?.map((page) => (
            <PageTreeItem key={page.id} page={page} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function PageTreeItem({
  page,
  onAction,
}: {
  page: Page;
  onAction: (action: 'rename' | 'duplicate' | 'delete', type: 'space' | 'folder' | 'doc' | 'page' | 'list', id: string, name: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const hasSubpages = page.subpages && page.subpages.length > 0;

  return (
    <div className="space-y-0.5 text-xs">
      <div className="group flex items-center justify-between px-2 py-0.5 text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors">
        <div onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-1.5 flex-1 truncate">
          {hasSubpages ? (
            isOpen ? (
              <ChevronDown className="w-2.5 h-2.5 text-zinc-500 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            ) : (
              <ChevronRight className="w-2.5 h-2.5 text-zinc-500 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            )
          ) : (
            <span className="w-2.5 h-2.5 inline-block shrink-0" />
          )}
          <span className="truncate text-[10.5px]">{page.title}</span>
        </div>

        {/* Quick Actions under Page */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
          <ActionMenu icon={<MoreHorizontal className="w-3.5 h-3.5" />}>
            <button onClick={(e) => { onAction('rename', 'page', page.id, page.title); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer">
              <Pencil className="w-3.5 h-3.5 text-zinc-400" />
              Rename
            </button>
            <button onClick={(e) => { onAction('duplicate', 'page', page.id, page.title); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer">
              <Copy className="w-3.5 h-3.5 text-zinc-400" />
              Duplicate
            </button>
            <button onClick={(e) => { onAction('delete', 'page', page.id, page.title); }} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 hover:text-red-300 flex items-center gap-2 cursor-pointer">
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </ActionMenu>
        </div>
      </div>

      {isOpen && hasSubpages && (
        <div className="pl-3 space-y-0.5 border-l border-zinc-800/80 ml-1.5">
          {page.subpages?.map((sub) => (
            <PageTreeItem key={sub.id} page={sub} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function ListTreeItem({
  list,
  onAction,
}: {
  list: List;
  onAction: (action: 'rename' | 'duplicate' | 'delete', type: 'space' | 'folder' | 'doc' | 'page' | 'list', id: string, name: string) => void;
}) {
  return (
    <div className="space-y-0.5 text-xs">
      <div className="group flex items-center justify-between px-2 py-1 text-zinc-400 hover:text-zinc-200 transition-colors rounded">
        <Link href={`/lists/${list.id}`} className="flex items-center gap-1.5 truncate flex-1 cursor-pointer">
          <ListIcon className="w-3 h-3 text-blue-400 shrink-0" />
          <span className="truncate text-[11px] font-medium">{list.name}</span>
        </Link>
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
          <ActionMenu icon={<MoreHorizontal className="w-3.5 h-3.5" />}>
            <button onClick={(e) => { onAction('rename', 'list', list.id, list.name); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer">
              <Pencil className="w-3.5 h-3.5 text-zinc-400" />
              Rename
            </button>
            <button onClick={(e) => { onAction('duplicate', 'list', list.id, list.name); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer">
              <Copy className="w-3.5 h-3.5 text-zinc-400" />
              Duplicate
            </button>
            <button onClick={(e) => { onAction('delete', 'list', list.id, list.name); }} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 hover:text-red-300 flex items-center gap-2 cursor-pointer">
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </ActionMenu>
        </div>
      </div>
    </div>
  );
}
