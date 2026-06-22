import { Router } from 'express';
import * as invoice from '../controllers/invoiceController';
import { authenticate, authorizeMinRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/', invoice.getInvoices);
router.get('/overdue', invoice.getOverdueInvoices);
router.get('/:id', invoice.getInvoice);
router.post('/', authorizeMinRole('ADMIN'), invoice.createInvoice);
router.put('/:id', authorizeMinRole('ADMIN'), invoice.updateInvoice);
router.delete('/:id', authorizeMinRole('ADMIN'), invoice.deleteInvoice);

export default router;
