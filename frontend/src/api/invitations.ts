import { apiClient } from './client';
import { Invitation, SystemRole, EmploymentType } from '@/lib/types';

export interface CreateInvitationPayload {
  email: string;
  role?: SystemRole;
  employmentType?: EmploymentType;
  expiresInDays?: number;
}

export const invitationsApi = {
  async getInvitations(): Promise<{ invitations: Invitation[] }> {
    return apiClient<{ invitations: Invitation[] }>('/api/invitations', {
      method: 'GET',
    });
  },

  async createInvitation(data: CreateInvitationPayload): Promise<{ invitation: Invitation }> {
    return apiClient<{ invitation: Invitation }>('/api/invitations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async revokeInvitation(id: string): Promise<{ message: string }> {
    return apiClient<{ message: string }>(`/api/invitations/${id}`, {
      method: 'DELETE',
    });
  },

  async resendInvitation(id: string): Promise<{ invitation: Invitation }> {
    return apiClient<{ invitation: Invitation }>(`/api/invitations/${id}/resend`, {
      method: 'POST',
    });
  },
};
