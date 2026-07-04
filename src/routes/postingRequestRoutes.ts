import { Router } from 'express';
import { authenticate, authorizeMinRole } from '../middleware/auth';
import * as postingRequest from '../controllers/postingRequestController';

const router = Router();

router.use(authenticate);

router.get('/pending', authorizeMinRole('SUPER_ADMIN'), postingRequest.getPendingPostingRequests);
router.post('/', postingRequest.createPostingRequest);
router.post('/:id/approve', authorizeMinRole('SUPER_ADMIN'), postingRequest.approvePostingRequest);
router.post('/:id/reject', authorizeMinRole('SUPER_ADMIN'), postingRequest.rejectPostingRequest);

export default router;
