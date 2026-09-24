import { Request, Response } from 'express';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { requireEnv } from '../config/env';
import { logger } from '../config/logger';
import { PrismaClient } from '@prisma/client';
import path from 'path';

const prisma = new PrismaClient();

const accountId = requireEnv('R2_ACCOUNT_ID');
const accessKeyId = requireEnv('R2_ACCESS_KEY_ID');
const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY');
const bucketName = requireEnv('R2_BUCKET_NAME');
const publicUrl = requireEnv('R2_PUBLIC_URL');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  forcePathStyle: true,
});

export const uploadFile = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { originalname, buffer, mimetype } = req.file;
    const { folder = 'general' } = req.body; // e.g. "comments" or "description"

    // Generate a unique key
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    // Sanitize filename to avoid weird characters in URL
    const safeFilename = originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const objectKey = `${folder}/${uniqueSuffix}-${safeFilename}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: buffer,
      ContentType: mimetype,
    });

    await s3.send(command);

    const fileUrl = `${publicUrl}/${objectKey}`;
    
    logger.info(`File uploaded successfully to R2: ${fileUrl}`);

    res.status(200).json({ url: fileUrl, name: originalname });
  } catch (error: any) {
    logger.error({ err: error }, 'Error uploading file to R2');
    res.status(500).json({ error: error.message || 'Failed to upload file' });
  }
};

export const uploadAvatar = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // 2MB limit for avatars
    if (req.file.size > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Avatar file size cannot exceed 2MB' });
    }

    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { originalname, buffer, mimetype } = req.file;
    const ext = path.extname(originalname) || '';
    
    // 1. Generate versioned key: nexus-avatars/{userId}-{timestamp}{ext}
    const objectKey = `nexus-avatars/${userId}-${Math.floor(Date.now() / 1000)}${ext}`;

    // 2. Upload new object to R2 with aggressive caching
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: buffer,
      ContentType: mimetype,
      CacheControl: 'public, max-age=31536000, immutable',
    });

    await s3.send(command);
    const newAvatarUrl = `${publicUrl}/${objectKey}`;

    // 3. Update DB
    const currentUser = await prisma.user.findUnique({ where: { id: userId } });
    const oldAvatarUrl = currentUser?.avatarUrl;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: newAvatarUrl },
    });

    logger.info(`Avatar uploaded successfully to R2: ${newAvatarUrl}`);

    // 4. Delete old object (fire-and-forget, don't fail request if it errors)
    if (oldAvatarUrl && oldAvatarUrl.startsWith(publicUrl)) {
      const oldKey = oldAvatarUrl.replace(`${publicUrl}/`, '');
      s3.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: oldKey,
      })).catch(err => {
        logger.error({ err, oldKey }, 'Failed to delete old avatar from R2');
      });
    }

    res.status(200).json({ url: newAvatarUrl, user: updatedUser });
  } catch (error: any) {
    logger.error({ err: error }, 'Error uploading avatar to R2');
    res.status(500).json({ error: error.message || 'Failed to upload avatar' });
  }
};
