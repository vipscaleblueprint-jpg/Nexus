// Export / import helpers for Docs pages. Browser-only, no extra dependencies:
//   - export: blocks → standalone HTML, Markdown, or the browser print dialog (Print / Save as PDF)
//   - import: Markdown / HTML files → sanitized block HTML for new pages

export interface TransferBlock {
  id: string;
  type: string;
  content: string;
  depth?: number;
  status?: string;
}

export interface ExportPage {
  title: string;
  blocks: TransferBlock[];
}

// ── Shared utils ────────────────────────────────────────────────────────────

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const isHtml = (s: string) => /^\s*</.test(s);

const tiptapJsonToText = (json: string) =>
  Array.from(json.matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)).map(m => m[1]).join(' ');

export const safeFileName = (name: string) =>
  (name || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';

export function downloadFile(fileName: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Sanitizing (imported files are untrusted) ───────────────────────────────

const DROP_TAGS = 'script,style,iframe,object,embed,link,meta,noscript,template,form,input:not([type="checkbox"]),button,select,textarea,svg,canvas,video,audio';

/** Parses untrusted HTML without executing it and strips scripts, handlers and unsafe URLs. */
export function sanitizeHtml(html: string): Document {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll(DROP_TAGS).forEach(el => el.remove());
  parsed.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'srcset') {
        el.removeAttribute(attr.name);
      } else if ((name === 'href' || name === 'src') && /^(javascript|data|vbscript):/.test(value)) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return parsed;
}

// ── Export: blocks → HTML ───────────────────────────────────────────────────

/** HTML for one block. `liveHtml` (from a mounted editor) wins over the stored content. */
export function blockToHtml(block: TransferBlock, liveHtml?: string): string {
  let html = liveHtml ?? block.content ?? '';
  if (!liveHtml && html.startsWith('{"type":"doc"')) html = `<p>${escapeHtml(tiptapJsonToText(html))}</p>`;
  else if (!isHtml(html)) html = html ? `<p>${escapeHtml(html)}</p>` : '';
  if (!html || html === '<p></p>') return '';

  const plain = html.replace(/<[^>]+>/g, '');
  switch (block.type) {
    case 'heading':
      html = /<h[1-6][\s>]/i.test(html) ? html : `<h2>${escapeHtml(plain)}</h2>`;
      break;
    case 'task':
    case 'subtask':
      html = `<ul class="task-list"><li><input type="checkbox" disabled${block.status === 'CLOSED' ? ' checked' : ''}> ${html.replace(/^<p>|<\/p>$/g, '')}</li></ul>`;
      break;
    case 'callout':
      html = `<blockquote>${html}</blockquote>`;
      break;
  }
  const depth = block.depth || 0;
  return depth > 0 ? `<div class="indent-${Math.min(depth, 6)}">${html}</div>` : html;
}

const EXPORT_CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #18181b; max-width: 760px; margin: 40px auto; padding: 0 24px; line-height: 1.6; font-size: 14px; }
  h1.page-title { font-size: 30px; margin: 0 0 24px; }
  section + section { page-break-before: always; margin-top: 48px; }
  ul.task-list { list-style: none; padding-left: 0; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0; }
  blockquote { border-left: 3px solid #ef4444; background: #fef2f2; margin: 8px 0; padding: 8px 12px; border-radius: 4px; }
  a { color: #2563eb; }
  ${[1, 2, 3, 4, 5, 6].map(d => `.indent-${d} { margin-left: ${d * 24}px; }`).join('\n  ')}
  @media print { body { margin: 0 auto; } }
`;

export function pagesToHtmlDocument(docTitle: string, pages: ExportPage[], liveHtml?: (blockId: string) => string | undefined): string {
  const sections = pages.map(page => {
    const body = page.blocks.map(b => blockToHtml(b, liveHtml?.(b.id))).filter(Boolean).join('\n');
    return `<section>\n<h1 class="page-title">${escapeHtml(page.title || 'Untitled Page')}</h1>\n${body}\n</section>`;
  }).join('\n');
  return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${escapeHtml(docTitle)}</title>\n<style>${EXPORT_CSS}</style>\n</head>\n<body>\n${sections}\n</body>\n</html>\n`;
}

// ── Export: HTML → Markdown ─────────────────────────────────────────────────

function inlineToMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\s+/g, ' ');
  if (!(node instanceof Element)) return '';
  const inner = Array.from(node.childNodes).map(inlineToMd).join('');
  switch (node.tagName.toLowerCase()) {
    case 'strong': case 'b': return inner.trim() ? `**${inner}**` : inner;
    case 'em': case 'i': return inner.trim() ? `*${inner}*` : inner;
    case 's': case 'del': case 'strike': return inner.trim() ? `~~${inner}~~` : inner;
    case 'code': return `\`${node.textContent || ''}\``;
    case 'a': return `[${inner}](${node.getAttribute('href') || ''})`;
    case 'br': return '  \n';
    case 'input': return '';
    default: return inner;
  }
}

