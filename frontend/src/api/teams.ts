import { apiClient } from './client';
import type { Team, TeamRole } from '@/lib/types';

export const getTeams = (): Promise<Team[]> => {
  return apiClient<Team[]>('/api/teams', { method: 'GET' });
};

export const createTeam = (data: { name: string; color?: string }): Promise<Team> => {
  return apiClient<Team>('/api/teams', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const updateTeam = (id: string, data: { name: string; color?: string }): Promise<Team> => {
  return apiClient<Team>(`/api/teams/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
};

export const deleteTeam = (id: string): Promise<void> => {
  return apiClient<void>(`/api/teams/${id}`, { method: 'DELETE' });
};

export const createTeamRole = (teamId: string, data: { name: string }): Promise<TeamRole> => {
  return apiClient<TeamRole>(`/api/teams/${teamId}/roles`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const updateTeamRole = (teamId: string, roleId: string, data: { name: string }): Promise<TeamRole> => {
  return apiClient<TeamRole>(`/api/teams/${teamId}/roles/${roleId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
};

export const deleteTeamRole = (teamId: string, roleId: string): Promise<void> => {
  return apiClient<void>(`/api/teams/${teamId}/roles/${roleId}`, { method: 'DELETE' });
};
