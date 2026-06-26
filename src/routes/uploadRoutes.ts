import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { upload } from '../middleware/upload';
import * as uploadController from '../controllers/uploadController';

const router = Router();

router.use(authenticate);
router.post('/', upload.single('file'), uploadController.uploadAttachment);

export default router;
