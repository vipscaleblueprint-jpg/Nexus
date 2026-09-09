'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { InviteModal } from '@/components/modals/InviteModal';
import { AddInvitationModal } from '@/components/modals/AddInvitationModal';
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
  UserPlus,
  LucideIcon,
  Folder as FolderIcon,
  FileText,
  List as ListIcon,
  ChevronDown,
  ChevronRight,
  Plus,
  Activity,
  CheckSquare,
  Sparkles,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  ExternalLink,
  Rocket,
  Clock,
  Video,
  History,
  ScrollText,
  Type,
  MessageSquareText,
  Music,
  Image,
  Megaphone,
  Target,
  Shirt,
  Camera,
  TextCursorInput,
  Film,
  ImagePlus,
  Upload,
  Infinity,
  CircleUser,
  BarChart3,
  Wand2,
  PanelsTopLeft,
  Repeat,
  Archive,
  Calendar,
  Download,
  Package,
  Move,
  Eye,
  HardDrive,
  Moon,
  LogOut,
  LayoutGrid,
} from 'lucide-react';

const VIPSCALE_BASE = 'https://tools.vipscaleph.com';

interface SidebarProps {
  spaces?: Space[];
  userRoster?: User[];
}

// ─── VIPScale menu data ───────────────────────────────────────────────────────

const managementItems = [
  { title: 'Dashboard', url: '/protected', icon: PanelsTopLeft, color: 'text-purple-500' },
  { title: 'Galaxy Task', url: '/protected/galaxy-task', icon: Rocket, color: 'text-sky-500' },
  { title: 'QA Listing', url: '/protected/qa-listing', icon: FileText, color: 'text-purple-500' },
  { title: 'SOP', url: '/protected/sop', icon: ScrollText, color: 'text-green-500' },
];

const trackerItems = [
  { title: 'Time Tracker', url: '/protected/time-entry-v2', icon: Clock, color: 'text-pink-600' },
  { title: 'Time Entry Report', url: '/protected/time-entry-reports', icon: BarChart3, color: 'text-pink-600' },
  { title: 'Time Calendar', url: '/protected/time-entry-calendar', icon: Calendar, color: 'text-pink-600' },
  { title: 'Time Track History', url: '/protected/time-track', icon: History, color: 'text-indigo-600' },
];

const clientItems = [
  { title: 'Add Client', url: '/protected/add-client', icon: UserPlus, color: 'text-purple-700' },
  { title: 'Add Product', url: '/protected/add-product', icon: Package, color: 'text-purple-700' },
  { title: 'VPS Generator', url: '/protected/vps-generator', icon: Target, color: 'text-orange-500' },
  { title: 'DM Reply Generator', url: '/protected/dm-reply-generator', icon: Sparkles, color: 'text-purple-500' },
];

const contractsItems = [
  { title: 'All Contracts', url: '/protected/contracts', icon: FileText, color: 'text-amber-500' },
  { title: 'Create Contract', url: '/protected/contracts/new', icon: Sparkles, color: 'text-amber-500' },
  { title: 'Templates', url: '/protected/contracts/templates', icon: ScrollText, color: 'text-amber-500' },
  { title: 'Proposals Queue', url: '/protected/contracts/proposals', icon: Megaphone, color: 'text-amber-500' },
  { title: 'Link Management', url: '/protected/contracts/links', icon: ExternalLink, color: 'text-amber-500' },
  { title: 'R2 Storage Manager', url: '/protected/contracts/storage', icon: HardDrive, color: 'text-amber-500' },
];

const toolsItems = [
  { title: 'Prompt Generator', url: '/protected/prompt-generator', icon: Sparkles, color: 'text-pink-700' },
  { title: 'Landing Page Copy', url: '/protected/landing-page-copy', icon: PanelsTopLeft, color: 'text-purple-700' },
  { title: 'Video Transcriber', url: '/protected/video-transcriber', icon: FileText, color: 'text-cyan-600' },
  { title: 'Video Downloader', url: '/protected/video-downloader', icon: Download, color: 'text-orange-500' },
  { title: 'Website Audit', url: '/protected/website-audit', icon: Eye, color: 'text-green-600' },
];

const adsItems = [
  { title: 'Static Ads Generator', url: '/protected/static-ads-generator', icon: Megaphone, color: 'text-orange-500' },
  { title: 'Video Ads Script Generator', url: '/protected/video-ads-script-generator', icon: ScrollText, color: 'text-orange-500' },
];

