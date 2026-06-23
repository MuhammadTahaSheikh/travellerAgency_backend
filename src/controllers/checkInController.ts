import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination } from '../utils/helpers';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';

export async function getCheckIns(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const upcoming = req.query.upcoming === 'true';

  const where: Record<string, unknown> = {};
  if (upcoming) {
    where.checkInDate = { gte: new Date() };
  }

  const [checkIns, total] = await Promise.all([
    prisma.checkInRecord.findMany({
      where,
      skip,
      take: limit,
      orderBy: { checkInDate: 'asc' },
      include: { booking: { include: { customer: true } } },
    }),
    prisma.checkInRecord.count({ where }),
  ]);

  return res.json({ success: true, data: checkIns, pagination: formatPagination(total, page, limit) });
}

export async function createCheckIn(req: AuthRequest, res: Response) {
  const { bookingId, hotelName, checkInDate, guestName, roomDetails } = req.body;

  if (!bookingId || !hotelName || !checkInDate) {
    return res.status(400).json({ success: false, error: 'Booking, hotel name, and check-in date are required' });
  }

  const record = await prisma.checkInRecord.create({
    data: {
      bookingId,
      hotelName,
      checkInDate: new Date(checkInDate),
      guestName,
      roomDetails,
    },
    include: { booking: { include: { customer: true } } },
  });

  await logActivity(req, 'CREATE', 'CheckInRecord', record.id);
  return res.status(201).json({ success: true, data: record });
}

export async function updateCheckIn(req: AuthRequest, res: Response) {
  const record = await prisma.checkInRecord.update({
    where: { id: paramId(req) },
    data: {
      ...req.body,
      checkInDate: req.body.checkInDate ? new Date(req.body.checkInDate) : undefined,
    },
    include: { booking: { include: { customer: true } } },
  });

  await logActivity(req, 'UPDATE', 'CheckInRecord', record.id);
  return res.json({ success: true, data: record });
}

export async function deleteCheckIn(req: AuthRequest, res: Response) {
  await prisma.checkInRecord.delete({ where: { id: paramId(req) } });
  await logActivity(req, 'DELETE', 'CheckInRecord', paramId(req));
  return res.json({ success: true, message: 'Check-in record deleted' });
}
