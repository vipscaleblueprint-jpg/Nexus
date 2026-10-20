/**
 * clickupCommentConverter.ts
 *
 * Converts rich HTML content from Nexus's Tiptap comment editor into ClickUp's
 * native rich comment format (Quill Delta segments) and clean markdown/plain-text fallback.
 *
 * Preserves:
 * - Author prefix formatted cleanly as [Name] (no asterisks ****)
 * - Spacing, blank lines, and line breaks
 * - Emojis and Unicode symbols
 * - Basic formatting (bold, italic, underline, strikethrough, inline code)
 * - Sizes / Headings (H1, H2, H3)
 * - Text colors and highlights
 * - Pill badges (mapped to ClickUp's native badge-class)
 * - Lists (bullet, ordered, checklist)
 * - Quotes and code blocks
 * - Images (extracted for task attachment upload + inline card display)
 */

export interface ExtractedImage {
  src: string;
  alt: string;
}

export interface ClickUpSegment {
  text?: string;
  type?: string;
  attributes?: Record<string, any>;
  image?: {
    id?: string;
    name?: string;
    url?: string;
    thumbnail_small?: string;
    thumbnail_large?: string;
    uploaded?: boolean;
    [key: string]: any;
  };
}

export interface ConvertedComment {
  comment: ClickUpSegment[];
  comment_text: string;
  images: ExtractedImage[];
}

const BADGE_COLOR_MAP: Record<string, string> = {
  '#c62828': 'red',
  '#fcd9d9': 'red',
  '#f57c00': 'orange',
  '#fdd9b5': 'orange',
  '#f5b417': 'yellow',
  '#fdecb5': 'yellow',
  '#1565c0': 'blue',
  '#d3e5fb': 'blue',
  '#5b3fd6': 'purple',
  '#dedbfb': 'purple',
  '#e0407b': 'pink',
  '#f9d6e4': 'pink',
  '#2e8b57': 'green',
  '#d0ecd9': 'green',
  '#c4c4c4': 'gray',
  '#e2e2e2': 'gray',
};

const COLOR_NAMES: Record<string, string> = {
  '#ef4444': 'red',
  '#f97316': 'orange',
  '#eab308': 'yellow',
  '#22c55e': 'green',
  '#14b8a6': 'teal',
  '#3b82f6': 'blue',
  '#6366f1': 'purple',
  '#d946ef': 'pink',
  '#52525b': 'gray',
};

export function normalizeHex(color: string): string {
  if (!color) return '';
  color = color.trim().toLowerCase();
  if (color.startsWith('#')) {
    if (color.length === 4) {
      return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
    }
    return color.substring(0, 7);
  }
  const rgbMatch = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10).toString(16).padStart(2, '0');
    const g = parseInt(rgbMatch[2], 10).toString(16).padStart(2, '0');
    const b = parseInt(rgbMatch[3], 10).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return color;
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return _;
      }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return _;
      }
    });
}

/**
 * Downloads binary image data from a URL or parses base64 data URI.
 */
export async function fetchImageBuffer(
  imageUrl: string
): Promise<{ buffer: Buffer; filename: string; mimetype: string } | null> {
  try {
    if (!imageUrl) return null;

    if (imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return null;
      const mimetype = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      const ext = mimetype.split('/')[1] || 'png';
      return { buffer, filename: `image-${Date.now()}.${ext}`, mimetype };
    }

    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const res = await fetch(imageUrl);
      if (!res.ok) {
        console.error(`[ClickUp] fetchImageBuffer failed (${res.status}) for ${imageUrl}`);
        return null;
      }
      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const mimetype = res.headers.get('content-type') || 'image/png';
      const parsedUrl = new URL(imageUrl);
      const pathname = parsedUrl.pathname;
      const rawName = pathname.split('/').pop() || `image-${Date.now()}.png`;
      const filename = decodeURIComponent(rawName);
      return { buffer, filename, mimetype };
    }

    return null;
  } catch (err) {
    console.error('[ClickUp] fetchImageBuffer error:', err);
    return null;
  }
}

/**
 * Converts Nexus comment HTML into ClickUp Delta segments and plain text fallback.
 */
