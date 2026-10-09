import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { io } from '../server';
import {
  testConnection,
  getWorkspaces,
  getSpaces,
  getFolders,
  getListsInFolder,
  getFolderlessLists,
  getClickUpTask,
  resolveClickUpListId,
} from '../services/clickupService';
import { startClickUpSync, getClickUpSyncState } from '../services/clickupSyncService';
import { autoLinkClientDashboardLists } from '../services/clickupMappingService';

// ---------------------------------------------------------------------------
// GET /api/clickup/status
// Quick connectivity check — returns the authenticated ClickUp user info.
// ---------------------------------------------------------------------------
export async function getClickUpStatus(req: Request, res: Response) {
  try {
    const result = await testConnection();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/clickup/workspaces
// Returns all ClickUp workspaces visible to the API key.
// ---------------------------------------------------------------------------
export async function listWorkspaces(req: Request, res: Response) {
  try {
    const data = await getWorkspaces();
    return res.json({ teams: data?.teams ?? [] });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/clickup/workspaces/:teamId/spaces
// ---------------------------------------------------------------------------
export async function listSpaces(req: Request, res: Response) {
  try {
    const { teamId } = req.params;
    const data = await getSpaces(teamId);
    return res.json({ spaces: data?.spaces ?? [] });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/clickup/spaces/:spaceId/folders
// ---------------------------------------------------------------------------
export async function listFolders(req: Request, res: Response) {
  try {
    const { spaceId } = req.params;
    const data = await getFolders(spaceId);
    return res.json({ folders: data?.folders ?? [] });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/clickup/folders/:folderId/lists
// ---------------------------------------------------------------------------
export async function listFolderLists(req: Request, res: Response) {
  try {
    const { folderId } = req.params;
    const data = await getListsInFolder(folderId);
    return res.json({ lists: data?.lists ?? [] });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/clickup/spaces/:spaceId/folderless-lists
// ---------------------------------------------------------------------------
export async function listFolderlessLists(req: Request, res: Response) {
  try {
    const { spaceId } = req.params;
    const data = await getFolderlessLists(spaceId);
    return res.json({ lists: data?.lists ?? [] });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/clickup/mappings
// Returns all Nexus lists that have a ClickUp list ID mapped to them.
// Mappings live in List.clickUpListId (List.externalId holds the Galaxy client
// ID); older mappings stored as "cu:<id>" in externalId are still read.
// ---------------------------------------------------------------------------
export async function getMappings(req: Request, res: Response) {
  try {
    const lists = await prisma.list.findMany({
      where: {
        OR: [{ clickUpListId: { not: null } }, { externalId: { startsWith: 'cu:' } }]
      },
      select: {
        id: true,
        name: true,
        externalId: true,
        clickUpListId: true,
        space: { select: { id: true, name: true } },
        folder: { select: { id: true, name: true } },
      }
    });

    const mappings = lists.map((l) => ({
      nexusListId: l.id,
      nexusListName: l.name,
      space: l.space,
      folder: l.folder,
      clickUpListId: resolveClickUpListId(l),
    }));

    return res.json({ mappings });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/clickup/mappings
// Body: { nexusListId, clickUpListId }
// Links a Nexus list to a ClickUp list so tasks auto-sync.
// ---------------------------------------------------------------------------
export async function createMapping(req: Request, res: Response) {
  try {
    const { nexusListId, clickUpListId } = req.body;
    if (!nexusListId || !clickUpListId) {
      return res.status(400).json({ error: 'nexusListId and clickUpListId are required' });
    }

    const list = await prisma.list.update({
      where: { id: nexusListId },
      data: { clickUpListId: String(clickUpListId) },
      select: { id: true, name: true }
    });

    return res.json({
      ok: true,
      mapping: {
        nexusListId: list.id,
        nexusListName: list.name,
        clickUpListId,
      }
    });
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'That ClickUp list is already mapped to another Nexus list' });
    }
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/clickup/mappings/auto-link
// Links unmapped Client Dashboard lists to the ClickUp list with the same name.
// ---------------------------------------------------------------------------
export async function autoLinkMappings(req: Request, res: Response) {
  try {
    const result = await autoLinkClientDashboardLists();
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/clickup/mappings/:nexusListId
// Removes the ClickUp mapping from a Nexus list.
// ---------------------------------------------------------------------------
export async function deleteMapping(req: Request, res: Response) {
  try {
    const { nexusListId } = req.params;
    const list = await prisma.list.findUnique({ where: { id: nexusListId }, select: { externalId: true } });
    await prisma.list.update({
      where: { id: nexusListId },
      // Only clear externalId when it's a legacy "cu:" mapping — otherwise it's the Galaxy client ID.
      data: {
        clickUpListId: null,
        ...(list?.externalId?.startsWith('cu:') && { externalId: null }),
      },
    });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/clickup/tasks/:taskId
// Proxies a ClickUp task fetch — useful for the frontend to check sync state.
// ---------------------------------------------------------------------------
export async function getClickUpTaskProxy(req: Request, res: Response) {
  try {
    const { taskId } = req.params;
    const data = await getClickUpTask(taskId);
    return res.json({ task: data });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/clickup/recent-activity
// Returns the last N tasks updated in Nexus that have a ClickUp external ID.
// ---------------------------------------------------------------------------
export async function getRecentSyncedActivity(req: Request, res: Response) {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '20')), 50);

    // Get tasks that have a clickup external ID
    const tasks = await prisma.task.findMany({
      where: {
        externalId: { not: null }
      } as any,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        externalId: true,
        updatedAt: true,
        list: { select: { id: true, name: true } },
        assignees: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    return res.json({ tasks });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/clickup/sync-all
// Starts pulling every mapped ClickUp list into Nexus in the background — a
// full pull can outlast an HTTP request. Poll /sync-status for the result.
// ---------------------------------------------------------------------------
export async function syncAllClickUp(req: Request, res: Response) {
  try {
    const started = startClickUpSync({
      // Active tasks only unless the caller asks for closed ones too.
      includeClosed: req.body?.includeClosed === true,
      // Default: only tasks changed since each list's last clean pull.
      full: req.body?.full === true,
      // Optional: pull just these Nexus lists (e.g. one client).
      ...(Array.isArray(req.body?.nexusListIds) &&
        req.body.nexusListIds.length > 0 && { nexusListIds: req.body.nexusListIds.map(String) }),
      emit: (room, event, payload) => io.to(room).emit(event, payload),
    });
    return res.status(202).json({ ok: true, started });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/clickup/sync-status
// Whether a pull is running, with its live progress — or the last finished one.
// ---------------------------------------------------------------------------
export async function getClickUpSyncStatus(req: Request, res: Response) {
  return res.json(getClickUpSyncState());
}
