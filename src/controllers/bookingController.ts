import { Response } from 'express';
import prisma, { TX_OPTS } from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination, applyDateFilter, serializeForDeletedRecord, paginateSearch } from '../utils/helpers';
import { allocateBookingNumber } from '../services/numberingService';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';
import { createBookingConfirmation } from '../services/notificationService';
import {
  generateInvoiceFromBooking,
  confirmInvoice,
  createCheckInsFromBooking,
} from '../services/invoiceService';
import { createVendorPostingsFromBooking } from '../services/vendorPostingService';

export async function getBookings(req: AuthRequest, res: Response) {
  const search = (req.query.search as string)?.trim();
  const useSearchPagination = Boolean(search);
  const { page, limit, skip } = useSearchPagination
    ? paginateSearch(req.query.page as string, req.query.limit as string)
    : paginate(req.query.page as string, req.query.limit as string);
  const status = req.query.status as string;
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (req.user?.role === 'USER') where.createdById = req.user.id;
  applyDateFilter(where, 'createdAt', startDate, endDate);
  if (search) {
    where.OR = [
      { bookingNumber: { contains: search } },
      { customer: { firstName: { contains: search } } },
      { customer: { lastName: { contains: search } } },
      { customer: { companyName: { contains: search } } },
    ];
  }

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

/**
 * Resolves the customer FK for a booking. B2B bookings must reference a registered
 * customer; B2C bookings accept a free-text guest name, for which we find-or-create a
 * lightweight B2C customer so the required relation stays satisfied.
 */
async function resolveCustomerId(input: {
  bookingType?: string;
  customerId?: string;
  guestName?: string;
}): Promise<{ customerId: string } | { error: string }> {
  const bookingType = input.bookingType === 'B2C' ? 'B2C' : input.customerId ? 'B2B' : input.guestName ? 'B2C' : 'B2B';

  if (bookingType === 'B2B') {
    if (!input.customerId) return { error: 'A registered company/client is required for B2B bookings' };
    return { customerId: input.customerId };
  }

  const guestName = (input.guestName || '').trim();
  if (!guestName) return { error: 'Guest name is required for B2C bookings' };

  const [firstName, ...rest] = guestName.split(/\s+/);
  const lastName = rest.join(' ') || '-';

  const existing = await prisma.customer.findFirst({
    where: { customerType: 'B2C', firstName, lastName },
  });
  if (existing) return { customerId: existing.id };

  const created = await prisma.customer.create({
    data: { customerType: 'B2C', firstName, lastName, phone: '' },
  });
  return { customerId: created.id };
}

export async function createBooking(req: AuthRequest, res: Response) {
  const {
    packageId,
    customerId,
    bookingType,
    guestName,
    currency,
    priceMode,
    travelDate,
    returnDate,
    numTravelers,
    adults,
    children,
    infants,
    priceAdult,
    priceChild,
    priceInfant,
    totalAmount,
    discount,
    notes,
    additionalCustomers,
    status,
    serviceItems,
  } = req.body;

  const resolved = await resolveCustomerId({ bookingType, customerId, guestName });
  if ('error' in resolved) {
    return res.status(400).json({ success: false, error: resolved.error });
  }
  const resolvedCustomerId = resolved.customerId;

  const items = serviceItems || [];
  let computedTotal = totalAmount ? Number(totalAmount) : 0;

  if (!totalAmount && items.length > 0) {
    computedTotal = items.reduce((sum: number, i: { amount: number }) => sum + Number(i.amount || 0), 0);
  }

  // Determined pricing can stand on per-passenger rates alone; otherwise require a package or a service item.
  if (!packageId && items.length === 0 && computedTotal <= 0) {
    return res.status(400).json({ success: false, error: 'Package, a service item, or determined passenger pricing is required' });
  }

  if (!computedTotal || computedTotal <= 0) {
    return res.status(400).json({ success: false, error: 'Total amount must be greater than zero' });
  }

  const bookingNumber = await allocateBookingNumber();
  const booking = await prisma.booking.create({
    data: {
      bookingNumber,
      packageId: packageId || null,
      customerId: resolvedCustomerId,
      createdById: req.user!.id,
      bookingType: bookingType === 'B2B' ? 'B2B' : 'B2C',
      guestName: bookingType === 'B2C' ? (guestName || null) : null,
      currency: currency === 'SAR' ? 'SAR' : 'PKR',
      priceMode: priceMode === 'BREAKDOWN' ? 'BREAKDOWN' : 'DETERMINED',
      travelDate: travelDate ? new Date(travelDate) : undefined,
      returnDate: returnDate ? new Date(returnDate) : undefined,
      numTravelers: numTravelers || 1,
      adults: adults ?? 1,
      children: children ?? 0,
      infants: infants ?? 0,
      priceAdult: priceAdult || 0,
      priceChild: priceChild || 0,
      priceInfant: priceInfant || 0,
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
  await prisma.$transaction(async (tx) => {
    invoice = await generateInvoiceFromBooking(bookingId, 14, tx);
    await confirmInvoice(invoice.id, tx);
    // Vendor costs are recorded as PENDING (Unposted) postings; they hit the ledger only
    // once confirmed on the vendor postings screen.
    await createVendorPostingsFromBooking(bookingId, tx);
  }, TX_OPTS);

  await createCheckInsFromBooking(bookingId);

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
  }, TX_OPTS);

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
  } else if (booking.status === 'CONFIRMED' && serviceItems) {
    // Already-confirmed booking whose services were edited — refresh the arrival schedule
    // so accommodation/transport changes are reflected.
    await createCheckInsFromBooking(booking.id);
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
