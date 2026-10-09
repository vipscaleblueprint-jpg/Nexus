/**
 * clickupMappingService.ts
 *
 * Links unmapped Nexus "Client Dashboard" lists to the ClickUp list of the same
 * client, so a mapping removed by mistake can be restored without hand-typing IDs.
 */

import { prisma } from '../config/prisma';
import { getWorkspaces, getSpaces, getFolders, getListsInFolder } from './clickupService';

const FOLDER_NAME = 'client dashboard';

/** Lower-case, collapse spaces, drop punctuation so "Jen Richardson " == "jen richardson". */
function norm(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Same client? Exact after normalising; a Nexus name cut short with "..." that
 * ClickUp's name starts with; or a 1–2 letter typo (Espinosa/Espinoza, Xfinite/Xfnite).
 */
function sameList(nexusName: string, clickUpName: string): boolean {
  const n = norm(nexusName);
  const c = norm(clickUpName);
  if (n === c) return true;
  if (/\.\.\.\s*$/.test(nexusName) && n.length >= 8 && c.startsWith(n)) return true;
  return n.length >= 6 && levenshtein(n, c) <= 2;
}

export interface AutoLinkResult {
  linked: { nexusListName: string; clickUpListName: string; clickUpListId: string }[];
  /** Unmapped Nexus lists with no ClickUp list of a matching name. */
  unmatched: string[];
}

export async function autoLinkClientDashboardLists(): Promise<AutoLinkResult> {
  const clickUpLists: { id: string; name: string }[] = [];
  for (const team of (await getWorkspaces())?.teams ?? []) {
    for (const space of (await getSpaces(team.id))?.spaces ?? []) {
      for (const folder of (await getFolders(space.id))?.folders ?? []) {
        if (norm(folder.name) !== FOLDER_NAME) continue;
        for (const l of (await getListsInFolder(folder.id))?.lists ?? []) clickUpLists.push({ id: l.id, name: l.name });
      }
    }
  }

  const nexusLists = await prisma.list.findMany({
    where: { folder: { name: { equals: 'Client Dashboard', mode: 'insensitive' } } },
    select: { id: true, name: true, clickUpListId: true },
  });
  const taken = new Set(nexusLists.map((l) => l.clickUpListId).filter(Boolean));

  const result: AutoLinkResult = { linked: [], unmatched: [] };
  for (const list of nexusLists.filter((l) => !l.clickUpListId)) {
    const match = clickUpLists.find((c) => !taken.has(c.id) && sameList(list.name, c.name));
    if (!match) {
      result.unmatched.push(list.name);
      continue;
    }
    await prisma.list.update({ where: { id: list.id }, data: { clickUpListId: match.id } });
    taken.add(match.id);
    result.linked.push({ nexusListName: list.name, clickUpListName: match.name, clickUpListId: match.id });
  }
  return result;
}
