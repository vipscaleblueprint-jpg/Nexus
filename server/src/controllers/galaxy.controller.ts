import { Response } from 'express';
import { prisma } from '../config/prisma';
import type { AuthRequest } from '../types';
import { parseLaunchDate } from '../utils/launchDate';

import { getToolsBaseUrl, getToolsHeaders } from '../utils/vipscaleTools';

/**
 * Verifies the Nexus session user is active and allowed to create Galaxy tasks
 * (mirrors VIPScale's `tasks.manage` permission: non-intern or admin).
 */
async function resolveGalaxyActor(req: AuthRequest, res: Response) {
  if (!req.user?.id) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      systemRole: true,
      employmentType: true,
    },
  });

  if (!user || !user.isActive) {
    res.status(401).json({ error: 'Account inactive or not found' });
    return null;
  }

  return {
    ...user,
    listedBy: user.name?.trim() || user.email,
  };
}

async function fetchToolsGalaxyMeta(include: 'clients' | 'tasks', res: Response) {
  const apiKey = process.env.VIPSCALE_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'VIPScale integration key is not configured.' });
  }

  try {
    const upstream = await fetch(`${getToolsBaseUrl()}/api/galaxy-task?include=${include}`, {
      method: 'GET',
      headers: getToolsHeaders(),
      signal: AbortSignal.timeout(15000),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data?.error || `Failed to load Galaxy ${include} (${upstream.status})`,
      });
    }

    return res.json(data);
  } catch (err: any) {
    const message = err?.name === 'TimeoutError'
      ? 'Timed out while loading data from VIPScale.'
      : err?.message || 'Failed to connect to VIPScale.';
    return res.status(502).json({ error: message });
  }
}

async function forwardGalaxyCreate(
  mode: 'task' | 'subtask',
  req: AuthRequest,
  res: Response,
) {
  const actor = await resolveGalaxyActor(req, res);
  if (!actor) return;

  const apiKey = process.env.VIPSCALE_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'VIPScale integration key is not configured.' });
  }

  const body = req.body || {};
  if (!body?.clients?.name || !body?.clients?.id || !String(body?.prompt || '').trim()) {
    return res.status(400).json({ error: 'Client and prompt are required.' });
  }
  if (mode === 'task' && !String(body?.goal || '').trim()) {
    return res.status(400).json({ error: 'Goal is required for a new task.' });
  }
  if (mode === 'subtask' && !String(body?.task_link || '').trim()) {
    return res.status(400).json({ error: 'Parent task link is required for a subtask.' });
  }

  // Optional launch date (YYYY-MM-DD): VIPScale forwards it to the Galaxy webhook, which sets the due date.
  if (parseLaunchDate(body.launch_date) === null) {
    return res.status(400).json({ error: 'Launch date must be a valid date.' });
  }
  const upstreamPayload = body;

  try {
    const upstream = await fetch(`${getToolsBaseUrl()}/api/galaxy-task`, {
      method: 'POST',
      headers: getToolsHeaders(),
      body: JSON.stringify({
        mode,
        payload: upstreamPayload,
        listed_by: actor.listedBy,
      }),
      signal: AbortSignal.timeout(90000),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data?.error || `VIPScale Galaxy request failed (${upstream.status})`,
      });
    }

    return res.json(data);
  } catch (err: any) {
    const message = err?.name === 'TimeoutError'
      ? 'Galaxy task request timed out waiting for VIPScale.'
      : err?.message || 'Failed to connect to VIPScale.';
    return res.status(502).json({ error: message });
  }
}

/** GET /api/tasks/galaxy/clients — on-demand active clients list from VIPScale */
export async function getGalaxyClients(req: AuthRequest, res: Response) {
  const actor = await resolveGalaxyActor(req, res);
  if (!actor) return;
  return fetchToolsGalaxyMeta('clients', res);
}

/** GET /api/tasks/galaxy/parent-tasks — on-demand parent tasks (last 30d) from VIPScale */
export async function getGalaxyParentTasks(req: AuthRequest, res: Response) {
  const actor = await resolveGalaxyActor(req, res);
  if (!actor) return;
  return fetchToolsGalaxyMeta('tasks', res);
}

/** POST /api/tasks/galaxy/task — creates a new Galaxy task via VIPScale API */
export async function createGalaxyTask(req: AuthRequest, res: Response) {
  return forwardGalaxyCreate('task', req, res);
}

/** POST /api/tasks/galaxy/subtask — creates a new Galaxy subtask via VIPScale API */
export async function createGalaxySubtask(req: AuthRequest, res: Response) {
  return forwardGalaxyCreate('subtask', req, res);
}
