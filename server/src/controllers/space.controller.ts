import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { getCache, setCache, invalidateCache } from '../services/redisService';
import { keepUnseenBlocks, stripMentionSnapshots, taskMentionIds } from '../utils/pageBlocks';
import { writePageIfUnchanged } from '../services/pageContentService';
import { syncClients } from './webhook.controller';

export async function triggerSyncClients(req: Request, res: Response) {
  req.headers['x-api-key'] = process.env.VIPSCALE_API_KEY;
  return syncClients(req, res);
}

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

const pageSelectConfig = {
  id: true,
  title: true,
  docId: true,
  parentPageId: true,
  createdAt: true,
  updatedAt: true,
  isClosed: true,
  reportDate: true,
};

// Helper for recursive folder inclusion
const folderIncludeConfig: any = {
  orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
  include: {
    lists: listsIncludeWithCount,
    docs: {
      where: { isDailyRollover: false },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
      include: {
        pages: {
          orderBy: { createdAt: 'asc' },
          select: {
            ...pageSelectConfig,
            subpages: {
              orderBy: { createdAt: 'asc' },
              select: pageSelectConfig,
            },
          },
        },
      },
    },
    subfolders: {
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
      include: {
        lists: listsIncludeWithCount,
        docs: {
          where: { isDailyRollover: false },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
          include: {
            pages: {
              orderBy: { createdAt: 'asc' },
              select: {
                ...pageSelectConfig,
                subpages: {
                  orderBy: { createdAt: 'asc' },
                  select: pageSelectConfig,
                },
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
          where: { folderId: null, isDailyRollover: false },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
          include: {
            pages: {
              orderBy: { createdAt: 'asc' },
              select: {
                ...pageSelectConfig,
                subpages: {
                  orderBy: { createdAt: 'asc' },
                  select: pageSelectConfig,
                },
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
      where: { spaceId: null, folderId: null, isDailyRollover: false },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
      include: {
        pages: {
          orderBy: { createdAt: 'asc' },
          select: {
            ...pageSelectConfig,
            subpages: {
              orderBy: { createdAt: 'asc' },
              select: pageSelectConfig,
            },
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

    const allDocsList = collectAllDocs(resultSpaces);
    const dailyRolloverDocs = await prisma.doc.findMany({
      where: { isDailyRollover: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] as any,
      include: {
        pages: {
          orderBy: { createdAt: 'asc' },
          select: {
            ...pageSelectConfig,
            subpages: {
              orderBy: { createdAt: 'asc' },
              select: pageSelectConfig,
            },
          },
        },
      },
    });
    dailyRolloverDocs.forEach((d) => allDocsList.push({ doc: d }));

    const payload = {
      spaces: resultSpaces,
      allLists: collectAllLists(resultSpaces),
      allDocs: allDocsList,
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
          where: { folderId: null, isDailyRollover: false },
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
      where: { spaceId: null, folderId: null, isDailyRollover: false },
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
        roles: true,
      },
      orderBy: { name: 'asc' },
    });

    const allDocsList = collectAllDocs(resultSpaces);
    const dailyRolloverDocs = await prisma.doc.findMany({
      where: { isDailyRollover: true },
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
    dailyRolloverDocs.forEach((d) => allDocsList.push({ doc: d }));

    const payload = {
      spaces: resultSpaces,
      users,
      allLists: collectAllLists(resultSpaces),
      allDocs: allDocsList,
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
    const { title, docDate, spaceId, folderId, teamId, isDailyRollover } = req.body;
    const doc = await prisma.doc.create({
      data: {
        title,
        docDate: docDate ? new Date(docDate) : new Date(),
        spaceId: spaceId || null,
        folderId: folderId || null,
        teamId: teamId || null,
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
// ?includeContent=false returns the page tree without page content (the editor loads the open page via
// GET /pages/:id). Journal docs gain a page every day, so sending every page's content grows forever.
export async function getDoc(req: Request, res: Response) {
  try {
    const includeContent = req.query.includeContent !== 'false';
    const pagesQuery = includeContent
      ? {
          where: { parentPageId: null },
          orderBy: { createdAt: 'asc' as const },
          include: {
            subpages: {
              orderBy: { createdAt: 'asc' as const },
              include: {
                subpages: { orderBy: { createdAt: 'asc' as const } },
              },
            },
          },
        }
      : {
          where: { parentPageId: null },
          orderBy: { createdAt: 'asc' as const },
          select: {
            ...pageSelectConfig,
            subpages: {
              orderBy: { createdAt: 'asc' as const },
              select: {
                ...pageSelectConfig,
                subpages: { orderBy: { createdAt: 'asc' as const }, select: pageSelectConfig },
              },
            },
          },
        };

    const doc = await prisma.doc.findUnique({
      where: { id: req.params.id },
      include: {
        space: { select: { id: true, name: true, color: true } },
        folder: { select: { id: true, name: true } },
        team: { select: { id: true, name: true, color: true } },
        pages: pagesQuery,
      },
    });
    if (!doc) return res.status(404).json({ error: 'Doc not found' });
    return res.json({ doc });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// GET /api/spaces/pages/:id - a single page with its content
export async function getPage(req: Request, res: Response) {
  try {
    // ?since=<updatedAt the client has cached>: answer "not modified" from the timestamp alone instead of
    // reading and sending the (possibly megabytes of) content again. Every content write — editor saves and
    // the journal auto-append alike — bumps updatedAt, so a changed page is always sent in full.
    const since = typeof req.query.since === 'string' ? new Date(req.query.since) : null;
    if (since && !Number.isNaN(since.getTime())) {
      const meta = await prisma.page.findUnique({ where: { id: req.params.id }, select: { id: true, updatedAt: true } });
      if (!meta) return res.status(404).json({ error: 'Page not found' });
      if (meta.updatedAt.getTime() <= since.getTime()) return res.json({ notModified: true, page: meta });
    }

    const page = await prisma.page.findUnique({
      where: { id: req.params.id },
      select: { ...pageSelectConfig, content: true },
    });
    if (!page) return res.status(404).json({ error: 'Page not found' });
    return res.json({ page: { ...page, content: stripMentionSnapshots(page.content) } });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}



// PATCH /api/spaces/docs/:id
export async function updateDoc(req: Request, res: Response) {
  try {
    const { title, docDate, teamId, assigneeRoleRestrictions } = req.body;
    const doc = await prisma.doc.update({
      where: { id: req.params.id },
      data: {
        ...(title && { title }),
        ...(docDate && { docDate: new Date(docDate) }),
        ...(teamId !== undefined && { teamId }),
        ...(assigneeRoleRestrictions !== undefined && { assigneeRoleRestrictions }),
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
const VERSION_COALESCE_MS = 30_000;

export async function updatePage(req: Request, res: Response) {
  try {
    const { title, deletedBlockIds } = req.body;
    const incoming: string | undefined = req.body.content === undefined ? undefined : stripMentionSnapshots(req.body.content);
    const authReq = req as any;
    const userId = authReq.user?.id;

    // Read the stored values first so unchanged saves (e.g. clicking out of a block) don't create a
    // version or bust the hierarchy cache. The doc editor sends the title with every save.
    const readPrevious = () => prisma.page.findUnique({
      where: { id: req.params.id },
      select: {
        ...pageSelectConfig,
        content: true,
        doc: { select: { isDailyRollover: true, rolloverTimezone: true } },
      },
    });
    let previous = await readPrevious();
    if (!previous) return res.status(404).json({ error: 'Page not found' });

    let content = incoming;
    let keptUnseenBlocks = false;
    let page: Omit<NonNullable<typeof previous>, 'content' | 'doc'>;
    if (incoming === undefined) {
      const { content: _content, ...updated } = await prisma.page.update({
        where: { id: req.params.id },
        data: { ...(title && { title }) },
      });
      page = updated;
    } else {
      // Conditional write: a journal auto-append (or another save) landing between the read above and this
      // write is re-read and merged in instead of being overwritten (see pageContentService).
      for (let attempt = 1; ; attempt++) {
        content = incoming;
        keptUnseenBlocks = false;
        // Only editors that report their deletions get the merge; older clients keep last-write-wins
        if (Array.isArray(deletedBlockIds)) {
          const merged = keepUnseenBlocks(previous.content, incoming, deletedBlockIds);
          keptUnseenBlocks = merged !== incoming;
          content = merged;
        }
        const updatedAt = await writePageIfUnchanged(req.params.id, previous.updatedAt, {
          content,
          ...(title && { title }),
        });
        if (updatedAt) {
          const { content: _content, doc: _doc, ...meta } = previous;
          page = { ...meta, ...(title && { title }), updatedAt };
          break;
        }
        if (attempt >= 5) return res.status(409).json({ error: 'Page is being changed by someone else; please retry' });
        previous = await readPrevious();
        if (!previous) return res.status(404).json({ error: 'Page not found' });
      }
    }
    // The page content can be megabytes: send it back only when the server changed it (kept blocks the
    // editor hadn't seen), since otherwise the editor already has exactly what it sent.
    const savedContent = content;

    if (content !== undefined && userId && previous?.content !== content) {
      // A burst of saves (typing, mention chips refreshing) folds into one version per user instead of a
      // full page copy per keystroke; a pause longer than the window starts a new version.
      const recent = await prisma.pageVersion.findFirst({
        where: { pageId: page.id, createdAt: { gte: new Date(Date.now() - VERSION_COALESCE_MS) } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, userId: true },
      });
      if (recent && recent.userId === userId) {
        await prisma.pageVersion.update({ where: { id: recent.id }, data: { content } });
      } else {
        await prisma.pageVersion.create({ data: { pageId: page.id, userId, content } });
      }
    }

    // The cached hierarchy only holds page titles, so content-only saves don't need to invalidate it
    if (title && title !== previous?.title) {
      await invalidateCache('spaces:all', 'dashboard:all');
    }
    res.json({ page: keptUnseenBlocks ? { ...page, content: savedContent } : page });

    if (content !== undefined && previous && previous.content !== content) {
      syncRolloverExclusions(previous, content).catch((err) => console.error('[Rollover] exclusion sync failed:', err));
    }
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Page not found' });
    return res.status(500).json({ error: err.message });
  }
}

/**
 * On today's day page of a daily rollover doc, erasing every mention of a task takes it (and its subtasks)
 * off the following days' pages; mentioning it there again brings it back. Older day pages are history,
 * so edits to them change nothing.
 */
async function syncRolloverExclusions(
  previous: { content: string; title: string; parentPageId: string | null; doc: { isDailyRollover: boolean; rolloverTimezone: string } },
  content: string,
) {
  if (!previous.doc.isDailyRollover || !previous.parentPageId) return;
  // Same title format the rollover worker gives day pages ("October 14, 2026")
  const todayTitle = new Intl.DateTimeFormat('en-US', {
    timeZone: previous.doc.rolloverTimezone || 'Asia/Singapore',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
  if (previous.title !== todayTitle) return;

  const before = taskMentionIds(previous.content);
  const after = taskMentionIds(content);
  const erased = [...before].filter((id) => !after.has(id));
  const added = [...after].filter((id) => !before.has(id));

  if (erased.length > 0) {
    await prisma.task.updateMany({ where: { id: { in: erased } }, data: { rolloverExcluded: true } });
  }
  if (added.length > 0) {
    await prisma.task.updateMany({ where: { id: { in: added }, rolloverExcluded: true }, data: { rolloverExcluded: false } });
  }
}

// GET /api/spaces/pages/:id/versions
export async function getPageVersions(req: Request, res: Response) {
  try {
    const authReq = req as any;
    const userId = authReq.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // ?includeContent=false lists who saved when (page owner / contributors) without the full page copies,
    // which for a journal day page add up to tens of megabytes. ?mine=true limits it to the caller's versions.
    const includeContent = req.query.includeContent !== 'false';
    const versions = await prisma.pageVersion.findMany({
      where: { pageId: req.params.id, ...(req.query.mine === 'true' && { userId }) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        pageId: true,
        userId: true,
        createdAt: true,
        ...(includeContent && { content: true }),
        user: { select: { id: true, name: true, avatarUrl: true, email: true } },
      },
    });
    return res.json({ versions });
  } catch (err: any) {
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
    await invalidateCache('spaces:all', 'dashboard:all', 'lists:all');
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