const contentCreationItems = [
  { title: 'Gemini Video Generator', url: '/protected/gemini-video-generator', icon: Video, color: 'text-purple-500' },
  { title: 'Seedance Video Generator', url: '/protected/seedance-video-generator', icon: Video, color: 'text-purple-500' },
  { title: 'Motion Control', url: '/protected/motion-control', icon: Move, color: 'text-purple-500' },
  { title: 'Persona Generator', url: '/protected/persona-generator', icon: Users, color: 'text-orange-500' },
  { title: 'Reel Paraphraser', url: '/protected/reel-paraphraser', icon: Video, color: 'text-orange-500' },
  { title: 'Reel Script Generator V2', url: '/protected/reel-script-generator-v2', icon: ScrollText, color: 'text-orange-500' },
  { title: 'Looping and Carousel Copy', url: '/protected/looping-and-carousel-copy', icon: Repeat, color: 'text-orange-500' },
  { title: 'Pinned Highlights Script', url: '/protected/pinned-highlights-script-generator', icon: UserPlus, color: 'text-orange-500' },
  { title: 'Caption Generator', url: '/protected/caption-generator', icon: Type, color: 'text-orange-500' },
  { title: 'Caption Paraphraser', url: '/protected/caption-paraphraser', icon: MessageSquareText, color: 'text-orange-500' },
  { title: 'Thumbnail Hooks', url: '/protected/thumbnail-hooks', icon: Image, color: 'text-orange-500' },
  { title: 'Audio Tags', url: '/protected/audio-tags', icon: Music, color: 'text-orange-500' },
];

const aiAvatarItems = [
  { title: 'Reel to Prompt V3', url: '/protected/reel-to-prompt-v3', icon: Sparkles, color: 'text-indigo-500' },
  { title: 'Assets Generator', url: '/protected/assets-generator', icon: Package, color: 'text-indigo-500' },
  { title: '2S - Reel to Prompt', url: '/protected/2s-reel-to-prompt', icon: Infinity, color: 'text-indigo-500' },
  { title: 'Photoshoot to Prompt', url: '/protected/photoshoot-to-prompt', icon: Shirt, color: 'text-indigo-500' },
  { title: 'Scene Image to Prompt', url: '/protected/scene-to-prompt', icon: Camera, color: 'text-indigo-500' },
  { title: 'Scene Text to Prompt', url: '/protected/scene-text-to-prompt', icon: TextCursorInput, color: 'text-indigo-500' },
  { title: 'Kling', url: '/protected/kling', icon: Wand2, color: 'text-indigo-500' },
  { title: 'Avatar Generator', url: '/protected/avatar-generator', icon: CircleUser, color: 'text-indigo-500' },
  { title: 'Face Analyzer', url: '/protected/face-analyzer', icon: BarChart3, color: 'text-indigo-500' },
  { title: 'Body Analyzer', url: '/protected/body-analyzer', icon: BarChart3, color: 'text-indigo-500' },
  { title: 'Poses Generator', url: '/protected/poses-generator', icon: Package, color: 'text-indigo-500' },
  { title: 'Package Generator', url: '/protected/package-generator', icon: Package, color: 'text-indigo-500' },
  { title: 'Reel Scenes Extractor', url: '/protected/reel-scenes-extractor', icon: ImagePlus, color: 'text-indigo-500' },
];

