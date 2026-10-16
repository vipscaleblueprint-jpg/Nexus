import { API_BASE_URL } from './client';

export const uploadApi = {
  uploadFile: async (file: File, folder?: string): Promise<{ url: string; name: string }> => {
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
};
