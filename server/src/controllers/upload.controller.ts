import { Request, Response } from 'express';
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { requireEnv } from '../config/env';
import { logger, errMsg } from '../config/logger';
import { prisma } from '../config/prisma';
import { invalidateCache } from '../services/redisService';
import { encryptText, decryptText } from '../utils/encryption';


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

// The bucket is public and the browser-supplied type is untrusted. Only these types are served for viewing in
// place; anything else is a download, so an uploaded HTML or SVG file can't run as a web page on the bucket's domain.
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif|bmp)|application\/pdf|audio\/(mpeg|wav|ogg|webm|mp4)|text\/plain)$/;
// Types a browser can execute aren't kept even for downloads (SVG keeps its type so <img> previews still work)
const ACTIVE_TYPES = /^(text\/html|application\/xhtml\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript)$/;

function storageHeaders(mimetype: string, safeFilename: string) {
  const type = mimetype.split(';')[0].trim().toLowerCase();
  if (INLINE_TYPES.test(type)) return { ContentType: type };
  return {
    ContentType: ACTIVE_TYPES.test(type) ? 'application/octet-stream' : type || 'application/octet-stream',
    ContentDisposition: `attachment; filename="${safeFilename}"`,
  };
}

const AVATAR_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

// e.g. "comments" or "description"; client-supplied, so kept to a plain folder name
const folderOf = (raw: unknown) => String(raw || 'general').replace(/[^a-zA-Z0-9_-]/g, '_') || 'general';

/** Stores a file in R2 under a unique key and returns its public URL. */
async function putFile(folder: string, originalname: string, buffer: Buffer, mimetype: string): Promise<string> {
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  // Sanitize filename to avoid weird characters in URL
  const safeFilename = originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
  const objectKey = `${folder}/${uniqueSuffix}-${safeFilename}`;

  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    Body: buffer,
    ...storageHeaders(mimetype, safeFilename),
  }));

  const fileUrl = `${publicUrl}/${objectKey}`;
  logger.info(`File uploaded successfully to R2: ${fileUrl}`);
  return fileUrl;
}

export const uploadFile = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { originalname, buffer, mimetype } = req.file;

    // Hard limit: 10MB for images, 25MB for other attachments
    if (mimetype.startsWith('image/') && buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image exceeds the maximum allowed size of 10MB' });
    }

    const fileUrl = await putFile(folderOf(req.body.folder), originalname, buffer, mimetype);
    res.status(200).json({ url: fileUrl, name: originalname });
  } catch (error: any) {
    logger.error({ err: error }, `Error uploading file to R2: ${error?.name}: ${errMsg(error)}`);
    res.status(500).json({ error: error.message || 'Failed to upload file' });
  }
};

// ---------------------------------------------------------------------------
// Copying an image from a link: for images pasted from another app that the browser can't read
// (the host blocks cross-site reads). Public hosts only: every address a hostname resolves to is
// checked when connecting (redirects included), so the server can't be pointed at internal services.
// ---------------------------------------------------------------------------

const FETCH_IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|avif|bmp)$/;
const FETCH_MAX_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const FETCH_MAX_REDIRECTS = 3;

/** A link that can't be copied (refused, not an image, needs a login...), as opposed to a server fault. */
class FetchImageError extends Error {}