const oldItems = [
  { title: 'Reel to Prompt', url: '/protected/reel-to-prompt', icon: Film, color: 'text-purple-500' },
  { title: 'Fashion Randomizer', url: '/protected/fashion-randomizer', icon: Shirt, color: 'text-purple-500' },
  { title: 'B-roll Scene to prompt v2', url: '/protected/b-roll-image-to-prompt', icon: ImagePlus, color: 'text-purple-500' },
  { title: 'Static Ads Copy Generator', url: '/protected/ads-copy', icon: Megaphone, color: 'text-orange-500' },
  { title: 'Reel Scenes Library', url: '/protected/reel-scenes-library', icon: Upload, color: 'text-indigo-500' },
  { title: 'Reel Script Generator', url: '/protected/reel-script-generator', icon: ScrollText, color: 'text-orange-500' },
  { title: 'Time Tracker', url: '/protected/time-entry', icon: Clock, color: 'text-pink-600' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── VIPScale-style collapsible row ──────────────────────────────────────────

function VipRow({ icon: Icon, iconClass, label, labelClass, children, collapsed }: {
  icon: LucideIcon; iconClass: string; label: string; labelClass?: string; children: React.ReactNode; collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="list-none">
      <button
        onClick={() => { if (!collapsed) setOpen(!open); }}
        className={`flex items-center overflow-hidden rounded-md outline-none transition-colors hover:bg-[hsl(240,3.7%,15.9%)] hover:text-[hsl(240,4.8%,95.9%)] text-[hsl(240,4.8%,95.9%)] ${collapsed ? 'justify-center size-8 p-0 w-full' : 'w-full gap-2 p-2 text-left text-sm'}`}
        title={collapsed ? label : undefined}
      >
        <Icon className={`size-4 shrink-0 ${iconClass}`} />
        {!collapsed && <span className={`flex-1 truncate ${labelClass ?? ''}`}>{label}</span>}
        {!collapsed && <ChevronRight className={`ml-auto size-4 shrink-0 text-[hsl(240,5.3%,26.1%)] transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />}
      </button>
      {open && !collapsed && (
        <ul className="ml-4 border-l border-[hsl(240,3.7%,15.9%)] pl-2 mt-0.5 space-y-px">
          {children}
        </ul>
      )}
    </li>
  );
}

function VipItem({ url, icon: Icon, iconClass, title }: { url: string; icon: LucideIcon; iconClass: string; title: string }) {
  return (
    <li className="list-none">
      <a
        href={`${VIPSCALE_BASE}${url}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-sm text-[hsl(240,4.8%,95.9%)] outline-none transition-colors hover:bg-[hsl(240,3.7%,15.9%)]"
      >
        <Icon className={`size-4 shrink-0 ${iconClass}`} />
        <span className="truncate">{title}</span>
      </a>
    </li>
  );
}

function VipFlatItem({ url, icon: Icon, iconClass, title, collapsed }: { url: string; icon: LucideIcon; iconClass: string; title: string; collapsed: boolean; }) {
  return (
    <li className="list-none">
      <a
        href={`${VIPSCALE_BASE}${url}`}
        target="_blank"
        rel="noopener noreferrer"
        title={collapsed ? title : undefined}
        className={`flex items-center overflow-hidden rounded-md outline-none transition-colors hover:bg-[hsl(240,3.7%,15.9%)] text-[hsl(240,4.8%,95.9%)] ${collapsed ? 'justify-center size-8 p-0 w-full' : 'w-full gap-2 p-2 text-sm'}`}
      >
        <Icon className={`size-4 shrink-0 ${iconClass}`} />
        {!collapsed && <span className="truncate">{title}</span>}
      </a>
    </li>
  );
}

function GroupLabel({ children, collapsed }: { children: React.ReactNode; collapsed: boolean; }) {
  if (collapsed) return null;
  return (
    <div className="flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-[hsl(0,0%,63.9%)] outline-none ring-sidebar-ring transition-[margin,opacity] duration-200 ease-linear">
      {children}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function Sidebar({ spaces: initialSpaces = [], userRoster = [] }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filterParam = searchParams?.get('filter');
  const isMyTasksActive = pathname === '/tasks' && filterParam === 'my';
  const isAllTasksActive = (pathname === '/' || pathname === '/tasks') && filterParam !== 'my';

  const { currentUser, spaces: globalSpaces, loadSpaces: globalLoadSpaces, isSidebarCollapsed: collapsed } = useAppStore();
  const spaces = globalSpaces.length > 0 ? globalSpaces : initialSpaces;



  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isAddInvitationOpen, setIsAddInvitationOpen] = useState(false);
  const [isCreateSpaceOpen, setIsCreateSpaceOpen] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [isCreateListOpen, setIsCreateListOpen] = useState(false);
  const [isCreateDocOpen, setIsCreateDocOpen] = useState(false);
  const [isCreatePageOpen, setIsCreatePageOpen] = useState(false);
  const [activeSpaceId, setActiveSpaceId] = useState<string | undefined>();
  const [activeFolderId, setActiveFolderId] = useState<string | undefined>();
  const [activeDocId, setActiveDocId] = useState<string | undefined>();
  const [actionEntity, setActionEntity] = useState<{ type: 'space' | 'folder' | 'doc' | 'page' | 'list'; id: string; name: string } | null>(null);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const loadSpaces = async () => { await globalLoadSpaces(); };

  const handleAction = async (action: 'rename' | 'duplicate' | 'delete', type: 'space' | 'folder' | 'doc' | 'page' | 'list', id: string, name: string) => {
    if (action === 'rename') { setActionEntity({ type, id, name }); setIsRenameOpen(true); }
    else if (action === 'delete') { setActionEntity({ type, id, name }); setIsDeleteOpen(true); }
    else if (action === 'duplicate') {
      try {
        if (type === 'space') await spacesApi.duplicateSpace(id);
        else if (type === 'folder') await spacesApi.duplicateFolder(id);
        else if (type === 'doc') await spacesApi.duplicateDoc(id);
        else if (type === 'page') await spacesApi.duplicatePage(id);
        else if (type === 'list') await spacesApi.duplicateList(id);
        loadSpaces();
      } catch (err) { console.error('Failed to duplicate:', err); }
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

  const allDocs = getAllDocs(spaces);

  return (
    <div className="flex h-screen shrink-0 z-20">
      {/* ── PRIMARY VIPScale Sidebar ───────────────────────────── */}
      <div
        className="relative h-full flex-col flex transition-all duration-300 ease-in-out"
        style={{ width: collapsed ? '3rem' : '16rem' }}
      >
        {/* Sidebar inner — mimics shadcn sidebar-container */}
        <div className="h-full w-full bg-[hsl(240,5.9%,10%)] border-r border-[hsl(240,3.7%,15.9%)] flex flex-col text-[hsl(240,4.8%,95.9%)]">

          {/* Header */}
          <div className="flex h-[60px] items-center px-2 shrink-0 border-b border-[hsl(240,3.7%,15.9%)]">
            <a
              href={`${VIPSCALE_BASE}/protected`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 overflow-hidden flex-1"
            >
              <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg shadow-purple-500/20">
                <Sparkles className="size-4 text-white" />
              </div>
              {!collapsed && (
                <span className="font-bold text-lg bg-gradient-to-r from-purple-400 to-pink-600 text-transparent bg-clip-text truncate">
                  VIP Scale
                </span>
              )}
            </a>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            {/* Management */}
            <div className={`px-2 py-2 ${collapsed ? 'flex flex-col items-center gap-1' : ''}`}>
              <GroupLabel collapsed={collapsed}>Management</GroupLabel>
              <ul className={`space-y-px w-full ${collapsed ? 'flex flex-col items-center gap-1' : ''}`}>
                {managementItems.map((item) => <VipFlatItem key={item.title} {...item} iconClass={item.color} collapsed={collapsed} />)}
                <VipRow icon={Clock} iconClass="text-pink-600" label="Tracker" collapsed={collapsed}>
                  {trackerItems.map((item) => <VipItem key={item.title} {...item} iconClass={item.color} />)}
                </VipRow>
              </ul>
            </div>

            {/* Client */}
            <div className={`px-2 py-1 ${collapsed ? 'flex flex-col items-center gap-1' : ''}`}>
              <GroupLabel collapsed={collapsed}>Client</GroupLabel>
              <ul className={`space-y-px w-full ${collapsed ? 'flex flex-col items-center gap-1' : ''}`}>
                {clientItems.map((item) => <VipFlatItem key={item.title} {...item} iconClass={item.color} collapsed={collapsed} />)}
              </ul>
            </div>

            {/* Contracts */}
            <div className={`px-2 py-1 ${collapsed ? 'flex flex-col items-center gap-1' : ''}`}>
              <GroupLabel collapsed={collapsed}>Contracts</GroupLabel>
              <ul className={`space-y-px w-full ${collapsed ? 'flex flex-col items-center gap-1' : ''}`}>
                <VipRow icon={FileText} iconClass="text-amber-500" label="Contracts" collapsed={collapsed}>
                  {contractsItems.map((item) => <VipItem key={item.title} {...item} iconClass={item.color} />)}
                </VipRow>
              </ul>
            </div>

            {/* Collapsible sections */}
            <div className={`px-2 py-1 ${collapsed ? 'flex flex-col items-center gap-1' : ''}`}>
              <ul className={`space-y-px w-full ${collapsed ? 'flex flex-col items-center gap-1' : ''}`}>
                <VipRow icon={Wand2} iconClass="text-pink-500" label="Tools" collapsed={collapsed}>
                  {toolsItems.map((item) => <VipItem key={item.title} {...item} iconClass={item.color} />)}
                </VipRow>
                <VipRow icon={Megaphone} iconClass="text-orange-500" label="Ads" collapsed={collapsed}>
                  {adsItems.map((item) => <VipItem key={item.title} {...item} iconClass={item.color} />)}
                </VipRow>
                <VipRow icon={Video} iconClass="text-orange-500" label="Content Creation" collapsed={collapsed}>
                  {contentCreationItems.map((item) => <VipItem key={item.title} {...item} iconClass={item.color} />)}
                </VipRow>
                <VipRow icon={CircleUser} iconClass="text-indigo-500" label="AI Avatar" collapsed={collapsed}>
                  {aiAvatarItems.map((item) => <VipItem key={item.title} {...item} iconClass={item.color} />)}
                </VipRow>
                <VipRow icon={Archive} iconClass="text-purple-500" label="OLD" labelClass="text-purple-400" collapsed={collapsed}>
                  {oldItems.map((item) => <VipItem key={item.title} {...item} iconClass={item.color} />)}
                </VipRow>
              </ul>
            </div>

            {/* ── Nexus entry ── */}
            <div className={`px-2 py-1 border-t border-[hsl(240,3.7%,15.9%)] mt-1 ${collapsed ? 'flex justify-center' : ''}`}>
              <ul className="space-y-px w-full">
                <li className="list-none">
                  <div
                    className={`flex items-center overflow-hidden rounded-md outline-none transition-colors bg-[hsl(240,3.7%,15.9%)] font-medium ${collapsed ? 'justify-center size-8 p-0 w-full mx-auto' : 'w-full gap-2 p-2 text-left text-sm'}`}
                    title={collapsed ? 'Nexus' : undefined}
                  >
                    <div className="size-4 shrink-0 rounded bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
                      <span className="text-[8px] font-bold text-white leading-none">N</span>
                    </div>
                    {!collapsed && <span className="flex-1 truncate">Nexus</span>}
                    {!collapsed && <ChevronRight className="ml-auto size-4 shrink-0 text-[hsl(240,5.3%,26.1%)]" />}
                  </div>
                </li>
              </ul>
            </div>
          </div>

            <div className="border-t border-[hsl(240,3.7%,15.9%)] px-2 py-2 shrink-0 space-y-px flex flex-col items-center">
              <button title={collapsed ? 'Toggle Theme' : undefined} className={`flex items-center overflow-hidden rounded-md outline-none transition-colors hover:bg-[hsl(240,3.7%,15.9%)] text-[hsl(240,4.8%,95.9%)] ${collapsed ? 'justify-center size-8 p-0 w-full mx-auto' : 'w-full gap-2 p-2 text-sm'}`}>
                <Moon className="size-4 shrink-0 text-purple-400" />
                {!collapsed && <span>Toggle Theme</span>}
              </button>
              <button title={collapsed ? 'Sign Out' : undefined} className={`flex items-center overflow-hidden rounded-md outline-none transition-colors hover:bg-[hsl(240,3.7%,15.9%)] text-[hsl(240,4.8%,95.9%)] ${collapsed ? 'justify-center size-8 p-0 w-full mx-auto' : 'w-full gap-2 p-2 text-sm'}`}>
                <LogOut className="size-4 shrink-0 text-red-500" />
                {!collapsed && <span>Sign Out</span>}
              </button>
            </div>
        </div>
      </div>

      {/* ── SECONDARY Nexus Sub-Sidebar ───────────────────────── */}
      <div className="h-full w-56 bg-[hsl(240,5.9%,10%)] border-r border-[hsl(240,3.7%,15.9%)] flex flex-col text-[hsl(240,4.8%,95.9%)] shrink-0 transition-all duration-300 ease-in-out">
          {/* Nexus header */}
          <div className="flex h-[60px] items-center px-3 shrink-0 border-b border-[hsl(240,3.7%,15.9%)] gap-2">
            <div className="size-6 rounded bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0">
              <span className="text-[9px] font-bold text-white">N</span>
            </div>
            <span className="font-semibold text-sm truncate">Nexus</span>
          </div>

          {/* Nexus nav */}
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-px">
            <div className="flex items-center gap-2 overflow-hidden rounded-md p-2 text-sm cursor-pointer transition-colors hover:bg-[hsl(240,3.7%,15.9%)] text-[hsl(240,4.8%,95.9%)]">
              <Activity className="size-4 shrink-0 text-zinc-400" />
              <span className="truncate">Activity</span>
              <span className="ml-auto text-[10px] font-bold bg-pink-500 text-white px-1.5 py-0.5 rounded-full">99+</span>
            </div>


            {/* Spaces Section */}
            <div className="pt-2 space-y-px">
              <div className="flex items-center justify-between mb-1 px-2 pt-1">
                <span className="text-[10px] font-semibold text-[hsl(0,0%,63.9%)] uppercase tracking-wide">Spaces</span>
                <button onClick={() => setIsCreateSpaceOpen(true)} className="text-[hsl(0,0%,63.9%)] hover:text-white transition-colors cursor-pointer" title="New Space">
                  <Plus className="size-3.5" />
                </button>
              </div>

              {/* ── ALL TASKS ── */}
              <Link
                href="/"
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md font-medium text-xs transition-colors group cursor-pointer mb-1 ${
                  isAllTasksActive
                    ? 'bg-[hsl(240,3.7%,15.9%)] text-cyan-300 font-semibold'
                    : 'text-zinc-300 hover:bg-[hsl(240,3.7%,15.9%)] hover:text-white'
                }`}
              >
                <Sparkles className="size-3.5 text-cyan-400 shrink-0 group-hover:scale-110 transition-transform" />
                <span className="truncate flex-1">All Tasks</span>
              </Link>

              {/* Spaces & Root Folders */}
              {spaces.map((space) => {
                if (space.id === 'root-space') {
                  return (
                    <div key="root-items" className="space-y-px">
                      {space.folders?.map((folder) => (
                        <FolderTreeItem
                          key={folder.id}
                          folder={folder}
                          onAddFolder={(sId, fId) => { setActiveSpaceId(undefined); setActiveFolderId(fId); setIsCreateFolderOpen(true); }}
                          onAddDoc={(sId, fId) => { setActiveSpaceId(undefined); setActiveFolderId(fId); setIsCreateDocOpen(true); }}
                          onAddPage={(dId) => { setActiveDocId(dId); setIsCreatePageOpen(true); }}
                          onAddList={(sId, fId) => { setActiveSpaceId(undefined); setActiveFolderId(fId); setIsCreateListOpen(true); }}
                          onAction={handleAction}
                        />
                      ))}
                      {space.lists?.filter((l) => !l.folderId).map((list) => (
                        <ListTreeItem key={list.id} list={list} onAction={handleAction} />
                      ))}
                      {space.docs?.filter((d) => !d.folderId).map((doc) => (
                        <DocTreeItem key={doc.id} doc={doc} onAddPage={(dId) => { setActiveDocId(dId); setIsCreatePageOpen(true); }} onAction={handleAction} />
                      ))}
                    </div>
                  );
                }

                return (
                  <SpaceTreeItem
                    key={space.id}
                    space={space}
                    onAddFolder={(sId, fId) => { setActiveSpaceId(sId); setActiveFolderId(fId); setIsCreateFolderOpen(true); }}
                    onAddDoc={(sId, fId) => { setActiveSpaceId(sId); setActiveFolderId(fId); setIsCreateDocOpen(true); }}
                    onAddPage={(dId) => { setActiveDocId(dId); setIsCreatePageOpen(true); }}
                    onAddList={(sId, fId) => { setActiveSpaceId(sId); setActiveFolderId(fId); setIsCreateListOpen(true); }}
                    onAction={handleAction}
                  />
                );
              })}
              <button onClick={() => setIsCreateSpaceOpen(true)} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[hsl(0,0%,63.9%)] hover:text-white hover:bg-[hsl(240,3.7%,15.9%)] transition-colors cursor-pointer">
                <Plus className="size-3.5" />
                <span>New Space</span>
              </button>
            </div>

            <Link href="/team" className={`flex items-center gap-2 overflow-hidden rounded-md p-2 text-sm outline-none transition-colors hover:bg-[hsl(240,3.7%,15.9%)] ${pathname === '/team' ? 'bg-[hsl(240,3.7%,15.9%)] font-medium text-[hsl(240,4.8%,95.9%)]' : 'text-[hsl(240,4.8%,95.9%)]'}`}>
              <Users className="size-4 shrink-0 text-zinc-400" />
              <span className="truncate">Member Directory</span>
            </Link>
          </div>

          {/* Nexus footer */}
          <div className="border-t border-[hsl(240,3.7%,15.9%)] px-2 py-2 shrink-0">
            <button
              onClick={() => { if (currentUser?.systemRole === 'ADMIN') setIsAddInvitationOpen(true); else setIsInviteOpen(true); }}
              className="flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-sm outline-none transition-colors hover:bg-[hsl(240,3.7%,15.9%)]"
            >
              <UserPlus className="size-4 shrink-0 text-green-500" />
              <span>Invite</span>
            </button>
          </div>
        </div>
      
      {/* Modals */}
      <InviteModal isOpen={isInviteOpen} onClose={() => setIsInviteOpen(false)} />
      <AddInvitationModal isOpen={isAddInvitationOpen} onClose={() => setIsAddInvitationOpen(false)} onSuccess={() => {}} />
      <CreateSpaceModal isOpen={isCreateSpaceOpen} onClose={() => setIsCreateSpaceOpen(false)} onSuccess={loadSpaces} />
      <CreateFolderModal isOpen={isCreateFolderOpen} onClose={() => setIsCreateFolderOpen(false)} onSuccess={loadSpaces} spaces={spaces} defaultSpaceId={activeSpaceId} />
      <CreateListModal isOpen={isCreateListOpen} onClose={() => setIsCreateListOpen(false)} onSuccess={loadSpaces} spaces={spaces} defaultSpaceId={activeSpaceId} defaultFolderId={activeFolderId} />
      <CreateDocModal isOpen={isCreateDocOpen} onClose={() => setIsCreateDocOpen(false)} onSuccess={loadSpaces} spaces={spaces} defaultSpaceId={activeSpaceId} defaultFolderId={activeFolderId} />
      <CreatePageModal isOpen={isCreatePageOpen} onClose={() => setIsCreatePageOpen(false)} onSuccess={loadSpaces} allDocs={allDocs} defaultDocId={activeDocId} />
      <RenameModal isOpen={isRenameOpen} onClose={() => setIsRenameOpen(false)} onConfirm={handleConfirmRename} title={`Rename ${actionEntity?.type}`} initialName={actionEntity?.name || ''} />
      <ConfirmDeleteModal isOpen={isDeleteOpen} onClose={() => setIsDeleteOpen(false)} onConfirm={handleConfirmDelete} title={`Delete ${actionEntity?.type}`} itemName={actionEntity?.name || ''} />
    </div>
  );
}



function SpaceTreeItem({ space, onAddFolder, onAddDoc, onAddPage, onAddList, onAction }: {
  space: Space;
  onAddFolder: (spaceId?: string, folderId?: string) => void;
  onAddDoc: (spaceId?: string, folderId?: string) => void;
  onAddPage: (docId: string) => void;
  onAddList: (spaceId?: string, folderId?: string) => void;
  onAction: (action: 'rename' | 'duplicate' | 'delete', type: 'space' | 'folder' | 'doc' | 'page' | 'list', id: string, name: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className="space-y-px text-xs">
      <div className="group flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-[hsl(240,3.7%,15.9%)] cursor-pointer transition-colors">
        <div onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-2 truncate flex-1">
          <div className="relative size-4 flex items-center justify-center shrink-0">
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              {isOpen ? <ChevronDown className="size-3.5 text-[hsl(0,0%,63.9%)]" /> : <ChevronRight className="size-3.5 text-[hsl(0,0%,63.9%)]" />}
            </div>
            <div className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity">
              <span className="size-2 rounded-full" style={{ backgroundColor: space.color || '#3B82F6' }} />
            </div>
          </div>
          <span className="truncate text-sm">{space.name}</span>
        </div>
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
          {space.id !== 'root-space' && (
            <ActionMenu icon={<MoreHorizontal className="size-3.5" />}>
              <button onClick={() => onAction('rename', 'space', space.id, space.name)} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer"><Pencil className="size-3.5 text-zinc-400" />Rename</button>
              <button onClick={() => onAction('duplicate', 'space', space.id, space.name)} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer"><Copy className="size-3.5 text-zinc-400" />Duplicate</button>
              <button onClick={() => onAction('delete', 'space', space.id, space.name)} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 hover:text-red-300 flex items-center gap-2 cursor-pointer"><Trash2 className="size-3.5" />Delete</button>
            </ActionMenu>
          )}
          <ActionMenu>
            <button onClick={(e) => { e.stopPropagation(); onAddFolder(space.id); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer"><FolderIcon className="size-3.5 text-amber-400" />Folder</button>
            <button onClick={(e) => { e.stopPropagation(); onAddDoc(space.id); }} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer"><FileText className="size-3.5 text-purple-400" />Doc</button>
          </ActionMenu>
        </div>
      </div>
      {isOpen && (
        <div className="pl-4 border-l border-[hsl(240,3.7%,15.9%)] ml-3 space-y-px">
          {space.folders?.map((folder) => <FolderTreeItem key={folder.id} folder={folder} spaceId={space.id} onAddFolder={onAddFolder} onAddDoc={onAddDoc} onAddPage={onAddPage} onAddList={onAddList} onAction={onAction} />)}
          {space.lists?.filter(l => !l.folderId).map((list) => <ListTreeItem key={list.id} list={list} onAction={onAction} />)}
          {space.docs?.filter(d => !d.folderId).map((doc) => <DocTreeItem key={doc.id} doc={doc} onAddPage={onAddPage} onAction={onAction} />)}
        </div>
      )}
    </div>
  );
}

function FolderTreeItem({ folder, spaceId, onAddFolder, onAddDoc, onAddPage, onAddList, onAction }: {
  folder: Folder; spaceId?: string;
  onAddFolder: (spaceId?: string, folderId?: string) => void;
  onAddDoc: (spaceId?: string, folderId?: string) => void;
  onAddPage: (docId: string) => void;
  onAddList: (spaceId?: string, folderId?: string) => void;
  onAction: (action: 'rename' | 'duplicate' | 'delete', type: 'space' | 'folder' | 'doc' | 'page' | 'list', id: string, name: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className="space-y-px">
      <div className="group flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-[hsl(240,3.7%,15.9%)] cursor-pointer transition-colors">
        <div onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-2 truncate flex-1">
          <div className="relative size-3.5 flex items-center justify-center shrink-0">
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              {isOpen ? <ChevronDown className="size-3 text-[hsl(0,0%,63.9%)]" /> : <ChevronRight className="size-3 text-[hsl(0,0%,63.9%)]" />}
            </div>
            <div className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity">
              <FolderIcon className="size-3.5 text-amber-400" />
            </div>
          </div>
          <span className="truncate text-xs text-[hsl(240,4.8%,95.9%)]">{folder.name}</span>
        </div>
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
          <ActionMenu icon={<MoreHorizontal className="size-3.5" />}>
            <button onClick={() => onAction('rename', 'folder', folder.id, folder.name)} className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 hover:text-white flex items-center gap-2 cursor-pointer"><Pencil className="size-3.5 text-zinc-400" />Rename</button>
            <button onClick={() => onAction('delete', 'folder', folder.id, folder.name)} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 hover:text-red-300 flex items-center gap-2 cursor-pointer"><Trash2 className="size-3.5" />Delete</button>
          </ActionMenu>
        </div>
      </div>
      {isOpen && (
        <div className="pl-3 border-l border-[hsl(240,3.7%,15.9%)] ml-3 space-y-px">
          {folder.subfolders?.map((sub) => <FolderTreeItem key={sub.id} folder={sub} spaceId={spaceId} onAddFolder={onAddFolder} onAddDoc={onAddDoc} onAddPage={onAddPage} onAddList={onAddList} onAction={onAction} />)}
          {folder.lists?.map((list) => <ListTreeItem key={list.id} list={list} onAction={onAction} />)}
          {folder.docs?.map((doc) => <DocTreeItem key={doc.id} doc={doc} onAddPage={onAddPage} onAction={onAction} />)}
        </div>
      )}
    </div>
  );
}

function DocTreeItem({ doc, onAddPage, onAction }: {
  doc: Doc;
  onAddPage: (docId: string) => void;
  onAction: (action: 'rename' | 'duplicate' | 'delete', type: 'space' | 'folder' | 'doc' | 'page' | 'list', id: string, name: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const hasPages = doc.pages && doc.pages.length > 0;
  return (
    <div className="space-y-px">
      <div className="group flex items-center justify-between rounded-md px-2 py-1 text-xs text-[hsl(0,0%,63.9%)] hover:text-[hsl(240,4.8%,95.9%)] cursor-pointer hover:bg-[hsl(240,3.7%,15.9%)] transition-colors">
        <div className="flex items-center gap-2 truncate flex-1">
          <div onClick={(e) => { if (hasPages) { e.preventDefault(); setIsOpen(!isOpen); } }} className="relative size-3.5 flex items-center justify-center shrink-0">
            {hasPages && <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">{isOpen ? <ChevronDown className="size-3 text-[hsl(0,0%,63.9%)]" /> : <ChevronRight className="size-3 text-[hsl(0,0%,63.9%)]" />}</div>}
            <div className={`absolute inset-0 flex items-center justify-center ${hasPages ? 'group-hover:opacity-0' : ''} transition-opacity`}><FileText className="size-3.5 text-purple-400" /></div>
          </div>
          <Link href={`/docs/${doc.id}`} className="truncate flex-1"><span className="truncate">{doc.title}</span></Link>
        </div>
      </div>
      {isOpen && hasPages && (
        <div className="pl-3 border-l border-[hsl(240,3.7%,15.9%)] ml-3 space-y-px">
          {doc.pages?.map((page) => <PageTreeItem key={page.id} page={page} onAction={onAction} />)}
        </div>
      )}
    </div>
  );
}

function PageTreeItem({ page, onAction }: {
  page: Page;
  onAction: (action: 'rename' | 'duplicate' | 'delete', type: 'space' | 'folder' | 'doc' | 'page' | 'list', id: string, name: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const hasSubpages = page.subpages && page.subpages.length > 0;
  return (
    <div className="space-y-px">
      <div onClick={() => hasSubpages && setIsOpen(!isOpen)} className="flex items-center gap-2 rounded-md px-2 py-0.5 text-xs text-[hsl(0,0%,63.9%)] hover:text-[hsl(240,4.8%,95.9%)] cursor-pointer hover:bg-[hsl(240,3.7%,15.9%)] transition-colors">
        <FileText className="size-3 text-emerald-400 shrink-0 opacity-80" />
        <Link href={`/docs/${page.docId}?page=${page.id}`} className="truncate flex-1"><span className="truncate">{page.title}</span></Link>
      </div>
      {isOpen && hasSubpages && (
        <div className="pl-3 border-l border-[hsl(240,3.7%,15.9%)] ml-2 space-y-px">
          {page.subpages?.map((sub) => <PageTreeItem key={sub.id} page={sub} onAction={onAction} />)}
        </div>
      )}
    </div>
  );
}

function ListTreeItem({ list, onAction }: {
  list: List;
  onAction: (action: 'rename' | 'duplicate' | 'delete', type: 'space' | 'folder' | 'doc' | 'page' | 'list', id: string, name: string) => void;
}) {
  return (
    <Link href={`/lists/${list.id}`} className="group flex items-center gap-2 rounded-md px-2 py-1 text-xs text-[hsl(0,0%,63.9%)] hover:text-[hsl(240,4.8%,95.9%)] hover:bg-[hsl(240,3.7%,15.9%)] transition-colors">
      <ListIcon className="size-3.5 text-blue-400 shrink-0" />
      <span className="truncate">{list.name}</span>
    </Link>
  );
}
