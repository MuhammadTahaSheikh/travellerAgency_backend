import { Router } from 'express';
import * as report from '../controllers/reportController';
import { authenticate, authorizeMinRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.use(authorizeMinRole('ADMIN'));
router.get('/income-statement', report.getIncomeStatement);
router.get('/profit-loss', report.getProfitAndLoss);
router.get('/cash-flow', report.getCashFlowReport);
router.get('/expenses', report.getExpenseReport);
router.get('/customer-outstanding', report.getCustomerOutstanding);
router.get('/daily-collection', report.getDailyCollectionReport);
router.get('/customer-statement', report.getCustomerStatement);
router.get('/customer-statement/html', report.getCustomerStatementHtml);
router.get('/b2b-partners', report.getB2BPartnerReport);

export default router;
