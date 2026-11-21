/**
 * Asks the self-hosted Ollama model which on-shift MA should get a task.
 *
 * The model only chooses among candidates code already filtered (eligible, on shift, under the cap).
 * Candidates are shown as short labels (c1, c2, ...) and the JSON schema restricts the answer to those
 * labels, so a small model can't invent a person. Any failure returns null and the caller falls back
 * to the fewest-tasks rule.
 */
import { logger, errMsg } from '../../config/logger';

export interface PickTask {
  title: string;
  client?: string | null;
  parentTaskTitle?: string | null;
  priority?: string | null;
  dueDate?: string | Date | null;
  description?: string | null;
}

export interface PickCandidate {
  id: string;
  name: string;
  active: number;
  queued: number;
  starRating?: number | null;
  /** Clients of the open tasks already in their column. */
  currentClients: string[];
  /** They were the original MA on this task (e.g. it came back for revision). */
  workedOnThisBefore: boolean;
}

export interface AiPick {
  userId: string;
  reason: string;
}

export interface OllamaConfig {
  url: string;
  model: string;
  username?: string;
  password?: string;
  timeoutMs: number;
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

const MAX_DESCRIPTION_CHARS = 600;

const SYSTEM_PROMPT = `You are the project manager for a team of marketing associates (MAs).
Pick the ONE MA who should get the task. Everyone listed is on shift and has room for it.
Decide in this order:
1. Someone who worked on this exact task before should get it back.
2. Prefer someone already working for the same client.
3. For URGENT or HIGH priority tasks, prefer a higher star rating.
4. Otherwise, prefer the person with the fewest open tasks.
Reply with JSON only: {"candidate": "<label>", "reason": "<one short sentence>"}.`;

const label = (i: number) => `c${i + 1}`;

function cleanText(s: string | null | undefined, max: number): string {
  const text = (s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function formatDue(d?: string | Date | null): string {
  if (!d) return 'none';
  const date = new Date(d);
  return isNaN(date.getTime()) ? 'none' : date.toISOString().slice(0, 10);
}

export function buildPickRequest(task: PickTask, candidates: PickCandidate[], model: string) {
  const taskLines = [
    `Task: ${cleanText(task.title, 200)}`,
    task.parentTaskTitle ? `Part of: ${cleanText(task.parentTaskTitle, 200)}` : null,
    `Client: ${task.client || 'unknown'}`,
    `Priority: ${task.priority || 'MEDIUM'}`,
    `Due: ${formatDue(task.dueDate)}`,
    task.description ? `Description: ${cleanText(task.description, MAX_DESCRIPTION_CHARS)}` : null,
  ].filter(Boolean);

  const candidateLines = candidates.map((c, i) => {
    const parts = [
      `${label(i)}: ${c.name}`,
      `open tasks ${c.active} (${c.queued} not started)`,
      `star rating ${c.starRating ?? 'n/a'}`,
      `current clients: ${c.currentClients.length ? c.currentClients.join(', ') : 'none'}`,
    ];
    if (c.workedOnThisBefore) parts.push('WORKED ON THIS TASK BEFORE');
    return `- ${parts.join('; ')}`;
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `${taskLines.join('\n')}\n\nCandidates:\n${candidateLines.join('\n')}` },
  ];

  return {
    model,
    stream: false,
    messages,
    format: {
      type: 'object',
      properties: {
        candidate: { type: 'string', enum: candidates.map((_, i) => label(i)) },
        reason: { type: 'string' },
      },
      required: ['candidate', 'reason'],
    },
    options: { temperature: 0 },
  };
}

export function parsePickResponse(raw: string, candidates: PickCandidate[]): AiPick | null {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const idx = candidates.findIndex((_, i) => label(i) === String(parsed?.candidate || '').trim());
  if (idx === -1) return null;
  const reason = typeof parsed?.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim().slice(0, 300) : 'Picked by AI';
  return { userId: candidates[idx].id, reason };
}

export async function pickWithOllama(
  task: PickTask,
  candidates: PickCandidate[],
  config: OllamaConfig
): Promise<AiPick | null> {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return { userId: candidates[0].id, reason: 'Only MA available' };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.username && config.password) {
    headers.Authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
  }

  try {
    const res = await fetch(`${config.url.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildPickRequest(task, candidates, config.model)),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!res.ok) {
      logger.warn(`[AutoQueue] Ollama returned HTTP ${res.status}`);
      return null;
    }
    const body: any = await res.json();
    const pick = parsePickResponse(body?.message?.content || '', candidates);
    if (!pick) logger.warn(`[AutoQueue] Ollama gave an unusable answer: ${String(body?.message?.content || '').slice(0, 200)}`);
    return pick;
  } catch (err) {
    logger.warn(`[AutoQueue] Ollama request failed: ${errMsg(err)}`);
    return null;
  }
}
