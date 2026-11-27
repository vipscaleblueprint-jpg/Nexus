import {
  AUDIT_HIERARCHY_ORDER,
  getNextAuditStepFromHierarchy,
  toCanonicalHierarchyLabel,
} from '../config/auditHierarchy';
import {
  HIDE_DESIGN_AUDIT,
  getAiPickedAudits,
  getRequiredAudits,
  isCheckingStatus,
  isNexusAuditChecklist,
  isReviewStatus,
  normalizeAuditName,
} from './auditChecklist';

export interface ChecklistItemLike {
  id?: string;
  text: string;
  completed?: boolean;
  assigneeId?: string[] | null;
  checkedById?: string | null;
}

export interface ChecklistLike {
  id?: string;
  name: string;
  externalId?: string | null;
  subtaskId?: string | null;
  items?: ChecklistItemLike[] | null;
}

export interface AuditProgressEvaluationInput {
  taskStatus: string | null | undefined;
  taskTitle: string;
  taskMapStatuses?: string[] | null;
  auditorRoles?: string[];
  checklists?: ChecklistLike[] | null;
  hierarchyOrder?: readonly string[];
  hideDesignAudit?: boolean;
}

export type AuditAutomationOutcome = 'ALL_CHECKED' | 'PARTIAL_CHECKED' | 'NONE';

export interface AuditProgressTransitionResult {
  outcome: AuditAutomationOutcome;
  targetBoard?: 'CRM' | 'AUDIT';
  nextStatus?: string;
  nextSubStatuses?: string[];
  clearAssignee?: boolean;
  handedOver?: boolean;
  nextAuditStep?: string | null;
  completedAudits: string[];
  remainingAudits: string[];
}

