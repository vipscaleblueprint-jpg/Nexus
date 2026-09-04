import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { getCache, setCache, invalidateCache } from '../services/redisService';

const senderSelect = { id: true, name: true, email: true, avatarUrl: true, imageUrl: true };

// GET /api/chat/channels - Redis Cache-Aside
export async function listChannels(req: Request, res: Response) {
  try {
    const cachedChannels = await getCache<any[]>('channels:all');
    if (cachedChannels) {
      return res.json({ channels: cachedChannels, cached: true });
    }

    const channels = await prisma.channel.findMany({
      include: {
        members: {
          include: {
            user: { select: senderSelect },
          },
        },
      },
    });

    await setCache('channels:all', channels, 300);

    return res.json({ channels, cached: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/chat/channels
export async function createChannel(req: Request, res: Response) {
  try {
    const { name, description, isPrivate, type, spaceId } = req.body;
    const channel = await prisma.channel.create({
      data: {
        name,
        description,
        isPrivate: isPrivate || false,
        type: type || 'PUBLIC',
        spaceId: spaceId || null,
      },
    });

    await invalidateCache('channels:all', 'dashboard:all');

    return res.status(201).json({ channel });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// GET /api/chat/messages - Redis Cache-Aside
export async function listMessages(req: Request, res: Response) {
  try {
    const { channelId, parentMessageId } = req.query;
    const cacheKey = `messages:${channelId || 'all'}:${parentMessageId || 'root'}`;

    const cachedMessages = await getCache<any[]>(cacheKey);
    if (cachedMessages) {
      return res.json({ messages: cachedMessages, cached: true });
    }

    const messages = await prisma.message.findMany({
      where: {
        ...(channelId && { channelId: String(channelId) }),
        parentMessageId: parentMessageId ? String(parentMessageId) : null,
      },
      include: {
        sender: { select: senderSelect },
        attachments: true,
        reactions: {
          include: {
            user: { select: senderSelect },
          },
        },
        mentions: {
          include: {
            mentionedUser: { select: senderSelect },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    await setCache(cacheKey, messages, 300);

    return res.json({ messages, cached: false });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// POST /api/chat/messages
export async function createMessage(req: Request, res: Response) {
  try {
    const { content, senderId, channelId, parentMessageId } = req.body;
    const message = await prisma.message.create({
      data: {
        content,
        senderId,
        channelId,
        parentMessageId: parentMessageId || null,
      },
      include: {
        sender: { select: senderSelect },
        attachments: true,
        reactions: true,
      },
    });

    if (parentMessageId) {
      await prisma.message.update({
        where: { id: parentMessageId },
        data: { replyCount: { increment: 1 } },
      });
    }

    await invalidateCache(`messages:${channelId || 'all'}:${parentMessageId || 'root'}`, 'channels:all');

    return res.status(201).json({ message });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
