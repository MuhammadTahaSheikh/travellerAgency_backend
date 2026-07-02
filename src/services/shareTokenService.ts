import { randomUUID } from 'crypto';
import prisma from '../config/database';

export async function ensureInvoiceShareToken(invoiceId: string): Promise<string> {
  const existing = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { shareToken: true },
  });
  if (existing?.shareToken) return existing.shareToken;

  const shareToken = randomUUID();
  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: { shareToken },
    select: { shareToken: true },
  });
  if (!updated.shareToken) throw new Error('Failed to create invoice share link');
  return updated.shareToken;
}

export async function ensureVoucherShareToken(voucherId: string): Promise<string> {
  const existing = await prisma.voucher.findUnique({
    where: { id: voucherId },
    select: { shareToken: true },
  });
  if (existing?.shareToken) return existing.shareToken;

  const shareToken = randomUUID();
  const updated = await prisma.voucher.update({
    where: { id: voucherId },
    data: { shareToken },
    select: { shareToken: true },
  });
  if (!updated.shareToken) throw new Error('Failed to create voucher share link');
  return updated.shareToken;
}
