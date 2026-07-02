import { Router } from 'express';
import * as publicCtrl from '../controllers/publicController';

const router = Router();

router.get('/packages', publicCtrl.getPublicPackages);
router.get('/packages/:id', publicCtrl.getPublicPackage);
router.get('/company', publicCtrl.getPublicCompany);
router.get('/invoices/:shareToken', publicCtrl.getPublicInvoiceHtml);
router.get('/vouchers/:shareToken', publicCtrl.getPublicVoucherHtml);

export default router;
