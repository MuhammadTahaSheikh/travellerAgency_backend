import { Router } from 'express';
import * as invoice from '../controllers/invoiceController';
import { authenticate, authorizeMinRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/', invoice.getInvoices);
router.get('/overdue', invoice.getOverdueInvoices);
router.get('/templates', invoice.getInvoiceTemplates);
router.get('/:id/share-link', invoice.getInvoiceShareLink);
router.get('/:id/html', invoice.getInvoiceHtml);
router.get('/:id', invoice.getInvoice);
router.post('/', authorizeMinRole('ADMIN'), invoice.createInvoice);
router.post('/:id/confirm', authorizeMinRole('ADMIN'), invoice.confirmInvoiceHandler);
router.put('/:id', authorizeMinRole('ADMIN'), invoice.updateInvoice);
router.delete('/:id', authorizeMinRole('ADMIN'), invoice.deleteInvoice);

export default router;
