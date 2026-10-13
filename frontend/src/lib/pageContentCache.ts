// In-memory cache of doc page content (e.g. journal days), so switching back to a date shows it instantly.
// Each entry carries the page's server updatedAt; callers revalidate with GET /pages/:id?since=<updatedAt>,
// so server-side changes (auto-appended tasks, other users' saves) always replace a cached copy.
// Kept for the browser session only, and only for the most recently opened pages.

export type CachedPage = { content: string; updatedAt: string };

const MAX_PAGES = 10;
const cache = new Map<string, CachedPage>();

export function getCachedPage(pageId: string): CachedPage | undefined {
  const entry = cache.get(pageId);
  if (entry) {
    // Re-insert so the Map's order tracks recency
    cache.delete(pageId);
    cache.set(pageId, entry);
  }
  return entry;
}

export function setCachedPage(pageId: string, content: string, updatedAt: string | Date | undefined) {
  if (!updatedAt) return;
  cache.delete(pageId);
  cache.set(pageId, { content, updatedAt: new Date(updatedAt).toISOString() });
  while (cache.size > MAX_PAGES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function forgetCachedPage(pageId: string) {
  cache.delete(pageId);
}
