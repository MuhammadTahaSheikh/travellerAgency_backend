import { Router } from 'express';
import * as booking from '../controllers/bookingController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/', booking.getBookings);
router.get('/:id', booking.getBooking);
router.post('/', booking.createBooking);
router.put('/:id', booking.updateBooking);
router.delete('/:id', booking.deleteBooking);

export default router;
