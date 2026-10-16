import { Router } from 'express';
import multer from 'multer';
import { uploadFile, uploadAvatar, uploadFromUrl } from '../controllers/upload.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB global limit
});

router.post('/', authenticateToken, upload.single('file'), uploadFile);
router.post('/avatar', authenticateToken, upload.single('file'), uploadAvatar);
router.post('/from-url', authenticateToken, uploadFromUrl);

export { router as uploadRouter };
