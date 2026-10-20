import type { Root, Element, ElementContent, Parent, Text } from 'hast';

/**
 * Turns user-entered link targets into absolute URLs. Without a protocol the browser
 * resolves "www.example.com" relative to the current page (e.g. /tasks/www.example.com).
 */
export function normalizeHref(href: string | null | undefined): string {
  const value = (href || '').trim();
  if (!value) return '';
  if (/^(https?:|mailto:|tel:|mention:|blob:|data:)/i.test(value)) return value;
  if (value.startsWith('/') || value.startsWith('#')) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value; // other explicit schemes
  return `https://${value.replace(/^\/\/+/, '')}`;
}

/** Opens an external link in a new tab without giving it access to this window. */
export function openExternalLink(href: string | null | undefined) {
  const url = normalizeHref(href);
  if (!url || url.startsWith('mention:')) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

// Bare domains (e.g. mail.google.com/...) only link for common TLDs so text like "file.txt"
// or "v1.2" isn't turned into a link.
const BARE_DOMAIN_TLDS = 'com|net|org|io|co|dev|app|ai|gov|edu|me|ph|us|uk|au|ca|info|biz|xyz|tech|site|online|so|ly|gg|tv|to|link|page|cloud|store|shop';

// http(s)://…, www.…, or a bare domain with a known TLD, up to whitespace/quotes/angle brackets.
// The lookbehind skips emails (user@gmail.com) and subparts of longer tokens.
// Trailing punctuation is trimmed below.
const URL_RE = new RegExp(
  `\\b(?:https?:\\/\\/|www\\.)[^\\s<>"']+` +
  `|(?<![@\\w.\\/-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${BARE_DOMAIN_TLDS})(?![a-z0-9-])(?::\\d+)?(?:[\\/?#][^\\s<>"']*)?`,
  'gi'
);
const TRAILING_PUNCT_RE = /[.,;:!?)\]}'"]+$/;
const SKIP_TAGS = new Set(['a', 'code', 'pre', 'button', 'script', 'style']);

