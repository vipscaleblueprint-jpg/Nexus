import type { Request, Response } from 'express';
import { logger, errMsg } from '../config/logger';
import { canUserSetAssignees } from '../utils/assignPermission';
import { getAutoQueueConfig, runAutoQueue } from '../services/autoQueue/autoQueueService';

/**
 * POST /api/task-map/auto-queue/preview (PMs and Admins)
 * Runs the auto-queue decision in dry-run: returns who each Available task would go to, changes nothing.
 */
export const previewAutoQueueHandler = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!(await canUserSetAssignees(user?.id))) {
      return res.status(403).json({ error: 'Only Project Managers and Admins can preview auto-queue' });
    }
    const config = getAutoQueueConfig();
    const result = await runAutoQueue({ modeOverride: 'dry_run' });
    return res.json({
      success: true,
      configuredMode: config.mode,
      aiEnabled: Boolean(config.ollama),
      maxQueuedPerMa: config.maxQueuedPerMa,
      maxAssignmentsPerRun: config.maxAssignmentsPerRun,
      ...result,
    });
  } catch (err) {
    logger.error(`Auto-queue preview failed: ${errMsg(err)}`);
    return res.status(500).json({ error: 'Auto-queue preview failed' });
  }
};
