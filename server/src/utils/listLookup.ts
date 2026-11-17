import { List } from '@prisma/client';
import { prisma } from '../config/prisma';

const DORMANT_FOLDER_NAME = 'dormant clients';

/**
 * Resolves an existing List by externalId / clickUpListId first, then by
 * trimmed case-insensitive name across folders.
 *
 * Name lookup preference order (when strictFolderId is not specified):
 * 1. A list in `preferredFolderId` (e.g. "Client Dashboard").
 * 2. Any list outside "Dormant Clients" (e.g. "Startups", "Admin", "Human Resource").
 * 3. Any existing list in "Dormant Clients" (preferring linked or populated lists).
 */
export async function findExistingListByIdentifiers(opts: {
  externalId?: string | null;
  clickUpListId?: string | null;
  name?: string | null;
  preferredFolderId?: string | null;
  strictFolderId?: string | null;
}) {
  const extId = opts.externalId?.trim() || '';
  const cuId = opts.clickUpListId?.trim() || '';
  const trimmedName = opts.name?.trim() || '';

  if (extId) {
    const byExt = await prisma.list.findUnique({ where: { externalId: extId } });
    if (byExt) return byExt;
  }

  if (cuId) {
    const byCu = await prisma.list.findFirst({
      where: {
        OR: [
          { clickUpListId: cuId },
          { externalId: `cu:${cuId}` },
          { externalId: cuId },
        ],
      },
    });
    if (byCu) return byCu;
  }

  if (!trimmedName) return null;

  if (opts.strictFolderId !== undefined) {
    return prisma.list.findFirst({
      where: {
        name: { equals: trimmedName, mode: 'insensitive' },
        folderId: opts.strictFolderId,
      },
    });
  }

  const candidates = await prisma.list.findMany({
    where: { name: { equals: trimmedName, mode: 'insensitive' } },
    include: {
      folder: { select: { name: true } },
      _count: { select: { tasks: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (candidates.length === 0) return null;

  const picked =
    (opts.preferredFolderId ? candidates.find((c) => c.folderId === opts.preferredFolderId) : undefined) ||
    candidates.find((c) => (c.folder?.name || '').trim().toLowerCase() !== DORMANT_FOLDER_NAME) ||
    candidates.find((c) => Boolean(c.externalId || c.clickUpListId)) ||
    candidates.find((c) => c._count.tasks > 0) ||
    candidates[0];

  const { folder: _folder, _count: _count, ...listRecord } = picked;
  return listRecord;
}

/** Safely links missing externalId / clickUpListId onto an existing list without failing on unique races. */
export async function linkMissingListIdentifiers(
  list: List,
  ids: { externalId?: string | null; clickUpListId?: string | null }
): Promise<List> {
  const data: { externalId?: string; clickUpListId?: string } = {};
  const extId = ids.externalId?.trim();
  const cuId = ids.clickUpListId?.trim();

  if (extId && !list.externalId) data.externalId = extId;
  if (cuId && !list.clickUpListId) data.clickUpListId = cuId;
  if (Object.keys(data).length === 0) return list;

  try {
    return await prisma.list.update({
      where: { id: list.id },
      data,
    });
  } catch (err: any) {
    // Ignore P2002 if another concurrent call linked the identifier first
    if (err?.code === 'P2002') return list;
    throw err;
  }
}
