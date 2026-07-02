import { Router } from 'express';
import * as payment from '../controllers/paymentController';
import { authenticate, authorize, authorizeMinRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/', payment.getPayments);
router.post('/', payment.createPayment);
router.post('/:id/verify', payment.verifyPayment);
router.get('/daily-collection', payment.getDailyCollection);
router.get('/accounts', payment.getAccounts);
router.post('/accounts', authorize('SUPER_ADMIN'), payment.createAccount);
router.put('/accounts/:id', authorize('SUPER_ADMIN'), payment.updateAccount);
router.delete('/accounts/:id', authorize('SUPER_ADMIN'), payment.deactivateAccount);
router.delete('/:id', authorize('SUPER_ADMIN'), payment.deletePayment);

export default router;
