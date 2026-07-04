import { Router } from 'express';
import { authenticate, authorizeMinRole } from '../middleware/auth';
import * as bookingConfirmationRequest from '../controllers/bookingConfirmationRequestController';

const router = Router();

router.use(authenticate);

router.get('/pending', authorizeMinRole('SUPER_ADMIN'), bookingConfirmationRequest.getPendingBookingConfirmationRequests);
router.post('/', bookingConfirmationRequest.createBookingConfirmationRequest);
router.post('/:id/approve', authorizeMinRole('SUPER_ADMIN'), bookingConfirmationRequest.approveBookingConfirmationRequest);
router.post('/:id/reject', authorizeMinRole('SUPER_ADMIN'), bookingConfirmationRequest.rejectBookingConfirmationRequest);

export default router;
