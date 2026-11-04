import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import * as draftService from '../services/draftService';
import { createLogger, errMsg } from '../config/logger';

const log = createLogger('draftController');

export async function getDrafts(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const drafts = await draftService.getUserDrafts(userId);
    return res.json({ drafts });
  } catch (err) {
    log.error({ err }, `getDrafts failed: ${errMsg(err)}`);
    return res.status(500).json({ error: 'Failed to retrieve drafts' });
  }
}

export async function saveDraft(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id, taskId, taskTitle, subtaskId, subtaskTitle, comment, description, type } = req.body;

    if (!taskId) {
      return res.status(400).json({ error: 'taskId is required' });
    }

    const draftId = id || (subtaskId ? `task:${taskId}:sub:${subtaskId}` : `task:${taskId}`);

    const saved = await draftService.saveDraft(userId, {
      id: draftId,
      taskId,
      taskTitle: taskTitle || 'Untitled Task',
      subtaskId: subtaskId || null,
      subtaskTitle: subtaskTitle || null,
      comment: comment ?? undefined,
      description: description ?? undefined,
      type: type || 'comment',
      updatedAt: new Date().toISOString(),
      userId,
    });

    return res.json({ success: true, draft: saved });
  } catch (err) {
    log.error({ err }, `saveDraft failed: ${errMsg(err)}`);
    return res.status(500).json({ error: 'Failed to save draft' });
  }
}

export async function deleteDraft(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Draft ID is required' });
    }

    await draftService.deleteDraft(userId, id);
    return res.json({ success: true, id });
  } catch (err) {
    log.error({ err }, `deleteDraft failed: ${errMsg(err)}`);
    return res.status(500).json({ error: 'Failed to delete draft' });
  }
}

export async function deleteDraftByTask(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { taskId } = req.params;
    const subtaskId = req.query.subtaskId as string | undefined;

    if (!taskId) {
      return res.status(400).json({ error: 'taskId is required' });
    }

    const count = await draftService.deleteDraftByTask(userId, taskId, subtaskId);
    return res.json({ success: true, count });
  } catch (err) {
    log.error({ err }, `deleteDraftByTask failed: ${errMsg(err)}`);
    return res.status(500).json({ error: 'Failed to delete task drafts' });
  }
}