const blockedIps = new net.BlockList();
for (const [net4, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedIps.addSubnet(net4, prefix, 'ipv4');
for (const [net6, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['64:ff9b::', 96]] as const) {
  blockedIps.addSubnet(net6, prefix, 'ipv6');
}

function isBlockedIp(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return blockedIps.check(mapped[1], 'ipv4');
  return blockedIps.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');
}

const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as unknown as dns.LookupAddress[];
    if (!list.length || list.some((a) => isBlockedIp(a.address))) {
      return callback(new FetchImageError(`Refusing to fetch from ${hostname}`), '', 0);
    }
    if ((options as dns.LookupOptions).all) return (callback as any)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

function fetchImage(url: URL, redirectsLeft = FETCH_MAX_REDIRECTS): Promise<{ buffer: Buffer; type: string }> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FetchImageError('Only http(s) links can be copied');
  // Literal IPs never go through the lookup, so they're checked here
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedIp(host)) throw new FetchImageError('That address is not allowed');

  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).get(url, {
      lookup: guardedLookup,
      timeout: FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': 'Nexus-Image-Copy/1.0', Accept: 'image/*' },
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new FetchImageError('Too many redirects'));
        try {
          return resolve(fetchImage(new URL(res.headers.location, url), redirectsLeft - 1));
        } catch (err) {
          return reject(err);
        }
      }
      if (status !== 200) {
        res.resume();
        return reject(new FetchImageError(`The image host answered ${status}`));
      }
      const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!FETCH_IMAGE_TYPES.test(type)) {
        res.resume();
        return reject(new FetchImageError('The link is not an image'));
      }
      if (Number(res.headers['content-length'] || 0) > FETCH_MAX_BYTES) {
        res.resume();
        return reject(new FetchImageError('The image is too large'));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > FETCH_MAX_BYTES) {
          req.destroy(new FetchImageError('The image is too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), type }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new FetchImageError('The image host took too long')));
    req.on('error', reject);
  });
}

function fileNameFromUrl(url: URL, type: string): string {
  const ext = type.split('/')[1].replace('jpeg', 'jpg');
  let name = '';
  try {
    name = decodeURIComponent(url.pathname.split('/').pop() || '');
  } catch { /* malformed escape */ }
  if (!name) return `pasted-image-${Date.now()}.${ext}`;
  return /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}.${ext}`;
}

// POST /api/upload/from-url  { url, folder? } → { url, name }
export const uploadFromUrl = async (req: Request, res: Response) => {
  let source: URL;
  try {
    source = new URL(String(req.body?.url || ''));
  } catch {
    return res.status(400).json({ error: 'A valid image link is required' });
  }
  try {
    const { buffer, type } = await fetchImage(source);
    const name = fileNameFromUrl(source, type);
    const fileUrl = await putFile(folderOf(req.body?.folder), name, buffer, type);
    res.status(200).json({ url: fileUrl, name });
  } catch (error: any) {
    // The host refused, needs a login or isn't an image: the client keeps a link instead
    const status = error instanceof FetchImageError || error?.code ? 422 : 500;
    if (status === 500) logger.error({ err: error }, `Error copying image from ${source.host}: ${errMsg(error)}`);
    res.status(status).json({ error: errMsg(error) || 'Failed to copy image' });
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

    const { buffer, mimetype } = req.file;
    // Raster images only (no SVG: it can carry scripts), with the extension taken from the type, not the file name
    const contentType = mimetype.split(';')[0].trim().toLowerCase();
    const ext = AVATAR_EXTENSIONS[contentType];
    if (!ext) {
      return res.status(400).json({ error: 'Avatar must be a PNG, JPEG, GIF, WEBP or AVIF image' });
    }

    // 1. Generate versioned key: nexus-avatars/{userId}-{timestamp}{ext}
    const objectKey = `nexus-avatars/${userId}-${Math.floor(Date.now() / 1000)}${ext}`;

    // 2. Upload new object to R2 with aggressive caching
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType,
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
        logger.error({ err, oldKey }, `Failed to delete old avatar from R2: ${errMsg(err)}`);
      });
    }

    // Never send the password hash or Google ID back; credits is a BigInt, which JSON can't serialize
    const { password: _password, googleId: _googleId, ...safeUser } = updatedUser;
    res.status(200).json({
      url: newAvatarUrl,
      user: { ...safeUser, credits: safeUser.credits != null ? Number(safeUser.credits) : null },
    });
  } catch (error: any) {
    logger.error({ err: error }, `Error uploading avatar to R2: ${error?.name}: ${errMsg(error)}`);
    res.status(500).json({ error: error.message || 'Failed to upload avatar' });
  }
};

export const uploadConfetti = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No confetti file uploaded' });
    }

    // Strict 500 KB limit for confetti images to ensure ultra-lightweight fetching and zero lag
    if (req.file.size > 500 * 1024) {
      return res.status(400).json({ error: 'Confetti image file size cannot exceed 500 KB' });
    }

    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { buffer, mimetype } = req.file;
    const contentType = mimetype.split(';')[0].trim().toLowerCase();
    const ext = AVATAR_EXTENSIONS[contentType];
    if (!ext) {
      return res.status(400).json({ error: 'Confetti image must be PNG, JPEG, GIF, WEBP or AVIF' });
    }

    // 1. Generate versioned key in separate R2 folder: nexus-confetti/
    const objectKey = `nexus-confetti/${userId}-${Math.floor(Date.now() / 1000)}${ext}`;

    // 2. Upload to R2 with immutable 1-year cache
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    });

    await s3.send(command);
    const newConfettiUrl = `${publicUrl}/${objectKey}`;

    // 3. Encrypt URL before saving to DB
    const encryptedConfettiUrl = encryptText(newConfettiUrl);

    const currentUser = await (prisma.user as any).findUnique({ where: { id: userId } });
    const oldEncryptedUrl = currentUser?.confettiUrl;
    const oldDecryptedUrl = decryptText(oldEncryptedUrl);

    const updatedUser = await (prisma.user as any).update({
      where: { id: userId },
      data: { confettiUrl: encryptedConfettiUrl },
    });

    // Invalidate Redis user roster cache
    await invalidateCache('users:all');

    logger.info(`Confetti image uploaded successfully to R2 (folder: nexus-confetti): ${newConfettiUrl}`);

    // 4. Delete old object from R2 if it was in nexus-confetti
    if (oldDecryptedUrl && oldDecryptedUrl.startsWith(publicUrl)) {
      const oldKey = oldDecryptedUrl.replace(`${publicUrl}/`, '');
      s3.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: oldKey,
      })).catch(err => {
        logger.error({ err, oldKey }, `Failed to delete old confetti image from R2: ${errMsg(err)}`);
      });
    }

    const { password: _password, googleId: _googleId, ...safeUser } = updatedUser;
    res.status(200).json({
      url: newConfettiUrl,
      user: {
        ...safeUser,
        confettiUrl: newConfettiUrl,
        credits: safeUser.credits != null ? Number(safeUser.credits) : null,
      },
    });
  } catch (error: any) {
    logger.error({ err: error }, `Error uploading confetti image to R2: ${error?.name}: ${errMsg(error)}`);
    res.status(500).json({ error: error.message || 'Failed to upload confetti image' });
  }
};

export const deleteConfetti = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const currentUser = await (prisma.user as any).findUnique({ where: { id: userId } });
    const oldEncryptedUrl = currentUser?.confettiUrl;
    const oldDecryptedUrl = decryptText(oldEncryptedUrl);

    const updatedUser = await (prisma.user as any).update({
      where: { id: userId },
      data: { confettiUrl: null },
    });

    await invalidateCache('users:all');

    if (oldDecryptedUrl && oldDecryptedUrl.startsWith(publicUrl)) {
      const oldKey = oldDecryptedUrl.replace(`${publicUrl}/`, '');
      s3.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: oldKey,
      })).catch(err => {
        logger.error({ err, oldKey }, `Failed to delete old confetti image from R2: ${errMsg(err)}`);
      });
    }

    const { password: _password, googleId: _googleId, ...safeUser } = updatedUser;
    res.status(200).json({
      user: {
        ...safeUser,
        confettiUrl: null,
        credits: safeUser.credits != null ? Number(safeUser.credits) : null,
      },
    });
  } catch (error: any) {
    logger.error({ err: error }, `Error deleting confetti image: ${error?.name}: ${errMsg(error)}`);
    res.status(500).json({ error: error.message || 'Failed to delete confetti image' });
  }
};

