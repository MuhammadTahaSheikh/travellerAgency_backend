import { Router } from 'express';
import * as expense from '../controllers/expenseController';
import { authenticate, authorizeMinRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/', expense.getExpenses);
router.post('/', authorizeMinRole('ADMIN'), expense.createExpense);
router.put('/:id', authorizeMinRole('ADMIN'), expense.updateExpense);
router.delete('/:id', authorizeMinRole('ADMIN'), expense.deleteExpense);
router.get('/income', expense.getIncomeEntries);
router.post('/income', authorizeMinRole('ADMIN'), expense.createIncomeEntry);

export default router;
