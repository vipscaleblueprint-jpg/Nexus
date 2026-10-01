import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import {
  testConnection,
  getWorkspaces,
  getSpaces,
  getFolders,
  getListsInFolder,
  getFolderlessLists,
  getClickUpTask,
} from '../services/clickupService';

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
// We store the mapping in the List.externalId field (or a separate JSON
// column if that field is already in use). For now we use List.externalId
// prefixed with "cu:" so it doesn't clash with other external IDs.
// ---------------------------------------------------------------------------
export async function getMappings(req: Request, res: Response) {
  try {
    const lists = await prisma.list.findMany({
      where: {
        externalId: { startsWith: 'cu:' }
      } as any,
      select: {
        id: true,
        name: true,
        externalId: true,
        space: { select: { id: true, name: true } },
        folder: { select: { id: true, name: true } },
      }
    });

    const mappings = lists.map((l: any) => ({
      nexusListId: l.id,
      nexusListName: l.name,
      space: l.space,
      folder: l.folder,
      clickUpListId: l.externalId?.replace('cu:', '') ?? null,
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
      data: { externalId: `cu:${clickUpListId}` } as any,
      select: { id: true, name: true, externalId: true }
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
    return res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/clickup/mappings/:nexusListId
// Removes the ClickUp mapping from a Nexus list.
// ---------------------------------------------------------------------------
export async function deleteMapping(req: Request, res: Response) {
  try {
    const { nexusListId } = req.params;
    await prisma.list.update({
      where: { id: nexusListId },
      data: { externalId: null } as any,
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
