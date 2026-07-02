import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as currency from '../controllers/currencyController';

const router = Router();

router.use(authenticate);
router.get('/rate', currency.getLiveExchangeRate);
router.put('/default-rate', authorize('SUPER_ADMIN'), currency.setDefaultExchangeRate);

export default router;
