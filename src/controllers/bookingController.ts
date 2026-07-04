import { Response } from 'express';
import prisma, { TX_OPTS } from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination, applyDateFilter, serializeForDeletedRecord, paginateSearch } from '../utils/helpers';
import { allocateBookingNumber } from '../services/numberingService';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';
import { createBookingConfirmation, createNotification } from '../services/notificationService';
import {
  generateInvoiceFromBooking,
  createCheckInsFromBooking,
  syncBookingInvoiceAndLedger,
} from '../services/invoiceService';
import { postVendorCostToLedger } from '../services/vendorPostingService';

function derivePaymentStatus(paidAmount: number, totalAmount: number): string {
  if (paidAmount <= 0) return 'Unpaid';
  if (paidAmount >= totalAmount) return 'Paid';
  return 'Partially-Paid';
}

function derivePostingStatus(postings: { status: string }[]): string {
  if (!postings.length) return 'Un-Posted';
  const posted = postings.filter((p) => p.status === 'POSTED').length;
  if (posted === 0) return 'Un-Posted';
  if (posted === postings.length) return 'Posted';
  return 'Partially Posted';
}

function enrichBooking(booking: Record<string, unknown> & {
  paidAmount: unknown;
  totalAmount: unknown;
  vendorPostings?: { status: string }[];
}) {
  const paid = Number(booking.paidAmount);
  const total = Number(booking.totalAmount);
  const postings = booking.vendorPostings || [];
  return {
    ...booking,
    paymentStatus: derivePaymentStatus(paid, total),
    postingStatus: derivePostingStatus(postings),
  };
}

function isSuperAdmin(role?: string) {
  return role === 'SUPER_ADMIN';
}

function canUserModifyBooking(role: string | undefined, bookingStatus: string): boolean {
  if (isSuperAdmin(role)) return true;
  if (role === 'ADMIN') return true;
  if (bookingStatus === 'CONFIRMED' || bookingStatus === 'REQUEST_CONFIRMATION') return false;
  return true;
}

function canDirectConfirmBooking(role?: string) {
  return isSuperAdmin(role);
}

function normalizeBookingStatus(status?: string): string {
  const allowed = ['DRAFT', 'PENDING', 'REQUEST_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'COMPLETED'];
  if (status && allowed.includes(status)) return status;
  return 'DRAFT';
}

async function handleBookingDraft(bookingId: string) {
  return generateInvoiceFromBooking(bookingId);
}

async function submitConfirmationRequest(bookingId: string, userId: string, userName: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new Error('Booking not found');

  const existing = await prisma.bookingConfirmationRequest.findFirst({
    where: { bookingId, status: 'PENDING' },
  });
  if (existing) return existing;

  const request = await prisma.bookingConfirmationRequest.create({
    data: { bookingId, requestedById: userId },
  });

  const superAdmins = await prisma.user.findMany({
    where: { isActive: true, role: { name: 'SUPER_ADMIN' } },
    select: { id: true },
  });

  await Promise.all(
    superAdmins.map((admin) =>
      createNotification(
        admin.id,
        'BOOKING_CONFIRMATION_REQUEST',
        'Booking Confirmation Request',
        `${userName} requested confirmation for booking ${booking.bookingNumber}`,
        '/approvals?tab=booking'
      )
    )
  );

  return request;
}

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
        vendorPostings: { include: { vendor: true } },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  const enriched = bookings.map((b) => enrichBooking(b as Parameters<typeof enrichBooking>[0]));
  return res.json({ success: true, data: enriched, pagination: formatPagination(total, page, limit) });
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
      vendorPostings: { include: { vendor: true } },
    },
  });

  if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });
  return res.json({ success: true, data: enrichBooking(booking as Parameters<typeof enrichBooking>[0]) });
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

  const bookingStatus = normalizeBookingStatus(status);

  if (bookingStatus === 'CONFIRMED' && !canDirectConfirmBooking(req.user?.role)) {
    return res.status(403).json({
      success: false,
      error: 'Only Super Admin can confirm bookings directly. Use Request Confirmation instead.',
    });
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
      status: bookingStatus as 'DRAFT' | 'PENDING' | 'REQUEST_CONFIRMATION' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED',
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
  try {
    if (booking.status === 'DRAFT' || booking.status === 'PENDING') {
      invoice = await handleBookingDraft(booking.id);
    } else if (booking.status === 'REQUEST_CONFIRMATION') {
      invoice = await handleBookingDraft(booking.id);
      await submitConfirmationRequest(
        booking.id,
        req.user!.id,
        `${req.user!.firstName} ${req.user!.lastName}`
      );
    } else if (booking.status === 'CONFIRMED') {
      invoice = await handleBookingConfirmed(booking.id, req.user!.id);
    }
  } catch (err) {
    const fallbackStatus = booking.status === 'CONFIRMED' ? 'DRAFT' : booking.status;
    await prisma.booking.update({ where: { id: booking.id }, data: { status: fallbackStatus } });
    const message = err instanceof Error ? err.message : 'Failed to process booking status';
    return res.status(500).json({ success: false, error: message });
  }

  return res.status(201).json({ success: true, data: booking, invoice });
}

