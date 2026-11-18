import { escapeHtml } from '../services/clickupService';

/**
 * Plain text as the HTML the comment editor stores: one <p> per line, so line breaks,
 * blank lines and indentation survive (comments render as markdown, which would
 * otherwise join the lines into one paragraph).
 *
 * Converts markdown links [label](url) into safe <a href="url">label</a> tags so they
 * render as interactive links with hover preview in Nexus comments.
 */
export function plainTextToCommentHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      let safe = escapeHtml(line).replace(/^[ \t]+/, (ws) => '&nbsp;'.repeat(ws.replace(/\t/g, '    ').length));
      safe = safe.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)<>"]+)\)/g, '<a href="$2">$1</a>');
      return `<p>${safe}</p>`;
    })
    .join('');
}