function linkifyText(node: Text): ElementContent[] | null {
  const value = node.value;
  URL_RE.lastIndex = 0;
  if (!URL_RE.test(value)) return null;
  URL_RE.lastIndex = 0;

  const out: ElementContent[] = [];
  let last = 0;
  for (const match of value.matchAll(URL_RE)) {
    const raw = match[0];
    const trimmed = raw.replace(TRAILING_PUNCT_RE, '');
    if (!trimmed || trimmed === 'www.') continue;
    const start = match.index ?? 0;
    if (start > last) out.push({ type: 'text', value: value.slice(last, start) });
    out.push({
      type: 'element',
      tagName: 'a',
      properties: { href: normalizeHref(trimmed) },
      children: [{ type: 'text', value: trimmed }],
    });
    last = start + trimmed.length;
  }
  if (out.length === 0) return null;
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

function walk(parent: Parent) {
  const next: typeof parent.children = [];
  let changed = false;
  for (const child of parent.children) {
    if (child.type === 'text') {
      const replaced = linkifyText(child);
      if (replaced) {
        next.push(...replaced);
        changed = true;
        continue;
      }
    } else if (child.type === 'element' && !SKIP_TAGS.has((child as Element).tagName)) {
      walk(child as Element);
    }
    next.push(child);
  }
  if (changed) parent.children = next;
}

const knownTagCache = new Map<string, boolean>();

function isKnownHtmlTag(tagName: string): boolean {
  if (typeof document === 'undefined') return true;
  const cached = knownTagCache.get(tagName);
  if (cached !== undefined) return cached;
  // Same check React uses for its "tag is unrecognized" warning; custom elements (with "-") are allowed
  const known = tagName.includes('-') || !(document.createElement(tagName) instanceof HTMLUnknownElement);
  knownTagCache.set(tagName, known);
  return known;
}

function restoreUnknownTags(parent: Parent) {
  const next: typeof parent.children = [];
  let changed = false;
  for (const child of parent.children) {
    if (child.type === 'element') {
      restoreUnknownTags(child);
      if (!isKnownHtmlTag(child.tagName)) {
        next.push({ type: 'text', value: `<${child.tagName}>` }, ...child.children);
        changed = true;
        continue;
      }
    }
    next.push(child);
  }
  if (changed) parent.children = next;
}

const EMPTY_PARAGRAPH = String.raw`<p[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>`;
const LEADING_EMPTY_PARAGRAPHS = new RegExp(`^(?:\\s*${EMPTY_PARAGRAPH})+`, 'i');
const TRAILING_EMPTY_PARAGRAPHS = new RegExp(`(?:${EMPTY_PARAGRAPH}\\s*)+$`, 'i');

/** Comment editor HTML with blank lines removed from the start and end. */
export function trimCommentHtml(html: string): string {
  return html.trim().replace(LEADING_EMPTY_PARAGRAPHS, '').replace(TRAILING_EMPTY_PARAGRAPHS, '').trim();
}

/** True when comment HTML has no visible text and no image/video, e.g. only blank lines. */
export function isBlankCommentHtml(html: string): boolean {
  if (/<(img|video)\b/i.test(html)) return false;
  return !html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
}

/** Decodes standalone Unicode emoji hex tokens (e.g. 1F60A, 1F562, 26A1) in text strings */
export function decodeEmojiHexTokens(text: string): string {
  if (!text) return '';
  return text.replace(/\b(1F[0-9A-Fa-f]{3,4}|2[67][0-9A-Fa-f]{2})\b/g, (match) => {
    try {
      const code = parseInt(match, 16);
      if ((code >= 0x1F000 && code <= 0x1FAFF) || (code >= 0x2600 && code <= 0x27BF)) {
        return String.fromCodePoint(code);
      }
      return match;
    } catch {
      return match;
    }
  });
}

/**
 * Comment HTML from the editor can begin with an inline-placed image. Markdown only treats a line
 * as raw HTML when it opens with a block tag, so an <img> first would turn the rest into markdown;
 * an empty leading <p> keeps the whole comment as HTML.
 * Also safely decodes any ClickUp emoji hex codes (e.g. 1F60A, 1F562) into real Unicode emojis.
 */
export function commentHtmlForMarkdown(content: string): string {
  if (!content) return '';
  const decoded = decodeEmojiHexTokens(content);
  return /^\s*<img\b/i.test(decoded) ? `<p></p>${decoded}` : decoded;
}

/**
 * Rehype plugin (run after rehype-raw): plain text like "/tasks/<id>" in a comment is parsed
 * as an <id> element, which React rejects and which hides the text inside it. Unknown tags
 * are turned back into literal text, keeping their contents.
 */
export function rehypeUnknownTagsToText() {
  return (tree: Root) => {
    restoreUnknownTags(tree);
  };
}

/**
 * Rehype plugin: converts bare URLs in text into links. Comments are stored as HTML and
 * rendered through rehype-raw, so remark-gfm's autolinking never sees their text, and the
 * editor only autolinks a URL once a space is typed after it.
 */
export function rehypeLinkify() {
  return (tree: Root) => {
    walk(tree);
  };
}

export interface NexusTaskLinkInfo {
  taskId: string;
  subtaskId?: string;
  listId?: string;
  isSubtask: boolean;
  originalUrl: string;
}

/**
 * Checks if a string or URL is specifically a Nexus task or subtask link.
 * Strict check: returns null for any third-party domain (e.g. GitHub, Google, ClickUp).
 */
export function parseNexusTaskLink(input: string | null | undefined): NexusTaskLinkInfo | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    if (trimmed.startsWith('/') || trimmed.startsWith('?')) {
      url = new URL(trimmed, 'https://nexus.vipscaleph.com');
    } else if (/^https?:\/\//i.test(trimmed)) {
      url = new URL(trimmed);
    } else if (/^(?:www\.)?nexus\.vipscaleph\.com/i.test(trimmed)) {
      url = new URL(`https://${trimmed.replace(/^\/\//, '')}`);
    } else {
      return null;
    }
  } catch {
    return null;
  }

  // Domain verification: must strictly be a Nexus host or local development origin
  const hostname = url.hostname.toLowerCase();
  const currentHost = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';
  const isNexusDomain =
    hostname === 'nexus.vipscaleph.com' ||
    hostname.endsWith('.vipscaleph.com') ||
    (currentHost && (hostname === currentHost || hostname === 'localhost' || hostname === '127.0.0.1')) ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1';

  if (!isNexusDomain) {
    return null;
  }

  const pathname = url.pathname;
  const taskQuery = url.searchParams.get('task');
  const subtaskQuery = url.searchParams.get('subtask');

  let listId: string | undefined;
  let taskId: string | undefined;
  let subtaskId: string | undefined;

  const listMatch = pathname.match(/\/lists\/([a-zA-Z0-9_-]+)/);
  if (listMatch) {
    listId = listMatch[1];
  }

  const taskMatch = pathname.match(/\/tasks\/([a-zA-Z0-9_-]+)/);
  if (taskMatch) {
    taskId = taskMatch[1];
  }

  if (taskQuery) {
    taskId = taskQuery;
  }
  if (subtaskQuery) {
    subtaskId = subtaskQuery;
  }

  if (!taskId && !subtaskId) {
    return null;
  }

  const effectiveId = subtaskId || taskId!;
  const isSubtask = Boolean(subtaskId);

  return {
    taskId: effectiveId,
    subtaskId: subtaskId || undefined,
    listId,
    isSubtask,
    originalUrl: trimmed,
  };
}
