import { Router } from 'express';
import * as checkIn from '../controllers/checkInController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/export', checkIn.exportCheckIns);
router.get('/', checkIn.getCheckIns);
router.post('/', checkIn.createCheckIn);
router.put('/:id', checkIn.updateCheckIn);
router.delete('/:id', checkIn.deleteCheckIn);

export default router;
