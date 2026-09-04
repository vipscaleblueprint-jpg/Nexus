import { create } from 'zustand';
import { User } from './types';

interface AppState {
  // Session User
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentUser: null,
  setCurrentUser: (user) => set({ currentUser: user }),
}));
