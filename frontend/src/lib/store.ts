import { create } from 'zustand';
import { User, Space } from './types';
import { spacesApi } from '@/api';

interface AppState {
  // Session User
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  
  // Spaces
  spaces: Space[];
  loadingSpaces: boolean;
  hasLoadedSpaces: boolean;
  loadSpaces: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  currentUser: null,
  setCurrentUser: (user) => set({ currentUser: user }),
  
  spaces: [],
  loadingSpaces: false,
  hasLoadedSpaces: false,
  loadSpaces: async () => {
    set({ loadingSpaces: true });
    try {
      const res = await spacesApi.getSpaces();
      if (res.spaces) {
        set({ spaces: res.spaces });
      }
    } catch (e) {
      console.error('Failed to fetch spaces', e);
    } finally {
      set({ loadingSpaces: false, hasLoadedSpaces: true });
    }
  }
}));

