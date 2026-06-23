import { Router } from 'express';
import * as voucher from '../controllers/voucherController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/', voucher.getVouchers);
router.get('/:id/html', voucher.getVoucherHtml);
router.get('/:id', voucher.getVoucher);
router.post('/', voucher.createVoucher);
router.post('/:id/share', voucher.shareVoucher);

export default router;
