import { Request, Response } from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { requireEnv } from '../config/env';
import { logger } from '../config/logger';

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
