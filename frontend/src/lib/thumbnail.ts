/**
 * Utility for generating compressed thumbnail URLs (1-15kb) for BlurUP previews.
 */

export function isVectorOrDataUrl(src: string): boolean {
  if (!src) return false;
  return (
    src.startsWith('data:') ||
    src.endsWith('.svg') ||
    src.includes('.svg?')
  );
}

/**
 * Returns a compressed thumbnail URL (1-15kb WebP) for an image URL.
 * Bypasses inline data URLs and SVGs (which are already tiny).
 */
export function getThumbnailUrl(src: string, width = 360, quality = 35): string {
  if (!src) return '';
  if (isVectorOrDataUrl(src)) {
    return src;
  }
  if (src.startsWith('/api/thumbnail')) {
    return src;
  }
  return `/api/thumbnail?url=${encodeURIComponent(src)}&w=${width}&q=${quality}`;
}
