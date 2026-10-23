/**
 * clickupMirrorAuthor.ts
 *
 * Comments written in Nexus are mirrored to ClickUp through the shared "VIP Scale" API account,
 * so ClickUp shows them as VIP Scale with the real author in a prefix: "[Mimi] …"
 * (older mirrors: "**[Mimi]** …", where ClickUp kept the markdown asterisks as literal text).
 *
 * When those comments come back into Nexus, the prefix is used to credit the real Nexus user
 * and is then stripped, so nobody sees "[Name]" or "**[Name]**" in Nexus.
 */

/** "[Name] …" or "**[Name]** …" at the very start of a comment. */
export const MIRROR_PREFIX_RE = /^\s*(?:\*\*)?\[([^\]\n]{1,80})\](?:\*\*)?(?=\s|$|:)/;

/** ClickUp accounts that post on behalf of others (the API token owner). */
const BOT_EMAILS = new Set(['vipscaleblueprint@gmail.com', 'vipscale@system.local', 'clickup@system.local']);

/** The author name inside a mirror prefix, or null when the text has none. */
export function parseMirrorAuthor(text: string | null | undefined): string | null {
  const name = String(text ?? '').match(MIRROR_PREFIX_RE)?.[1]?.trim();
  // Needs a letter, so "[ ] todo" or "[1] footnote" aren't read as authors.
  return name && /\p{L}/u.test(name) ? name : null;
}

/** True for the shared account Nexus mirrors through (or a ClickUp user with no Nexus account). */
export function isMirrorBotUser(cuUser: any): boolean {
  const email = typeof cuUser?.email === 'string' ? cuUser.email.trim().toLowerCase() : '';
  const username = typeof cuUser?.username === 'string' ? cuUser.username : '';
  return BOT_EMAILS.has(email) || /vip\s*scale/i.test(username);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Removes a leading "[Name]" / "**[Name]**" from plain text, and any trailing duplicated fallback line. */
export function stripMirrorPrefixText(text: string, name: string): string {
  if (!text || !name) return text;
  const escaped = escapeRegExp(name);
  const re = new RegExp(`^\\s*(?:\\*\\*)?\\[${escaped}\\](?:\\*\\*)?[\\s:]*`, 'i');
  let out = text.replace(re, '');
  // Also strip trailing duplicate plain-text fallback block if ClickUp appended "\n[Name] ..."
  const trailerRegex = new RegExp(`\\n+\\s*(?:\\*\\*)?\\[${escaped}\\](?:\\*\\*)?[\\s\\S]*$`, 'i');
  out = out.replace(trailerRegex, '');
  return out.trim();
}

/**
 * Removes a leading "[Name]" / "**[Name]**" from comment HTML, even when it sits inside
 * opening tags (p, h1-h6, strong, etc.), then drops tags left empty by it.
 * Also strips any trailing duplicated plain-text fallback block (<p>[Name]...</p>)
 * appended by ClickUp when dual comment payloads were previously sent.
 */
export function stripMirrorPrefixHtml(html: string, name: string): string {
  if (!html || !name) return html;
  const escaped = escapeRegExp(name);
  const re = new RegExp(
    `^((?:\\s*<(?:p|h[1-6]|strong|b|em|span|li|blockquote)\\b[^>]*>)*\\s*)(?:\\*\\*)?\\[${escaped}\\](?:\\*\\*)?(?:\\s|&nbsp;|:)*`,
    'i'
  );
  let out = html.replace(re, '$1');
  // Bold/span wrapper that held only the prefix: "<p><strong></strong>Text" → "<p>Text"
  for (let i = 0; i < 3; i++) {
    out = out.replace(/^((?:\s*<(?:p|h[1-6]|li|blockquote)\b[^>]*>)?\s*)<(strong|b|em|span)\b[^>]*>\s*<\/\2>/i, '$1');
  }
  // Prefix was alone on the first block/line
  out = out.replace(/^\s*<(p|h[1-6]|li|blockquote)\b[^>]*>\s*(?:<br\s*\/?>)?\s*<\/\1>/i, '');

  // Strip trailing duplicated plain-text fallback block if ClickUp appended <p>[Name] ...</p>
  const trailerRegex = new RegExp(`<p>\\s*(?:<[^>]+>)*\\s*\\[(?:${escaped})\\][\\s\\S]*$`, 'i');
  out = out.replace(trailerRegex, '');

  return out.trim();
}

/**
 * Builds a resolver from a mirror-prefix name to a Nexus user id: exact full name first,
 * then a unique first-name match. System accounts are never matched.
 */
export function buildNameResolver(users: { id: string; name: string | null; email: string }[]) {
  const full = new Map<string, string>();
  const first = new Map<string, string | null>(); // null = ambiguous
  for (const u of users) {
    const name = (u.name ?? '').trim().toLowerCase();
    if (!name || BOT_EMAILS.has(u.email.toLowerCase()) || /vip\s*scale|^clickup$/.test(name)) continue;
    full.set(name, u.id);
    const f = name.split(/\s+/)[0];
    first.set(f, first.has(f) && first.get(f) !== u.id ? null : u.id);
  }
  return (name: string): string | null => {
    const n = name.trim().toLowerCase();
    return full.get(n) ?? first.get(n) ?? first.get(n.split(/\s+/)[0]) ?? null;
  };
}
