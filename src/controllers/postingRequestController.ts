import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';
import { postVendorCostToLedger } from '../services/vendorPostingService';
import { createNotification } from '../services/notificationService';

export async function getPendingPostingRequests(_req: AuthRequest, res: Response) {
  const requests = await prisma.postingRequest.findMany({
    where: { status: 'PENDING' },
    include: {
      booking: { include: { customer: true } },
      vendorPosting: { include: { vendor: true } },
      requestedBy: { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json({ success: true, data: requests });
}

export async function createPostingRequest(req: AuthRequest, res: Response) {
  const { bookingId, vendorPostingId } = req.body;

  if (!bookingId || !vendorPostingId) {
    return res.status(400).json({ success: false, error: 'Booking ID and vendor posting ID are required' });
  }

  const posting = await prisma.vendorPosting.findUnique({
    where: { id: vendorPostingId },
    include: { booking: true },
  });

  if (!posting || posting.bookingId !== bookingId) {
    return res.status(404).json({ success: false, error: 'Vendor posting not found for this booking' });
  }

  if (posting.status === 'POSTED') {
    return res.status(400).json({ success: false, error: 'This vendor posting is already posted' });
  }

  if (!posting.vendorId) {
    return res.status(400).json({ success: false, error: 'Assign a vendor before requesting posting' });
  }

  const existing = await prisma.postingRequest.findFirst({
    where: { vendorPostingId, status: 'PENDING' },
  });

  if (existing) {
    return res.status(400).json({ success: false, error: 'A posting request is already pending for this item' });
  }

  const request = await prisma.postingRequest.create({
    data: {
      bookingId,
      vendorPostingId,
      requestedById: req.user!.id,
    },
    include: {
      booking: true,
      vendorPosting: { include: { vendor: true } },
      requestedBy: { select: { firstName: true, lastName: true } },
    },
  });

  const superAdmins = await prisma.user.findMany({
    where: { isActive: true, role: { name: 'SUPER_ADMIN' } },
    select: { id: true },
  });

  await Promise.all(
    superAdmins.map((admin) =>
      createNotification(
        admin.id,
        'POSTING_REQUEST',
        'Vendor Posting Request',
        `${req.user!.firstName} ${req.user!.lastName} requested posting for booking ${posting.booking?.bookingNumber || bookingId}`,
        '/approvals?tab=posting'
      )
    )
  );

  await logActivity(req, 'CREATE', 'PostingRequest', request.id);
  return res.status(201).json({ success: true, data: request, message: 'Posting request sent to Super Admin for approval' });
}

export async function approvePostingRequest(req: AuthRequest, res: Response) {
  const request = await prisma.postingRequest.findUnique({
    where: { id: paramId(req) },
    include: { vendorPosting: true, booking: true },
  });

  if (!request) return res.status(404).json({ success: false, error: 'Posting request not found' });
  if (request.status !== 'PENDING') {
    return res.status(400).json({ success: false, error: 'Posting request is no longer pending' });
  }

  const { actualCost } = req.body;

  try {
    await postVendorCostToLedger(
      request.vendorPostingId,
      actualCost != null ? Number(actualCost) : undefined
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to post vendor cost';
    return res.status(400).json({ success: false, error: message });
  }

  const updated = await prisma.postingRequest.update({
    where: { id: request.id },
    data: {
      status: 'APPROVED',
      reviewedById: req.user!.id,
      reviewedAt: new Date(),
    },
    include: {
      booking: true,
      vendorPosting: { include: { vendor: true } },
      requestedBy: { select: { firstName: true, lastName: true } },
    },
  });

  await logActivity(req, 'UPDATE', 'PostingRequest', request.id, 'Approved and posted');
  return res.json({ success: true, data: updated, message: 'Posting approved and posted to ledger' });
}

export async function rejectPostingRequest(req: AuthRequest, res: Response) {
  const request = await prisma.postingRequest.findUnique({ where: { id: paramId(req) } });

  if (!request) return res.status(404).json({ success: false, error: 'Posting request not found' });
  if (request.status !== 'PENDING') {
    return res.status(400).json({ success: false, error: 'Posting request is no longer pending' });
  }

  const { reason } = req.body;

  const updated = await prisma.postingRequest.update({
    where: { id: request.id },
    data: {
      status: 'REJECTED',
      reviewedById: req.user!.id,
      reviewedAt: new Date(),
      rejectionReason: reason || null,
    },
  });

  await logActivity(req, 'UPDATE', 'PostingRequest', request.id, 'Rejected');
  return res.json({ success: true, data: updated, message: 'Posting request rejected' });
}
