"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getR2PresignedUrl = getR2PresignedUrl;
function getR2PresignedUrl(fileName, mimeType) {
    const fileKey = `uploads/${Date.now()}-${fileName}`;
    const publicUrl = `${process.env.R2_PUBLIC_DOMAIN || 'https://r2.nexus.internal'}/${fileKey}`;
    return {
        uploadUrl: `${publicUrl}?presigned=true`,
        fileKey,
        fileUrl: publicUrl,
    };
}
