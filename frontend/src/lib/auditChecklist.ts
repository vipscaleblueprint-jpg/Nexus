/**
 * Nexus's own Audit checklist (Instructions / Design / UI UX / Funnel, shown in the
 * Audit section) vs. a ClickUp checklist that happens to be named "Audit". The two
 * share a name, so the items decide: Nexus's only ever holds the four audit items.
 */
const NEXUS_AUDIT_ITEMS = new Set(['instructions audit', 'design audit', 'ui ux audit', 'funnel audit']);

interface ChecklistLike {
  name: string;
  externalId?: string | null;
  items?: { text: string }[] | null;
}

export function isNexusAuditChecklist(c: ChecklistLike): boolean {
  if (c.name.trim().toLowerCase() !== 'audit') return false;
  const items = c.items ?? [];
  // Empty: Nexus's own unless it came from ClickUp.
  if (items.length === 0) return !c.externalId;
  return items.every((i) => NEXUS_AUDIT_ITEMS.has(i.text.trim().toLowerCase()));
}
