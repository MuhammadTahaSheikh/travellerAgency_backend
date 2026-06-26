import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination, generateNumber, applyDateFilter, serializeForDeletedRecord } from '../utils/helpers';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';
import { createBookingConfirmation } from '../services/notificationService';
import {
  generateInvoiceFromBooking,
  confirmInvoice,
  allocateVendorCosts,
  createCheckInsFromBooking,
} from '../services/invoiceService';

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
        serviceItems: { include: { vendor: true } },
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
      serviceItems: { include: { vendor: true } },
      invoices: { include: { items: true } },
      checkIns: true,
      vendorCosts: { include: { vendor: true } },
      vouchers: true,
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
    serviceItems,
  } = req.body;

  if (!customerId) {
    return res.status(400).json({ success: false, error: 'Customer is required' });
  }

  const items = serviceItems || [];
  let computedTotal = totalAmount ? Number(totalAmount) : 0;

  if (!totalAmount && items.length > 0) {
    computedTotal = items.reduce((sum: number, i: { amount: number }) => sum + Number(i.amount || 0), 0);
  }

  if (!packageId && items.length === 0) {
    return res.status(400).json({ success: false, error: 'Package or at least one service item is required' });
  }

  if (!computedTotal || computedTotal <= 0) {
    return res.status(400).json({ success: false, error: 'Total amount must be greater than zero' });
  }

  const booking = await prisma.booking.create({
    data: {
      bookingNumber: generateNumber('BK'),
      packageId: packageId || null,
      customerId,
      createdById: req.user!.id,
      travelDate: travelDate ? new Date(travelDate) : undefined,
      returnDate: returnDate ? new Date(returnDate) : undefined,
      numTravelers: numTravelers || 1,
      totalAmount: computedTotal,
      discount: discount || 0,
      notes,
      status: status || 'PENDING',
      bookingCustomers: additionalCustomers?.length
        ? { create: additionalCustomers.map((cid: string) => ({ customerId: cid })) }
        : undefined,
      serviceItems: items.length
        ? {
            create: items.map((item: {
              serviceType: string;
              description: string;
              amount: number;
              costAmount?: number;
              vendorId?: string;
              details?: Record<string, unknown>;
            }) => ({
              serviceType: item.serviceType,
              description: item.description,
              amount: item.amount,
              costAmount: item.costAmount || 0,
              vendorId: item.vendorId || null,
              details: item.details || undefined,
            })),
          }
        : undefined,
    },
    include: {
      customer: true,
      package: true,
      bookingCustomers: { include: { customer: true } },
      serviceItems: { include: { vendor: true } },
    },
  });

  await logActivity(req, 'CREATE', 'Booking', booking.id);

  let invoice = null;
  if (booking.status === 'CONFIRMED') {
    try {
      invoice = await handleBookingConfirmed(booking.id, req.user!.id);
    } catch (err) {
      await prisma.booking.update({ where: { id: booking.id }, data: { status: 'PENDING' } });
      const message = err instanceof Error ? err.message : 'Failed to confirm booking';
      return res.status(500).json({ success: false, error: `Booking saved as pending: ${message}` });
    }
  }

  return res.status(201).json({ success: true, data: booking, invoice });
}

async function handleBookingConfirmed(bookingId: string, userId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return null;

  await createBookingConfirmation(userId, booking.bookingNumber);

  let invoice;
  await prisma.$transaction(
    async (tx) => {
      invoice = await generateInvoiceFromBooking(bookingId, 14, tx);
      await confirmInvoice(invoice.id, tx);
      await allocateVendorCosts(bookingId, tx);
      await createCheckInsFromBooking(bookingId, tx);
    },
    { maxWait: 10000, timeout: 60000 },
  );

  return prisma.invoice.findUnique({
    where: { id: invoice!.id },
    include: { customer: true, booking: true, items: true },
  });
}

export async function updateBooking(req: AuthRequest, res: Response) {
  const oldBooking = await prisma.booking.findUnique({ where: { id: paramId(req) } });
  const { serviceItems, ...rest } = req.body;

  const booking = await prisma.$transaction(async (tx) => {
    if (serviceItems) {
      await tx.bookingServiceItem.deleteMany({ where: { bookingId: paramId(req) } });
    }

    return tx.booking.update({
      where: { id: paramId(req) },
      data: {
        ...rest,
        packageId: rest.packageId || null,
        travelDate: rest.travelDate ? new Date(rest.travelDate) : undefined,
        returnDate: rest.returnDate ? new Date(rest.returnDate) : undefined,
        serviceItems: serviceItems?.length
          ? {
              create: serviceItems.map((item: {
                serviceType: string;
                description: string;
                amount: number;
                costAmount?: number;
                vendorId?: string;
                details?: Record<string, unknown>;
              }) => ({
                serviceType: item.serviceType,
                description: item.description,
                amount: item.amount,
                costAmount: item.costAmount || 0,
                vendorId: item.vendorId || null,
                details: item.details || undefined,
              })),
            }
          : undefined,
      },
      include: {
        customer: true,
        package: true,
        serviceItems: { include: { vendor: true } },
      },
    });
  });

  await logActivity(req, 'UPDATE', 'Booking', booking.id, `Status: ${oldBooking?.status} -> ${booking.status}`);

  let invoice = null;
  if (oldBooking?.status !== 'CONFIRMED' && booking.status === 'CONFIRMED') {
    try {
      invoice = await handleBookingConfirmed(booking.id, req.user!.id);
    } catch (err) {
      await prisma.booking.update({ where: { id: booking.id }, data: { status: oldBooking?.status || 'PENDING' } });
      const message = err instanceof Error ? err.message : 'Failed to confirm booking';
      return res.status(500).json({ success: false, error: `Booking confirmation failed: ${message}` });
    }
  }

  return res.json({ success: true, data: booking, invoice });
}

export async function deleteBooking(req: AuthRequest, res: Response) {
  const booking = await prisma.booking.findUnique({ where: { id: paramId(req) } });
  if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

  await prisma.deletedRecord.create({
    data: { entity: 'Booking', entityId: booking.id, data: serializeForDeletedRecord(booking), deletedBy: req.user?.id },
  });

  await prisma.booking.update({ where: { id: paramId(req) }, data: { status: 'CANCELLED' } });
  await logActivity(req, 'DELETE', 'Booking', paramId(req));
  return res.json({ success: true, message: 'Booking cancelled' });
}

export async function generateBookingInvoice(req: AuthRequest, res: Response) {
  try {
    const invoice = await generateInvoiceFromBooking(paramId(req));
    await logActivity(req, 'CREATE', 'Invoice', invoice.id, `From booking ${paramId(req)}`);
    return res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate invoice';
    return res.status(400).json({ success: false, error: message });
  }
}
