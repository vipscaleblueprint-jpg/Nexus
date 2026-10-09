import { apiClient } from './client';

export interface ClickUpMapping {
  nexusListId: string;
  nexusListName: string;
  clickUpListId: string;
  space?: { id: string; name: string } | null;
  folder?: { id: string; name: string } | null;
}

export interface ClickUpWorkspace {
  id: string;
  name: string;
  color?: string;
  avatar?: string;
}

export interface ClickUpSpace {
  id: string;
  name: string;
}

export interface ClickUpFolder {
  id: string;
  name: string;
}

export interface ClickUpList {
  id: string;
  name: string;
  task_count?: number;
}

export interface ClickUpSyncSummary {
  startedAt: string;
  finishedAt?: string;
  lists: number;
  tasksCreated: number;
  tasksUpdated: number;
  subtasks: number;
  checklists: number;
  checklistItems: number;
  comments: number;
  attachments: number;
  statusesCreated: number;
  unmatchedUsers: string[];
  /** Failures left after the server's automatic retries. */
  errors: string[];
  listResults: ClickUpListResult[];
  /** The list being pulled right now; absent once finished. */
  currentList?: string;
}

export interface ClickUpListResult {
  name: string;
  created: number;
  updated: number;
  subtasks: number;
  retried: number;
  failed: number;
}

export const clickUpApi = {
  /** Test ClickUp connectivity — returns the authenticated user. */
  async getStatus(): Promise<{ ok: boolean; user?: any; error?: string }> {
    return apiClient('/api/clickup/status');
  },

  /** Get all ClickUp workspaces for the API key. */
  async getWorkspaces(): Promise<{ teams: ClickUpWorkspace[] }> {
    return apiClient('/api/clickup/workspaces');
  },

  /** Get all spaces in a workspace. */
  async getSpaces(teamId: string): Promise<{ spaces: ClickUpSpace[] }> {
    return apiClient(`/api/clickup/workspaces/${teamId}/spaces`);
  },

  /** Get all folders in a space. */
  async getFolders(spaceId: string): Promise<{ folders: ClickUpFolder[] }> {
    return apiClient(`/api/clickup/spaces/${spaceId}/folders`);
  },

  /** Get all lists inside a folder. */
  async getFolderLists(folderId: string): Promise<{ lists: ClickUpList[] }> {
    return apiClient(`/api/clickup/folders/${folderId}/lists`);
  },

  /** Get all folderless lists in a space. */
  async getFolderlessLists(spaceId: string): Promise<{ lists: ClickUpList[] }> {
    return apiClient(`/api/clickup/spaces/${spaceId}/folderless-lists`);
  },

  /** Get all Nexus→ClickUp list mappings. */
  async getMappings(): Promise<{ mappings: ClickUpMapping[] }> {
    return apiClient('/api/clickup/mappings');
  },

  /** Create a new Nexus→ClickUp list mapping. */
  async createMapping(nexusListId: string, clickUpListId: string): Promise<{ ok: boolean; mapping: ClickUpMapping }> {
    return apiClient('/api/clickup/mappings', {
      method: 'POST',
      body: JSON.stringify({ nexusListId, clickUpListId }),
    });
  },

  /** Remove a Nexus→ClickUp list mapping. */
  async deleteMapping(nexusListId: string): Promise<{ ok: boolean }> {
    return apiClient(`/api/clickup/mappings/${nexusListId}`, { method: 'DELETE' });
  },

  /** Get recent tasks synced to ClickUp. */
  async getRecentActivity(limit = 20): Promise<{ tasks: any[] }> {
    return apiClient(`/api/clickup/recent-activity?limit=${limit}`);
  },

  /** Proxy-fetch a single ClickUp task by its ClickUp task ID. */
  async getClickUpTask(taskId: string): Promise<{ task: any }> {
    return apiClient(`/api/clickup/tasks/${taskId}`);
  },

  /**
   * Start pulling every mapped ClickUp list into Nexus (active tasks unless includeClosed).
   * Runs in the background; poll getSyncStatus. started=false means one is already running.
   */
  async syncAll(includeClosed = false): Promise<{ ok: boolean; started: boolean }> {
    return apiClient('/api/clickup/sync-all', { method: 'POST', body: JSON.stringify({ includeClosed }) });
  },

  /** Whether a pull is running, with its live progress — or the last finished one. */
  async getSyncStatus(): Promise<{ running: boolean; summary: ClickUpSyncSummary | null }> {
    return apiClient('/api/clickup/sync-status');
  },
};
