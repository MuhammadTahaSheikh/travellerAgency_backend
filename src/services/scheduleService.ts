import prisma from '../config/database';
import { Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

export async function createSchedulesFromInvoice(invoiceId: string, tx?: TxClient) {
  const client = tx || prisma;
  const invoice = await client.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: true,
      items: true,
      booking: { include: { serviceItems: true } },
      vendorPostings: true,
    },
  });

  if (!invoice) return [];
  if (!['PARTIAL', 'PAID'].includes(invoice.status)) return [];

  const guestName = `${invoice.customer.firstName} ${invoice.customer.lastName}`;
  const records = [];

  for (const item of invoice.items) {
    const details = (item.details as Record<string, string> | null) || {};
    const vendorPosted = invoice.vendorPostings.some(
      (p) => p.invoiceItemId === item.id && p.status === 'POSTED'
    );

    if (item.serviceType === 'HOTEL') {
      const checkInDate = details.checkInDate ? new Date(details.checkInDate) : invoice.issueDate;
      const existing = await client.checkInRecord.findFirst({
        where: { invoiceId, scheduleType: 'HOTEL', hotelName: details.hotelName || item.description },
      });
      if (!existing) {
        records.push(
          await client.checkInRecord.create({
            data: {
              invoiceId,
              bookingId: invoice.bookingId,
              scheduleType: 'HOTEL',
              hotelName: details.hotelName || item.description,
              checkInDate,
              guestName,
              roomDetails: details.roomType || details.roomDetails,
              vendorPosted,
            },
          })
        );
      }
    }

    if (item.serviceType === 'TRANSPORT') {
      const transportDate = details.transportDate ? new Date(details.transportDate) : invoice.issueDate;
      const existing = await client.checkInRecord.findFirst({
        where: { invoiceId, scheduleType: 'TRANSPORT' },
      });
      if (!existing) {
        records.push(
          await client.checkInRecord.create({
            data: {
              invoiceId,
              bookingId: invoice.bookingId,
              scheduleType: 'TRANSPORT',
              transportDate,
              pickupLocation: details.pickupLocation,
              dropoffLocation: details.dropoffLocation,
              guestName,
              vendorPosted,
            },
          })
        );
      }
    }
  }

  return records;
}
