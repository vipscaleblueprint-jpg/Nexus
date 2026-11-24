import type { OllamaConfig } from './ollamaPicker';

/**
 *   AUTO_QUEUE_MODE=off      (default) does nothing; Galaxy assigns tasks to the whole picked role as before
 *   AUTO_QUEUE_MODE=dry_run  decides and logs what it would assign, changes nothing
 *   AUTO_QUEUE_MODE=on       assigns, as the "Nexus AI" system user; Galaxy tasks wait in Available tasks
 */
export type AutoQueueMode = 'off' | 'dry_run' | 'on';

export interface AutoQueueConfig {
  mode: AutoQueueMode;
  maxQueuedPerMa: number;
  maxAssignmentsPerRun: number;
  /** Hours a task without an estimate counts for when balancing. */
  defaultHours: number;
  ollama: OllamaConfig | null;
}

const numEnv = (name: string, fallback: number, min: number) => {
  const n = Number(process.env[name] || '');
  return Number.isFinite(n) && n >= min ? n : fallback;
};

export function getAutoQueueConfig(): AutoQueueConfig {
  const rawMode = (process.env.AUTO_QUEUE_MODE || 'off').trim().toLowerCase();
  const mode: AutoQueueMode = rawMode === 'on' || rawMode === 'dry_run' ? rawMode : 'off';
  const url = (process.env.OLLAMA_URL || '').trim();
  return {
    mode,
    maxQueuedPerMa: Math.floor(numEnv('AUTO_QUEUE_MAX_QUEUED_PER_MA', 2, 1)),
    maxAssignmentsPerRun: Math.floor(numEnv('AUTO_QUEUE_MAX_PER_RUN', 5, 1)),
    defaultHours: numEnv('AUTO_QUEUE_DEFAULT_HOURS', 3, 0.25),
    ollama: url
      ? {
          url,
          model: (process.env.OLLAMA_MODEL || 'qwen2.5:3b').trim(),
          username: process.env.OLLAMA_USERNAME || undefined,
          password: process.env.OLLAMA_PASSWORD || undefined,
          timeoutMs: Math.floor(numEnv('OLLAMA_TIMEOUT_MS', 60_000, 1000)),
        }
      : null,
  };
}

/** Galaxy tasks go to Available tasks (keeping their role) only while auto-queue actually assigns. */
export function shouldPoolGalaxyRoleTasks(): boolean {
  return getAutoQueueConfig().mode === 'on';
}
