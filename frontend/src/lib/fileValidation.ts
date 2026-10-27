/**
 * File validation, size limits, and security restrictions for uploads and comments.
 * Protects against DDoS, malicious executables, and bandwidth-heavy media (videos).
 */

// Blocked executable and script extensions
export const BLOCKED_EXECUTABLE_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'sh', 'bin', 'msi', 'dll', 'com', 'scr', 'vbs', 'vbe',
  'wsf', 'wsh', 'js', 'mjs', 'cjs', 'jar', 'apk', 'app', 'pif', 'gadget',
  'cpl', 'reg', 'ps1', 'ps2', 'psc1', 'psc2', 'py', 'pyc', 'php', 'php3',
  'php4', 'php5', 'phtml', 'cgi', 'asp', 'aspx', 'jsp', 'pl', 'vbe', 'ws'
]);

// Blocked video extensions (videos are disallowed in comments)
export const BLOCKED_VIDEO_EXTENSIONS = new Set([
  'mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'webm', 'm4v', '3gp', '3g2',
  'ogv', 'ts', 'm2ts', 'mts', 'vob'
]);

// Blocked MIME types
export const BLOCKED_MIME_TYPES = [
  /^video\//i,
  /^application\/(x-msdownload|x-executable|x-msdos-program|x-sh|x-bat|x-msi|x-dosexec|x-shockwave-flash)$/i,
  /^application\/(javascript|x-javascript)$/i,
  /^text\/javascript$/i,
];

// Size boundaries
export const IMAGE_SOFT_MAX_BYTES = 3 * 1024 * 1024;    // 3 MB (warning threshold)
export const IMAGE_HARD_MAX_BYTES = 10 * 1024 * 1024;   // 10 MB (strict rejection)

export const ATTACHMENT_SOFT_MAX_BYTES = 10 * 1024 * 1024;  // 10 MB (warning threshold)
export const ATTACHMENT_HARD_MAX_BYTES = 25 * 1024 * 1024;  // 25 MB (strict rejection)

export const MAX_FILES_PER_BATCH = 10; // DDoS / tab-crash protection

/** Extracts the lowercased file extension without the leading dot. */
export function getExtension(fileName: string): string {
  if (!fileName) return '';
  const clean = fileName.split('?')[0].split('#')[0];
  const lastDot = clean.lastIndexOf('.');
  return lastDot !== -1 ? clean.slice(lastDot + 1).toLowerCase() : '';
}

/** Pretty formats byte size into KB / MB. */
export function formatFileSize(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Checks whether a file is an image based on MIME type or extension. */
export function isImageFile(file: { name?: string; type?: string }): boolean {
  if (file.type && file.type.startsWith('image/')) return true;
  const ext = getExtension(file.name || '');
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'].includes(ext);
}

/** Checks whether a file is an executable or script. */
export function isExecutableFile(file: { name?: string; type?: string }): boolean {
  const ext = getExtension(file.name || '');
  if (BLOCKED_EXECUTABLE_EXTENSIONS.has(ext)) return true;
  if (file.type) {
    return BLOCKED_MIME_TYPES.slice(1).some(pattern => pattern.test(file.type || ''));
  }
  return false;
}

/** Checks whether a file is a video. */
export function isVideoFile(file: { name?: string; type?: string }): boolean {
  if (file.type && file.type.startsWith('video/')) return true;
  const ext = getExtension(file.name || '');
  return BLOCKED_VIDEO_EXTENSIONS.has(ext);
}

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  isSoftWarning?: boolean;
  softWarning?: string;
  isImage: boolean;
}

/**
 * Validates a file against security restrictions, disallowed extensions,
 * and soft/hard size limits.
 */
export function validateUploadFile(file: File): FileValidationResult {
  const ext = getExtension(file.name);
  const isImg = isImageFile(file);

  // 1. Strict check: Executable & Script files
  if (isExecutableFile(file)) {
    return {
      valid: false,
      error: `"${file.name}": Executable and script files (.${ext || 'exe'}) are blocked for security reasons.`,
      isImage: false,
    };
  }

  // 2. Strict check: Video files (explicitly disallowed)
  if (isVideoFile(file)) {
    return {
      valid: false,
      error: `"${file.name}": Video files (.${ext || 'mp4'}) are not permitted in comments.`,
      isImage: false,
    };
  }

  // 3. Size checks: Images
  if (isImg) {
    if (file.size > IMAGE_HARD_MAX_BYTES) {
      return {
        valid: false,
        error: `"${file.name}" exceeds the maximum image limit of ${formatFileSize(IMAGE_HARD_MAX_BYTES)} (file is ${formatFileSize(file.size)}).`,
        isImage: true,
      };
    }
    const isSoft = file.size > IMAGE_SOFT_MAX_BYTES;
    return {
      valid: true,
      isImage: true,
      isSoftWarning: isSoft,
      softWarning: isSoft
        ? `Large image (${formatFileSize(file.size)}) — exceeds ${formatFileSize(IMAGE_SOFT_MAX_BYTES)} soft limit.`
        : undefined,
    };
  }

  // 4. Size checks: All other attachments
  if (file.size > ATTACHMENT_HARD_MAX_BYTES) {
    return {
      valid: false,
      error: `"${file.name}" exceeds the maximum attachment limit of ${formatFileSize(ATTACHMENT_HARD_MAX_BYTES)} (file is ${formatFileSize(file.size)}).`,
      isImage: false,
    };
  }

  const isSoft = file.size > ATTACHMENT_SOFT_MAX_BYTES;
  return {
    valid: true,
    isImage: false,
    isSoftWarning: isSoft,
    softWarning: isSoft
      ? `Large attachment (${formatFileSize(file.size)}) — exceeds ${formatFileSize(ATTACHMENT_SOFT_MAX_BYTES)} soft limit.`
      : undefined,
  };
}