async function handleBookingConfirmed(bookingId: string, userId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return null;

  await createBookingConfirmation(userId, booking.bookingNumber);

  let invoice;
  await prisma.$transaction(async (tx) => {
    invoice = await syncBookingInvoiceAndLedger(bookingId, tx);
  }, TX_OPTS);

  await createCheckInsFromBooking(bookingId);

  return prisma.invoice.findUnique({
    where: { id: invoice!.id },
    include: { customer: true, booking: true, items: true },
  });
}

async function resyncConfirmedBooking(bookingId: string) {
  let invoice;
  await prisma.$transaction(async (tx) => {
    invoice = await syncBookingInvoiceAndLedger(bookingId, tx);
  }, TX_OPTS);
  await createCheckInsFromBooking(bookingId);
  return invoice;
}

export async function updateBooking(req: AuthRequest, res: Response) {
  const oldBooking = await prisma.booking.findUnique({ where: { id: paramId(req) } });
  if (!oldBooking) return res.status(404).json({ success: false, error: 'Booking not found' });

  if (!canUserModifyBooking(req.user?.role, oldBooking.status)) {
    return res.status(403).json({
      success: false,
      error: 'This booking cannot be modified. Contact Super Admin.',
    });
  }

  const { serviceItems, status: rawStatus, ...rest } = req.body;
  const nextStatus = rawStatus ? normalizeBookingStatus(rawStatus) : oldBooking.status;

  if (nextStatus === 'CONFIRMED' && !canDirectConfirmBooking(req.user?.role)) {
    return res.status(403).json({
      success: false,
      error: 'Only Super Admin can confirm bookings directly. Use Request Confirmation instead.',
    });
  }

  const booking = await prisma.$transaction(async (tx) => {
    if (serviceItems) {
      await tx.bookingServiceItem.deleteMany({ where: { bookingId: paramId(req) } });
    }

    return tx.booking.update({
      where: { id: paramId(req) },
      data: {
        ...rest,
        status: nextStatus,
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
  try {
    if (oldBooking?.status !== 'CONFIRMED' && booking.status === 'CONFIRMED') {
      invoice = await handleBookingConfirmed(booking.id, req.user!.id);
    } else if (booking.status === 'CONFIRMED') {
      invoice = await resyncConfirmedBooking(booking.id);
    } else if (
      booking.status === 'DRAFT' ||
      booking.status === 'PENDING' ||
      (oldBooking?.status !== booking.status && booking.status !== 'REQUEST_CONFIRMATION' && booking.status !== 'CANCELLED')
    ) {
      invoice = await handleBookingDraft(booking.id);
    }

    if (
      booking.status === 'REQUEST_CONFIRMATION' &&
      oldBooking?.status !== 'REQUEST_CONFIRMATION'
    ) {
      if (!invoice) invoice = await handleBookingDraft(booking.id);
      await submitConfirmationRequest(
        booking.id,
        req.user!.id,
        `${req.user!.firstName} ${req.user!.lastName}`
      );
    }
  } catch (err) {
    await prisma.booking.update({ where: { id: booking.id }, data: { status: oldBooking?.status || 'DRAFT' } });
    const message = err instanceof Error ? err.message : 'Failed to update booking';
    return res.status(500).json({ success: false, error: message });
  }

  return res.json({ success: true, data: booking, invoice });
}

export async function updateBookingPricing(req: AuthRequest, res: Response) {
  const booking = await prisma.booking.findUnique({
    where: { id: paramId(req) },
    include: { serviceItems: true },
  });

  if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

  if (!canUserModifyBooking(req.user?.role, booking.status)) {
    return res.status(403).json({
      success: false,
      error: 'Confirmed bookings cannot be modified. Contact Super Admin.',
    });
  }

  const { priceAdult, priceChild, priceInfant, serviceItems } = req.body;

  let totalAmount = Number(booking.totalAmount);

  await prisma.$transaction(async (tx) => {
    if (booking.priceMode === 'DETERMINED') {
      const adults = booking.adults;
      const children = booking.children;
      const infants = booking.infants;
      const pa = priceAdult != null ? Number(priceAdult) : Number(booking.priceAdult);
      const pc = priceChild != null ? Number(priceChild) : Number(booking.priceChild);
      const pi = priceInfant != null ? Number(priceInfant) : Number(booking.priceInfant);
      totalAmount = adults * pa + children * pc + infants * pi;

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          priceAdult: pa,
          priceChild: pc,
          priceInfant: pi,
          totalAmount,
        },
      });
    } else if (serviceItems?.length) {
      await tx.bookingServiceItem.deleteMany({ where: { bookingId: booking.id } });

      const created = await Promise.all(
        serviceItems.map((item: {
          serviceType: string;
          description: string;
          amount: number;
          costAmount?: number;
          vendorId?: string;
          details?: Record<string, unknown>;
        }) =>
          tx.bookingServiceItem.create({
            data: {
              bookingId: booking.id,
              serviceType: item.serviceType as 'TICKET' | 'VISA' | 'HOTEL' | 'TRANSPORT' | 'PACKAGE',
              description: item.description,
              amount: item.amount,
              costAmount: item.costAmount || 0,
              vendorId: item.vendorId || null,
              details: item.details ? JSON.parse(JSON.stringify(item.details)) : undefined,
            },
          })
        )
      );

      totalAmount = created.reduce((sum, item) => sum + Number(item.amount), 0);
      await tx.booking.update({
        where: { id: booking.id },
        data: { totalAmount },
      });
    }
  }, TX_OPTS);

  const updated = await prisma.booking.findUnique({
    where: { id: booking.id },
    include: {
      customer: true,
      package: true,
      serviceItems: { include: { vendor: true } },
      vendorPostings: { include: { vendor: true } },
    },
  });

  await logActivity(req, 'UPDATE', 'Booking', booking.id, 'Pricing updated');

  let invoice = null;
  if (updated?.status === 'CONFIRMED') {
    try {
      invoice = await resyncConfirmedBooking(booking.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sync booking';
      return res.status(500).json({ success: false, error: `Pricing saved but sync failed: ${message}` });
    }
  }

  return res.json({
    success: true,
    data: enrichBooking(updated as Parameters<typeof enrichBooking>[0]),
    invoice,
  });
}

export async function confirmBookingVendorPosting(req: AuthRequest, res: Response) {
  if (!isSuperAdmin(req.user?.role)) {
    return res.status(403).json({ success: false, error: 'Only Super Admin can post directly' });
  }

  const bookingId = paramId(req);
  const postingId = paramId(req, 'postingId');

  const posting = await prisma.vendorPosting.findUnique({ where: { id: postingId } });
  if (!posting || posting.bookingId !== bookingId) {
    return res.status(404).json({ success: false, error: 'Vendor posting not found for this booking' });
  }

  const { actualCost } = req.body;

  try {
    const updated = await postVendorCostToLedger(
      postingId,
      actualCost != null ? Number(actualCost) : undefined
    );
    await logActivity(req, 'UPDATE', 'VendorPosting', postingId, 'Direct post from booking');
    return res.json({ success: true, data: updated, message: 'Vendor cost posted to ledger' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to post vendor cost';
    return res.status(400).json({ success: false, error: message });
  }
}

export async function deleteBooking(req: AuthRequest, res: Response) {
  const booking = await prisma.booking.findUnique({ where: { id: paramId(req) } });
  if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

  if (!canUserModifyBooking(req.user?.role, booking.status)) {
    return res.status(403).json({
      success: false,
      error: 'Confirmed bookings cannot be modified. Contact Super Admin.',
    });
  }

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
