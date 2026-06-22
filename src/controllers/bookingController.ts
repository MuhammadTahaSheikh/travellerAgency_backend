import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination, generateNumber, applyDateFilter } from '../utils/helpers';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';
import { createBookingConfirmation } from '../services/notificationService';

export async function getBookings(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const status = req.query.status as string;
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (req.user?.role === 'USER') where.createdById = req.user.id;
  applyDateFilter(where, 'createdAt', startDate, endDate);

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: true,
        package: true,
        createdBy: { select: { firstName: true, lastName: true } },
        bookingCustomers: { include: { customer: true } },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  return res.json({ success: true, data: bookings, pagination: formatPagination(total, page, limit) });
}

export async function getBooking(req: AuthRequest, res: Response) {
  const booking = await prisma.booking.findUnique({
    where: { id: paramId(req) },
    include: {
      customer: true,
      package: { include: { destinations: true } },
      createdBy: { select: { firstName: true, lastName: true, email: true } },
      bookingCustomers: { include: { customer: true } },
      invoices: true,
    },
  });

  if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });
  return res.json({ success: true, data: booking });
}

export async function createBooking(req: AuthRequest, res: Response) {
  const {
    packageId,
    customerId,
    travelDate,
    returnDate,
    numTravelers,
    totalAmount,
    discount,
    notes,
    additionalCustomers,
    status,
  } = req.body;

  if (!packageId || !customerId || !totalAmount) {
    return res.status(400).json({ success: false, error: 'Package, customer, and total amount are required' });
  }

  const booking = await prisma.booking.create({
    data: {
      bookingNumber: generateNumber('BK'),
      packageId,
      customerId,
      createdById: req.user!.id,
      travelDate: travelDate ? new Date(travelDate) : undefined,
      returnDate: returnDate ? new Date(returnDate) : undefined,
      numTravelers: numTravelers || 1,
      totalAmount,
      discount: discount || 0,
      notes,
      status: status || 'PENDING',
      bookingCustomers: additionalCustomers?.length
        ? { create: additionalCustomers.map((cid: string) => ({ customerId: cid })) }
        : undefined,
    },
    include: { customer: true, package: true, bookingCustomers: { include: { customer: true } } },
  });

  await logActivity(req, 'CREATE', 'Booking', booking.id);

  if (booking.status === 'CONFIRMED') {
    await createBookingConfirmation(req.user!.id, booking.bookingNumber);
  }

  return res.status(201).json({ success: true, data: booking });
}

export async function updateBooking(req: AuthRequest, res: Response) {
  const oldBooking = await prisma.booking.findUnique({ where: { id: paramId(req) } });
  const booking = await prisma.booking.update({
    where: { id: paramId(req) },
    data: {
      ...req.body,
      travelDate: req.body.travelDate ? new Date(req.body.travelDate) : undefined,
      returnDate: req.body.returnDate ? new Date(req.body.returnDate) : undefined,
    },
    include: { customer: true, package: true },
  });

  await logActivity(req, 'UPDATE', 'Booking', booking.id, `Status: ${oldBooking?.status} -> ${booking.status}`);

  if (oldBooking?.status !== 'CONFIRMED' && booking.status === 'CONFIRMED') {
    await createBookingConfirmation(req.user!.id, booking.bookingNumber);
  }

  return res.json({ success: true, data: booking });
}

export async function deleteBooking(req: AuthRequest, res: Response) {
  const booking = await prisma.booking.findUnique({ where: { id: paramId(req) } });
  if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

  await prisma.deletedRecord.create({
    data: { entity: 'Booking', entityId: booking.id, data: JSON.stringify(booking), deletedBy: req.user?.id },
  });

  await prisma.booking.update({ where: { id: paramId(req) }, data: { status: 'CANCELLED' } });
  await logActivity(req, 'DELETE', 'Booking', paramId(req));
  return res.json({ success: true, message: 'Booking cancelled' });
}