function blockNodeToMd(el: Element, indent = ''): string {
  const tag = el.tagName.toLowerCase();
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) return `${'#'.repeat(Number(heading[1]))} ${inlineToMd(el).trim()}\n\n`;
  if (tag === 'p') return `${indent}${inlineToMd(el).trim()}\n\n`;
  if (tag === 'pre') return `\`\`\`\n${el.textContent || ''}\n\`\`\`\n\n`;
  if (tag === 'blockquote') {
    const inner = Array.from(el.children).map(c => blockNodeToMd(c)).join('').trim() || inlineToMd(el).trim();
    return inner.split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
  }
  if (tag === 'ul' || tag === 'ol') {
    const items = Array.from(el.children).filter(c => c.tagName.toLowerCase() === 'li');
    const lines = items.map((li, i) => {
      const checkbox = li.querySelector(':scope > input[type="checkbox"], :scope > label input[type="checkbox"]') as HTMLInputElement | null;
      const dataChecked = li.getAttribute('data-checked');
      const isTask = !!checkbox || dataChecked !== null;
      const checked = checkbox ? checkbox.hasAttribute('checked') : dataChecked === 'true';
      const marker = tag === 'ol' ? `${i + 1}.` : '-';
      const nested = Array.from(li.children).filter(c => /^(ul|ol)$/i.test(c.tagName));
      const textParts = Array.from(li.childNodes).filter(n => !(n instanceof Element && /^(ul|ol)$/i.test(n.tagName)));
      const text = textParts.map(inlineToMd).join(' ').replace(/\s+/g, ' ').trim();
      const nestedMd = nested.map(n => blockNodeToMd(n, indent + '  ').replace(/\n\n$/, '\n')).join('');
      return `${indent}${marker} ${isTask ? `[${checked ? 'x' : ' '}] ` : ''}${text}\n${nestedMd}`;
    });
    return lines.join('') + (indent ? '' : '\n');
  }
  if (/^(div|section|details|summary|article)$/.test(tag)) {
    const kids = Array.from(el.childNodes);
    if (kids.every(k => k.nodeType === Node.TEXT_NODE || (k instanceof Element && !/^(p|div|ul|ol|h[1-6]|pre|blockquote|section|details|summary)$/i.test(k.tagName)))) {
      const text = inlineToMd(el).trim();
      return text ? `${text}\n\n` : '';
    }
    return kids.map(k => (k instanceof Element ? blockNodeToMd(k, indent) : (k.textContent || '').trim() ? `${(k.textContent || '').trim()}\n\n` : '')).join('');
  }
  const text = inlineToMd(el).trim();
  return text ? `${text}\n\n` : '';
}

export function htmlToMarkdown(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(parsed.body.children).map(el => blockNodeToMd(el)).join('');
}

export function pagesToMarkdown(pages: ExportPage[], liveHtml?: (blockId: string) => string | undefined): string {
  return pages.map(page => {
    const body = page.blocks.map(b => blockToHtml(b, liveHtml?.(b.id))).filter(Boolean)
      .map(h => htmlToMarkdown(h)).join('');
    return `# ${page.title || 'Untitled Page'}\n\n${body}`.trimEnd();
  }).join('\n\n---\n\n') + '\n';
}

// ── Export: print / PDF ─────────────────────────────────────────────────────

/** Opens the browser print dialog for a standalone HTML document (users pick "Save as PDF" for PDF). */
export function printHtmlDocument(html: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.className = 'fixed -left-[9999px] top-0 w-0 h-0 border-0';
  iframe.onload = () => {
    const frameWin = iframe.contentWindow;
    if (!frameWin) { iframe.remove(); return; }
    frameWin.addEventListener('afterprint', () => setTimeout(() => iframe.remove(), 500), { once: true });
    frameWin.focus();
    frameWin.print();
    // Fallback for browsers that don't fire afterprint on iframes
    setTimeout(() => { if (iframe.isConnected) iframe.remove(); }, 60_000);
  };
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
}

// ── Import: Markdown → HTML ─────────────────────────────────────────────────

const safeUrl = (url: string) => (/^\s*(javascript|data|vbscript):/i.test(url) ? '#' : url);

function mdInline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, t, u) => `<a href="${escapeHtml(safeUrl(u))}">${t}</a>`);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<strong>${a ?? b}</strong>`);
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  return s;
}

/** Converts Markdown into one HTML string per top-level element (one doc block each). */
export function markdownToBlockHtml(md: string): string[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (/^```/.test(line.trim())) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      out.push(`<h${level}>${mdInline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { i++; continue; }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote><p>${mdInline(quote.join(' '))}</p></blockquote>`);
      continue;
    }
    if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+\[[ xX]\]\s/.test(lines[i])) {
        const m = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(lines[i++])!;
        items.push(`<li data-type="taskItem" data-checked="${m[1].toLowerCase() === 'x'}"><p>${mdInline(m[2])}</p></li>`);
      }
      out.push(`<ul data-type="taskList">${items.join('')}</ul>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const itemRe = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items: string[] = [];
      while (i < lines.length && itemRe.test(lines[i]) && !/^\s*[-*+]\s+\[[ xX]\]\s/.test(lines[i])) {
        items.push(`<li><p>${mdInline(itemRe.exec(lines[i++])![1])}</p></li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    // Paragraph: consecutive non-special lines
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^(#{1,6}\s|```|\s*>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i])
    ) para.push(lines[i++].trim());
    if (para.length) out.push(`<p>${para.map(mdInline).join('<br>')}</p>`);
    else i++;
  }
  return out;
}

