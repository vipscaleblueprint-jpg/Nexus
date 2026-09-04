import { z } from 'zod';
import { nullableUuid, shortText } from './common';

export const createListSchema = z
  .object({
    name: shortText('name'),
    spaceId: nullableUuid,
    folderId: nullableUuid,
  })
  .refine((body) => body.spaceId || body.folderId, {
    message: 'a list must belong to either a space or a folder',
    path: ['spaceId'],
  });

export type CreateListInput = z.infer<typeof createListSchema>;
