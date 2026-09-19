const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/+$/, '');

export const API_BASE_URL = apiBaseUrl;

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

export async function apiClient<T = any>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { params, headers, ...restOptions } = options;

  let url = endpoint.startsWith('http')
    ? endpoint
    : `${API_BASE_URL}/${endpoint.replace(/^\/+/, '')}`;

  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      credentials: 'include',
      ...restOptions,
    });
  } catch (err: any) {
    console.warn(`[apiClient] Network request failed for ${url}:`, err?.message || err);
    throw new Error(`Unable to connect to backend server at ${url}. Please make sure the server is running.`);
  }

  const data = await res.json().catch(() => {
    // Token expired or invalid — redirect to login
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    return {};
  });

  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
      // Return a pending promise so no error gets thrown while navigating
      return new Promise(() => {}) as Promise<T>;
    }
    throw new Error(data.error || data.message || `HTTP error ${res.status}`);
  }

  return data as T;
}
