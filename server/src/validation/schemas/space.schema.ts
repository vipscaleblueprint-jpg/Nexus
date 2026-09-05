import { z } from 'zod';
import { isoDate, longText, nullableUuid, shortText, uuid } from './common';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex colour, e.g. #4F46E5');

export const createSpaceSchema = z.object({
  name: shortText('name'),
  icon: z.string().trim().max(50).optional(),
  color: hexColor.optional(),
  ownerId: uuid,
});

export const createFolderSchema = z.object({
  name: shortText('name'),
  spaceId: nullableUuid,
  parentFolderId: nullableUuid,
});

export const createDocSchema = z.object({
  title: shortText('title'),
  docDate: isoDate.optional(),
  spaceId: nullableUuid,
  folderId: nullableUuid,
});

export const updateDocSchema = z
  .object({
    title: shortText('title').optional(),
    docDate: isoDate.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at least one field must be provided',
  });

export const createPageSchema = z.object({
  title: shortText('title').default('Untitled'),
  content: longText(100_000).default(''),
  docId: uuid,
  parentPageId: nullableUuid,
});

export const updatePageSchema = z
  .object({
    title: shortText('title').optional(),
    content: longText(100_000).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at least one field must be provided',
  });

export const updateSpaceSchema = z
  .object({
    name: shortText('name').optional(),
    icon: z.string().trim().max(50).optional(),
    color: hexColor.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at least one field must be provided',
  });

export const updateFolderSchema = z
  .object({
    name: shortText('name').optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at least one field must be provided',
  });

export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;
export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type CreateDocInput = z.infer<typeof createDocSchema>;
export type CreatePageInput = z.infer<typeof createPageSchema>;
