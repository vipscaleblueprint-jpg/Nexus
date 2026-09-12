import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { getCache, setCache, invalidateCache } from '../services/redisService';

function collectAllLists(spaces: any[]): { list: any; spaceName?: string; folderName?: string }[] {
  const result: { list: any; spaceName?: string; folderName?: string }[] = [];

  function processFolders(folders: any[], spaceName?: string, parentFolderName?: string) {
    folders.forEach((f) => {
      const currentFolderName = parentFolderName ? `${parentFolderName} / ${f.name}` : f.name;
      if (f.lists) {
        f.lists.forEach((l: any) => result.push({ list: l, spaceName, folderName: currentFolderName }));
      }
      if (f.subfolders) {
        processFolders(f.subfolders, spaceName, currentFolderName);
      }
    });
  }

  spaces.forEach((s) => {
    const effectiveSpaceName = s.id === 'root-space' ? undefined : s.name;
    if (s.lists) {
      s.lists.forEach((l: any) => result.push({ list: l, spaceName: effectiveSpaceName }));
    }
    if (s.folders) {
      processFolders(s.folders, effectiveSpaceName);
    }
  });

  return result;
}

function collectAllDocs(spaces: any[]): { doc: any; spaceName?: string; folderName?: string }[] {
  const result: { doc: any; spaceName?: string; folderName?: string }[] = [];

  function processFolders(folders: any[], spaceName?: string, parentFolderName?: string) {
    folders.forEach((f) => {
      const currentFolderName = parentFolderName ? `${parentFolderName} / ${f.name}` : f.name;
      if (f.docs) {
        f.docs.forEach((d: any) => result.push({ doc: d, spaceName, folderName: currentFolderName }));
      }
      if (f.subfolders) {
        processFolders(f.subfolders, spaceName, currentFolderName);
      }
    });
  }

  spaces.forEach((s) => {
    const effectiveSpaceName = s.id === 'root-space' ? undefined : s.name;
    if (s.docs) {
      s.docs.forEach((d: any) => result.push({ doc: d, spaceName: effectiveSpaceName }));
    }
    if (s.folders) {
      processFolders(s.folders, effectiveSpaceName);
    }
  });

  return result;
}

// Helper for listing lists with task count
const listsIncludeWithCount = {
  orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
  include: { _count: { select: { tasks: true } } },
};

