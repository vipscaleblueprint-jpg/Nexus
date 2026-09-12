import { create } from 'zustand';
import { User, Space } from './types';
import { spacesApi } from '@/api';

const SPACES_CACHE_KEY = 'nexus_spaces_cache';

function getCachedSpaces(): { spaces: Space[], allLists: any[], allDocs: any[] } {
  if (typeof window === 'undefined') return { spaces: [], allLists: [], allDocs: [] };
  try {
    const raw = localStorage.getItem(SPACES_CACHE_KEY);
    if (!raw) return { spaces: [], allLists: [], allDocs: [] };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { spaces: parsed, allLists: [], allDocs: [] };
    }
    return parsed;
  } catch {
    return { spaces: [], allLists: [], allDocs: [] };
  }
}

function setCachedSpaces(spaces: Space[], allLists?: any[], allDocs?: any[]) {
  try {
    localStorage.setItem(SPACES_CACHE_KEY, JSON.stringify({ spaces, allLists, allDocs }));
  } catch {}
}

interface AppState {
  // Session User
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  
  // Spaces
  spaces: Space[];
  allLists: any[];
  allDocs: any[];
  loadingSpaces: boolean;
  hasLoadedSpaces: boolean;
  hydrateFromCache: () => void;
  loadSpaces: () => Promise<void>;

  // Notifications
  unreadNotifications: number;
  setUnreadNotifications: (count: number) => void;
  decrementUnreadNotifications: () => void;

  // UI State
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentUser: null,
  setCurrentUser: (user) => set({ currentUser: user }),
  
  // Always start with [] to avoid SSR/client hydration mismatch.
  // Call hydrateFromCache() in a client-side useEffect to get instant data.
  spaces: [],
  allLists: [],
  allDocs: [],
  loadingSpaces: false,
  hasLoadedSpaces: false,
  hydrateFromCache: () => {
    const cached = getCachedSpaces();
    if (cached.spaces && cached.spaces.length > 0) {
      set({ spaces: cached.spaces, allLists: cached.allLists || [], allDocs: cached.allDocs || [] });
    }
  },
  loadSpaces: async () => {
    set({ loadingSpaces: true });
    try {
      const res = await spacesApi.getSpaces();
      if (res.spaces) {
        setCachedSpaces(res.spaces, res.allLists, res.allDocs);
        set({ spaces: res.spaces, allLists: res.allLists || [], allDocs: res.allDocs || [] });
      }
    } catch (e) {
      console.error('Failed to fetch spaces', e);
    } finally {
      set({ loadingSpaces: false, hasLoadedSpaces: true });
    }
  },

  unreadNotifications: 0,
  setUnreadNotifications: (count) => set({ unreadNotifications: count }),
  decrementUnreadNotifications: () => set((state) => ({ unreadNotifications: Math.max(0, state.unreadNotifications - 1) })),

  isSidebarCollapsed: true,
  toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
}));
