import type { Request, Response } from 'express';
import { logger, errMsg } from '../config/logger';
import { canUserSetAssignees } from '../utils/assignPermission';
import {
  AutoQueueBusyError,
  distributeAutoQueue,
  getAutoQueueConfig,
  resetAutoQueue,
  runCheckpoint,
  runDailyAutoQueue,
} from '../services/autoQueue/autoQueueService';

/** PMs and Admins only, same as assigning on the Task Map. Returns the user, or null after replying 403. */
async function requirePm(req: Request, res: Response) {
  const user = (req as any).user;
  if (!(await canUserSetAssignees(user?.id))) {
    res.status(403).json({ error: 'Only Project Managers and Admins can use auto-queue controls' });
    return null;
  }
  return { id: user.id as string, name: user.name as string | undefined, email: user.email as string | undefined };
}

function sendError(res: Response, err: unknown, what: string) {
  if (err instanceof AutoQueueBusyError) return res.status(409).json({ error: err.message });
  logger.error(`Auto-queue ${what} failed: ${errMsg(err)}`);
  return res.status(500).json({ error: `Auto-queue ${what} failed` });
}

/**
 * POST /api/task-map/auto-queue/preview?kind=daily|1pm|5pm|distribute
 * What a run would do right now, changing nothing. Defaults to the 5 AM plan.
 */
export const previewAutoQueueHandler = async (req: Request, res: Response) => {
  const actor = await requirePm(req, res);
  if (!actor) return;
  try {
    const config = getAutoQueueConfig();
    const kind = String(req.query.kind || 'daily');
    const result =
      kind === '1pm' || kind === '5pm'
        ? await runCheckpoint(kind, { modeOverride: 'dry_run' })
        : kind === 'distribute'
          ? await distributeAutoQueue(actor, { preview: true })
          : await runDailyAutoQueue({ modeOverride: 'dry_run' });
    return res.json({
      success: true,
      kind,
      configuredMode: config.mode,
      aiEnabled: Boolean(config.ollama),
      defaultHours: config.defaultHours,
      ...result,
    });
  } catch (err) {
    return sendError(res, err, 'preview');
  }
};

/** POST /api/task-map/auto-queue/reset: unstarted auto-queued tasks back to Available tasks. */
export const resetAutoQueueHandler = async (req: Request, res: Response) => {
  const actor = await requirePm(req, res);
  if (!actor) return;
  try {
    return res.json({ success: true, ...(await resetAutoQueue(actor)) });
  } catch (err) {
    return sendError(res, err, 'reset');
  }
};

/** POST /api/task-map/auto-queue/distribute: re-balance unstarted auto-queued tasks and the pool. */
export const distributeAutoQueueHandler = async (req: Request, res: Response) => {
  const actor = await requirePm(req, res);
  if (!actor) return;
  try {
    return res.json({ success: true, ...(await distributeAutoQueue(actor)) });
  } catch (err) {
    return sendError(res, err, 'distribute');
  }
};
