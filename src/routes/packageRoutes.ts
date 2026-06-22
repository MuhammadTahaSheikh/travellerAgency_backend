import { Router } from 'express';
import * as pkg from '../controllers/packageController';
import { authenticate, authorizeMinRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);
router.get('/', pkg.getPackages);
router.get('/:id', pkg.getPackage);
router.post('/', authorizeMinRole('ADMIN'), pkg.createPackage);
router.put('/:id', authorizeMinRole('ADMIN'), pkg.updatePackage);
router.delete('/:id', authorizeMinRole('ADMIN'), pkg.deletePackage);

export default router;
