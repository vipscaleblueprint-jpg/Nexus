import { z } from 'zod';
import { PRIORITIES } from '../../types';
import { longText, nullableIsoDate, nullableUuid, shortText, uuid } from './common';

/**
 * Task.status is a free-form String column (default "TODO") rather than a
 * Prisma enum, so it is validated as non-empty text, not a fixed set.
 */
const status = z.string().trim().min(1, 'status is required').max(50);

export const listTasksQuery = z.object({
  listId: uuid.optional(),
  assigneeId: uuid.optional(),
  status: status.optional(),
});

export const createTaskSchema = z.object({
  title: shortText('title'),
  description: longText().optional(),
  status: status.default('TODO'),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  listId: uuid,
  assigneeId: nullableUuid,
  teamId: nullableUuid,
  creatorId: uuid,
  dueDate: nullableIsoDate,
  startDate: nullableIsoDate,
});

export const updateTaskSchema = z
  .object({
    title: shortText('title').optional(),
    description: longText().nullable().optional(),
    status: status.optional(),
    priority: z.enum(PRIORITIES).optional(),
    listId: uuid.optional(),
    assigneeId: nullableUuid,
    teamId: nullableUuid,
    dueDate: nullableIsoDate,
    startDate: nullableIsoDate,
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at least one field must be provided',
  });

export const moveTaskSchema = z.object({ status });

export const attachmentUrlSchema = z.object({
  fileName: shortText('fileName', 255),
  fileType: z
    .string()
    .regex(/^[\w.+-]+\/[\w.+-]+$/, 'fileType must be a MIME type, e.g. image/png'),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuery>;
