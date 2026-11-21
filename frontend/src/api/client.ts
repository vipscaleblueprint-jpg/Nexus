import { isPerfEnabled, recordApi } from '@/lib/perfMonitor';
import { clearAllCaches } from '@/lib/store';

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/+$/, '');

export const API_BASE_URL = apiBaseUrl;

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
  _retry?: boolean;
  timeoutMs?: number;
}

// Single-flight lock for session refresh attempts so concurrent 401s don't hammer the endpoint
let sessionRefreshPromise: Promise<boolean> | null = null;

async function attemptSilentSessionRefresh(): Promise<boolean> {
  if (sessionRefreshPromise) return sessionRefreshPromise;

  sessionRefreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/session`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      return Boolean(data.authenticated && data.user);
    } catch {
      return false;
    } finally {
      sessionRefreshPromise = null;
    }
  })();

  return sessionRefreshPromise;
}

export async function apiClient<T = any>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { params, headers, _retry, timeoutMs = 45000, ...restOptions } = options;

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

  const method = (restOptions.method || 'GET').toUpperCase();
  const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;

  const externalSignal = restOptions.signal;
  const timeoutController = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let onExternalAbort: (() => void) | null = null;

  if (timeoutController) {
    if (externalSignal?.aborted) {
      timeoutController.abort();
    } else if (externalSignal) {
      onExternalAbort = () => timeoutController.abort();
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
      }, timeoutMs);
    }
  }

  let res: Response;
  try {
    res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      credentials: 'include',
      ...restOptions,
      ...(timeoutController ? { signal: timeoutController.signal } : {}),
    });
  } catch (err: any) {
    if (timeoutId) clearTimeout(timeoutId);
    if (externalSignal && onExternalAbort) externalSignal.removeEventListener('abort', onExternalAbort);
    if (isPerfEnabled()) recordApi(method, url, 0, performance.now() - startedAt, null);
    if (externalSignal?.aborted && !timedOut) {
      throw err;
    }
    console.warn(`[apiClient] Network request failed for ${url}:`, err?.message || err);
    if (timedOut) {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s while connecting to backend.`);
    }
    throw new Error(`Unable to connect to backend server at ${url}. Please make sure the server is running.`);
  }

  if (timeoutId) clearTimeout(timeoutId);
  if (externalSignal && onExternalAbort) externalSignal.removeEventListener('abort', onExternalAbort);

  const data = await res.json().catch(() => ({}));

  // Measured after the body is parsed, so large payloads show up in the timing
  if (isPerfEnabled()) recordApi(method, url, res.status, performance.now() - startedAt, res.headers.get('server-timing'));

  if (!res.ok) {
    if (res.status === 401) {
      const isAuthProbe =
        endpoint.includes('/api/auth/session') ||
        endpoint.includes('/api/auth/login') ||
        endpoint.includes('/api/auth/refresh');

      // Attempt transparent session refresh for data endpoints before giving up
      if (!isAuthProbe && !_retry) {
        const refreshed = await attemptSilentSessionRefresh();
        if (refreshed) {
          // Retry original request with fresh credentials
          return apiClient<T>(endpoint, { ...options, _retry: true });
        }
      }

      // If refresh failed or user is truly unauthenticated, handle redirect while preserving link
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        const currentPath = window.location.pathname + window.location.search + window.location.hash;
        const returnTo = currentPath && currentPath !== '/' && currentPath !== '/login'
          ? `?returnTo=${encodeURIComponent(currentPath)}`
          : '';
        clearAllCaches();
        window.location.replace(`/login${returnTo}`);
        return new Promise(() => {}) as Promise<T>;
      }
    }
    const errMsg = data.message || data.error || `HTTP error ${res.status}`;
    const error: any = new Error(errMsg);
    error.status = res.status;
    error.data = data;
    error.error = data.error;
    error.isClientLocked = Boolean(data.isClientLocked || data.error === 'CLIENT_LOCKED');
    error.clientName = data.clientName;
    error.hoursLogged = data.hoursLogged;
    error.weeklyLimit = data.weeklyLimit;
    error.response = { status: res.status, data };
    throw error;
  }

  return data as T;
}
