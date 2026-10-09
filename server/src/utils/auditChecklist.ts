/**
 * Nexus's own Audit checklist (Instructions / Design / UI UX / Funnel) vs. a ClickUp
 * checklist that happens to be named "Audit". They share a name, so the items decide:
 * Nexus's only ever holds the four audit items. Mirrors frontend/src/lib/auditChecklist.ts.
 */
const NEXUS_AUDIT_ITEMS = new Set(['instructions audit', 'design audit', 'ui ux audit', 'funnel audit']);

export function isNexusAuditChecklist(c: {
  name: string;
  externalId?: string | null;
  items?: { text: string }[] | null;
}): boolean {
  if (c.name.trim().toLowerCase() !== 'audit') return false;
  const items = c.items ?? [];
  // Empty: Nexus's own unless it came from ClickUp.
  if (items.length === 0) return !c.externalId;
  return items.every((i) => NEXUS_AUDIT_ITEMS.has(i.text.trim().toLowerCase()));
}
