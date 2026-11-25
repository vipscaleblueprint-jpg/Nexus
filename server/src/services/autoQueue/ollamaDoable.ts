/**
 * Asks the self-hosted Ollama model which unstarted tasks in an MA's column
 * they realistically cannot finish before their shift ends today.
 *
 * Items are labelled t1..tN; started (IN PROGRESS) tasks are shown for context
 * and excluded from the JSON schema enum so only unstarted labels can be returned.
 */
import { isBoardItemStarted, type BoardItem } from './rules';
import {
  chatWithOllama,
  cleanOllamaText,
  formatOllamaDue,
  type OllamaConfig,
} from './ollamaPicker';

export interface DoableAnswer {
  cannotFinishIds: string[];
  reason: string;
}

const MAX_DESCRIPTION_CHARS = 600;
const label = (i: number) => `t${i + 1}`;

export function buildDoableRequest(remainingHours: number, items: BoardItem[], model: string) {
  const hoursStr = Math.max(0, remainingHours).toFixed(1);
  const unstartedLabels = items
    .map((it, i) => (isBoardItemStarted(it) ? null : label(i)))
    .filter((x): x is string => Boolean(x));

  const systemPrompt = `You are the project manager for a team of marketing associates (MAs).
The MA has ${hoursStr}h left in their shift today.
Tasks marked IN PROGRESS are already started and come first — factor those in before any not-started work.
From the not-started tasks only, list the tasks they realistically cannot finish today, judged from estimates, priority, due date, and description.
If everything fits, return an empty list.
Reply with JSON only: {"cannotFinish": ["t2", ...], "reason": "<one short sentence>"}.`;

  const lines = items.map((it, i) => {
    const started = isBoardItemStarted(it);
    const parts = [
      `${label(i)}: ${cleanOllamaText(it.title, 200)}`,
      started ? 'IN PROGRESS' : 'not started',
      it.parentTaskTitle ? `part of ${cleanOllamaText(it.parentTaskTitle, 120)}` : null,
      `client ${(it.list?.name || '').trim() || 'unknown'}`,
      `priority ${it.priority || 'MEDIUM'}`,
      `due ${formatOllamaDue(it.dueDate)}`,
      it.estimatedHours ? `est ${it.estimatedHours}h` : 'no estimate',
      it.description ? `desc: ${cleanOllamaText(it.description, MAX_DESCRIPTION_CHARS)}` : null,
    ].filter(Boolean);
    return `- ${parts.join('; ')}`;
  });

  return {
    model,
    stream: false,
    messages: [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `${hoursStr}h left in shift.\n\nTasks:\n${lines.join('\n')}` },
    ],
    format: {
      type: 'object',
      properties: {
        cannotFinish: {
          type: 'array',
          items: { type: 'string', enum: unstartedLabels },
        },
        reason: { type: 'string' },
      },
      required: ['cannotFinish', 'reason'],
    },
    options: { temperature: 0 },
  };
}

export function parseDoableResponse(raw: string, items: BoardItem[]): DoableAnswer | null {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cannotFinish)) {
    return null;
  }

  const labelToId = new Map<string, string>();
  items.forEach((it, i) => {
    if (!isBoardItemStarted(it)) labelToId.set(label(i), it.id);
  });

  const seen = new Set<string>();
  const cannotFinishIds: string[] = [];
  for (const entry of parsed.cannotFinish) {
    const id = labelToId.get(String(entry || '').trim());
    if (id && !seen.has(id)) {
      seen.add(id);
      cannotFinishIds.push(id);
    }
  }

  const reason =
    typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim().slice(0, 300)
      : 'Checked by AI';
  return { cannotFinishIds, reason };
}

export async function judgeWithOllama(
  remainingHours: number,
  items: BoardItem[],
  config: OllamaConfig
): Promise<DoableAnswer | null> {
  if (remainingHours <= 0 || items.every(isBoardItemStarted)) return null;
  return chatWithOllama(
    config,
    buildDoableRequest(remainingHours, items, config.model),
    (raw) => parseDoableResponse(raw, items),
    'AutoQueue'
  );
}
