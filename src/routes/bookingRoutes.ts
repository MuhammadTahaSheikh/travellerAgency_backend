import { Router } from 'express';
import * as booking from '../controllers/bookingController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/', booking.getBookings);
router.get('/:id', booking.getBooking);
router.post('/', booking.createBooking);
router.post('/:id/generate-invoice', booking.generateBookingInvoice);
router.patch('/:id/pricing', booking.updateBookingPricing);
router.post('/:id/request-confirmation', booking.requestBookingConfirmation);
router.post('/:id/refund', booking.createBookingRefund);
router.post('/:id/vendor-postings/:postingId/confirm', booking.confirmBookingVendorPosting);
router.put('/:id', booking.updateBooking);
router.delete('/:id', booking.deleteBooking);

export default router;
