import { Router } from 'express';
import { authenticate, authorizeMinRole } from '../middleware/auth';
import * as vendorPosting from '../controllers/vendorPostingController';

const router = Router();

router.use(authenticate);

router.get('/', vendorPosting.getVendorPostings);
router.get('/pending-summary', vendorPosting.getPendingCostsSummary);
router.post('/', authorizeMinRole('ADMIN'), vendorPosting.createVendorPostingHandler);
router.put('/:id', authorizeMinRole('ADMIN'), vendorPosting.updateVendorPosting);
router.post('/:id/confirm', authorizeMinRole('ADMIN'), vendorPosting.confirmVendorPosting);

export default router;
