import { Router } from 'express';
import * as ledger from '../controllers/ledgerController';
import { authenticate, authorizeMinRole, authorize } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/accounts', ledger.getAccounts);
router.get('/accounts/:id/transactions/export', ledger.exportAccountTransactions);
router.get('/accounts/:id/transactions', ledger.getAccountTransactions);
router.get('/journal-entries', ledger.getJournalEntries);
router.post('/journal-entries', authorizeMinRole('ADMIN'), ledger.createJournalEntryHandler);
router.delete('/journal-entries/:id', authorizeMinRole('ADMIN'), ledger.deleteJournalEntry);
router.post('/transfers', authorizeMinRole('ADMIN'), ledger.transferBetweenAccounts);
router.post('/internal-transfers', authorizeMinRole('ADMIN'), ledger.createInternalTransferHandler);
router.get('/general-ledger/export', ledger.exportGeneralLedger);
router.get('/general-ledger', ledger.getGeneralLedger);
router.get('/trial-balance', ledger.getTrialBalanceReport);
router.get('/user-performance', ledger.getUserPerformance);

export default router;
