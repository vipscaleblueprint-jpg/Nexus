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
};
