import { Router } from 'express';
import {
  listChannels,
  createChannel,
  listMessages,
  createMessage,
} from '../controllers/chat.controller';
import { validate } from '../validation';
import {
  createChannelSchema,
  createMessageSchema,
  listMessagesQuery,
} from '../validation/schemas';

export const chatRouter = Router();

chatRouter.get('/channels', listChannels);
chatRouter.post('/channels', validate({ body: createChannelSchema }), createChannel);
chatRouter.get('/messages', validate({ query: listMessagesQuery }), listMessages);
chatRouter.post('/messages', validate({ body: createMessageSchema }), createMessage);
