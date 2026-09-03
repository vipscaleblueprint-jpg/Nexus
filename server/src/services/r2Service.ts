export interface R2UploadConfig {
  bucketName: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function getR2PresignedUrl(fileName: string, mimeType: string) {
  const fileKey = `uploads/${Date.now()}-${fileName}`;
  const publicUrl = `${process.env.R2_PUBLIC_DOMAIN || 'https://r2.nexus.internal'}/${fileKey}`;
  
  return {
    uploadUrl: `${publicUrl}?presigned=true`,
    fileKey,
    fileUrl: publicUrl,
  };
}
