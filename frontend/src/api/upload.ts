import { API_BASE_URL } from './client';
import { validateUploadFile } from '@/lib/fileValidation';

export const uploadApi = {
  uploadFile: async (file: File, folder?: string): Promise<{ url: string; name: string }> => {
    const check = validateUploadFile(file);
    if (!check.valid) {
      throw new Error(check.error || 'File cannot be uploaded');
    }

    const formData = new FormData();
    formData.append('file', file);
    if (folder) {
      formData.append('folder', folder);
    }

    const res = await fetch(`${API_BASE_URL}/api/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to upload file');
    }

    return res.json();
  },

  /** Has the server copy an image from a link into our storage (for hosts the browser can't read from). */
  uploadFromUrl: async (url: string, folder?: string): Promise<{ url: string; name: string }> => {
    const res = await fetch(`${API_BASE_URL}/api/upload/from-url`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, folder }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to copy image');
    }

    return res.json();
  },

  uploadConfetti: async (file: File): Promise<{ url: string; user: any }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', 'nexus-confetti');

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const res = await fetch(`${API_BASE_URL}/api/upload/confetti`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to upload confetti image');
    }

    return res.json();
  },

  deleteConfetti: async (): Promise<{ user: any }> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const res = await fetch(`${API_BASE_URL}/api/upload/confetti`, {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete confetti image');
    }

    return res.json();
  },

  uploadSound: async (file: File, category?: string): Promise<{ url: string; user: any; category?: string; soundId?: string; name?: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', 'nexus-sounds');
    if (category) {
      formData.append('category', category);
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const res = await fetch(`${API_BASE_URL}/api/upload/sound`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to upload notification sound');
    }

    return res.json();
  },

  deleteSound: async (params?: { category?: string; soundId?: string; soundUrl?: string } | string): Promise<{ user: any }> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const searchParams = new URLSearchParams();
    if (typeof params === 'string') {
      searchParams.append('category', params);
    } else if (params) {
      if (params.category) searchParams.append('category', params.category);
      if (params.soundId) searchParams.append('soundId', params.soundId);
      if (params.soundUrl) searchParams.append('soundUrl', params.soundUrl);
    }
    const query = searchParams.toString();
    const url = `${API_BASE_URL}/api/upload/sound${query ? `?${query}` : ''}`;
    const res = await fetch(url, {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete notification sound');
    }

    return res.json();
  },
};
