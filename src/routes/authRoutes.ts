import { Router } from 'express';
import * as auth from '../controllers/authController';
import { authenticate, authorizeMinRole } from '../middleware/auth';

const router = Router();

router.post('/login', auth.login);
router.get('/profile', authenticate, auth.getProfile);
router.put('/profile', authenticate, auth.updateProfile);
router.put('/change-password', authenticate, auth.changePassword);
router.get('/login-history', authenticate, auth.getLoginHistory);
router.post('/register', authenticate, authorizeMinRole('ADMIN'), auth.register);

export default router;
