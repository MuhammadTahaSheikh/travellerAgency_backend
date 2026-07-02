import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination } from '../utils/helpers';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';
import { generateVoucherFromPayment, renderVoucherHtml, markVoucherShared } from '../services/voucherService';
import { ensureVoucherShareToken } from '../services/shareTokenService';

export async function getVouchers(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);

  const [vouchers, total] = await Promise.all([
    prisma.voucher.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        booking: { include: { customer: true } },
        payment: true,
        invoice: { select: { id: true, invoiceNumber: true } },
      },
    }),
    prisma.voucher.count(),
  ]);

  return res.json({ success: true, data: vouchers, pagination: formatPagination(total, page, limit) });
}

export async function getVoucher(req: AuthRequest, res: Response) {
  const voucher = await prisma.voucher.findUnique({
    where: { id: paramId(req) },
    include: { booking: { include: { customer: true } }, payment: true },
  });

  if (!voucher) return res.status(404).json({ success: false, error: 'Voucher not found' });
  return res.json({ success: true, data: voucher });
}

export async function createVoucher(req: AuthRequest, res: Response) {
  const { paymentId } = req.body;

  if (!paymentId) {
    return res.status(400).json({ success: false, error: 'Payment ID is required' });
  }

  try {
    const vouchers = await generateVoucherFromPayment(paymentId);
    const first = vouchers[0];
    if (first) await logActivity(req, 'CREATE', 'Voucher', first.id);
    return res.status(201).json({ success: true, data: vouchers });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create voucher';
    return res.status(400).json({ success: false, error: message });
  }
}

export async function getVoucherShareLink(req: AuthRequest, res: Response) {
  const voucher = await prisma.voucher.findUnique({ where: { id: paramId(req) } });
  if (!voucher) return res.status(404).json({ success: false, error: 'Voucher not found' });

  const shareToken = await ensureVoucherShareToken(voucher.id);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return res.json({
    success: true,
    data: {
      shareToken,
      url: `${baseUrl}/api/public/vouchers/${shareToken}`,
    },
  });
}

export async function getVoucherHtml(req: AuthRequest, res: Response) {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const html = await renderVoucherHtml(paramId(req), undefined, baseUrl);
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Voucher not found';
    return res.status(404).json({ success: false, error: message });
  }
}

export async function shareVoucher(req: AuthRequest, res: Response) {
  const voucher = await markVoucherShared(paramId(req));
  await logActivity(req, 'UPDATE', 'Voucher', voucher.id, 'Marked as shared');
  return res.json({ success: true, data: voucher, message: 'Voucher marked as shared' });
}
