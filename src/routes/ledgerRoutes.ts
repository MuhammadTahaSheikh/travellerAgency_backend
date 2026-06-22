import { Router } from 'express';
import * as ledger from '../controllers/ledgerController';
import { authenticate, authorizeMinRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/accounts', ledger.getAccounts);
router.get('/accounts/:id/transactions', ledger.getAccountTransactions);
router.get('/journal-entries', ledger.getJournalEntries);
router.post('/journal-entries', authorizeMinRole('ADMIN'), ledger.createJournalEntryHandler);
router.delete('/journal-entries/:id', authorizeMinRole('ADMIN'), ledger.deleteJournalEntry);
router.get('/general-ledger', ledger.getGeneralLedger);
router.get('/trial-balance', ledger.getTrialBalanceReport);

export default router;