export function convertCommentHtmlToClickUp(html: string, authorName?: string): ConvertedComment {
  const cleanAuthor = authorName ? authorName.trim() : '';
  const authorPrefix = cleanAuthor ? `[${cleanAuthor}] ` : '';

  if (!html || !html.trim()) {
    const text = cleanAuthor ? `[${cleanAuthor}]` : '';
    return {
      comment: text ? [{ text, attributes: { bold: true } }, { text: '\n' }] : [],
      comment_text: text,
      images: [],
    };
  }

  const images: ExtractedImage[] = [];

  // 1. Extract all images for attachment uploading
  const imgRegex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const tag = imgMatch[0];
    const src = imgMatch[1];
    const altMatch = tag.match(/\balt=["']([^"']*)["']/i);
    const alt = altMatch ? altMatch[1] : '';
    images.push({ src, alt });
  }

  // 2. Tokenize HTML tags and text nodes
  interface Token {
    type: 'tag' | 'text';
    value: string;
  }

  const tokens: Token[] = [];
  let pos = 0;
  while (pos < html.length) {
    const nextTag = html.indexOf('<', pos);
    if (nextTag === -1) {
      tokens.push({ type: 'text', value: html.slice(pos) });
      break;
    }
    if (nextTag > pos) {
      tokens.push({ type: 'text', value: html.slice(pos, nextTag) });
    }
    const endTag = html.indexOf('>', nextTag);
    if (endTag === -1) {
      tokens.push({ type: 'text', value: html.slice(nextTag) });
      break;
    }
    tokens.push({ type: 'tag', value: html.slice(nextTag, endTag + 1) });
    pos = endTag + 1;
  }

  // 3. Intermediate block representation
  interface Block {
    type:
      | 'p'
      | 'h1'
      | 'h2'
      | 'h3'
      | 'ul'
      | 'ol'
      | 'task-checked'
      | 'task-unchecked'
      | 'pre'
      | 'blockquote'
      | 'img';
    imgSrc?: string;
    imgAlt?: string;
    segments: { text: string; attributes?: Record<string, any> }[];
  }

  const blocks: Block[] = [];
  let currentBlock: Block | null = null;
  const attrStack: Record<string, any>[] = [];
  let inList: 'ul' | 'ol' | 'task-checked' | 'task-unchecked' | null = null;

  function ensureBlock(type: Block['type'] = 'p'): Block {
    if (!currentBlock) {
      currentBlock = { type, segments: [] };
    }
    return currentBlock;
  }

  function flushBlock(allowEmpty = false) {
    if (currentBlock) {
      const hasContent = currentBlock.segments.some((s) => s.text && s.text.length > 0);
      if (hasContent || allowEmpty || currentBlock.type === 'img') {
        blocks.push(currentBlock);
      }
      currentBlock = null;
    }
  }

  function currentAttrs(): Record<string, any> {
    const combined: Record<string, any> = {};
    for (const frame of attrStack) {
      Object.assign(combined, frame);
    }
    return combined;
  }

  for (const token of tokens) {
    if (token.type === 'text') {
      const rawText = token.value;
      // Skip inter-block whitespace (newlines between closing and opening tags)
      if (!currentBlock && /^\s*$/.test(rawText)) {
        continue;
      }
      const decoded = decodeHtmlEntities(rawText);
      if (!decoded) continue;
      ensureBlock(inList || 'p');
      const attrs = currentAttrs();
      currentBlock!.segments.push(
        Object.keys(attrs).length > 0 ? { text: decoded, attributes: { ...attrs } } : { text: decoded }
      );
    } else {
      const tagContent = token.value.slice(1, -1).trim();
      const isClosing = tagContent.startsWith('/');
      const rawName = (isClosing ? tagContent.slice(1) : tagContent).split(/[\s>]/)[0].toLowerCase();

      if (isClosing) {
        switch (rawName) {
          case 'p':
            if (!inList) {
              // If paragraph is completely empty, preserve it as an empty line
              const activeBlock = currentBlock as Block | null;
              const isEmptyP = Boolean(activeBlock && activeBlock.segments.length === 0);
              flushBlock(isEmptyP);
            }
            break;
          case 'h1':
          case 'h2':
          case 'h3':
          case 'pre':
          case 'blockquote':
            flushBlock();
            break;
          case 'li':
            flushBlock();
            inList = null;
            break;
          case 'ul':
          case 'ol':
            flushBlock();
            inList = null;
            break;
          case 'strong':
          case 'b':
          case 'em':
          case 'i':
          case 'u':
          case 's':
          case 'strike':
          case 'del':
          case 'code':
          case 'a':
          case 'mark':
          case 'span':
          case 'font':
            attrStack.pop();
            break;
        }
      } else {
        // Opening or void tag
        switch (rawName) {
          case 'p':
            if (!inList) {
              flushBlock();
              ensureBlock('p');
            }
            break;
          case 'h1':
          case 'h2':
          case 'h3':
            flushBlock();
            ensureBlock(rawName as Block['type']);
            break;
          case 'ul':
            flushBlock();
            break;
          case 'ol':
            flushBlock();
            break;
          case 'li': {
            flushBlock();
            const isTask = tagContent.includes('data-type="taskItem"');
            const isChecked = tagContent.includes('data-checked="true"');
            if (isTask) {
              inList = isChecked ? 'task-checked' : 'task-unchecked';
            } else {
              const isOl =
                tagContent.includes('data-list="ordered"') ||
                html.lastIndexOf('<ol', html.indexOf(token.value)) > html.lastIndexOf('<ul', html.indexOf(token.value));
              inList = isOl ? 'ol' : 'ul';
            }
            ensureBlock(inList);
            break;
          }
          case 'pre':
            flushBlock();
            ensureBlock('pre');
            break;
          case 'blockquote':
            flushBlock();
            ensureBlock('blockquote');
            break;
          case 'br': {
            ensureBlock(inList || 'p');
            currentBlock!.segments.push({ text: '\n' });
            break;
          }
          case 'img': {
            flushBlock();
            const srcMatch = tagContent.match(/\bsrc=["']([^"']+)["']/i);
            const altMatch = tagContent.match(/\balt=["']([^"']*)["']/i);
            if (srcMatch) {
              blocks.push({
                type: 'img',
                imgSrc: srcMatch[1],
                imgAlt: altMatch ? altMatch[1] : '',
                segments: [],
              });
            }
            break;
          }
          case 'strong':
          case 'b':
            attrStack.push({ bold: true });
            break;
          case 'em':
          case 'i':
            attrStack.push({ italic: true });
            break;
          case 'u':
            attrStack.push({ underline: true });
            break;
          case 's':
          case 'strike':
          case 'del':
            attrStack.push({ strike: true });
            break;
          case 'code': {
            const activeBlock = currentBlock as Block | null;
            if (activeBlock?.type !== 'pre') {
              attrStack.push({ code: true });
            } else {
              attrStack.push({});
            }
            break;
          }
          case 'a': {
            const hrefMatch = tagContent.match(/\bhref=["']([^"']+)["']/i);
            const href = hrefMatch ? hrefMatch[1] : '';
            if (href.startsWith('mention://')) {
              attrStack.push({ bold: true });
            } else if (href) {
              attrStack.push({ link: href });
            } else {
              attrStack.push({});
            }
            break;
          }
          case 'mark': {
            const colorMatch =
              tagContent.match(/\bdata-color=["']([^"']+)["']/i) ||
              tagContent.match(/\bbackground-color:\s*([^;"]+)/i);
            const hex = colorMatch ? normalizeHex(colorMatch[1]) : '#eab308';
            attrStack.push({
              background: hex,
              'background-class': BADGE_COLOR_MAP[hex]
                ? `cu-editor-color-${BADGE_COLOR_MAP[hex]}`
                : 'cu-editor-color-yellow',
            });
            break;
          }
          case 'span': {
            const frame: Record<string, any> = {};
            const badgeMatch = tagContent.match(/\bdata-badge=["']([^"']+)["']/i);
            if (badgeMatch) {
              const hex = normalizeHex(badgeMatch[1]);
              const badgeClass = BADGE_COLOR_MAP[hex] || 'gray';
              frame['badge-class'] = badgeClass;
              frame['bold'] = true;
              frame['background'] = hex;
              const textColorMatch = tagContent.match(/\bcolor:\s*([^;"]+)/i);
              if (textColorMatch) frame['color'] = normalizeHex(textColorMatch[1]);
            } else {
              const colorMatch = tagContent.match(/\bcolor:\s*([^;"]+)/i);
              if (colorMatch && !colorMatch[0].includes('background')) {
                const hex = normalizeHex(colorMatch[1]);
                frame['color'] = hex;
                if (COLOR_NAMES[hex]) frame['color-class'] = COLOR_NAMES[hex];
              }
              const bgMatch = tagContent.match(/\bbackground-color:\s*([^;"]+)/i);
              if (bgMatch) {
                const hex = normalizeHex(bgMatch[1]);
                frame['background'] = hex;
              }
            }
            attrStack.push(frame);
            break;
          }
          case 'font': {
            const colorMatch = tagContent.match(/\bcolor=["']([^"']+)["']/i);
            if (colorMatch) {
              const hex = normalizeHex(colorMatch[1]);
              attrStack.push({ color: hex });
            } else {
              attrStack.push({});
            }
            break;
          }
          default:
            break;
        }
      }
    }
  }
  flushBlock();

  // If no blocks were created (empty HTML)
  if (blocks.length === 0) {
    blocks.push({ type: 'p', segments: [{ text: '' }] });
  }

  // Prepend author prefix to the first block with text
  if (authorPrefix) {
    const firstTextBlock = blocks.find((b) => b.type !== 'img');
    if (firstTextBlock) {
      firstTextBlock.segments.unshift({
        text: authorPrefix,
        attributes: { bold: true },
      });
    } else {
      blocks.unshift({
        type: 'p',
        segments: [{ text: authorPrefix, attributes: { bold: true } }],
      });
    }
  }

  // 4. Construct ClickUp Quill delta segments and plain text lines
  const commentSegments: ClickUpSegment[] = [];
  const textLines: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    let blockText = '';

    if (block.type === 'img') {
      const imgUrl = block.imgSrc || '';
      const imgName = block.imgAlt || imgUrl.split('/').pop() || 'image';
      // In segments: represent as image block and preview link
      commentSegments.push({
        type: 'image',
        text: imgName,
        image: {
          name: imgName,
          url: imgUrl,
        },
      });
      commentSegments.push({ text: '\n' });
      commentSegments.push({ text: imgUrl, attributes: { link: imgUrl } });
      commentSegments.push({ text: '\n' });
      textLines.push(imgUrl);
      continue;
    }

    for (const seg of block.segments) {
      commentSegments.push(seg);
      // For badge in plain text, format with brackets [Badge] if not already bracketed
      if (seg.attributes?.['badge-class'] && !seg.text.startsWith('[')) {
        blockText += `[${seg.text}]`;
      } else {
        blockText += seg.text;
      }
    }

    // Trailing newline for block with attributes
    switch (block.type) {
      case 'h1':
        commentSegments.push({ text: '\n', attributes: { header: 1 } });
        textLines.push(`# ${blockText.trim()}`);
        break;
      case 'h2':
        commentSegments.push({ text: '\n', attributes: { header: 2 } });
        textLines.push(`## ${blockText.trim()}`);
        break;
      case 'h3':
        commentSegments.push({ text: '\n', attributes: { header: 3 } });
        textLines.push(`### ${blockText.trim()}`);
        break;
      case 'ul':
        commentSegments.push({ text: '\n', attributes: { list: { list: 'bullet' } } });
        textLines.push(`- ${blockText.trim()}`);
        break;
      case 'ol':
        commentSegments.push({ text: '\n', attributes: { list: { list: 'ordered' } } });
        textLines.push(`1. ${blockText.trim()}`);
        break;
      case 'task-checked':
        commentSegments.push({ text: '\n', attributes: { list: { list: 'checked' } } });
        textLines.push(`[x] ${blockText.trim()}`);
        break;
      case 'task-unchecked':
        commentSegments.push({ text: '\n', attributes: { list: { list: 'unchecked' } } });
        textLines.push(`[ ] ${blockText.trim()}`);
        break;
      case 'pre':
        commentSegments.push({ text: '\n', attributes: { 'code-block': { 'code-block': 'plain' } } });
        textLines.push(`\`\`\`\n${blockText}\n\`\`\``);
        break;
      case 'blockquote':
        commentSegments.push({ text: '\n', attributes: { blockquote: true } });
        textLines.push(`> ${blockText.trim()}`);
        break;
      case 'p':
      default:
        commentSegments.push({ text: '\n' });
        textLines.push(blockText);
        break;
    }
  }

  const comment_text = textLines.join('\n');

  return {
    comment: commentSegments,
    comment_text,
    images,
  };
}
