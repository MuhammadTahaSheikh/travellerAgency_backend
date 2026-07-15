import prisma from '../config/database';
import { voucherNumberFromLinkedDocument } from './numberingService';
import { VoucherFormat } from '@prisma/client';
import { renderVoucherPatternHtml } from './voucherPatternTemplate';

function paymentStatusLabel(invoice: { totalAmount: unknown; paidAmount: unknown } | null | undefined) {
  if (!invoice) return 'PAID';
  const total = Number(invoice.totalAmount);
  const paid = Number(invoice.paidAmount);
  if (paid >= total) return 'FULLY_PAID';
  if (paid > 0) return 'PARTIALLY_PAID';
  return 'UNPAID';
}

function voucherNumberForFormat(baseNumber: string, format: VoucherFormat): string {
  if (format === 'COMPLETE') return baseNumber;
  return `${baseNumber}-${format}`;
}

function invoiceHasService(
  invoice: { items: { serviceType?: string | null }[]; booking?: { serviceItems: { serviceType: string }[] } | null },
  type: 'HOTEL' | 'TRANSPORT'
) {
  if (invoice.items.some((i) => i.serviceType === type)) return true;
  return invoice.booking?.serviceItems.some((i) => i.serviceType === type) ?? false;
}

function firstHotelDetails(invoice: {
  items: { serviceType?: string | null; description: string; details?: unknown }[];
  booking?: { serviceItems: { serviceType: string; description: string; details?: unknown }[] } | null;
}) {
  const item =
    invoice.items.find((i) => i.serviceType === 'HOTEL') ||
    invoice.booking?.serviceItems.find((i) => i.serviceType === 'HOTEL');
  if (!item) return {};
  const details = (item.details as Record<string, unknown> | null) || {};
  const rows = Array.isArray(details.rows) ? (details.rows as Record<string, string>[]) : [];
  const row = rows[0] || (details as Record<string, string>);
  return { item, details, row };
}

function firstTransportDetails(invoice: {
  items: { serviceType?: string | null; description: string; details?: unknown }[];
  booking?: { serviceItems: { serviceType: string; description: string; details?: unknown }[] } | null;
}) {
  const item =
    invoice.items.find((i) => i.serviceType === 'TRANSPORT') ||
    invoice.booking?.serviceItems.find((i) => i.serviceType === 'TRANSPORT');
  if (!item) return {};
  const details = (item.details as Record<string, string> | null) || {};
  const rows = Array.isArray((item.details as Record<string, unknown>)?.rows)
    ? ((item.details as Record<string, unknown>).rows as Record<string, string>[])
    : [];
  const row = rows[0] || details;
  return { item, details, row };
}