export function normalizeWorkflowStatusToken(status?: string | null): string {
  return (status || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
}

export function isHandOverSubStatusList(statuses?: string[] | null): boolean {
  if (!Array.isArray(statuses)) return false;
  return statuses.some((s) => normalizeWorkflowStatusToken(s) === 'HANDOVER');
}

export function isRevisionSubStatusList(statuses?: string[] | null): boolean {
  if (!Array.isArray(statuses)) return false;
  return statuses.some((s) => {
    const norm = normalizeWorkflowStatusToken(s);
    return norm === 'REVISION' || norm === 'REVISIONS';
  });
}

export function parsePmReviewsSafe(raw: any): any[] {
  if (Array.isArray(raw)) return [...raw];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Resolves Task Map Available Pool visibility for a task, honoring both
 * `"Hand Over"` and `"Hand-over"` substatuses (plus `handedOver: true`).
 */
export function resolveHandOverAvailablePoolVisibility(task: {
  status?: string | null;
  isClosed?: boolean;
  recurringConfig?: any;
  assigneeId?: string | null;
  subtaskId?: string | null;
  isSubtask?: boolean;
  taskMap?: {
    statuses?: string[] | null;
    handedOver?: boolean;
    pmReviews?: any;
  } | null;
  progress?: {
    maName?: string | null;
    timeIn?: string | null;
    timeOut?: string | null;
  } | null;
}): {
  inAvailablePool: boolean;
  effectiveHandlerId: string | null;
  isHandedOver: boolean;
} {
  if (task.isClosed) {
    return { inAvailablePool: false, effectiveHandlerId: null, isHandedOver: false };
  }

  const s = normalizeWorkflowStatusToken(task.status);
  const mapStatuses = (task.taskMap?.statuses || []).map(normalizeWorkflowStatusToken);
  const isHandedOver = Boolean(task.taskMap?.handedOver) || mapStatuses.includes('HANDOVER');

  const isExcluded =
    s === 'WAITING' ||
    s.includes('WAITING') ||
    s === 'CRM' ||
    s.includes('CRM') ||
    s === 'INREVIEW' ||
    s === 'TOREVIEW' ||
    s === 'REVIEW' ||
    s === 'CHECKING' ||
    s === 'INCHECKING' ||
    s === 'CLOSED' ||
    s === 'DONE' ||
    s === 'COMPLETED' ||
    s === 'DAILY' ||
    s.includes('DAILY') ||
    s === 'WEEKLY' ||
    s.includes('WEEKLY') ||
    s === 'MONTHLY' ||
    s.includes('MONTHLY') ||
    s === 'RECURRING' ||
    s.includes('RECURRING') ||
    Boolean(task.recurringConfig) ||
    mapStatuses.some(
      (st) =>
        [
          'WAITING',
          'CRM',
          'ASKCLIENT',
          'READYTOSEND',
          'TOSEND',
          'DAILY',
          'WEEKLY',
          'MONTHLY',
          'RECURRING',
          'INREVIEW',
          'TOREVIEW',
          'CHECKING',
          'INCHECKING',
          'CLOSED',
          'DONE',
        ].includes(st) ||
        st.includes('WAITING') ||
        st.includes('CRM') ||
        st.includes('DAILY') ||
        st.includes('WEEKLY') ||
        st.includes('MONTHLY') ||
        st.includes('RECURRING')
    );

  const reviewsList = parsePmReviewsSafe(task.taskMap?.pmReviews);
  const pmAssigned = reviewsList.find(
    (r: any) =>
      r?.type === 'PM_ASSIGNMENT' &&
      r?.assignedTo &&
      (task.isSubtask ? r?.subtaskId === task.subtaskId : !r?.subtaskId)
  );

  // Explicit Hand Over substatus or handedOver flag clears active handler so it shows in Available Tasks
  const effectiveHandlerId = isHandedOver
    ? null
    : pmAssigned?.assignedTo || task.assigneeId || null;

  if (isExcluded) {
    return { inAvailablePool: false, effectiveHandlerId, isHandedOver };
  }

  const isLiveWorking = Boolean(
    task.progress?.maName && !task.progress?.timeOut && task.progress?.timeIn
  );
  if (isLiveWorking) {
    return { inAvailablePool: false, effectiveHandlerId, isHandedOver };
  }

  if (isHandedOver) {
    return { inAvailablePool: true, effectiveHandlerId: null, isHandedOver: true };
  }

  if (pmAssigned?.assignedTo || task.assigneeId) {
    return { inAvailablePool: false, effectiveHandlerId, isHandedOver: false };
  }

  return { inAvailablePool: true, effectiveHandlerId: null, isHandedOver: false };
}

/**
 * Pure server-side evaluation of Nexus Audit checklist completeness and configurable hierarchy step progression.
 */
export function evaluateAuditProgressTransition(
  input: AuditProgressEvaluationInput
): AuditProgressTransitionResult {
  const {
    taskStatus,
    taskTitle,
    taskMapStatuses = [],
    auditorRoles = [],
    checklists = [],
    hierarchyOrder = AUDIT_HIERARCHY_ORDER,
    hideDesignAudit = HIDE_DESIGN_AUDIT,
  } = input;

  const statusNorm = normalizeWorkflowStatusToken(taskStatus);
  const mapNorms = (taskMapStatuses || []).map(normalizeWorkflowStatusToken);

  const isTerminalOrOtherBoard =
    ['CRM', 'WAITING', 'SENT', 'CLOSED', 'DONE', 'COMPLETED', 'RESOLVED', 'CANCELLED', 'REVISION', 'REVISIONS'].includes(statusNorm) ||
    mapNorms.some((st) => ['ASKCLIENT', 'READYTOSEND', 'TOSEND', 'SENTBUTWAITING', 'SENT', 'CLOSED', 'DONE'].includes(st));

  const isAuditPhase =
    isReviewStatus(taskStatus) ||
    isCheckingStatus(taskStatus) ||
    ['TOREVIEW', 'INREVIEW', 'REVIEW', 'CHECKING', 'INCHECKING'].includes(statusNorm) ||
    mapNorms.some((st) =>
      ['TOREVIEW', 'INREVIEW', 'CHECKING', 'INCHECKING', 'UIUXAUDIT', 'FUNNELAUDIT', 'INSTRUCTIONAUDIT', 'INSTRUCTIONSAUDIT', 'DESIGNAUDIT', 'PRODUCTIONAUDIT'].includes(st)
    );

  if (isTerminalOrOtherBoard || !isAuditPhase) {
    return { outcome: 'NONE', completedAudits: [], remainingAudits: [] };
  }

  const auditChecklists = (checklists || []).filter((c) => isNexusAuditChecklist(c));
  const allItems = auditChecklists.flatMap((c) => c.items || []);

  const excludedNorms = new Set(
    allItems
      .filter((i) => (i.text || '').trim().startsWith('!'))
      .map((i) => normalizeAuditName((i.text || '').replace(/^!\s*/, '')))
  );

  const activeItems = allItems.filter((i) => i.text && !(i.text || '').trim().startsWith('!'));
  const activeItemNames = activeItems.map((i) => i.text);
  const activeSet = new Set(activeItemNames.map((n) => normalizeAuditName(n)));

  const aiPicked = getAiPickedAudits(checklists || []);
  const rawRequired = [
    ...(aiPicked ? [] : getRequiredAudits(taskTitle || '', auditorRoles)),
    ...activeItemNames,
  ];

  const requiredMap = new Map<string, string>();
  for (const name of rawRequired) {
    if (!name || name.trim().startsWith('!')) continue;
    const norm = normalizeAuditName(name);
    if (!norm || excludedNorms.has(norm)) continue;
    if (hideDesignAudit && norm === 'design audit' && !activeSet.has(norm)) continue;
    if (!requiredMap.has(norm)) {
      requiredMap.set(norm, toCanonicalHierarchyLabel(name));
    }
  }

  const requiredAudits = Array.from(requiredMap.values());
  if (requiredAudits.length === 0) {
    return { outcome: 'NONE', completedAudits: [], remainingAudits: [] };
  }

  const completedNorms = new Set(
    activeItems
      .filter((i) => Boolean(i.completed))
      .map((i) => normalizeAuditName(i.text))
  );

  const completedAudits = requiredAudits.filter((label) =>
    completedNorms.has(normalizeAuditName(label))
  );
  const remainingAudits = requiredAudits.filter(
    (label) => !completedNorms.has(normalizeAuditName(label))
  );

  if (completedAudits.length === 0) {
    return {
      outcome: 'NONE',
      completedAudits: [],
      remainingAudits,
    };
  }

  // Rule 3a: ALL audit checklist items checked -> Ready to Send + transfer to CRM Map
  if (remainingAudits.length === 0) {
    return {
      outcome: 'ALL_CHECKED',
      targetBoard: 'CRM',
      nextStatus: 'CRM',
      nextSubStatuses: ['Ready to Send'],
      clearAssignee: true,
      handedOver: false,
      nextAuditStep: null,
      completedAudits,
      remainingAudits: [],
    };
  }

  // Rule 3b: SOME checked, others remain -> return to Audit pool, clear auditor, set next hierarchy step
  const nextAuditStep = getNextAuditStepFromHierarchy({
    requiredAudits,
    completedAuditNames: completedAudits,
    activeChecklistNames: activeItemNames,
    hierarchyOrder,
    hideDesignAudit,
  });

  const hasRemainingLevel1 = remainingAudits.some((label) => {
    const norm = normalizeAuditName(label);
    return norm.includes('ui') || norm.includes('ux') || norm.includes('design') || norm.includes('production');
  });

  return {
    outcome: 'PARTIAL_CHECKED',
    targetBoard: 'AUDIT',
    nextStatus: hasRemainingLevel1 ? 'IN REVIEW' : 'CHECKING',
    nextSubStatuses: nextAuditStep ? [nextAuditStep] : ['To Review'],
    clearAssignee: true,
    handedOver: false,
    nextAuditStep,
    completedAudits,
    remainingAudits,
  };
}

export interface RevisionPlanInput {
  pmReviews: any;
  existingStatuses?: string[] | null;
  fallbackOriginalMaId?: string | null;
  fallbackOriginalMaName?: string | null;
  subtaskId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  nowIso?: string;
}

export interface RevisionPlanResult {
  originalMaId: string | null;
  nextStatus: 'REVISION';
  nextSubStatuses: string[];
  pmReviews: any[];
  handedOver: boolean;
}

const WORKFLOW_STATUS_TOKENS_TO_STRIP = new Set([
  'TOREVIEW',
  'INREVIEW',
  'REVIEW',
  'CHECKING',
  'INCHECKING',
  'WAITING',
  'SENTBUTWAITING',
  'SENT',
  'CRM',
  'ASKCLIENT',
  'READYTOSEND',
  'TOSEND',
  'FOLLOWUP',
  'CLOSED',
  'DONE',
  'REVISION',
  'REVISIONS',
  'HANDOVER',
  'AVAILABLETASK',
  'UIUXAUDIT',
  'FUNNELAUDIT',
  'INSTRUCTIONAUDIT',
  'INSTRUCTIONSAUDIT',
  'DESIGNAUDIT',
  'PRODUCTIONAUDIT',
]);

/**
 * Pure planner for returning any task from Audit Map or CRM Map to Revision
 * in the original assigned MA's Task Map column.
 */
export function planRevisionReturnTransition(input: RevisionPlanInput): RevisionPlanResult {
  const {
    pmReviews: rawPmReviews,
    existingStatuses = [],
    fallbackOriginalMaId = null,
    fallbackOriginalMaName = null,
    subtaskId = null,
    actorId = null,
    actorName = 'System',
    nowIso = new Date().toISOString(),
  } = input;

  const reviews = parsePmReviewsSafe(rawPmReviews);
  const storedOriginal = reviews.find(
    (r: any) =>
      r?.type === 'ORIGINAL_MA' &&
      r?.userId &&
      (subtaskId ? r?.subtaskId === subtaskId : !r?.subtaskId)
  );

  const originalMaId = storedOriginal?.userId || fallbackOriginalMaId || null;
  const originalMaName = storedOriginal?.userName || fallbackOriginalMaName || null;

  // Strip current PM_ASSIGNMENT for this entity + stale CRM waiting state
  const nextReviews = reviews.filter((r: any) => {
    if (r?.type === 'CRM_WAITING_META' && !subtaskId) return false;
    if (r?.type === 'PM_ASSIGNMENT') {
      return subtaskId ? r?.subtaskId !== subtaskId : Boolean(r?.subtaskId);
    }
    return true;
  });

  if (originalMaId) {
    if (!storedOriginal) {
      nextReviews.push({
        type: 'ORIGINAL_MA',
        userId: originalMaId,
        userName: originalMaName,
        ...(subtaskId ? { subtaskId } : {}),
        updatedAt: nowIso,
      });
    }
    nextReviews.push({
      type: 'PM_ASSIGNMENT',
      assignedTo: originalMaId,
      assignedBy: actorId || null,
      assignedByName: actorName || 'System',
      mode: 'QUEUE',
      ...(subtaskId ? { subtaskId } : {}),
      assignedAt: nowIso,
    });
  }

  const preservedMetaStatuses = (existingStatuses || []).filter((st) => {
    const norm = normalizeWorkflowStatusToken(st);
    if (!norm) return false;
    if (st.startsWith('PM_ASSIGNMENT:')) return false;
    return !WORKFLOW_STATUS_TOKENS_TO_STRIP.has(norm);
  });

  return {
    originalMaId,
    nextStatus: 'REVISION',
    nextSubStatuses: Array.from(new Set(['Revision', ...preservedMetaStatuses])),
    pmReviews: nextReviews,
    handedOver: originalMaId ? false : true,
  };
}

export function upsertOriginalMaEntry(
  pmReviews: any[],
  params: { userId: string; userName?: string | null; subtaskId?: string | null; nowIso?: string }
): any[] {
  const { userId, userName = null, subtaskId = null, nowIso = new Date().toISOString() } = params;
  const filtered = pmReviews.filter(
    (r: any) => !(r?.type === 'ORIGINAL_MA' && (subtaskId ? r?.subtaskId === subtaskId : !r?.subtaskId))
  );
  filtered.push({
    type: 'ORIGINAL_MA',
    userId,
    userName,
    ...(subtaskId ? { subtaskId } : {}),
    updatedAt: nowIso,
  });
  return filtered;
}

export function isNonMaReviewerOnlyRole(user?: { roles?: string[] | null; role?: string | null } | null): boolean {
  if (!user) return false;
  const roles = [
    ...(Array.isArray(user.roles) ? user.roles : []),
    ...(user.role ? [user.role] : []),
  ]
    .map((r) => (r || '').trim().toLowerCase())
    .filter(Boolean);

  if (roles.length === 0) return false;

  const hasAuditOrCrmRole = roles.some(
    (r) =>
      r.includes('audit') ||
      r.includes('crm') ||
      r.includes('funnel') ||
      r.includes('ui/ux') ||
      r.includes('ui ux') ||
      r.includes('instruction')
  );
  const hasMaOrProdRole = roles.some(
    (r) =>
      r === 'ma' ||
      r.includes('marketing associate') ||
      r.includes('dev') ||
      r.includes('pm') ||
      r.includes('project manager') ||
      r.includes('manager')
  );

  return hasAuditOrCrmRole && !hasMaOrProdRole;
}
