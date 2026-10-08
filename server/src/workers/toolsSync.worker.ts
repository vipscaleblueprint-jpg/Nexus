import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { reconcileWithTools } from '../services/toolsSync';

// Safety net for the instant two-way sync: re-sends failed Nexus pushes and
// pulls any assistant changes the Supabase trigger didn't deliver.
export const toolsSyncWorker = new Worker(
  'ToolsSync',
  async () => {
    const summary = await reconcileWithTools();
    return { created: summary.created.length, updated: summary.updated.length, skippedPending: summary.skippedPending.length };
  },
  { connection: redis, concurrency: 1 },
);

toolsSyncWorker.on('failed', (job, err) => {
  logger.error({ err }, `ToolsSync reconcile failed: ${err.message}`);
});
