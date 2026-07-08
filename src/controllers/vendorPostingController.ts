import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';
import { createVendorPosting, postVendorCostToLedger, getPendingVendorCosts, resyncUnpostedAccrualForPosting } from '../services/vendorPostingService';

export async function getVendorPostings(req: AuthRequest, res: Response) {
  const status = req.query.status as string;
  const where = status ? { status: status as 'UNASSIGNED' | 'PENDING' | 'POSTED' | 'CANCELLED' } : {};

  const postings = await prisma.vendorPosting.findMany({
    where,
    include: {
      vendor: true,
      invoice: { include: { customer: true } },
      invoiceItem: true,
      booking: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json({ success: true, data: postings });
}

export async function createVendorPostingHandler(req: AuthRequest, res: Response) {
  const {
    invoiceId,
    bookingId,
    invoiceItemId,
    vendorId,
    serviceType,
    description,
    expectedCost,
    currency,
    exchangeRate,
    postingType,
    dueDate,
  } = req.body;

  if (!serviceType || !description || expectedCost == null) {
    return res.status(400).json({ success: false, error: 'Service type, description, and expected cost are required' });
  }

  const posting = await createVendorPosting({
    invoiceId,
    bookingId,
    invoiceItemId,
    vendorId,
    serviceType,
    description,
    expectedCost: Number(expectedCost),
    currency,
    exchangeRate: exchangeRate ? Number(exchangeRate) : undefined,
    postingType: postingType || 'PENDING',
    dueDate: dueDate ? new Date(dueDate) : undefined,
  });

  await logActivity(req, 'CREATE', 'VendorPosting', posting.id);
  return res.status(201).json({ success: true, data: posting });
}

export async function updateVendorPosting(req: AuthRequest, res: Response) {
  const posting = await prisma.vendorPosting.findUnique({ where: { id: paramId(req) } });
  if (!posting) return res.status(404).json({ success: false, error: 'Vendor posting not found' });
  if (posting.status === 'POSTED') {
    return res.status(400).json({ success: false, error: 'Cannot edit posted vendor cost' });
  }

  const { vendorId, expectedCost, dueDate, description } = req.body;
  const isRegularUser = req.user?.role === 'USER';
  if (isRegularUser && expectedCost != null && Number(expectedCost) !== Number(posting.expectedCost)) {
    return res.status(403).json({ success: false, error: 'You can only assign vendors, not change expected cost' });
  }
  if (isRegularUser && description != null && description !== posting.description) {
    return res.status(403).json({ success: false, error: 'You can only assign vendors on this posting' });
  }

  const resolvedVendorId = vendorId ?? posting.vendorId;
  const nextExpectedCost = expectedCost != null ? Number(expectedCost) : Number(posting.expectedCost);
  const updated = await prisma.vendorPosting.update({
    where: { id: posting.id },
    data: {
      vendorId: resolvedVendorId,
      expectedCost: nextExpectedCost,
      dueDate: dueDate ? new Date(dueDate) : posting.dueDate,
      description: description ?? posting.description,
      ...(posting.status === 'UNASSIGNED' && resolvedVendorId ? { status: 'PENDING' } : {}),
    },
    include: { vendor: true, invoice: true },
  });

  if (nextExpectedCost !== Number(posting.expectedCost) && posting.unpostedJournalEntryId) {
    await resyncUnpostedAccrualForPosting(posting.id);
  }

  const refreshed = await prisma.vendorPosting.findUnique({
    where: { id: posting.id },
    include: { vendor: true, invoice: true },
  });

  await logActivity(req, 'UPDATE', 'VendorPosting', posting.id);
  return res.json({ success: true, data: refreshed ?? updated });
}

export async function confirmVendorPosting(req: AuthRequest, res: Response) {
  const { actualCost } = req.body;
  try {
    const updated = await postVendorCostToLedger(paramId(req), actualCost != null ? Number(actualCost) : undefined);
    await logActivity(req, 'UPDATE', 'VendorPosting', paramId(req), 'Posted to vendor ledger');
    return res.json({ success: true, data: updated, message: 'Vendor cost posted to ledger' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to post vendor cost';
    return res.status(400).json({ success: false, error: message });
  }
}

export async function getPendingCostsSummary(_req: AuthRequest, res: Response) {
  const data = await getPendingVendorCosts();
  return res.json({ success: true, data });
}
