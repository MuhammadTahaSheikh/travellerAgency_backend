import { Router } from 'express';
import * as payment from '../controllers/paymentController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/', payment.getPayments);
router.post('/', payment.createPayment);
router.post('/:id/verify', payment.verifyPayment);
router.get('/daily-collection', payment.getDailyCollection);
router.get('/accounts', payment.getAccounts);
router.post('/accounts', payment.createAccount);
router.delete('/:id', authorize('SUPER_ADMIN'), payment.deletePayment);

export default router;
