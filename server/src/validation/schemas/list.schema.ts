import { z } from 'zod';
import { nullableUuid, shortText } from './common';

export const createListSchema = z.object({
  name: shortText('name'),
  spaceId: nullableUuid,
  folderId: nullableUuid,
});

export const updateListSchema = z
  .object({
    name: shortText('name').optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at least one field must be provided',
  });

export type CreateListInput = z.infer<typeof createListSchema>;
