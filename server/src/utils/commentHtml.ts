import { escapeHtml } from '../services/clickupService';

/**
 * Plain text as the HTML the comment editor stores: one <p> per line, so line breaks,
 * blank lines and indentation survive (comments render as markdown, which would
 * otherwise join the lines into one paragraph).
 */
export function plainTextToCommentHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `<p>${escapeHtml(line).replace(/^[ \t]+/, (ws) => '&nbsp;'.repeat(ws.replace(/\t/g, '    ').length))}</p>`)
    .join('');
}