// Helper for recursive folder inclusion
const folderIncludeConfig: any = {
  orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
  include: {
    lists: listsIncludeWithCount,
    docs: {
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
      include: {
        pages: {
          orderBy: { createdAt: 'asc' },
          include: {
            subpages: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    },
    subfolders: {
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
      include: {
        lists: listsIncludeWithCount,
        docs: {
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
          include: {
            pages: {
              orderBy: { createdAt: 'asc' },
              include: {
                subpages: { orderBy: { createdAt: 'asc' } },
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
    const cachedSpaces = await getCache<any>('spaces:all');
    if (cachedSpaces) {
      if (Array.isArray(cachedSpaces)) {
        return res.json({ spaces: cachedSpaces, allLists: collectAllLists(cachedSpaces), allDocs: collectAllDocs(cachedSpaces), cached: true });
      }
      return res.json({ ...cachedSpaces, cached: true });
    }

    const spaces = await prisma.space.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
      include: {
        folders: folderIncludeConfig,
        lists: { where: { folderId: null }, ...listsIncludeWithCount },
        docs: {
          where: { folderId: null },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
          include: {
            pages: {
              orderBy: { createdAt: 'asc' },
              include: {
                subpages: { orderBy: { createdAt: 'asc' } },
              },
            },
          },
        },
      },
    });

    // Also fetch standalone root items (folders/lists/docs with no spaceId)
    const rootFolders = await prisma.folder.findMany({
      where: { spaceId: null, parentFolderId: null },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
      include: folderIncludeConfig.include,
    });
    const rootLists = await prisma.list.findMany({
      where: { spaceId: null, folderId: null },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
      include: { _count: { select: { tasks: true } } },
    });
    const rootDocs = await prisma.doc.findMany({
      where: { spaceId: null, folderId: null },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
      include: {
        pages: {
          orderBy: { createdAt: 'asc' },
          include: {
            subpages: { orderBy: { createdAt: 'asc' } },
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

    const payload = {
      spaces: resultSpaces,
      allLists: collectAllLists(resultSpaces),
      allDocs: collectAllDocs(resultSpaces),
    };

    await setCache('spaces:all', payload, 300);

    return res.json({ ...payload, cached: false });
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
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
      include: {
        folders: folderIncludeConfig,
        lists: { where: { folderId: null }, ...listsIncludeWithCount },
        docs: {
          where: { folderId: null },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
          include: {
            pages: {
              orderBy: { createdAt: 'asc' },
              include: {
                subpages: { orderBy: { createdAt: 'asc' } },
              },
            },
          },
        },
      },
    });

    const rootFolders = await prisma.folder.findMany({
      where: { spaceId: null, parentFolderId: null },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
      include: folderIncludeConfig.include,
    });
    const rootLists = await prisma.list.findMany({
      where: { spaceId: null, folderId: null },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
      include: { _count: { select: { tasks: true } } },
    });
    const rootDocs = await prisma.doc.findMany({
      where: { spaceId: null, folderId: null },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
      include: {
        pages: {
          orderBy: { createdAt: 'asc' },
          include: {
            subpages: { orderBy: { createdAt: 'asc' } },
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

    const payload = {
      spaces: resultSpaces,
      users,
      allLists: collectAllLists(resultSpaces),
      allDocs: collectAllDocs(resultSpaces),
    };
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

// PATCH /api/spaces/:id
export async function updateSpace(req: Request, res: Response) {
  try {
    const { name, icon, color } = req.body;
    const space = await prisma.space.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(icon && { icon }),
        ...(color && { color }),
      },
    });
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.json({ space });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Space not found' });
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/spaces/:id/duplicate
export async function duplicateSpace(req: Request, res: Response) {
  try {
    const original = await prisma.space.findUnique({ where: { id: req.params.id } });
    if (!original) return res.status(404).json({ error: 'Space not found' });

    const space = await prisma.space.create({
      data: {
        name: `${original.name} (Copy)`,
        icon: original.icon,
        color: original.color,
        ownerId: original.ownerId,
      },
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

// PATCH /api/spaces/folders/:id
export async function updateFolder(req: Request, res: Response) {
  try {
    const { name } = req.body;
    const folder = await prisma.folder.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
      },
    });
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.json({ folder });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Folder not found' });
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/spaces/folders/:id/duplicate
export async function duplicateFolder(req: Request, res: Response) {
  try {
    const original = await prisma.folder.findUnique({ where: { id: req.params.id } });
    if (!original) return res.status(404).json({ error: 'Folder not found' });

    const folder = await prisma.folder.create({
      data: {
        name: `${original.name} (Copy)`,
        spaceId: original.spaceId,
        parentFolderId: original.parentFolderId,
      },
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
    const { title, docDate, spaceId, folderId, isDailyRollover } = req.body;
    const doc = await prisma.doc.create({
      data: {
        title,
        docDate: docDate ? new Date(docDate) : new Date(),
        spaceId: spaceId || null,
        folderId: folderId || null,
        isDailyRollover: isDailyRollover || false,
      },
    });
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.status(201).json({ doc });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// GET /api/spaces/docs/:id
export async function getDoc(req: Request, res: Response) {
  try {
    const doc = await prisma.doc.findUnique({
      where: { id: req.params.id },
      include: {
        space: { select: { id: true, name: true, color: true } },
        folder: { select: { id: true, name: true } },
        pages: {
          where: { parentPageId: null },
          orderBy: { createdAt: 'asc' },
          include: {
            subpages: {
              orderBy: { createdAt: 'asc' },
              include: {
                subpages: { orderBy: { createdAt: 'asc' } },
              },
            },
          },
        },
      },
    });
    if (!doc) return res.status(404).json({ error: 'Doc not found' });
    return res.json({ doc });
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

// POST /api/spaces/docs/:id/duplicate
export async function duplicateDoc(req: Request, res: Response) {
  try {
    const original = await prisma.doc.findUnique({ where: { id: req.params.id } });
    if (!original) return res.status(404).json({ error: 'Doc not found' });

    const doc = await prisma.doc.create({
      data: {
        title: `${original.title} (Copy)`,
        docDate: original.docDate,
        spaceId: original.spaceId,
        folderId: original.folderId,
      },
    });
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.status(201).json({ doc });
  } catch (err: any) {
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

// POST /api/spaces/pages/:id/duplicate
export async function duplicatePage(req: Request, res: Response) {
  try {
    const original = await prisma.page.findUnique({ where: { id: req.params.id } });
    if (!original) return res.status(404).json({ error: 'Page not found' });

    const page = await prisma.page.create({
      data: {
        title: `${original.title} (Copy)`,
        content: original.content,
        docId: original.docId,
        parentPageId: original.parentPageId,
      },
    });
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.status(201).json({ page });
  } catch (err: any) {
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

// PUT /api/spaces/reorder
export async function reorderSpaces(req: Request, res: Response) {
  try {
    const { items } = req.body; // Array of { id, order }
    await Promise.all(items.map((item: any) => 
      prisma.space.update({
        where: { id: item.id },
        data: { order: item.order } as any
      })
    ));
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PUT /api/spaces/folders/reorder
export async function reorderFolders(req: Request, res: Response) {
  try {
    const { items } = req.body; // Array of { id, order, spaceId?, parentFolderId? }
    await Promise.all(items.map((item: any) => {
      const updateData: any = { order: item.order };
      if (item.spaceId !== undefined) updateData.spaceId = item.spaceId;
      if (item.parentFolderId !== undefined) updateData.parentFolderId = item.parentFolderId;
      
      return prisma.folder.update({
        where: { id: item.id },
        data: updateData
      });
    }));
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PUT /api/spaces/lists/reorder
export async function reorderLists(req: Request, res: Response) {
  try {
    const { items } = req.body; // Array of { id, order, spaceId?, folderId? }
    await Promise.all(items.map((item: any) => {
      const updateData: any = { order: item.order };
      if (item.spaceId !== undefined) updateData.spaceId = item.spaceId;
      if (item.folderId !== undefined) updateData.folderId = item.folderId;
      
      return prisma.list.update({
        where: { id: item.id },
        data: updateData
      });
    }));
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// PUT /api/spaces/docs/reorder
export async function reorderDocs(req: Request, res: Response) {
  try {
    const { items } = req.body; // Array of { id, order, spaceId?, folderId? }
    await Promise.all(items.map((item: any) => {
      const updateData: any = { order: item.order };
      if (item.spaceId !== undefined) updateData.spaceId = item.spaceId;
      if (item.folderId !== undefined) updateData.folderId = item.folderId;
      
      return prisma.doc.update({
        where: { id: item.id },
        data: updateData
      });
    }));
    await invalidateCache('spaces:all', 'dashboard:all');
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

