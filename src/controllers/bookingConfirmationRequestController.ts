import { Response } from 'express';
import prisma, { TX_OPTS } from '../config/database';
import { AuthRequest } from '../types';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';
import { createNotification, createBookingConfirmation } from '../services/notificationService';
import {
  createCheckInsFromBooking,
  syncBookingInvoiceAndLedger,
} from '../services/invoiceService';

export async function getPendingBookingConfirmationRequests(_req: AuthRequest, res: Response) {
  const requests = await prisma.bookingConfirmationRequest.findMany({
    where: { status: 'PENDING' },
    include: {
      booking: { include: { customer: true, serviceItems: true, invoices: true } },
      requestedBy: { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json({ success: true, data: requests });
}

export async function createBookingConfirmationRequest(req: AuthRequest, res: Response) {
  const { bookingId } = req.body;

  if (!bookingId) {
    return res.status(400).json({ success: false, error: 'Booking ID is required' });
  }

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

  if (booking.status === 'CONFIRMED') {
    return res.status(400).json({ success: false, error: 'Booking is already confirmed' });
  }

  if (booking.status === 'CANCELLED') {
    return res.status(400).json({ success: false, error: 'Cannot request confirmation for a cancelled booking' });
  }

  const existing = await prisma.bookingConfirmationRequest.findFirst({
    where: { bookingId, status: 'PENDING' },
  });

  if (existing) {
    return res.status(400).json({ success: false, error: 'A confirmation request is already pending for this booking' });
  }

  const request = await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: 'REQUEST_CONFIRMATION' },
    });

    return tx.bookingConfirmationRequest.create({
      data: {
        bookingId,
        requestedById: req.user!.id,
      },
      include: {
        booking: { include: { customer: true } },
        requestedBy: { select: { firstName: true, lastName: true } },
      },
    });
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
        `${req.user!.firstName} ${req.user!.lastName} requested confirmation for booking ${booking.bookingNumber}`,
        '/approvals?tab=booking'
      )
    )
  );

  await logActivity(req, 'CREATE', 'BookingConfirmationRequest', request.id);
  return res.status(201).json({
    success: true,
    data: request,
    message: 'Confirmation request sent to Super Admin for approval',
  });
}

export async function approveBookingConfirmationRequest(req: AuthRequest, res: Response) {
  const request = await prisma.bookingConfirmationRequest.findUnique({
    where: { id: paramId(req) },
    include: { booking: true },
  });

  if (!request) return res.status(404).json({ success: false, error: 'Confirmation request not found' });
  if (request.status !== 'PENDING') {
    return res.status(400).json({ success: false, error: 'Confirmation request is no longer pending' });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: request.bookingId },
        data: { status: 'CONFIRMED' },
      });
      await tx.bookingConfirmationRequest.update({
        where: { id: request.id },
        data: {
          status: 'APPROVED',
          reviewedById: req.user!.id,
          reviewedAt: new Date(),
        },
      });
    }, TX_OPTS);

    await createBookingConfirmation(req.user!.id, request.booking.bookingNumber);

    const syncedInvoice = await prisma.$transaction(async (tx) => {
      return syncBookingInvoiceAndLedger(request.bookingId, tx);
    }, TX_OPTS);

    await createCheckInsFromBooking(request.bookingId);

    const updated = await prisma.bookingConfirmationRequest.findUnique({
      where: { id: request.id },
      include: {
        booking: { include: { customer: true, serviceItems: true } },
        requestedBy: { select: { firstName: true, lastName: true } },
      },
    });

    const fullInvoice = syncedInvoice
      ? await prisma.invoice.findUnique({
          where: { id: syncedInvoice.id },
          include: { customer: true, booking: true, items: true },
        })
      : null;

    await logActivity(req, 'UPDATE', 'BookingConfirmationRequest', request.id, 'Approved and confirmed');
    return res.json({
      success: true,
      data: updated,
      invoice: fullInvoice,
      message: 'Booking confirmed and synced to ledger',
    });
  } catch (err) {
    await prisma.booking.update({
      where: { id: request.bookingId },
      data: { status: 'REQUEST_CONFIRMATION' },
    });
    await prisma.bookingConfirmationRequest.update({
      where: { id: request.id },
      data: { status: 'PENDING', reviewedById: null, reviewedAt: null },
    });
    const message = err instanceof Error ? err.message : 'Failed to confirm booking';
    return res.status(500).json({ success: false, error: message });
  }
}

export async function rejectBookingConfirmationRequest(req: AuthRequest, res: Response) {
  const request = await prisma.bookingConfirmationRequest.findUnique({
    where: { id: paramId(req) },
    include: { booking: true },
  });

  if (!request) return res.status(404).json({ success: false, error: 'Confirmation request not found' });
  if (request.status !== 'PENDING') {
    return res.status(400).json({ success: false, error: 'Confirmation request is no longer pending' });
  }

  const { reason } = req.body;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: request.bookingId },
      data: { status: 'DRAFT' },
    });

    return tx.bookingConfirmationRequest.update({
      where: { id: request.id },
      data: {
        status: 'REJECTED',
        reviewedById: req.user!.id,
        reviewedAt: new Date(),
        rejectionReason: reason || null,
      },
    });
  });

  await logActivity(req, 'UPDATE', 'BookingConfirmationRequest', request.id, 'Rejected');
  return res.json({ success: true, data: updated, message: 'Confirmation request rejected' });
}
