import { Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { ActivityAction } from '@prisma/client';

export async function logActivity(
  req: AuthRequest,
  action: ActivityAction,
  entity: string,
  entityId?: string,
  details?: string
): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        userId: req.user?.id,
        action,
        entity,
        entityId,
        details,
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      },
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
}

export function activityLogger(action: ActivityAction, entity: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const entityId = (req.params as { id?: string }).id || (body as { data?: { id?: string } })?.data?.id;
        logActivity(req, action, entity, entityId, `${action} ${entity}`);
      }
      return originalJson(body);
    };
    next();
  };
}
