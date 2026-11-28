export interface DeliverableQualityCheck {
  id: 'tangible' | 'measurable' | 'specific';
  label: string;
  passed: boolean;
  hint: string;
}

export interface DeliverableQualityReport {
  score: number; // 0..100
  level: 'strong' | 'fair' | 'weak';
  isGraphicsOrMediaTask: boolean;
  isSubmittable: boolean;
  blockReason: string | null;
  checks: DeliverableQualityCheck[];
  suggestions: string[];
  templateSnippet: string;
}

const VAGUE_NON_DELIVERABLE_REGEX =
  /^(?:check(?:ed)?\s+tasks?(?:\s+to\s+work\s+on(?:\s+in\s+nexus)?)?|work(?:ing)?\s+on\s+(?:tasks?|nexus|edits?)|refine\s+edits?(?:\s+with\s+minor\s+revisions?)?|minor\s+revisions?|revisions?|updates?|done|finished|completed|fixed|working|wip|test(?:ing)?|na|n\/a|none)$/i;

const GENERIC_ACTIVITY_ONLY_REGEX =
  /\b(?:checked\s+tasks?|to\s+work\s+on\s+in\s+nexus|minor\s+revision(?:s)?|refine\s+edits?)\b/i;

// Concrete tangible client outputs (media, graphics, copy, web/funnel, social, automation, docs)
const TANGIBLE_OUTPUT_REGEX =
  /\b(?:video\s+edits?|video\s+clips?|video\s+assembly|video\s+scenes?|video|clips?|thumbnails?|titles?|graphics?|visual\s+assets?|visual\s+layout|text\s+animation|audio\s+timing|branding|voice-?over|footage|captions?|caption\s+template(?:\s+versions?)?|cta\s+script|script|generated\s+audio|audio|image\s+product\s+showcase|image\s+assets?|static\s+ads?|ads?|b-?roll|hooks?|font\s+family(?:\s+to\s+[a-z0-9\s]+)?|scheduled\s+posts?|contents?|posts?|reels?|mockups?|banners?|carousels?|posters?|logos?|infographics?|slides?|deck|landing\s+page|funnel|opt-?in|checkout|thank\s+you\s+page|emails?|copy|workflow|webhook|automation|audit|report|ui|ux|layout|section|header|footer|pages?)\b/i;

// Measurable quantity, numbered module/reel/phase/lesson/ad, or concrete named client scope
const MEASURABLE_SCOPE_REGEX =
  /(\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|all)\b|\b(?:phase|module|lesson|reel(?:\s+ad)?|part|step|version|ver|v)\s*\d+\b|\b(?:welcome|final|finalized?|initial|revised|additional)\b|\bfor\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|future\s+ads|[a-z0-9\s–—-]{3,})\b|\bacross\s+(?:all\s+)?[a-z0-9\s]{3,}|\b(?:personal|page)\s+[a-z]+\s+account\b|[–—-]\s*[a-z0-9][a-z0-9\s]{3,})/i;

// Named asset / target (e.g. "Ana James – Scalp Activation Video", "Medière PDRN Phase 2", "Tattoo Removal Reel", "Module 2 lessons")
const NAMED_TARGET_REGEX =
  /(\b(?:module|lesson|phase|reel|ad|campaign|account|page)\s*(?:\d+|[a-z]+)|\bfor\s+[a-z0-9][a-z0-9\s–-]{2,}|\bacross\s+[a-z0-9][a-z0-9\s–-]{2,}|[–—-]\s*[a-z0-9][a-z0-9\s]{2,})/i;

const GRAPHICS_MEDIA_KEYWORDS = [
  'graphic',
  'graphics',
  'thumbnail',
  'thumbnails',
  'image',
  'visual',
  'video',
  'reel',
  'clip',
  'clips',
  'b-roll',
  'caption',
  'voice-over',
  'audio',
  'design',
  'banner',
  'carousel',
  'mockup',
  'logo',
  'branding',
  'animation',
  'layout',
  'font',
  'static ad',
];

function normalizeText(value?: string | number | null): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ');
}

