import { Router } from 'express';
import * as vendor from '../controllers/vendorController';
import { authenticate, authorizeMinRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/', vendor.getVendors);
router.get('/payables', vendor.getVendorPayables);
router.get('/:id/ledger/export', vendor.exportVendorLedger);
router.get('/:id/ledger', vendor.getVendorLedger);
router.post('/:id/pay', authorizeMinRole('ADMIN'), vendor.payVendor);
router.get('/:id', vendor.getVendor);
router.post('/', authorizeMinRole('ADMIN'), vendor.createVendor);
router.put('/:id', authorizeMinRole('ADMIN'), vendor.updateVendor);
router.delete('/:id', authorizeMinRole('ADMIN'), vendor.deleteVendor);

export default router;
