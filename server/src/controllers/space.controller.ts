import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { getCache, setCache, invalidateCache } from '../services/redisService';

// Helper for recursive folder inclusion
const folderIncludeConfig: any = {
  include: {
    lists: true,
    docs: {
      include: {
        pages: {
          include: {
            subpages: true,
          },
        },
      },
    },
    subfolders: {
      include: {
        lists: true,
        docs: {
          include: {
            pages: {
              include: {
                subpages: true,
              },
            },
          },
        },
      },
    },
  },
};

// GET /api/spaces - full hierarchy with Redis Cache-Aside
export async function listSpaces(req: Request, res: Response) {
  try {
    const cachedSpaces = await getCache<any[]>('spaces:all');
    if (cachedSpaces) {
      return res.json({ spaces: cachedSpaces, cached: true });
    }

    const spaces = await prisma.space.findMany({
      include: {
        folders: folderIncludeConfig,
        lists: true,
        docs: {
          include: {
            pages: {
              include: {
                subpages: true,
              },
            },
          },
        },
      },
    });

    // Also fetch standalone root items (folders/lists/docs with no spaceId)
    const rootFolders = await prisma.folder.findMany({
      where: { spaceId: null, parentFolderId: null },
      include: folderIncludeConfig.include,
    });
    const rootLists = await prisma.list.findMany({
      where: { spaceId: null, folderId: null },
    });
    const rootDocs = await prisma.doc.findMany({
      where: { spaceId: null, folderId: null },
      include: {
        pages: {
          include: {
            subpages: true,
          },
        },
      },
    });

    let resultSpaces = [...spaces];

    // If standalone root items exist, bundle them into a virtual Space so they render in hierarchy tree
    if (rootFolders.length > 0 || rootLists.length > 0 || rootDocs.length > 0) {
      resultSpaces.unshift({
        id: 'root-space',
        name: 'Workspace Overview',
        color: '#6366F1',
        folders: rootFolders,
        lists: rootLists,
        docs: rootDocs,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    }

    await setCache('spaces:all', resultSpaces, 300);

    return res.json({ spaces: resultSpaces, cached: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// GET /api/spaces/dashboard - Aggregated single endpoint for Dashboard (Spaces + Users)
export async function getDashboardData(req: Request, res: Response) {
  try {
    const cached = await getCache<any>('dashboard:all');
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const spaces = await prisma.space.findMany({
      include: {
        folders: folderIncludeConfig,
        lists: true,
        docs: {
          include: {
            pages: {
              include: {
                subpages: true,
              },
            },
          },
        },
      },
    });

    const rootFolders = await prisma.folder.findMany({
      where: { spaceId: null, parentFolderId: null },
      include: folderIncludeConfig.include,
    });
    const rootLists = await prisma.list.findMany({
      where: { spaceId: null, folderId: null },
    });
    const rootDocs = await prisma.doc.findMany({
      where: { spaceId: null, folderId: null },
      include: {
        pages: {
          include: {
            subpages: true,
          },
        },
      },
    });

    let resultSpaces = [...spaces];
    if (rootFolders.length > 0 || rootLists.length > 0 || rootDocs.length > 0) {
      resultSpaces.unshift({
        id: 'root-space',
        name: 'Workspace Overview',
        color: '#6366F1',
        folders: rootFolders,
        lists: rootLists,
        docs: rootDocs,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    }

    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        imageUrl: true,
        primaryRole: true,
      },
      orderBy: { name: 'asc' },
    });

    const payload = { spaces: resultSpaces, users };
    await setCache('dashboard:all', payload, 300);

    return res.json({ ...payload, cached: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/spaces
export async function createSpace(req: Request, res: Response) {
  try {
    const { name, icon, color, ownerId } = req.body;
    const space = await prisma.space.create({
      data: { name, icon: icon || 'rocket', color: color || '#4F46E5', ownerId },
    });
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.status(201).json({ space });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/spaces/:id
export async function deleteSpace(req: Request, res: Response) {
  try {
    await prisma.space.delete({ where: { id: req.params.id } });
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.json({ message: 'Space deleted successfully' });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Space not found' });
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/spaces/folders (Can belong to spaceId or parentFolderId)
export async function createFolder(req: Request, res: Response) {
  try {
    const { name, spaceId, parentFolderId } = req.body;
    const folder = await prisma.folder.create({
      data: { name, spaceId: spaceId || null, parentFolderId: parentFolderId || null },
    });
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.status(201).json({ folder });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/spaces/folders/:id
export async function deleteFolder(req: Request, res: Response) {
  try {
    await prisma.folder.delete({ where: { id: req.params.id } });
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.json({ message: 'Folder deleted successfully' });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Folder not found' });
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/spaces/docs (Doc container for Pages)
export async function createDoc(req: Request, res: Response) {
  try {
    const { title, docDate, spaceId, folderId } = req.body;
    const doc = await prisma.doc.create({
      data: {
        title,
        docDate: docDate ? new Date(docDate) : new Date(),
        spaceId: spaceId || null,
        folderId: folderId || null,
      },
    });
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.status(201).json({ doc });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PATCH /api/spaces/docs/:id
export async function updateDoc(req: Request, res: Response) {
  try {
    const { title, docDate } = req.body;
    const doc = await prisma.doc.update({
      where: { id: req.params.id },
      data: {
        ...(title && { title }),
        ...(docDate && { docDate: new Date(docDate) }),
      },
    });
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.json({ doc });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Doc not found' });
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/spaces/docs/:id
export async function deleteDoc(req: Request, res: Response) {
  try {
    await prisma.doc.delete({ where: { id: req.params.id } });
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.json({ message: 'Doc deleted successfully' });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Doc not found' });
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/spaces/pages (Pages inside Docs or subpages inside Pages)
export async function createPage(req: Request, res: Response) {
  try {
    const { title, content, docId, parentPageId } = req.body;
    const page = await prisma.page.create({
      data: {
        title: title || 'Untitled Page',
        content: content || '<h2>Untitled Page</h2><p>Start typing content...</p>',
        docId,
        parentPageId: parentPageId || null,
      },
    });
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.status(201).json({ page });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PATCH /api/spaces/pages/:id
export async function updatePage(req: Request, res: Response) {
  try {
    const { title, content } = req.body;
    const page = await prisma.page.update({
      where: { id: req.params.id },
      data: {
        ...(title && { title }),
        ...(content !== undefined && { content }),
      },
    });
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.json({ page });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Page not found' });
    return res.status(500).json({ error: err.message });
  }
}

// DELETE /api/spaces/pages/:id
export async function deletePage(req: Request, res: Response) {
  try {
    await prisma.page.delete({ where: { id: req.params.id } });
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.json({ message: 'Page deleted successfully' });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Page not found' });
    return res.status(500).json({ error: err.message });
  }
}

// GET /api/spaces/docs/:id/task-subtab
export async function listDocTaskSubtab(req: Request, res: Response) {
  try {
    const docId = req.params.id;
    return res.json({ docId, tasks: [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
