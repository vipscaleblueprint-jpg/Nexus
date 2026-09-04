import { z } from 'zod';
import { CHANNEL_TYPES } from '../../types';
import { longText, nullableUuid, shortText, uuid } from './common';

export const createChannelSchema = z.object({
  name: shortText('name', 80),
  description: longText(500).optional(),
  isPrivate: z.boolean().default(false),
  type: z.enum(CHANNEL_TYPES).default('PUBLIC'),
  spaceId: nullableUuid,
});

export const listMessagesQuery = z.object({
  channelId: uuid.optional(),
  parentMessageId: uuid.optional(),
});

export const createMessageSchema = z.object({
  content: z.string().trim().min(1, 'message content is required').max(10_000),
  senderId: uuid,
  channelId: uuid,
  parentMessageId: nullableUuid,
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type CreateMessageInput = z.infer<typeof createMessageSchema>;
