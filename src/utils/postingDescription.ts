import { ServiceType } from '@prisma/client';

function formatShortDate(d: string): string {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

function nightsBetween(checkIn?: string, checkOut?: string): number {
  if (!checkIn || !checkOut) return 0;
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const diff = Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

function bookingRef(bookingNumber: string): string {
  return bookingNumber.replace(/^BK-/i, 'BK#');
}

/** Builds the detailed ledger / posting description format from booking + service data. */
export function buildDetailedPostingDescription(
  bookingNumber: string,
  customerName: string,
  serviceType: ServiceType,
  itemDescription: string,
  details: Record<string, unknown> = {},
  row?: Record<string, string>
): string {
  const bk = bookingRef(bookingNumber);
  const vendorRes = String(row?.vendorResNo || details.vendorResNo || 'Vendor Res#');
  const res = `(${vendorRes})`;

  if (serviceType === 'HOTEL' && row) {
    const nights = nightsBetween(row.checkInDate, row.checkOutDate);
    const ci = formatShortDate(row.checkInDate);
    const co = formatShortDate(row.checkOutDate);
    return `${bk}—${customerName}—${row.hotelName || ''}—${row.roomType || ''}—${nights}N—${ci}To${co}—${res}`;
  }

  if (serviceType === 'TRANSPORT' && row) {
    return `${bk}—${customerName}—Transport—${row.sector || ''}—${res}`;
  }

  if (serviceType === 'TICKET') {
    const sector = String(details.sector || row?.sector || '');
    const airline = String(details.airline || '');
    return `${bk}—${customerName}—Ticket—${sector}—${airline}—${res}`;
  }

  if (serviceType === 'VISA') {
    const country = String(details.country || details.visaType || '');
    return `${bk}—${customerName}—Visa—${country}—${res}`;
  }

  if (serviceType === 'OTHER') {
    return `${bk}—${customerName}—Other—${itemDescription}—${res}`;
  }

  return `${bk}—${customerName}—${itemDescription}—${res}`;
}
