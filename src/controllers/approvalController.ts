import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';
import { generateVouchersForApprovedInvoice } from '../services/voucherService';
import { createCheckInsFromBooking } from '../services/invoiceService';

export async function getPendingApprovals(_req: AuthRequest, res: Response) {
  const invoices = await prisma.invoice.findMany({
    where: {
      approvalStatus: 'PENDING',
      paidAmount: { gt: 0 },
      status: { in: ['PARTIAL', 'PAID', 'SENT'] },
    },
    include: {
      customer: true,
      items: true,
      payments: { where: { verificationStatus: 'VERIFIED' }, orderBy: { paymentDate: 'desc' } },
      vendorPostings: { include: { vendor: true } },
      booking: { include: { serviceItems: { include: { vendor: true } } } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const data = invoices.map((inv) => ({
    ...inv,
    remainingBalance: Number(inv.totalAmount) - Number(inv.paidAmount),
    totalCost: inv.items.reduce((s, i) => s + Number(i.costAmount), 0),
  }));

  return res.json({ success: true, data });
}

export async function getApprovalDetail(req: AuthRequest, res: Response) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: paramId(req) },
    include: {
      customer: true,
      items: true,
      payments: { include: { recordedBy: { select: { firstName: true, lastName: true } } } },
      vendorPostings: { include: { vendor: true, invoiceItem: true } },
      booking: { include: { serviceItems: { include: { vendor: true } }, vendorCosts: { include: { vendor: true } } } },
    },
  });

  if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });

  return res.json({
    success: true,
    data: {
      ...invoice,
      remainingBalance: Number(invoice.totalAmount) - Number(invoice.paidAmount),
      serviceBreakdown: invoice.items.map((item) => ({
        ...item,
        vendorPostings: invoice.vendorPostings.filter((p) => p.invoiceItemId === item.id),
      })),
    },
  });
}

export async function approveInvoice(req: AuthRequest, res: Response) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: paramId(req) },
    include: { customer: true, items: true },
  });

  if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });
  if (invoice.approvalStatus === 'APPROVED') {
    return res.status(400).json({ success: false, error: 'Invoice already approved' });
  }
  if (Number(invoice.paidAmount) <= 0) {
    return res.status(400).json({ success: false, error: 'No payment received yet' });
  }

  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      approvalStatus: 'APPROVED',
      approvedAt: new Date(),
      approvedById: req.user!.id,
    },
    include: { customer: true, items: true, payments: true },
  });

  let vouchers: Awaited<ReturnType<typeof generateVouchersForApprovedInvoice>> = [];
  try {
    vouchers = await generateVouchersForApprovedInvoice(invoice.id);
  } catch {
    // Voucher generation optional if no hotel/transport services
  }

  if (invoice.bookingId) {
    try {
      await createCheckInsFromBooking(invoice.bookingId);
    } catch {
      // Schedule sync should not block approval
    }
  }

  await logActivity(req, 'UPDATE', 'Invoice', invoice.id, 'Approved by super admin');
  return res.json({ success: true, data: updated, vouchers, message: 'Invoice approved' });
}

export async function rejectInvoice(req: AuthRequest, res: Response) {
  const { reason } = req.body;
  const invoice = await prisma.invoice.findUnique({ where: { id: paramId(req) } });
  if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });

  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      approvalStatus: 'REJECTED',
      notes: reason ? `${invoice.notes || ''}\nRejection: ${reason}`.trim() : invoice.notes,
    },
  });

  await logActivity(req, 'UPDATE', 'Invoice', invoice.id, `Rejected: ${reason || 'No reason'}`);
  return res.json({ success: true, data: updated, message: 'Invoice approval rejected' });
}
