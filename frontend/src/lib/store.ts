import { create } from 'zustand';
import { User, Space } from './types';
import { spacesApi } from '@/api';

const SPACES_CACHE_KEY = 'nexus_spaces_cache';

function getCachedSpaces(): Space[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SPACES_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setCachedSpaces(spaces: Space[]) {
  try {
    localStorage.setItem(SPACES_CACHE_KEY, JSON.stringify(spaces));
  } catch {}
}

interface AppState {
  // Session User
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  
  // Spaces
  spaces: Space[];
  loadingSpaces: boolean;
  hasLoadedSpaces: boolean;
  hydrateFromCache: () => void;
  loadSpaces: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  currentUser: null,
  setCurrentUser: (user) => set({ currentUser: user }),
  
  // Always start with [] to avoid SSR/client hydration mismatch.
  // Call hydrateFromCache() in a client-side useEffect to get instant data.
  spaces: [],
  loadingSpaces: false,
  hasLoadedSpaces: false,
  hydrateFromCache: () => {
    const cached = getCachedSpaces();
    if (cached.length > 0) set({ spaces: cached });
  },
  loadSpaces: async () => {
    set({ loadingSpaces: true });
    try {
      const res = await spacesApi.getSpaces();
      if (res.spaces) {
        setCachedSpaces(res.spaces);
        set({ spaces: res.spaces });
      }
    } catch (e) {
      console.error('Failed to fetch spaces', e);
    } finally {
      set({ loadingSpaces: false, hasLoadedSpaces: true });
    }
  }
}));