export async function generateVouchersForApprovedInvoice(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId, approvalStatus: 'APPROVED' },
    include: {
      customer: true,
      items: true,
      payments: { where: { verificationStatus: 'VERIFIED' }, orderBy: { paymentDate: 'desc' }, take: 1 },
      booking: { include: { serviceItems: true, customer: true } },
    },
  });

  if (!invoice) throw new Error('Approved invoice not found');

  const payment = invoice.payments[0];
  const guestName =
    invoice.customer.customerType === 'B2B' && invoice.customer.companyName
      ? invoice.customer.companyName
      : `${invoice.customer.firstName} ${invoice.customer.lastName}`;

  const remaining = Number(invoice.totalAmount) - Number(invoice.paidAmount);
  const payStatus = paymentStatusLabel(invoice);
  const formats: VoucherFormat[] = ['COMPLETE', 'HOTEL', 'TRANSPORT'];
  const vouchers = [];

  for (const format of formats) {
    const hasHotel = invoiceHasService(invoice, 'HOTEL');
    const hasTransport = invoiceHasService(invoice, 'TRANSPORT');
    if (format === 'HOTEL' && !hasHotel) continue;
    if (format === 'TRANSPORT' && !hasTransport) continue;

    const existing = await prisma.voucher.findFirst({
      where: { invoiceId, voucherFormat: format },
    });
    if (existing) {
      vouchers.push(existing);
      continue;
    }

    const { item: hotelItem, row: hotelRow, details: hotelDetailsRaw } = firstHotelDetails(invoice);
    const { item: transportItem, row: transportRow, details: transportDetailsRaw } = firstTransportDetails(invoice);
    const hotelDetails = { ...(hotelDetailsRaw as Record<string, string>), ...hotelRow };
    const transportDetails = { ...transportDetailsRaw, ...transportRow };

    const baseVoucherNumber = await voucherNumberFromLinkedDocument(
      invoice.booking?.bookingNumber,
      invoice.invoiceNumber
    );
    const voucherNumber = voucherNumberForFormat(baseVoucherNumber, format);

    const voucher = await prisma.voucher.create({
      data: {
        voucherNumber,
        invoiceId,
        bookingId: invoice.bookingId,
        paymentId: payment?.id,
        voucherFormat: format,
        hotelName: hotelItem ? hotelRow?.hotelName || hotelDetails.hotelName || hotelItem.description : null,
        checkInDate: hotelRow?.checkInDate || hotelDetails.checkInDate
          ? new Date(hotelRow?.checkInDate || hotelDetails.checkInDate)
          : invoice.booking?.travelDate || undefined,
        checkOutDate: hotelRow?.checkOutDate || hotelDetails.checkOutDate
          ? new Date(hotelRow?.checkOutDate || hotelDetails.checkOutDate)
          : invoice.booking?.returnDate || undefined,
        guestName,
        roomDetails: hotelRow?.roomType || hotelDetails.roomType || hotelDetails.roomDetails,
        transportDetails: transportItem
          ? {
              description: transportItem.description,
              pickupLocation: transportRow?.sector?.split(/\s*[-–>]\s*/)[0] || transportDetails.pickupLocation,
              dropoffLocation: transportRow?.sector?.split(/\s*[-–>]\s*/)[1] || transportDetails.dropoffLocation,
              transportDate: transportRow?.date || transportDetails.transportDate,
            }
          : undefined,
        paymentStatus: payStatus,
        remainingBalance: remaining > 0 ? remaining : 0,
        status: 'ISSUED',
        issuedAt: new Date(),
      },
      include: { booking: { include: { customer: true } }, payment: true, invoice: { include: { customer: true, items: true } } },
    });
    vouchers.push(voucher);
  }

  return vouchers;
}

/** Creates missing HOTEL / TRANSPORT vouchers for already-approved invoices (one-time backfill). */
export async function syncMissingVouchersForApprovedInvoices() {
  const invoices = await prisma.invoice.findMany({
    where: { approvalStatus: 'APPROVED' },
    select: { id: true },
  });
  for (const inv of invoices) {
    try {
      await generateVouchersForApprovedInvoice(inv.id);
    } catch (err) {
      console.warn(`syncMissingVouchers: invoice ${inv.id}`, err);
    }
  }
}

export async function generateVoucherFromPayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { invoice: true },
  });
  if (!payment?.invoiceId) throw new Error('Payment must be linked to an invoice');
  return generateVouchersForApprovedInvoice(payment.invoiceId);
}

export async function renderVoucherHtml(voucherId: string, format?: VoucherFormat, baseUrl?: string) {
  const voucher = await prisma.voucher.findUnique({
    where: { id: voucherId },
    include: {
      booking: {
        include: {
          customer: true,
          createdBy: { select: { id: true, firstName: true, lastName: true, phone: true } },
          serviceItems: { include: { vendor: { select: { vendorCode: true } } } },
        },
      },
      payment: true,
      invoice: { include: { customer: true, items: true } },
    },
  });

  if (!voucher) throw new Error('Voucher not found');
  const fmt = format || voucher.voucherFormat;
  return renderVoucherPatternHtml(voucher, fmt);
}

export async function markVoucherShared(voucherId: string) {
  return prisma.voucher.update({
    where: { id: voucherId },
    data: { status: 'SHARED', sharedAt: new Date() },
    include: { booking: { include: { customer: true } }, payment: true, invoice: { include: { customer: true } } },
  });
}
