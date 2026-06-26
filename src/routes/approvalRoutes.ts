import { Router } from 'express';
import { authenticate, authorizeMinRole } from '../middleware/auth';
import * as approval from '../controllers/approvalController';

const router = Router();

router.use(authenticate);

router.get('/pending', authorizeMinRole('SUPER_ADMIN'), approval.getPendingApprovals);
router.get('/:id', authorizeMinRole('SUPER_ADMIN'), approval.getApprovalDetail);
router.post('/:id/approve', authorizeMinRole('SUPER_ADMIN'), approval.approveInvoice);
router.post('/:id/reject', authorizeMinRole('SUPER_ADMIN'), approval.rejectInvoice);

export default router;
