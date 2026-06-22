import { Router } from 'express';
import * as dashboard from '../controllers/dashboardController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/stats', dashboard.getDashboardStats);
router.get('/charts', dashboard.getDashboardChartData);

export default router;