// ── Import: HTML → block HTML ───────────────────────────────────────────────

const CONTAINER_TAGS = /^(div|section|article|main|header|footer|body|span|table|tbody|thead|tr|td|th|figure)$/i;

/** Flattens sanitized HTML into one HTML string per top-level block element. */
export function htmlToBlockHtml(html: string): string[] {
  const parsed = sanitizeHtml(html);
  const out: string[] = [];
  const walk = (parent: Element) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent || '').trim();
        if (text) out.push(`<p>${escapeHtml(text)}</p>`);
      } else if (node instanceof Element) {
        const tag = node.tagName.toLowerCase();
        if (CONTAINER_TAGS.test(tag) && node.querySelector('p,h1,h2,h3,h4,h5,h6,ul,ol,pre,blockquote,div')) {
          walk(node);
        } else if (/^(p|h[1-6]|ul|ol|pre|blockquote)$/.test(tag)) {
          if ((node.textContent || '').trim()) out.push(node.outerHTML);
        } else {
          const text = (node.textContent || '').trim();
          if (text) out.push(`<p>${node.innerHTML}</p>`);
        }
      }
    }
  };
  walk(parsed.body);
  return out;
}

export interface ImportedPage {
  title: string;
  blockHtml: string[];
}

/** Notion appends a 32-char id to exported file names: "Meeting notes 1a2b….md" */
export const titleFromFileName = (fileName: string) =>
  fileName.replace(/\.[^.]+$/, '').replace(/\s[0-9a-f]{32}$/i, '').trim() || 'Untitled Page';

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/** A leading H1 becomes the page title instead of a duplicate first block. */
function withTitle(fallbackTitle: string, blockHtml: string[]): ImportedPage {
  if (blockHtml[0] && /^<h1[\s>]/i.test(blockHtml[0])) {
    return { title: textOf(blockHtml[0]) || fallbackTitle, blockHtml: blockHtml.slice(1) };
  }
  return { title: fallbackTitle, blockHtml };
}

/** Splits blocks into pages at every H1 (content before the first H1 keeps the file's name). */
export function splitPagesAtH1(fallbackTitle: string, blockHtml: string[]): ImportedPage[] {
  const pages: ImportedPage[] = [];
  let current: ImportedPage = { title: fallbackTitle, blockHtml: [] };
  // A section is kept if it has content or came from an H1 (an empty pre-H1 intro is dropped)
  const keep = (p: ImportedPage, fromH1: boolean) => p.blockHtml.length > 0 || fromH1;
  let currentFromH1 = false;
  for (const html of blockHtml) {
    if (/^<h1[\s>]/i.test(html)) {
      if (keep(current, currentFromH1)) pages.push(current);
      current = { title: textOf(html) || 'Untitled Page', blockHtml: [] };
      currentFromH1 = true;
    } else {
      current.blockHtml.push(html);
    }
  }
  if (keep(current, currentFromH1)) pages.push(current);
  return pages.length > 0 ? pages : [{ title: fallbackTitle, blockHtml: [] }];
}

export type ImportKind = 'markdown' | 'html' | 'html-split' | 'document' | 'notion' | 'confluence';

/** Turns one file into one or more pages. Throws for unsupported file types. */
export async function fileToPages(file: File, kind: ImportKind): Promise<ImportedPage[]> {
  const text = await file.text();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const fallback = titleFromFileName(file.name);
  const isMd = ext === 'md' || ext === 'markdown';
  const isHtmlFile = ext === 'html' || ext === 'htm';

  if (kind === 'html-split') {
    if (!isHtmlFile) throw new Error(`${file.name}: expected an .html file`);
    return splitPagesAtH1(fallback, htmlToBlockHtml(text));
  }
  if (isMd) return [withTitle(fallback, markdownToBlockHtml(text))];
  if (isHtmlFile) return [withTitle(fallback, htmlToBlockHtml(text))];
  if (ext === 'txt') {
    return [{ title: fallback, blockHtml: text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`) }];
  }
  throw new Error(`${file.name}: unsupported file type (.${ext || '?'})`);
}

export const IMPORT_ACCEPT: Record<ImportKind, string> = {
  markdown: '.md,.markdown',
  html: '.html,.htm',
  'html-split': '.html,.htm',
  document: '.txt,.md,.markdown,.html,.htm',
  notion: '.md,.markdown,.html,.htm',
  confluence: '.html,.htm',
};
