import { Router } from 'express';
import * as settings from '../controllers/settingsController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/', settings.getSettings);
router.put('/', authorize('SUPER_ADMIN'), settings.updateSetting);
router.put('/bulk', authorize('SUPER_ADMIN'), settings.bulkUpdateSettings);

export default router;
