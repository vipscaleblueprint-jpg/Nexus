import { HIDE_DESIGN_AUDIT, normalizeAuditName } from '../utils/auditChecklist';

/**
 * ============================================================================
 * CONFIGURABLE AUDIT HIERARCHY (SINGLE SOURCE OF TRUTH)
 * ============================================================================
 * Edit this ordered list to change the audit step progression when a partial
 * audit checklist is checked and the task returns to the Audit Map pool.
 *
 * Example:
 *   When 'UI/UX Audit' is checked and 'Funnel Audit' remains unchecked,
 *   the server assigns the substatus 'Funnel Audit' and clears the auditor so
 *   the next auditor can pick it up from the pool.
 *
 * Globally disabled steps (for example 'Design Audit' when
 * HIDE_DESIGN_AUDIT === true) are automatically skipped unless explicitly
 * present on the task's active checklist items.
 */
// Review-stage audits (UI/UX, Design) come first: moving to Checking needs both checked.
export const AUDIT_HIERARCHY_ORDER: readonly string[] = [
  'UI/UX Audit',
  'Design Audit',
  'Funnel Audit',
  'Instructions Audit',
];

const CANONICAL_DISPLAY_LABELS: Record<string, string> = {
  'ui ux audit': 'UI/UX Audit',
  'funnel audit': 'Funnel Audit',
  'instructions audit': 'Instructions Audit',
  'design audit': 'Design Audit',
};

/** Converts any audit variant string (e.g. 'UI UX Audit', 'UI/UX Audit', 'Instruction Audit') to a clean display label. */
export function toCanonicalHierarchyLabel(rawName: string): string {
  const norm = normalizeAuditName(rawName);
  return CANONICAL_DISPLAY_LABELS[norm] || rawName.trim();
}

export interface NextAuditStepParams {
  requiredAudits: string[];
  completedAuditNames: string[];
  activeChecklistNames?: string[];
  hierarchyOrder?: readonly string[];
  hideDesignAudit?: boolean;
}

/**
 * Finds the next unchecked audit step according to AUDIT_HIERARCHY_ORDER (or a custom override).
 * Returns null if all required audits are completed or none remain.
 */
export function getNextAuditStepFromHierarchy(params: NextAuditStepParams): string | null {
  const {
    requiredAudits,
    completedAuditNames,
    activeChecklistNames = [],
    hierarchyOrder = AUDIT_HIERARCHY_ORDER,
    hideDesignAudit = HIDE_DESIGN_AUDIT,
  } = params;

  const completedSet = new Set(completedAuditNames.map((n) => normalizeAuditName(n)));
  const activeSet = new Set(activeChecklistNames.map((n) => normalizeAuditName(n)));
  const requiredByNorm = new Map<string, string>();

  for (const reqName of requiredAudits) {
    const norm = normalizeAuditName(reqName);
    if (!norm) continue;
    if (hideDesignAudit && norm === 'design audit' && !activeSet.has(norm)) {
      continue;
    }
    if (!requiredByNorm.has(norm)) {
      requiredByNorm.set(norm, toCanonicalHierarchyLabel(reqName));
    }
  }

  // 1. Walk the configured ordered hierarchy first
  for (const step of hierarchyOrder) {
    const norm = normalizeAuditName(step);
    if (!norm) continue;
    if (hideDesignAudit && norm === 'design audit' && !activeSet.has(norm)) {
      continue;
    }
    if (requiredByNorm.has(norm) && !completedSet.has(norm)) {
      return toCanonicalHierarchyLabel(step);
    }
  }

  // 2. Fallback: return any remaining unchecked required audit not listed in hierarchyOrder
  for (const [norm, displayLabel] of requiredByNorm.entries()) {
    if (!completedSet.has(norm)) {
      return displayLabel;
    }
  }

  return null;
}
