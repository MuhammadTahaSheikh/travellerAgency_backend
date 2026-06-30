import { Response } from 'express';
import prisma, { TX_OPTS } from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination, generateNumber, applyDateFilter, serializeForDeletedRecord } from '../utils/helpers';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';
import { createPaymentReminder } from '../services/notificationService';
import { confirmInvoice, renderInvoiceHtml } from '../services/invoiceService';
import { createVendorPosting } from '../services/vendorPostingService';

async function getInvoicePrefix() {
  const setting = await prisma.setting.findUnique({ where: { key: 'invoice_prefix' } });
  return setting?.value || 'INV';
}

export async function getInvoices(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const status = req.query.status as string;
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  applyDateFilter(where, 'issueDate', startDate, endDate);

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: true,
        booking: { include: { package: true } },
        payments: true,
        items: true,
      },
    }),
    prisma.invoice.count({ where }),
  ]);

  return res.json({ success: true, data: invoices, pagination: formatPagination(total, page, limit) });
}

export async function getInvoice(req: AuthRequest, res: Response) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: paramId(req) },
    include: {
      customer: true,
      booking: { include: { package: true, serviceItems: true } },
      payments: { include: { recordedBy: { select: { firstName: true, lastName: true } } } },
      items: true,
    },
  });

  if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });
  return res.json({ success: true, data: invoice });
}

export async function createInvoice(req: AuthRequest, res: Response) {
  const { bookingId, customerId, subtotal, tax, discount, dueDate, notes, items } = req.body;

  if (!customerId || !subtotal || !dueDate) {
    return res.status(400).json({ success: false, error: 'Customer, subtotal, and due date are required' });
  }

  const totalAmount = Number(subtotal) + Number(tax || 0) - Number(discount || 0);
  const prefix = await getInvoicePrefix();

  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        invoiceNumber: generateNumber(prefix),
        bookingId,
        customerId,
        subtotal,
        tax: tax || 0,
        discount: discount || 0,
        totalAmount,
        dueDate: new Date(dueDate),
        notes,
        status: 'SENT',
        items: items?.length
          ? {
              create: items.map((i: {
                description: string;
                quantity?: number;
                unitPrice: number;
                amount: number;
                serviceType?: string;
                costAmount?: number;
                vendorId?: string;
                details?: Record<string, string>;
                postingType?: 'INSTANT' | 'PENDING';
                dueDate?: string;
              }) => ({
                description: i.description,
                quantity: i.quantity || 1,
                unitPrice: i.unitPrice,
                amount: i.amount,
                serviceType: i.serviceType,
                costAmount: i.costAmount || 0,
                vendorId: i.vendorId,
                details: i.details,
              })),
            }
          : undefined,
      },
      include: { customer: true, booking: true, items: true },
    });

    for (const item of created.items) {
      const cost = Number(item.costAmount);
      if (cost <= 0) continue;

      const sourceItem = items?.find((i: { description: string }) => i.description === item.description);
      const postingType = sourceItem?.postingType || (sourceItem?.vendorId ? 'INSTANT' : 'PENDING');

      await createVendorPosting(
        {
          invoiceId: created.id,
          bookingId: bookingId || undefined,
          invoiceItemId: item.id,
          vendorId: item.vendorId || sourceItem?.vendorId,
          serviceType: item.serviceType || 'HOTEL',
          description: item.description,
          expectedCost: cost,
          postingType,
          dueDate: sourceItem?.dueDate ? new Date(sourceItem.dueDate) : undefined,
        },
        tx
      );
    }

    return created;
  }, TX_OPTS);

  try {
    await confirmInvoice(invoice.id);
  } catch {
    // Already confirmed or ledger issue — invoice still created
  }

  await createPaymentReminder(req.user!.id, invoice.invoiceNumber, invoice.dueDate);
  await logActivity(req, 'CREATE', 'Invoice', invoice.id);

  const full = await prisma.invoice.findUnique({
    where: { id: invoice.id },
    include: { customer: true, booking: true, items: true, vendorPostings: { include: { vendor: true } } },
  });

  return res.status(201).json({ success: true, data: full });
}

