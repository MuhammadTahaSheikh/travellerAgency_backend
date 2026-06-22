import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination } from '../utils/helpers';
import { paramId } from '../utils/params';
import { createSystemAnnouncement } from '../services/notificationService';

export async function getNotifications(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const unreadOnly = req.query.unread === 'true';

  const where = {
    userId: req.user!.id,
    ...(unreadOnly ? { isRead: false } : {}),
  };

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.notification.count({ where }),
  ]);

  return res.json({ success: true, data: notifications, pagination: formatPagination(total, page, limit) });
}

export async function markAsRead(req: AuthRequest, res: Response) {
  await prisma.notification.update({
    where: { id: paramId(req), userId: req.user!.id },
    data: { isRead: true },
  });
  return res.json({ success: true, message: 'Notification marked as read' });
}

export async function markAllAsRead(req: AuthRequest, res: Response) {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, isRead: false },
    data: { isRead: true },
  });
  return res.json({ success: true, message: 'All notifications marked as read' });
}

export async function createAnnouncement(req: AuthRequest, res: Response) {
  const { title, message } = req.body;
  if (!title || !message) {
    return res.status(400).json({ success: false, error: 'Title and message required' });
  }

  await createSystemAnnouncement(title, message);
  return res.status(201).json({ success: true, message: 'Announcement sent to all users' });
}

export async function getUnreadCount(req: AuthRequest, res: Response) {
  const count = await prisma.notification.count({
    where: { userId: req.user!.id, isRead: false },
  });
  return res.json({ success: true, data: { count } });
}
