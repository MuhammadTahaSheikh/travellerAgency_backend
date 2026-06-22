import { Router } from 'express';
import * as activity from '../controllers/activityLogController';
import { authenticate, authorizeMinRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.use(authorizeMinRole('ADMIN'));
router.get('/', activity.getActivityLogs);
router.get('/login-history', activity.getLoginHistory);
router.get('/deleted-records', activity.getDeletedRecords);
router.get('/summary', activity.getAuditSummary);

export default router;
