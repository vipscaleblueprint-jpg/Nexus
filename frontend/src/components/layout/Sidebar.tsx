'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { InviteModal } from '@/components/modals/InviteModal';
import { CreateSpaceModal } from '@/components/modals/CreateSpaceModal';
import { CreateFolderModal } from '@/components/modals/CreateFolderModal';
import { CreateListModal } from '@/components/modals/CreateListModal';
import { CreateDocModal } from '@/components/modals/CreateDocModal';
import { CreatePageModal } from '@/components/modals/CreatePageModal';
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
  Inbox,
  CheckSquare,
  Sparkles,
  Hash,
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

// Helper to collect all task lists across spaces & folders
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

export function Sidebar({ spaces: initialSpaces = [], userRoster = [] }: SidebarProps) {
  const pathname = usePathname();
  const { currentUser } = useAppStore();
  const [spaces, setSpaces] = useState<Space[]>(initialSpaces);
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

  // Synchronize state when props update
  useEffect(() => {
    if (initialSpaces && initialSpaces.length > 0) {
      setSpaces(initialSpaces);
    }
  }, [initialSpaces]);

  useEffect(() => {
    if (userRoster && userRoster.length > 0) {
      setUsers(userRoster);
    }
  }, [userRoster]);

  // Fetch only once on mount if empty to prevent infinite API polling loops
  useEffect(() => {
    let isSubscribed = true;

    if (initialSpaces.length === 0) {
      spacesApi
        .getSpaces()
        .then((res) => {
          if (isSubscribed && res.spaces) setSpaces(res.spaces);
        })
        .catch((err) => console.warn('Failed to load spaces in Sidebar:', err));
    }

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
    try {
      const res = await spacesApi.getSpaces();
      if (res.spaces) setSpaces(res.spaces);
    } catch (err) {
      console.warn('Failed to load spaces in Sidebar:', err);
    }
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
          <h2 className="text-sm font-bold tracking-tight text-zinc-100 flex items-center gap-2">
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
              {/* Top Navigation Items: Inbox & My Tasks ONLY */}
              <div className="space-y-0.5">
                <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-zinc-900 text-zinc-200 font-semibold cursor-pointer transition-colors">
                  <div className="flex items-center gap-2">
                    <Inbox className="w-4 h-4 text-zinc-400" />
                    <span>Inbox</span>
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

                <div className="flex items-center gap-2 px-2 py-1 text-zinc-300 font-medium hover:bg-zinc-900 rounded-lg cursor-pointer">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate">All Tasks</span>
                  <span className="text-[10px] text-zinc-500 font-mono ml-auto truncate">
                    {spaces.length > 0 ? `- ${spaces[0].name}` : ''}
                  </span>
                </div>

                <div className="space-y-1">
                  {spaces.map((space) => (
                    <SpaceTreeItem
                      key={space.id}
                      space={space}
                      onAddFolder={(sId) => {
                        setActiveSpaceId(sId);
                        setIsCreateFolderOpen(true);
                      }}
                      onAddDoc={(sId) => {
                        setActiveSpaceId(sId);
                        setIsCreateDocOpen(true);
                      }}
                      onAddPage={(dId) => {
                        setActiveDocId(dId);
                        setIsCreatePageOpen(true);
                      }}
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

              {/* Channels Section (DYNAMIC BASED ON DB SPACES) */}
              <div className="border-t border-zinc-800/80 pt-3 space-y-1.5">
                <div className="flex items-center justify-between px-1 text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                  <span>Channels</span>
                  <button
                    onClick={() => setIsCreateSpaceOpen(true)}
                    className="p-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {spaces.length === 0 ? (
                  <div className="flex items-center gap-2 px-2 py-1 text-zinc-300 hover:bg-zinc-900 rounded-lg cursor-pointer">
                    <Hash className="w-3.5 h-3.5 text-zinc-400" />
                    <span>General</span>
                  </div>
                ) : (
                  spaces.map((s) => (
                    <div
                      key={`channel-${s.id}`}
                      className="flex items-center gap-2 px-2 py-1 text-zinc-300 hover:bg-zinc-900 rounded-lg cursor-pointer"
                    >
                      <Hash className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      <span className="truncate">General</span>
                      <span className="text-[10px] text-zinc-500 font-mono ml-auto truncate">
                        - {s.name}
                      </span>
                    </div>
                  ))
                )}

                <button
                  onClick={() => setIsCreateSpaceOpen(true)}
                  className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-400 hover:text-white hover:bg-zinc-900 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Add Channel</span>
                </button>
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
                      onAddFolder={(sId) => {
                        setActiveSpaceId(sId);
                        setIsCreateFolderOpen(true);
                      }}
                      onAddDoc={(sId) => {
                        setActiveSpaceId(sId);
                        setIsCreateDocOpen(true);
                      }}
                      onAddPage={(dId) => {
                        setActiveDocId(dId);
                        setIsCreatePageOpen(true);
                      }}
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
                      onAddDoc={(fId) => {
                        setActiveFolderId(fId);
                        setIsCreateDocOpen(true);
                      }}
                      onAddPage={(dId) => {
                        setActiveDocId(dId);
                        setIsCreatePageOpen(true);
                      }}
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
    </div>
  );
}

function SpaceTreeItem({
  space,
  onAddFolder,
  onAddDoc,
  onAddPage,
}: {
  space: Space;
  onAddFolder: (spaceId: string) => void;
  onAddDoc: (spaceId: string) => void;
  onAddPage: (docId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="space-y-0.5 text-xs group">
      <div className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-zinc-900 text-zinc-200 font-medium cursor-pointer transition-colors">
        <div onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-1.5 truncate flex-1">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          )}
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: space.color || '#3B82F6' }} />
          <span className="truncate">{space.name}</span>
        </div>

        {/* Quick Add under Space */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddFolder(space.id);
            }}
            title="Add Folder to Space"
            className="p-0.5 text-zinc-400 hover:text-amber-400"
          >
            <FolderIcon className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddDoc(space.id);
            }}
            title="Add Doc to Space"
            className="p-0.5 text-zinc-400 hover:text-purple-400"
          >
            <FileText className="w-3 h-3" />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="pl-4 space-y-0.5 border-l border-zinc-800/80 ml-2">
          {/* Folders */}
          {space.folders?.map((folder) => (
            <FolderTreeItem key={folder.id} folder={folder} onAddDoc={onAddDoc} onAddPage={onAddPage} />
          ))}

          {/* Direct Lists */}
          {space.lists?.map((list) => (
            <div key={list.id} className="flex items-center gap-2 px-2 py-1 text-zinc-400 hover:text-zinc-200 cursor-pointer">
              <ListIcon className="w-3 h-3 text-blue-400 shrink-0" />
              <span className="truncate text-[11px]">{list.name}</span>
            </div>
          ))}

          {/* Direct Docs */}
          {space.docs?.map((doc) => (
            <DocTreeItem key={doc.id} doc={doc} onAddPage={onAddPage} />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderTreeItem({
  folder,
  onAddDoc,
  onAddPage,
}: {
  folder: Folder;
  onAddDoc: (folderId: string) => void;
  onAddPage: (docId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="space-y-0.5 text-xs group">
      <div className="flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-900 text-zinc-300 cursor-pointer">
        <div onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-1.5 truncate flex-1">
          {isOpen ? (
            <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-zinc-500 shrink-0" />
          )}
          <FolderIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="truncate text-[11px]">{folder.name}</span>
        </div>

        {/* Quick Add under Folder */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddDoc(folder.id);
            }}
            title="Add Doc to Folder"
            className="p-0.5 text-zinc-400 hover:text-purple-400"
          >
            <FileText className="w-3 h-3" />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="pl-4 space-y-0.5 border-l border-zinc-800/80 ml-2">
          {/* Nested Subfolders (Recursive) */}
          {folder.subfolders?.map((sub) => (
            <FolderTreeItem key={sub.id} folder={sub} onAddDoc={onAddDoc} onAddPage={onAddPage} />
          ))}

          {/* Lists */}
          {folder.lists?.map((list) => (
            <div key={list.id} className="flex items-center gap-2 px-2 py-1 text-zinc-400 hover:text-zinc-200 cursor-pointer">
              <ListIcon className="w-3 h-3 text-blue-400 shrink-0" />
              <span className="truncate text-[11px]">{list.name}</span>
            </div>
          ))}

          {/* Docs */}
          {folder.docs?.map((doc) => (
            <DocTreeItem key={doc.id} doc={doc} onAddPage={onAddPage} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocTreeItem({
  doc,
  onAddPage,
}: {
  doc: Doc;
  onAddPage: (docId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const hasPages = doc.pages && doc.pages.length > 0;

  return (
    <div className="space-y-0.5 text-xs group">
      <div className="flex items-center justify-between px-2 py-1 text-zinc-400 hover:text-zinc-200 cursor-pointer">
        <div onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-1.5 truncate flex-1">
          {hasPages ? (
            isOpen ? (
              <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 text-zinc-500 shrink-0" />
            )
          ) : (
            <span className="w-3 h-3 inline-block shrink-0" />
          )}
          <FileText className="w-3 h-3 text-purple-400 shrink-0" />
          <span className="truncate text-[11px] font-medium">{doc.title}</span>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddPage(doc.id);
          }}
          title="Add Page to Doc"
          className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-400 hover:text-emerald-400 transition-opacity"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {isOpen && hasPages && (
        <div className="pl-4 space-y-0.5 border-l border-zinc-800/80 ml-2">
          {doc.pages?.map((page) => (
            <PageTreeItem key={page.id} page={page} />
          ))}
        </div>
      )}
    </div>
  );
}

function PageTreeItem({ page }: { page: Page }) {
  const [isOpen, setIsOpen] = useState(false);
  const hasSubpages = page.subpages && page.subpages.length > 0;

  return (
    <div className="space-y-0.5 text-xs">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-0.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
      >
        {hasSubpages ? (
          isOpen ? (
            <ChevronDown className="w-2.5 h-2.5 text-zinc-500 shrink-0" />
          ) : (
            <ChevronRight className="w-2.5 h-2.5 text-zinc-500 shrink-0" />
          )
        ) : (
          <span className="w-2.5 h-2.5 inline-block shrink-0" />
        )}
        <span className="truncate text-[10.5px]">{page.title}</span>
      </div>

      {isOpen && hasSubpages && (
        <div className="pl-3 space-y-0.5 border-l border-zinc-800/80 ml-1.5">
          {page.subpages?.map((sub) => (
            <PageTreeItem key={sub.id} page={sub} />
          ))}
        </div>
      )}
    </div>
  );
}
