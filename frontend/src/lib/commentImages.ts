/**
 * Utilities for extracting and ordering images in comments for lightbox navigation.
 */

export function extractImagesFromContent(content: string): string[] {
  if (!content || typeof content !== 'string') return [];

  const found: { url: string; index: number }[] = [];

  // 1. Match HTML <img> tags
  const imgRegex = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRegex.exec(content)) !== null) {
    if (m[1]) {
      found.push({ url: m[1], index: m.index });
    }
  }

  // 2. Match Markdown image syntax: ![alt](url)
  const mdImgRegex = /!\[[^\]]*\]\((https?:\/\/[^\s\)]+|\/uploads\/[^\s\)]+)\)/gi;
  while ((m = mdImgRegex.exec(content)) !== null) {
    if (m[1]) {
      found.push({ url: m[1], index: m.index });
    }
  }

  // 3. Match <a> links or markdown links that point directly to an image file
  const linkImgRegex = /(?:<a\b[^>]*?\bhref=["']|(?<!\!)\[[^\]]*\]\()([^"'\)\s]+\.(?:jpe?g|png|gif|webp|svg|avif)(?:\?[^"'\s\)]*)?)/gi;
  while ((m = linkImgRegex.exec(content)) !== null) {
    if (m[1]) {
      found.push({ url: m[1], index: m.index });
    }
  }

  // Sort by visual appearance order in the source content
  found.sort((a, b) => a.index - b.index);

  // Filter overlapping captures
  const result: string[] = [];
  const seenIndices = new Set<number>();
  for (const item of found) {
    let overlap = false;
    for (const idx of seenIndices) {
      if (Math.abs(idx - item.index) < 6) {
        overlap = true;
        break;
      }
    }
    if (!overlap) {
      seenIndices.add(item.index);
      result.push(item.url);
    }
  }

  return result;
}

/**
 * Extracts all image URLs across comments and replies in chronological feed order (top/above to bottom/underneath).
 */
export function extractImagesFromComments(comments: any[]): string[] {
  if (!comments || !Array.isArray(comments)) return [];

  // Sort chronologically ascending (older comments at top, newer at bottom)
  const sortedComments = [...comments].sort((a, b) => {
    const timeA = new Date(a.createdAt || a.date || 0).getTime();
    const timeB = new Date(b.createdAt || b.date || 0).getTime();
    return timeA - timeB;
  });

  const result: string[] = [];

  for (const c of sortedComments) {
    if (c.content) {
      const urls = extractImagesFromContent(c.content);
      for (const u of urls) {
        if (!result.includes(u)) {
          result.push(u);
        }
      }
    }

    if (Array.isArray(c.replies) && c.replies.length > 0) {
      const sortedReplies = [...c.replies].sort((a, b) => {
        const timeA = new Date(a.createdAt || a.date || 0).getTime();
        const timeB = new Date(b.createdAt || b.date || 0).getTime();
        return timeA - timeB;
      });
      for (const r of sortedReplies) {
        if (r.content) {
          const urls = extractImagesFromContent(r.content);
          for (const u of urls) {
            if (!result.includes(u)) {
              result.push(u);
            }
          }
        }
      }
    }
  }

  return result;
}
