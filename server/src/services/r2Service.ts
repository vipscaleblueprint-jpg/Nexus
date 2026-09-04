import { requireEnv } from '../config/env';

export interface R2UploadConfig {
  bucketName: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function getR2PresignedUrl(fileName: string, mimeType: string) {
  const fileKey = `uploads/${Date.now()}-${fileName}`;
  const publicUrl = `${requireEnv('R2_PUBLIC_DOMAIN')}/${fileKey}`;
  
  return {
    uploadUrl: `${publicUrl}?presigned=true`,
    fileKey,
    fileUrl: publicUrl,
  };
}
