import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination, applyDateFilter } from '../utils/helpers';

export async function getActivityLogs(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const { action, entity, userId, startDate, endDate } = req.query;

  const where: Record<string, unknown> = {};
  if (action) where.action = action;
  if (entity) where.entity = entity;
  if (userId) where.userId = userId;
  applyDateFilter(where, 'createdAt', startDate as string, endDate as string);

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    }),
    prisma.activityLog.count({ where }),
  ]);

  return res.json({ success: true, data: logs, pagination: formatPagination(total, page, limit) });
}

export async function getLoginHistory(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);

  const [history, total] = await Promise.all([
    prisma.loginHistory.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    }),
    prisma.loginHistory.count(),
  ]);

  return res.json({ success: true, data: history, pagination: formatPagination(total, page, limit) });
}

export async function getDeletedRecords(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);

  const [records, total] = await Promise.all([
    prisma.deletedRecord.findMany({ skip, take: limit, orderBy: { deletedAt: 'desc' } }),
    prisma.deletedRecord.count(),
  ]);

  return res.json({ success: true, data: records, pagination: formatPagination(total, page, limit) });
}

export async function getAuditSummary(_req: AuthRequest, res: Response) {
  const [totalLogs, recentLogins, deletedCount, actionsByType] = await Promise.all([
    prisma.activityLog.count(),
    prisma.loginHistory.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    prisma.deletedRecord.count(),
    prisma.activityLog.groupBy({ by: ['action'], _count: { action: true } }),
  ]);

  return res.json({
    success: true,
    data: { totalLogs, recentLogins, deletedCount, actionsByType },
  });
}
