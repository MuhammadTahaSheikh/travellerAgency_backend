import { Router } from 'express';
import * as customer from '../controllers/customerController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/', customer.getCustomers);
router.get('/:id/ledger/export', customer.exportCustomerLedger);
router.get('/:id/ledger', customer.getCustomerLedger);
router.get('/:id', customer.getCustomer);
router.post('/', customer.createCustomer);
router.put('/:id', customer.updateCustomer);
router.delete('/:id', customer.deleteCustomer);
router.get('/:id/documents', customer.getCustomerDocuments);
router.post('/:id/documents', customer.addCustomerDocument);
router.delete('/:id/documents/:docId', customer.deleteCustomerDocument);

export default router;
