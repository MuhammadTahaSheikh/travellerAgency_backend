import { Router } from 'express';
import * as user from '../controllers/userController';
import { authenticate, authorize, authorizeMinRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/roles', user.getRoles);
router.get('/permissions', authorize('SUPER_ADMIN'), user.getPermissions);
router.get('/', authorizeMinRole('ADMIN'), user.getUsers);
router.get('/:id', authorizeMinRole('ADMIN'), user.getUser);
router.put('/:id', authorizeMinRole('ADMIN'), user.updateUser);
router.delete('/:id', authorize('SUPER_ADMIN'), user.deleteUser);
router.post('/:id/reset-password', authorize('SUPER_ADMIN'), user.resetUserPassword);

export default router;
