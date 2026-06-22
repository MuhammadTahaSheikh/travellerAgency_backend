import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination } from '../utils/helpers';
import { paramId } from '../utils/params';
import { hashPassword } from '../utils/password';
import { logActivity } from '../middleware/activityLogger';

export async function getUsers(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        isActive: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.user.count(),
  ]);

  return res.json({ success: true, data: users, pagination: formatPagination(total, page, limit) });
}

export async function getUser(req: AuthRequest, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: paramId(req) },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      loginHistory: { take: 10, orderBy: { createdAt: 'desc' } },
    },
  });

  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const { password: _, ...userWithoutPassword } = user;
  return res.json({ success: true, data: userWithoutPassword });
}

export async function updateUser(req: AuthRequest, res: Response) {
  const { firstName, lastName, phone, roleId, isActive } = req.body;
  const data: Record<string, unknown> = { firstName, lastName, phone };

  if (roleId !== undefined || isActive !== undefined) {
    if (req.user!.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, error: 'Only super admin can change roles or account status' });
    }
    if (roleId !== undefined) data.roleId = roleId;
    if (isActive !== undefined) data.isActive = isActive;
  }

  const user = await prisma.user.update({
    where: { id: paramId(req) },
    data,
    include: { role: true },
  });

  const { password: _, ...userWithoutPassword } = user;
  await logActivity(req, 'UPDATE', 'User', user.id);
  return res.json({ success: true, data: userWithoutPassword });
}

export async function deleteUser(req: AuthRequest, res: Response) {
  await prisma.user.update({ where: { id: paramId(req) }, data: { isActive: false } });
  await logActivity(req, 'DELETE', 'User', paramId(req));
  return res.json({ success: true, message: 'User deactivated' });
}

export async function getRoles(_req: AuthRequest, res: Response) {
  const roles = await prisma.role.findMany({
    include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
  });
  return res.json({ success: true, data: roles });
}

export async function getPermissions(_req: AuthRequest, res: Response) {
  const permissions = await prisma.permission.findMany({ orderBy: [{ resource: 'asc' }, { action: 'asc' }] });
  return res.json({ success: true, data: permissions });
}

export async function resetUserPassword(req: AuthRequest, res: Response) {
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ success: false, error: 'New password required' });

  await prisma.user.update({
    where: { id: paramId(req) },
    data: { password: await hashPassword(newPassword) },
  });

  await logActivity(req, 'UPDATE', 'User', paramId(req), 'Password reset');
  return res.json({ success: true, message: 'Password reset successfully' });
}
