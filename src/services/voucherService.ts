import prisma from '../config/database';
import { generateNumber } from '../utils/helpers';

export async function generateVoucherFromPayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      invoice: {
        include: {
          booking: {
            include: {
              customer: true,
              serviceItems: true,
            },
          },
        },
      },
    },
  });

  if (!payment) throw new Error('Payment not found');
  if (payment.verificationStatus !== 'VERIFIED') {
    throw new Error('Payment must be verified before issuing voucher');
  }

  const booking = payment.invoice?.booking;
  if (!booking) throw new Error('Payment must be linked to a booking invoice');

  const existing = await prisma.voucher.findFirst({ where: { paymentId } });
  if (existing) return existing;

  const hotelItem = booking.serviceItems.find((i) => i.serviceType === 'HOTEL');
  const details = hotelItem?.details as Record<string, string> | null;
  const guestName = `${booking.customer.firstName} ${booking.customer.lastName}`;

  return prisma.voucher.create({
    data: {
      voucherNumber: generateNumber('VCH'),
      bookingId: booking.id,
      paymentId,
      hotelName: details?.hotelName || hotelItem?.description || 'Hotel Reservation',
      checkInDate: details?.checkInDate ? new Date(details.checkInDate) : booking.travelDate || new Date(),
      checkOutDate: details?.checkOutDate ? new Date(details.checkOutDate) : booking.returnDate || undefined,
      guestName,
      roomDetails: details?.roomType || details?.roomDetails || null,
      status: 'ISSUED',
      issuedAt: new Date(),
    },
    include: { booking: { include: { customer: true } }, payment: true },
  });
}

export async function renderVoucherHtml(voucherId: string) {
  const voucher = await prisma.voucher.findUnique({
    where: { id: voucherId },
    include: { booking: { include: { customer: true } }, payment: true },
  });

  if (!voucher) throw new Error('Voucher not found');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Hotel Voucher ${voucher.voucherNumber}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; color: #1e293b; border: 2px solid #0d9488; padding: 32px; }
  h1 { color: #0d9488; margin-bottom: 8px; }
  .badge { display: inline-block; background: #0d9488; color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; }
  .section { margin: 20px 0; padding: 16px; background: #f8fafc; border-radius: 8px; }
  .label { font-weight: bold; color: #64748b; font-size: 12px; text-transform: uppercase; }
  .value { font-size: 16px; margin-top: 4px; }
</style></head><body>
<h1>HOTEL VOUCHER</h1>
<p><span class="badge">${voucher.voucherNumber}</span> &nbsp; Status: ${voucher.status}</p>
<div class="section">
  <div class="label">Guest Name</div><div class="value">${voucher.guestName}</div>
</div>
<div class="section">
  <div class="label">Hotel</div><div class="value">${voucher.hotelName}</div>
</div>
<div class="section">
  <div class="label">Check-in Date</div><div class="value">${new Date(voucher.checkInDate).toLocaleDateString()}</div>
  ${voucher.checkOutDate ? `<div class="label" style="margin-top:12px">Check-out Date</div><div class="value">${new Date(voucher.checkOutDate).toLocaleDateString()}</div>` : ''}
</div>
${voucher.roomDetails ? `<div class="section"><div class="label">Room Details</div><div class="value">${voucher.roomDetails}</div></div>` : ''}
${voucher.notes ? `<div class="section"><div class="label">Notes</div><div class="value">${voucher.notes}</div></div>` : ''}
<p style="margin-top:32px;color:#64748b;font-size:13px">Issued by Moazin Travel Agency | ${voucher.issuedAt ? new Date(voucher.issuedAt).toLocaleString() : ''}</p>
</body></html>`;
}

export async function markVoucherShared(voucherId: string) {
  return prisma.voucher.update({
    where: { id: voucherId },
    data: { status: 'SHARED', sharedAt: new Date() },
  });
}
