import { randomBytes } from 'crypto';
import prisma from '../config/database';
import { hashPassword } from '../utils/password';
import { config } from '../config';
import { sendInviteEmail } from './emailService';

const INVITE_EXPIRY_DAYS = 7;

export function generateInviteToken(): string {
  return randomBytes(32).toString('hex');
}

export function getInviteExpiryDate(): Date {
  const expires = new Date();
  expires.setDate(expires.getDate() + INVITE_EXPIRY_DAYS);
  return expires;
}

export function buildSetupPasswordUrl(token: string): string {
  const base = config.frontendUrl.replace(/\/$/, '');
  return `${base}/setup-password?token=${token}`;
}

export async function createUserInvite(params: {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  roleId: string;
  createdById: string;
  inviterName: string;
}) {
  const email = params.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error('A user with this email already exists');
  }

  const role = await prisma.role.findUnique({ where: { id: params.roleId } });
  if (!role) throw new Error('Invalid role selected');

  const inviteToken = generateInviteToken();
  const inviteExpiresAt = getInviteExpiryDate();
  const placeholderPassword = await hashPassword(randomBytes(32).toString('hex'));

  const user = await prisma.user.create({
    data: {
      email,
      password: placeholderPassword,
      firstName: params.firstName.trim(),
      lastName: params.lastName.trim(),
      phone: params.phone?.trim() || null,
      roleId: params.roleId,
      createdById: params.createdById,
      inviteToken,
      inviteExpiresAt,
    },
    include: { role: true },
  });

  const setupUrl = buildSetupPasswordUrl(inviteToken);
    const emailResult = await sendInviteEmail({
      to: email,
      firstName: user.firstName,
      inviterName: params.inviterName,
      roleName: role.name,
      setupUrl,
    });

    return { user, setupUrl, emailSent: emailResult.sent, emailError: emailResult.error };
}

export async function resendUserInvite(userId: string, inviterName: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true },
  });

  if (!user) throw new Error('User not found');
  if (!user.inviteToken) throw new Error('This user has already completed account setup');

  const inviteToken = generateInviteToken();
  const inviteExpiresAt = getInviteExpiryDate();

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { inviteToken, inviteExpiresAt },
    include: { role: true },
  });

  const setupUrl = buildSetupPasswordUrl(inviteToken);
  const emailResult = await sendInviteEmail({
    to: updated.email,
    firstName: updated.firstName,
    inviterName,
    roleName: updated.role.name,
    setupUrl,
  });

  return { user: updated, setupUrl, emailSent: emailResult.sent, emailError: emailResult.error };
}

export async function validateInviteToken(token: string) {
  const user = await prisma.user.findUnique({
    where: { inviteToken: token },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      inviteExpiresAt: true,
      role: { select: { name: true } },
    },
  });

  if (!user) return { valid: false as const, error: 'Invalid or expired invite link' };
  if (user.inviteExpiresAt && user.inviteExpiresAt < new Date()) {
    return { valid: false as const, error: 'This invite link has expired. Ask your admin to resend the invite.' };
  }

  return { valid: true as const, user };
}

export async function completeInviteSetup(token: string, password: string) {
  const validation = await validateInviteToken(token);
  if (!validation.valid) throw new Error(validation.error);

  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const user = await prisma.user.update({
    where: { inviteToken: token },
    data: {
      password: await hashPassword(password),
      inviteToken: null,
      inviteExpiresAt: null,
      passwordSetAt: new Date(),
      isActive: true,
    },
    include: { role: true },
  });

  const { password: _, ...userWithoutPassword } = user;
  return userWithoutPassword;
}