function stripPunctuation(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

/**
 * Returns true if the task resides under Admin (internal/admin folder or list),
 * where strict client deliverable format requirements are bypassed.
 */
export function isTaskUnderAdminScope(params: {
  isAdminTask?: boolean;
  folderName?: string | null;
  listName?: string | null;
  clientName?: string | null;
}): boolean {
  if (params.isAdminTask) return true;
  const candidates = [params.folderName, params.listName, params.clientName]
    .map((v) => (v || '').trim().toLowerCase())
    .filter(Boolean);
  return candidates.some((c) => c === 'admin' || /\badmin\b/i.test(c));
}

/**
 * Evaluates `Task Deliverables Description:` (Column K).
 * Plain numbers (numerical values) and any non-empty text are allowed.
 */
export function evaluateDeliverableDescription(params: {
  deliverablesDescription: string | number | null | undefined;
  taskTitle?: string;
  clientName?: string;
  listName?: string;
  folderName?: string;
  isAdminTask?: boolean;
}): DeliverableQualityReport {
  const desc = normalizeText(params.deliverablesDescription);
  const title = normalizeText(params.taskTitle);

  const combinedHintText = `${title} ${desc}`.toLowerCase();
  const isGraphicsOrMediaTask = GRAPHICS_MEDIA_KEYWORDS.some((kw) =>
    combinedHintText.includes(kw)
  );

  const templateSnippet = isGraphicsOrMediaTask
    ? 'Update thumbnails, titles, and graphics across Module 2 lessons'
    : 'Create two caption template versions for the target reel';

  const hasValue = desc.length > 0;

  if (
    isTaskUnderAdminScope({
      isAdminTask: params.isAdminTask,
      folderName: params.folderName,
      listName: params.listName,
      clientName: params.clientName,
    })
  ) {
    return {
      score: hasValue ? 100 : 0,
      level: hasValue ? 'strong' : 'weak',
      isGraphicsOrMediaTask,
      isSubmittable: hasValue,
      blockReason: hasValue ? null : 'Task Deliverables Description is required.',
      checks: [],
      suggestions: [],
      templateSnippet,
    };
  }

  const descNorm = stripPunctuation(desc);
  const wordCount = desc ? desc.split(/\s+/).filter(Boolean).length : 0;
  const isNumericInput = /^-?\d+(?:[.,/]\d+)?%?$/.test(desc);

  const isExplicitVague =
    !desc ||
    (!isNumericInput &&
      (VAGUE_NON_DELIVERABLE_REGEX.test(desc) || VAGUE_NON_DELIVERABLE_REGEX.test(descNorm)));

  const hasTangibleOutput =
    isNumericInput || (TANGIBLE_OUTPUT_REGEX.test(desc) && !GENERIC_ACTIVITY_ONLY_REGEX.test(desc));
  const hasMeasurableScope =
    isNumericInput || (MEASURABLE_SCOPE_REGEX.test(desc) && NAMED_TARGET_REGEX.test(desc));
  const hasClientSpecificDetail =
    isNumericInput ||
    (Boolean(desc) &&
      !isExplicitVague &&
      !GENERIC_ACTIVITY_ONLY_REGEX.test(desc) &&
      wordCount >= 4 &&
      desc.length >= 20);

  const checks: DeliverableQualityCheck[] = [
    {
      id: 'tangible',
      label: 'Tangible Output',
      passed: hasTangibleOutput,
      hint: isGraphicsOrMediaTask
        ? 'Name the exact output created or updated (e.g. "thumbnails, titles, and graphics", "video clips", "voice-over and captions", "image assets").'
        : 'Name the concrete deliverable produced (e.g. "CTA script", "landing page section", "3 scheduled posts", "font family update").',
    },
    {
      id: 'measurable',
      label: 'Measurable / Named Target',
      passed: hasMeasurableScope,
      hint: 'State the quantity or exact target (e.g. "two caption template versions", "Reel 1 and 3", "Phase 2", "Module 3 Lesson 1", "3 contents for December").',
    },
    {
      id: 'specific',
      label: 'Client-Ready Detail',
      passed: hasClientSpecificDetail,
      hint: 'Avoid vague descriptions like "Checked tasks to work on in nexus", "Refine edits with minor revision", or "Refine edits to Module 2 lessons".',
    },
  ];

  const passedCount = checks.filter((c) => c.passed).length;
  const score = hasValue ? Math.round((passedCount / checks.length) * 100) : 0;
  const level: 'strong' | 'fair' | 'weak' =
    score === 100 ? 'strong' : score >= 50 ? 'fair' : 'weak';

  // Admin tasks (not admin users) bypass strict tangible/measurable checks;
  // Client tasks enforce tangible/measurable/client-ready detail unless a plain numerical value is entered.
  let blockReason: string | null = null;
  if (!hasValue) {
    blockReason = 'Task Deliverables Description is required.';
  } else if (!isNumericInput) {
    if (isExplicitVague || GENERIC_ACTIVITY_ONLY_REGEX.test(desc)) {
      blockReason =
        'Task Deliverables Description needs a specific tangible output and target (e.g. "Update thumbnails, titles, and graphics across Module 2 lessons").';
    } else if (!hasTangibleOutput) {
      blockReason =
        'Specify what tangible asset or deliverable was created/updated (e.g. thumbnails, graphics, video clips, captions, voice-over, script, posts).';
    } else if (!hasMeasurableScope) {
      blockReason =
        'Add a measurable count or named target (e.g. "two versions", "3 contents", "Reel 1", "Phase 2", "Module 3 Lesson 1").';
    } else if (!hasClientSpecificDetail) {
      blockReason =
        'Make Task Deliverables Description slightly more detailed (action + tangible deliverable + target).';
    }
  }

  const suggestions = checks.filter((c) => !c.passed).map((c) => c.hint);

  return {
    score,
    level,
    isGraphicsOrMediaTask,
    isSubmittable: !blockReason,
    blockReason,
    checks,
    suggestions,
    templateSnippet,
  };
}
