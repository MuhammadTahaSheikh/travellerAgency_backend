import { Router } from 'express';
import * as notification from '../controllers/notificationController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/', notification.getNotifications);
router.get('/unread-count', notification.getUnreadCount);
router.put('/:id/read', notification.markAsRead);
router.put('/read-all', notification.markAllAsRead);
router.post('/announcement', authorize('SUPER_ADMIN', 'ADMIN'), notification.createAnnouncement);

export default router;
