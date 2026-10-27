import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { uploadFile, uploadAvatar, uploadFromUrl, uploadConfetti, deleteConfetti } from '../controllers/upload.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { uploadRateLimiter } from '../middleware/security.middleware';

const router = Router();

// Blocked executable, script, and video extensions
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'sh', 'bin', 'msi', 'dll', 'com', 'scr', 'vbs', 'vbe',
  'wsf', 'wsh', 'js', 'mjs', 'cjs', 'jar', 'apk', 'app', 'pif', 'gadget',
  'cpl', 'reg', 'ps1', 'ps2', 'psc1', 'psc2', 'py', 'pyc', 'php', 'php3',
  'php4', 'php5', 'phtml', 'cgi', 'asp', 'aspx', 'jsp', 'pl',
  // Videos (strictly disallowed per requirements)
  'mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'webm', 'm4v', '3gp', '3g2', 'ogv', 'ts'
]);

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const ext = (file.originalname || '').split('.').pop()?.toLowerCase() || '';
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return cb(new Error(`File type .${ext} is prohibited for security or policy reasons.`));
  }
  if (file.mimetype.startsWith('video/')) {
    return cb(new Error('Video uploads are not allowed in comments.'));
  }
  if (
    file.mimetype.startsWith('application/x-msdownload') ||
    file.mimetype.startsWith('application/x-executable') ||
    file.mimetype.startsWith('application/x-dosexec')
  ) {
    return cb(new Error('Executable file uploads are prohibited.'));
  }
  cb(null, true);
};

// 25MB max hard limit for memory storage protection (prevents memory exhaustion DDoS)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter,
});

/** Wrapper around multer to convert Multer errors and filter rejections to clean 400 responses. */
const handleUpload = (uploadMiddleware: any) => (req: Request, res: Response, next: NextFunction) => {
  uploadMiddleware(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File exceeds maximum allowed size of 25MB.' });
        }
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message || 'Invalid file upload.' });
    }
    next();
  });
};

router.post('/', uploadRateLimiter, authenticateToken, handleUpload(upload.single('file')), uploadFile);
router.post('/avatar', uploadRateLimiter, authenticateToken, handleUpload(upload.single('file')), uploadAvatar);
router.post('/confetti', uploadRateLimiter, authenticateToken, handleUpload(upload.single('file')), uploadConfetti);
router.delete('/confetti', authenticateToken, deleteConfetti);
router.post('/from-url', uploadRateLimiter, authenticateToken, uploadFromUrl);

export { router as uploadRouter };