export async function confirmInvoiceHandler(req: AuthRequest, res: Response) {
  try {
    const invoice = await confirmInvoice(paramId(req));
    await logActivity(req, 'UPDATE', 'Invoice', invoice.id, 'Confirmed - ledger debited');
    return res.json({ success: true, data: invoice, message: 'Invoice confirmed and customer account debited' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to confirm invoice';
    return res.status(400).json({ success: false, error: message });
  }
}

export async function getInvoiceHtml(req: AuthRequest, res: Response) {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const html = await renderInvoiceHtml(paramId(req), baseUrl);
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invoice not found';
    return res.status(404).json({ success: false, error: message });
  }
}

export async function updateInvoice(req: AuthRequest, res: Response) {
  const { customerId, subtotal, tax, discount, dueDate, notes, status, items } = req.body;

  const subtotalNum = Number(subtotal);
  const taxNum = Number(tax || 0);
  const discountNum = Number(discount || 0);
  const totalAmount = subtotalNum + taxNum - discountNum;

  const data: Record<string, unknown> = {
    customerId,
    subtotal: subtotalNum,
    tax: taxNum,
    discount: discountNum,
    totalAmount,
    dueDate: dueDate ? new Date(dueDate) : undefined,
    notes,
    status,
  };

  if (Array.isArray(items) && items.length > 0) {
    data.items = {
      deleteMany: {},
      create: items.map((i: {
        description: string;
        quantity?: number;
        unitPrice: number;
        amount: number;
        serviceType?: string;
        costAmount?: number;
        vendorId?: string;
        details?: Record<string, string>;
      }) => ({
        description: i.description,
        quantity: i.quantity || 1,
        unitPrice: i.unitPrice,
        amount: i.amount,
        serviceType: i.serviceType,
        costAmount: i.costAmount || 0,
        vendorId: i.vendorId || null,
        details: i.details,
      })),
    };
  }

  const invoice = await prisma.invoice.update({
    where: { id: paramId(req) },
    data,
    include: { customer: true, payments: true, items: true },
  });

  await logActivity(req, 'UPDATE', 'Invoice', invoice.id);
  return res.json({ success: true, data: invoice });
}

export async function deleteInvoice(req: AuthRequest, res: Response) {
  const invoice = await prisma.invoice.findUnique({ where: { id: paramId(req) } });
  if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });

  await prisma.deletedRecord.create({
    data: { entity: 'Invoice', entityId: invoice.id, data: serializeForDeletedRecord(invoice), deletedBy: req.user?.id },
  });

  await prisma.invoice.update({ where: { id: paramId(req) }, data: { status: 'CANCELLED' } });
  await logActivity(req, 'DELETE', 'Invoice', paramId(req));
  return res.json({ success: true, message: 'Invoice cancelled' });
}

export async function getOverdueInvoices(_req: AuthRequest, res: Response) {
  const invoices = await prisma.invoice.findMany({
    where: {
      dueDate: { lt: new Date() },
      status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] },
    },
    include: { customer: true },
    orderBy: { dueDate: 'asc' },
  });
  return res.json({ success: true, data: invoices });
}

export async function getInvoiceTemplates(_req: AuthRequest, res: Response) {
  const templates = await prisma.invoiceTemplate.findMany({ orderBy: { name: 'asc' } });
  return res.json({ success: true, data: templates });
}

export async function updateInvoiceTemplate(req: AuthRequest, res: Response) {
  const { name, header, footer, terms, isDefault } = req.body;

  if (isDefault) {
    await prisma.invoiceTemplate.updateMany({ data: { isDefault: false } });
  }

  const template = await prisma.invoiceTemplate.upsert({
    where: { id: paramId(req) },
    update: { name, header, footer, terms, isDefault },
    create: { name: name || 'Default', header: header || '', footer: footer || '', terms, isDefault: isDefault ?? true },
  });

  return res.json({ success: true, data: template });
}
