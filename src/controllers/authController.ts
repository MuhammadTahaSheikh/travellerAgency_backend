import { Response } from 'express';
import prisma from '../config/database';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { AuthRequest } from '../types';
import { logActivity } from '../middleware/activityLogger';

export async function login(req: AuthRequest, res: Response) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password required' });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true },
  });

  if (!user || !user.isActive) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  if (user.inviteToken) {
    return res.status(403).json({
      success: false,
      error: 'Please set your password using the invite link sent to your email before logging in.',
    });
  }

  const valid = await comparePassword(password, user.password);
  if (!valid) {
    await prisma.loginHistory.create({
      data: { userId: user.id, ipAddress: req.ip, userAgent: req.headers['user-agent'], success: false },
    });
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }

  await prisma.loginHistory.create({
    data: { userId: user.id, ipAddress: req.ip, userAgent: req.headers['user-agent'], success: true },
  });

  const authUser = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role.name,
    roleId: user.roleId,
  };

  req.user = authUser;
  await logActivity(req, 'LOGIN', 'User', user.id, 'User logged in');

  const token = generateToken(authUser);
  const { password: _, ...userWithoutPassword } = user;

  return res.json({
    success: true,
    data: { token, user: userWithoutPassword },
  });
}

export async function register(req: AuthRequest, res: Response) {
  const { email, password, firstName, lastName, phone, roleId } = req.body;

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ success: false, error: 'Required fields missing' });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ success: false, error: 'Email already exists' });
  }

  let assignedRoleId = roleId;
  if (!assignedRoleId) {
    const userRole = await prisma.role.findUnique({ where: { name: 'USER' } });
    assignedRoleId = userRole?.id;
  }

  const hashed = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      password: hashed,
      firstName,
      lastName,
      phone,
      roleId: assignedRoleId!,
      createdById: req.user?.id,
    },
    include: { role: true },
  });

  const { password: _, ...userWithoutPassword } = user;
  await logActivity(req, 'CREATE', 'User', user.id, 'User registered');

  return res.status(201).json({ success: true, data: userWithoutPassword });
}

export async function getProfile(req: AuthRequest, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });

  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const { password: _, ...userWithoutPassword } = user;
  return res.json({ success: true, data: userWithoutPassword });
}

export async function updateProfile(req: AuthRequest, res: Response) {
  const { firstName, lastName, phone } = req.body;
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { firstName, lastName, phone },
    include: { role: true },
  });

  const { password: _, ...userWithoutPassword } = user;
  return res.json({ success: true, data: userWithoutPassword });
}

export async function changePassword(req: AuthRequest, res: Response) {
  const { currentPassword, newPassword } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const valid = await comparePassword(currentPassword, user.password);
  if (!valid) return res.status(400).json({ success: false, error: 'Current password incorrect' });

  await prisma.user.update({
    where: { id: user.id },
    data: { password: await hashPassword(newPassword) },
  });

  return res.json({ success: true, message: 'Password updated successfully' });
}

export async function getLoginHistory(req: AuthRequest, res: Response) {
  const history = await prisma.loginHistory.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return res.json({ success: true, data: history });
}

export async function validateInvite(req: AuthRequest, res: Response) {
  const token = req.params.token as string;
  if (!token) {
    return res.status(400).json({ success: false, error: 'Invite token required' });
  }

  const { validateInviteToken } = await import('../services/inviteService');
  const result = await validateInviteToken(token);

  if (!result.valid) {
    return res.status(400).json({ success: false, error: result.error });
  }

  return res.json({
    success: true,
    data: {
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      role: result.user.role.name,
    },
  });
}

export async function setupPassword(req: AuthRequest, res: Response) {
  const { token, password, confirmPassword } = req.body;

  if (!token || !password) {
    return res.status(400).json({ success: false, error: 'Token and password are required' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ success: false, error: 'Passwords do not match' });
  }

  try {
    const { completeInviteSetup } = await import('../services/inviteService');
    const user = await completeInviteSetup(token, password);
    return res.json({ success: true, data: user, message: 'Password set successfully. You can now log in.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to set password';
    return res.status(400).json({ success: false, error: message });
  }
}
