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

/**
 * Comment HTML from the editor can begin with an inline-placed image. Markdown only treats a line
 * as raw HTML when it opens with a block tag, so an <img> first would turn the rest into markdown;
 * an empty leading <p> keeps the whole comment as HTML.
 */
export function commentHtmlForMarkdown(content: string): string {
  return /^\s*<img\b/i.test(content) ? `<p></p>${content}` : content;
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
