import { create } from 'zustand';
import { User, Space, Task, WorkspaceRole } from './types';
import { spacesApi, tasksApi } from '@/api';
import { getRoles } from '@/api/roles';
import { usersApi } from '@/api/users';

const SPACES_CACHE_KEY = 'nexus_spaces_cache';
const TASKS_CACHE_KEY = 'nexus_tasks_cache';
const ROLES_CACHE_KEY = 'nexus_roles_cache';
const USERS_CACHE_KEY = 'nexus_users_cache';
const TEAMS_CACHE_KEY = 'nexus_teams_cache';

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

function getCachedTasks(): Task[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TASKS_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function setCachedTasks(tasks: Task[]) {
  try {
    localStorage.setItem(TASKS_CACHE_KEY, JSON.stringify(tasks));
  } catch {}
}

const TASKS_CACHE_WRITE_DELAY_MS = 2000;
let tasksCacheWriteTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleCachedTasksWrite(getTasks: () => Task[]) {
  if (tasksCacheWriteTimer) clearTimeout(tasksCacheWriteTimer);
  tasksCacheWriteTimer = setTimeout(() => {
    tasksCacheWriteTimer = null;
    const currentTasks = getTasks();
    // Safeguard: Never overwrite a populated cache with an empty or suspiciously small list
    // (which happens if a single task socket arrives while on a different page before full list is loaded)
    const existing = getCachedTasks();
    if (existing.length > 5 && currentTasks.length < 5) {
      return;
    }
    setCachedTasks(currentTasks);
  }, TASKS_CACHE_WRITE_DELAY_MS);
}

function getCachedRoles(): WorkspaceRole[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ROLES_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function setCachedRoles(roles: WorkspaceRole[]) {
  try {
    localStorage.setItem(ROLES_CACHE_KEY, JSON.stringify(roles));
  } catch {}
}

function getCachedUsers(): User[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(USERS_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function setCachedUsers(users: User[]) {
  try {
    localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(users));
  } catch {}
}

function getCachedTeams(): any[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TEAMS_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function setCachedTeams(teams: any[]) {
  try {
    localStorage.setItem(TEAMS_CACHE_KEY, JSON.stringify(teams));
  } catch {}
}

let loadRolesPromise: Promise<void> | null = null;
let loadUsersPromise: Promise<void> | null = null;
let loadTeamsPromise: Promise<void> | null = null;

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

  // Tasks (Cached & Indexed)
  tasks: Task[];
  loadingTasks: boolean;
  hasLoadedTasks: boolean;
  tasksIndex: Record<string, Task>;
  hydrateTasksFromCache: () => void;
  loadTasks: (silent?: boolean) => Promise<void>;
  updateTask: (updatedTask: Task) => void;
  addTask: (newTask: Task) => void;
  removeTask: (taskId: string) => void;

  // Roles
  workspaceRoles: WorkspaceRole[];
  workspaceRolesIndex: Record<string, WorkspaceRole>;
  hasLoadedRoles: boolean;
  hydrateRolesFromCache: () => void;
  loadRoles: () => Promise<void>;

  // Users
  workspaceUsers: User[];
  workspaceUsersIndex: Record<string, User>;
  hasLoadedUsers: boolean;
  hydrateUsersFromCache: () => void;
  loadUsers: () => Promise<void>;

  // Teams
  workspaceTeams: any[];
  workspaceTeamsIndex: Record<string, any>;
  hasLoadedTeams: boolean;
  hydrateTeamsFromCache: () => void;
  loadTeams: () => Promise<void>;

  // Notifications
  unreadNotifications: number;
  setUnreadNotifications: (count: number) => void;
  decrementUnreadNotifications: () => void;

  // UI State
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
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

  // Tasks
  tasks: [],
  loadingTasks: false,
  hasLoadedTasks: false,
  tasksIndex: {},
  hydrateTasksFromCache: () => {
    const cached = getCachedTasks();
    if (cached && cached.length > 0) {
      const index: Record<string, Task> = {};
      cached.forEach(t => index[t.id] = t);
      set({ tasks: cached, tasksIndex: index, hasLoadedTasks: cached.length > 5 });
    }
  },
  loadTasks: async (silent = false) => {
    if (!silent) set({ loadingTasks: true });
    try {
      const res = await tasksApi.getTasks();
      if (res?.tasks) {
        setCachedTasks(res.tasks);
        const index: Record<string, Task> = {};
        res.tasks.forEach((t: Task) => index[t.id] = t);
        set({ tasks: res.tasks, tasksIndex: index, hasLoadedTasks: true });
      }
    } catch (err) {
      console.error("Failed to load tasks:", err);
    } finally {
      set({ loadingTasks: false, hasLoadedTasks: true });
    }
  },
  updateTask: (updatedTask) => set((state) => {
    let currentTasks = state.tasks;
    let currentIndex = state.tasksIndex;
    if (currentTasks.length === 0) {
      const cached = getCachedTasks();
      if (cached.length > 0) {
        currentTasks = cached;
        currentIndex = {};
        cached.forEach(t => currentIndex[t.id] = t);
      }
    }
    const exists = currentIndex[updatedTask.id];
    if (!exists) return state;
    const newTasks = currentTasks.map(t => t.id === updatedTask.id ? { ...t, ...updatedTask } : t);
    scheduleCachedTasksWrite(() => get().tasks);
    return {
      tasks: newTasks,
      tasksIndex: { ...currentIndex, [updatedTask.id]: { ...exists, ...updatedTask } }
    };
  }),
  addTask: (newTask) => set((state) => {
    let currentTasks = state.tasks;
    let currentIndex = state.tasksIndex;
    if (currentTasks.length === 0) {
      const cached = getCachedTasks();
      if (cached.length > 0) {
        currentTasks = cached;
        currentIndex = {};
        cached.forEach(t => currentIndex[t.id] = t);
      }
    }
    if (currentIndex[newTask.id]) return state; // Avoid duplicate
    const newTasks = [newTask, ...currentTasks];
    scheduleCachedTasksWrite(() => get().tasks);
    return {
      tasks: newTasks,
      tasksIndex: { ...currentIndex, [newTask.id]: newTask }
    };
  }),
  removeTask: (taskId) => set((state) => {
    let currentTasks = state.tasks;
    let currentIndex = state.tasksIndex;
    if (currentTasks.length === 0) {
      const cached = getCachedTasks();
      if (cached.length > 0) {
        currentTasks = cached;
        currentIndex = {};
        cached.forEach(t => currentIndex[t.id] = t);
      }
    }
    const newTasks = currentTasks.filter(t => t.id !== taskId);
    scheduleCachedTasksWrite(() => get().tasks);
    const newIndex = { ...currentIndex };
    delete newIndex[taskId];
    return {
      tasks: newTasks,
      tasksIndex: newIndex
    };
  }),

  // Roles
  workspaceRoles: [],
  workspaceRolesIndex: {},
  hasLoadedRoles: false,
  hydrateRolesFromCache: () => {
    const cached = getCachedRoles();
    if (cached && cached.length > 0) {
      const index: Record<string, WorkspaceRole> = {};
      cached.forEach(r => { index[r.id] = r; index[r.name] = r; });
      set({ workspaceRoles: cached, workspaceRolesIndex: index, hasLoadedRoles: true });
    }
  },
  loadRoles: async () => {
    if (loadRolesPromise) return loadRolesPromise;
    loadRolesPromise = (async () => {
      try {
        const roles = await getRoles();
        if (roles) {
          setCachedRoles(roles);
          const index: Record<string, WorkspaceRole> = {};
          roles.forEach((r: WorkspaceRole) => { index[r.id] = r; index[r.name] = r; });
          set({ workspaceRoles: roles, workspaceRolesIndex: index, hasLoadedRoles: true });
        }
      } catch (err) {
        console.warn("Failed to load roles:", err);
      } finally {
        loadRolesPromise = null;
      }
    })();
    return loadRolesPromise;
  },

  // Users
  workspaceUsers: [],
  workspaceUsersIndex: {},
  hasLoadedUsers: false,
  hydrateUsersFromCache: () => {
    const cached = getCachedUsers();
    if (cached && cached.length > 0) {
      const index: Record<string, User> = {};
      cached.forEach(u => index[u.id] = u);
      set({ workspaceUsers: cached, workspaceUsersIndex: index, hasLoadedUsers: true });
    }
  },
  loadUsers: async () => {
    if (loadUsersPromise) return loadUsersPromise;
    loadUsersPromise = (async () => {
      try {
        const res = await usersApi.getUsers();
        if (res?.users) {
          setCachedUsers(res.users);
          const index: Record<string, User> = {};
          res.users.forEach((u: User) => index[u.id] = u);
          set({ workspaceUsers: res.users, workspaceUsersIndex: index, hasLoadedUsers: true });
        }
      } catch (err) {
        console.warn("Failed to load users:", err);
      } finally {
        loadUsersPromise = null;
      }
    })();
    return loadUsersPromise;
  },

  // Teams
  workspaceTeams: [],
  workspaceTeamsIndex: {},
  hasLoadedTeams: false,
  hydrateTeamsFromCache: () => {
    const cached = getCachedTeams();
    if (cached && cached.length > 0) {
      const index: Record<string, any> = {};
      cached.forEach(t => index[t.id] = t);
      set({ workspaceTeams: cached, workspaceTeamsIndex: index, hasLoadedTeams: true });
    }
  },
  loadTeams: async () => {
    if (loadTeamsPromise) return loadTeamsPromise;
    loadTeamsPromise = (async () => {
      try {
        const res = await usersApi.getTeams();
        if (res?.teams) {
          setCachedTeams(res.teams);
          const index: Record<string, any> = {};
          res.teams.forEach((t: any) => index[t.id] = t);
          set({ workspaceTeams: res.teams, workspaceTeamsIndex: index, hasLoadedTeams: true });
        }
      } catch (err) {
        console.warn("Failed to load teams:", err);
      } finally {
        loadTeamsPromise = null;
      }
    })();
    return loadTeamsPromise;
  },

  unreadNotifications: 0,
  setUnreadNotifications: (count) => set({ unreadNotifications: count }),
  decrementUnreadNotifications: () => set((state) => ({ unreadNotifications: Math.max(0, state.unreadNotifications - 1) })),

  isSidebarCollapsed: true,
  toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
}));
