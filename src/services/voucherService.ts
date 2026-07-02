import prisma from '../config/database';
import { voucherNumberFromLinkedDocument } from './numberingService';
import { VoucherFormat } from '@prisma/client';
import { issuerFromCustomer, logoHtml, BRAND_NAME } from './documentBrand';

function paymentStatusLabel(invoice: { totalAmount: unknown; paidAmount: unknown } | null | undefined) {
  if (!invoice) return 'PAID';
  const total = Number(invoice.totalAmount);
  const paid = Number(invoice.paidAmount);
  if (paid >= total) return 'FULLY_PAID';
  if (paid > 0) return 'PARTIALLY_PAID';
  return 'UNPAID';
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
    const hasHotel = invoice.items.some((i) => i.serviceType === 'HOTEL');
    const hasTransport = invoice.items.some((i) => i.serviceType === 'TRANSPORT');
    if (format === 'HOTEL' && !hasHotel) continue;
    if (format === 'TRANSPORT' && !hasTransport) continue;

    const existing = await prisma.voucher.findFirst({
      where: { invoiceId, voucherFormat: format },
    });
    if (existing) {
      vouchers.push(existing);
      continue;
    }

    const hotelItem = invoice.items.find((i) => i.serviceType === 'HOTEL');
    const transportItem = invoice.items.find((i) => i.serviceType === 'TRANSPORT');
    const hotelDetails = (hotelItem?.details as Record<string, string> | null) || {};
    const transportDetails = (transportItem?.details as Record<string, string> | null) || {};

    const voucherNumber = await voucherNumberFromLinkedDocument(
      invoice.booking?.bookingNumber,
      invoice.invoiceNumber
    );

    const voucher = await prisma.voucher.create({
      data: {
        voucherNumber,
        invoiceId,
        bookingId: invoice.bookingId,
        paymentId: payment?.id,
        voucherFormat: format,
        hotelName: hotelItem ? hotelDetails.hotelName || hotelItem.description : null,
        checkInDate: hotelDetails.checkInDate
          ? new Date(hotelDetails.checkInDate)
          : invoice.booking?.travelDate || undefined,
        checkOutDate: hotelDetails.checkOutDate ? new Date(hotelDetails.checkOutDate) : invoice.booking?.returnDate || undefined,
        guestName,
        roomDetails: hotelDetails.roomType || hotelDetails.roomDetails,
        transportDetails: transportItem
          ? {
              description: transportItem.description,
              pickupLocation: transportDetails.pickupLocation,
              dropoffLocation: transportDetails.dropoffLocation,
              transportDate: transportDetails.transportDate,
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
      booking: { include: { customer: true, serviceItems: true } },
      payment: true,
      invoice: { include: { customer: true, items: true } },
    },
  });

  if (!voucher) throw new Error('Voucher not found');

  const customer = voucher.invoice?.customer || voucher.booking?.customer;
  if (!customer) throw new Error('Customer not found');

  const issuer = issuerFromCustomer(customer);
  const fmt = format || voucher.voucherFormat;
  const brandLogo = issuer.isB2B ? '' : `<div style="margin-bottom:12px">${logoHtml(baseUrl)}</div>`;
  const transport = voucher.transportDetails as Record<string, string> | null;
  const remaining = Number(voucher.remainingBalance || 0);
  const payLabel =
    voucher.paymentStatus === 'PARTIALLY_PAID'
      ? 'Partially Paid'
      : voucher.paymentStatus === 'FULLY_PAID'
        ? 'Fully Paid'
        : voucher.paymentStatus || 'Paid';

  const servicesHtml =
    fmt === 'COMPLETE' && voucher.invoice?.items
      ? voucher.invoice.items
          .map(
            (i) =>
              `<tr><td>${i.serviceType || 'Service'}</td><td>${i.description}</td><td style="text-align:right">${Number(i.amount).toLocaleString()}</td></tr>`
          )
          .join('')
      : '';

  const title =
    fmt === 'TRANSPORT' ? 'TRANSPORT VOUCHER' : fmt === 'COMPLETE' ? 'COMPLETE TRAVEL VOUCHER' : 'HOTEL VOUCHER';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title} ${voucher.voucherNumber}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; color: #1e293b; border: 2px solid #0d9488; padding: 32px; }
  h1 { color: #0d9488; margin-bottom: 8px; }
  .badge { display: inline-block; background: #0d9488; color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; }
  .payment-banner { background: ${remaining > 0 ? '#fef3c7' : '#d1fae5'}; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-weight: bold; }
  .section { margin: 20px 0; padding: 16px; background: #f8fafc; border-radius: 8px; }
  .label { font-weight: bold; color: #64748b; font-size: 12px; text-transform: uppercase; }
  .value { font-size: 16px; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #e2e8f0; padding: 8px; }
</style></head><body>
${brandLogo}
<div class="payment-banner">${payLabel}${remaining > 0 ? ` — Remaining Balance: ${remaining.toLocaleString()} PKR` : ''}</div>
<h1>${title}</h1>
<p><span class="badge">${voucher.voucherNumber}</span>${issuer.tradePartnerId ? ` &nbsp; Trade Partner: ${issuer.tradePartnerId}` : ''}</p>
<div class="section">
  <div class="label">${issuer.isB2B ? 'Issued For (B2B Partner)' : 'Issued By'}</div>
  <div class="value"><strong>${issuer.name}</strong><br>${issuer.address}<br>${issuer.phone}${issuer.email ? ` | ${issuer.email}` : ''}${issuer.contact ? `<br>Contact: ${issuer.contact}` : ''}</div>
</div>
<div class="section">
  <div class="label">Guest / Client</div><div class="value">${voucher.guestName}</div>
</div>
${fmt !== 'TRANSPORT' && voucher.hotelName ? `<div class="section"><div class="label">Hotel</div><div class="value">${voucher.hotelName}</div></div>` : ''}
${fmt !== 'TRANSPORT' && voucher.checkInDate ? `<div class="section"><div class="label">Check-in</div><div class="value">${new Date(voucher.checkInDate).toLocaleDateString()}${voucher.checkOutDate ? ` — Check-out: ${new Date(voucher.checkOutDate).toLocaleDateString()}` : ''}</div></div>` : ''}
${fmt !== 'TRANSPORT' && voucher.roomDetails ? `<div class="section"><div class="label">Room Details</div><div class="value">${voucher.roomDetails}</div></div>` : ''}
${fmt !== 'HOTEL' && transport ? `<div class="section"><div class="label">Transport</div><div class="value">${transport.description || ''}<br>${transport.pickupLocation ? `Pickup: ${transport.pickupLocation}<br>` : ''}${transport.dropoffLocation ? `Drop-off: ${transport.dropoffLocation}<br>` : ''}${transport.transportDate ? `Date: ${transport.transportDate}` : ''}</div></div>` : ''}
${fmt === 'COMPLETE' && servicesHtml ? `<div class="section"><div class="label">Services</div><table><thead><tr><th>Type</th><th>Description</th><th>Amount</th></tr></thead><tbody>${servicesHtml}</tbody></table></div>` : ''}
${voucher.notes ? `<div class="section"><div class="label">Notes</div><div class="value">${voucher.notes}</div></div>` : ''}
<p style="margin-top:32px;color:#64748b;font-size:13px">${issuer.isB2B ? issuer.name : BRAND_NAME} | ${voucher.issuedAt ? new Date(voucher.issuedAt).toLocaleString() : ''}</p>
</body></html>`;
}

export async function markVoucherShared(voucherId: string) {
  return prisma.voucher.update({
    where: { id: voucherId },
    data: { status: 'SHARED', sharedAt: new Date() },
    include: { booking: { include: { customer: true } }, payment: true, invoice: { include: { customer: true } } },
  });
}
