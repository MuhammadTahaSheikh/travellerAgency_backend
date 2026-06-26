import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination } from '../utils/helpers';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';

export async function getCheckIns(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const upcoming = req.query.upcoming === 'true';
  const scheduleType = req.query.scheduleType as string;

  const where: Record<string, unknown> = {};
  if (scheduleType) where.scheduleType = scheduleType;
  if (upcoming) {
    const now = new Date();
    where.OR = [
      { checkInDate: { gte: now } },
      { transportDate: { gte: now } },
    ];
  }

  const [checkIns, total] = await Promise.all([
    prisma.checkInRecord.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ checkInDate: 'asc' }, { transportDate: 'asc' }],
      include: { booking: { include: { customer: true } } },
    }),
    prisma.checkInRecord.count({ where }),
  ]);

  return res.json({ success: true, data: checkIns, pagination: formatPagination(total, page, limit) });
}

export async function createCheckIn(req: AuthRequest, res: Response) {
  const {
    bookingId,
    invoiceId,
    scheduleType,
    hotelName,
    checkInDate,
    transportDate,
    pickupLocation,
    dropoffLocation,
    guestName,
    roomDetails,
    vendorPosted,
  } = req.body;

  const type = scheduleType || 'HOTEL';
  if (type === 'HOTEL' && !hotelName && !checkInDate) {
    return res.status(400).json({ success: false, error: 'Hotel name and check-in date are required' });
  }
  if (type === 'TRANSPORT' && !transportDate) {
    return res.status(400).json({ success: false, error: 'Transport date is required' });
  }

  const record = await prisma.checkInRecord.create({
    data: {
      bookingId: bookingId || null,
      invoiceId: invoiceId || null,
      scheduleType: type,
      hotelName,
      checkInDate: checkInDate ? new Date(checkInDate) : undefined,
      transportDate: transportDate ? new Date(transportDate) : undefined,
      pickupLocation,
      dropoffLocation,
      guestName,
      roomDetails,
      vendorPosted: vendorPosted ?? false,
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
      transportDate: req.body.transportDate ? new Date(req.body.transportDate) : undefined,
    },
    include: { booking: { include: { customer: true } } },
  });

  await logActivity(req, 'UPDATE', 'CheckInRecord', record.id);
  return res.json({ success: true, data: record });
}

export async function deleteCheckIn(req: AuthRequest, res: Response) {
  await prisma.checkInRecord.delete({ where: { id: paramId(req) } });
  await logActivity(req, 'DELETE', 'CheckInRecord', paramId(req));
  return res.json({ success: true, message: 'Schedule record deleted' });
}
