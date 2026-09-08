import { apiClient } from './client';
import type { WorkspaceRole } from '../types/models';

export const getRoles = (): Promise<WorkspaceRole[]> => {
  return apiClient<WorkspaceRole[]>('/api/roles', { method: 'GET' });
};

export const createRole = (data: { name: string; color?: string }): Promise<WorkspaceRole> => {
  return apiClient<WorkspaceRole>('/api/roles', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const deleteRole = (id: string): Promise<void> => {
  return apiClient<void>(`/api/roles/${id}`, { method: 'DELETE' });
};
