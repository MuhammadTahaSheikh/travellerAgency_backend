import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination } from '../utils/helpers';
import { paramId } from '../utils/params';
import { hashPassword } from '../utils/password';
import { logActivity } from '../middleware/activityLogger';
import { createUserInvite, resendUserInvite } from '../services/inviteService';

export async function getUsers(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const includeInactive = req.query.includeInactive === 'true';

  const where = includeInactive ? {} : { isActive: true };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
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
        inviteToken: true,
        inviteExpiresAt: true,
        passwordSetAt: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  return res.json({
    success: true,
    data: users.map(({ inviteToken, inviteExpiresAt, passwordSetAt, ...user }) => ({
      ...user,
      invitePending: Boolean(inviteToken),
      inviteExpired: Boolean(inviteToken && inviteExpiresAt && inviteExpiresAt < new Date()),
    })),
    pagination: formatPagination(total, page, limit),
  });
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
  const id = paramId(req);

  if (id === req.user!.id) {
    return res.status(400).json({ success: false, error: 'You cannot delete your own account' });
  }

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      _count: {
        select: { bookings: true, payments: true, expenses: true, createdUsers: true },
      },
    },
  });

  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const hasActivity =
    user._count.bookings > 0 ||
    user._count.payments > 0 ||
    user._count.expenses > 0 ||
    user._count.createdUsers > 0;

  // Pending invites and users with no activity — remove completely (frees email for re-invite)
  if (user.inviteToken || !hasActivity) {
    await prisma.user.updateMany({ where: { createdById: id }, data: { createdById: null } });
    await prisma.account.updateMany({ where: { employeeId: id }, data: { employeeId: null } });
    await prisma.user.delete({ where: { id } });
    await logActivity(req, 'DELETE', 'User', id, 'User removed');
    return res.json({ success: true, message: 'User removed' });
  }

  await prisma.user.update({ where: { id }, data: { isActive: false } });
  await logActivity(req, 'DELETE', 'User', id, 'User deactivated');
  return res.json({ success: true, message: 'User deactivated (they had bookings/payments on record)' });
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
    data: {
      password: await hashPassword(newPassword),
      inviteToken: null,
      inviteExpiresAt: null,
      passwordSetAt: new Date(),
    },
  });

  await logActivity(req, 'UPDATE', 'User', paramId(req), 'Password reset');
  return res.json({ success: true, message: 'Password reset successfully' });
}

export async function inviteUser(req: AuthRequest, res: Response) {
  const { email, firstName, lastName, phone, roleId } = req.body;

  if (!email || !firstName || !lastName || !roleId) {
    return res.status(400).json({ success: false, error: 'Email, first name, last name, and role are required' });
  }

  if (req.user!.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, error: 'Only super admin can invite team members' });
  }

  const targetRole = await prisma.role.findUnique({ where: { id: roleId } });
  if (!targetRole) {
    return res.status(400).json({ success: false, error: 'Invalid role selected' });
  }

  try {
    const inviterName = `${req.user!.firstName} ${req.user!.lastName}`.trim();
    const result = await createUserInvite({
      email,
      firstName,
      lastName,
      phone,
      roleId,
      createdById: req.user!.id,
      inviterName,
    });

    const { password: _, inviteToken: __, ...userWithoutPassword } = result.user;
    await logActivity(req, 'CREATE', 'User', result.user.id, `Invited as ${targetRole.name}`);

    return res.status(201).json({
      success: true,
      data: { ...userWithoutPassword, invitePending: true },
      emailSent: result.emailSent,
      emailError: result.emailError,
      setupUrl: result.emailSent ? undefined : result.setupUrl,
      message: result.emailSent
        ? 'Invite sent successfully. The user will receive an email to set their password.'
        : result.emailError
          ? `User invited but email failed: ${result.emailError}. Share the setup link manually.`
          : 'User invited. Email is not configured — share the setup link manually.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to invite user';
    return res.status(400).json({ success: false, error: message });
  }
}

export async function resendInvite(req: AuthRequest, res: Response) {
  if (req.user!.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, error: 'Only super admin can resend invites' });
  }

  try {
    const inviterName = `${req.user!.firstName} ${req.user!.lastName}`.trim();
    const result = await resendUserInvite(paramId(req), inviterName);
    await logActivity(req, 'UPDATE', 'User', paramId(req), 'Invite resent');

    return res.json({
      success: true,
      emailSent: result.emailSent,
      emailError: result.emailError,
      setupUrl: result.emailSent ? undefined : result.setupUrl,
      message: result.emailSent
        ? 'Invite email resent successfully.'
        : result.emailError
          ? `Invite renewed but email failed: ${result.emailError}. Share the setup link manually.`
          : 'Invite renewed. Share the setup link manually.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to resend invite';
    return res.status(400).json({ success: false, error: message });
  }
}
