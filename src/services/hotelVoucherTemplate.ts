import prisma from '../config/database';
import { logoHtml, BRAND_NAME } from './documentBrand';
import { escapeHtml } from '../utils/exportHelpers';

type HotelTableRow = {
  qty: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  confirmation: string;
  view: string;
  mealPlan: string;
  hotelName: string;
  vendorCode: string;
};

function formatDisplayDate(value?: string | Date | null): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function nightsBetween(checkIn?: string, checkOut?: string): number {
  if (!checkIn || !checkOut) return 0;
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const diff = Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

async function collectHotelRows(
  booking: {
    serviceItems?: Array<{
      serviceType: string;
      description: string;
      vendorId?: string | null;
      vendor?: { vendorCode?: string | null } | null;
      details?: unknown;
    }>;
  } | null | undefined,
  fallback: {
    hotelName?: string | null;
    checkInDate?: Date | null;
    checkOutDate?: Date | null;
    roomDetails?: string | null;
  }
): Promise<HotelTableRow[]> {
  const items = (booking?.serviceItems || []).filter((i) => i.serviceType === 'HOTEL');
  const rows: HotelTableRow[] = [];
  const vendorIds = new Set<string>();

  for (const item of items) {
    const details = (item.details as Record<string, unknown> | null) || {};
    const rowList = Array.isArray(details.rows) && details.rows.length > 0
      ? (details.rows as Record<string, string>[])
      : [details as Record<string, string>];

    for (const row of rowList) {
      const vendorId = row.vendorId || item.vendorId;
      if (vendorId) vendorIds.add(vendorId);
    }
  }

  const vendors = vendorIds.size
    ? await prisma.vendor.findMany({ where: { id: { in: [...vendorIds] } } })
    : [];
  const vendorMap = new Map(vendors.map((v) => [v.id, v]));

  for (const item of items) {
    const details = (item.details as Record<string, unknown> | null) || {};
    const rowList = Array.isArray(details.rows) && details.rows.length > 0
      ? (details.rows as Record<string, string>[])
      : [details as Record<string, string>];

    for (const row of rowList) {
      const vendorId = row.vendorId || item.vendorId;
      const vendor = vendorId ? vendorMap.get(vendorId) : item.vendor;
      const checkIn = row.checkInDate || '';
      const checkOut = row.checkOutDate || '';

      rows.push({
        qty: row.numRooms || '1',
        roomType: row.roomType || fallback.roomDetails || '',
        checkIn: formatDisplayDate(checkIn || fallback.checkInDate),
        checkOut: formatDisplayDate(checkOut || fallback.checkOutDate),
        nights: nightsBetween(checkIn, checkOut) || nightsBetween(
          fallback.checkInDate?.toISOString(),
          fallback.checkOutDate?.toISOString()
        ),
        confirmation: row.vendorResNo || String(details.vendorResNo || ''),
        view: row.view || 'Standard',
        mealPlan: row.mealPlan || 'RO',
        hotelName: row.hotelName || String(details.hotelName || fallback.hotelName || item.description || ''),
        vendorCode: vendor?.vendorCode || '',
      });
    }
  }

  if (rows.length === 0 && (fallback.hotelName || fallback.checkInDate)) {
    rows.push({
      qty: '1',
      roomType: fallback.roomDetails || '',
      checkIn: formatDisplayDate(fallback.checkInDate),
      checkOut: formatDisplayDate(fallback.checkOutDate),
      nights: nightsBetween(
        fallback.checkInDate?.toISOString(),
        fallback.checkOutDate?.toISOString()
      ),
      confirmation: '',
      view: 'Standard',
      mealPlan: 'RO',
      hotelName: fallback.hotelName || '',
      vendorCode: '',
    });
  }

  return rows;
}

export async function renderHotelDefiniteConfirmationHtml(
  voucher: {
    voucherNumber: string;
    guestName: string;
    hotelName?: string | null;
    checkInDate?: Date | null;
    checkOutDate?: Date | null;
    roomDetails?: string | null;
    issuedAt?: Date | null;
    booking?: {
      bookingNumber?: string;
      guestName?: string | null;
      adults?: number;
      children?: number;
      infants?: number;
      createdBy?: { firstName?: string; lastName?: string; phone?: string | null } | null;
      customer?: {
        customerType?: string;
        companyName?: string | null;
        contactPerson?: string | null;
        firstName?: string;
        lastName?: string;
      } | null;
      serviceItems?: Array<{
        serviceType: string;
        description: string;
        vendorId?: string | null;
        vendor?: { vendorCode?: string | null } | null;
        details?: unknown;
      }>;
    } | null;
  },
  baseUrl?: string
): Promise<string> {
  const booking = voucher.booking;
  const customer = booking?.customer;
  const isB2B = customer?.customerType === 'B2B' && !!customer.companyName;

  const hotelRows = await collectHotelRows(booking, {
    hotelName: voucher.hotelName,
    checkInDate: voucher.checkInDate,
    checkOutDate: voucher.checkOutDate,
    roomDetails: voucher.roomDetails,
  });

  const primaryHotel = hotelRows[0]?.hotelName || voucher.hotelName || '';
  const guestName = booking?.guestName
    || (customer && customer.customerType !== 'B2B'
      ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim()
      : voucher.guestName);

  const totalPax = (booking?.adults ?? 0) + (booking?.children ?? 0) + (booking?.infants ?? 0);
  const resNo = booking?.bookingNumber || voucher.voucherNumber;
  const printDate = formatDisplayDate(voucher.issuedAt || new Date());
  const docDate = formatDisplayDate(new Date());

  const toLine = isB2B ? customer!.companyName! : guestName;
  const attLine = isB2B
    ? (customer!.contactPerson || '')
    : '';

  const vendorCodes = [...new Set(hotelRows.map((r) => r.vendorCode).filter(Boolean))];
  const remarks = vendorCodes.join(', ');

  const tableBody = hotelRows.map((r) => `
    <tr>
      <td>${escapeHtml(r.qty)}</td>
      <td>${escapeHtml(r.roomType)}</td>
      <td>${escapeHtml(r.checkIn)}</td>
      <td>${escapeHtml(r.checkOut)}</td>
      <td style="text-align:center">${r.nights || ''}</td>
      <td>${escapeHtml(r.confirmation)}</td>
      <td>${escapeHtml(r.view)}</td>
      <td>${escapeHtml(r.mealPlan)}</td>
    </tr>`).join('');

  const staff = booking?.createdBy
    ? `${booking.createdBy.firstName || ''} ${booking.createdBy.lastName || ''}`.trim()
    : '';
  const staffPhone = booking?.createdBy?.phone || '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Definite Confirmation ${escapeHtml(voucher.voucherNumber)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; font-size: 12px; margin: 0; padding: 24px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; font-size: 12px; }
  .meta-grid div { display: flex; gap: 8px; }
  .meta-grid label { font-weight: 700; min-width: 72px; }
  .brand { text-align: right; }
  .brand img { max-height: 64px; max-width: 180px; object-fit: contain; }
  .brand h1 { margin: 4px 0 0; font-size: 18px; color: #1d4ed8; letter-spacing: 0.5px; }
  .brand p { margin: 2px 0 0; font-size: 11px; color: #475569; font-weight: 700; }
  .intro { margin: 14px 0; font-size: 12px; }
  .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 32px; margin: 12px 0 18px; }
  .summary div { display: flex; gap: 8px; }
  .summary label { font-weight: 700; min-width: 88px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
  th { background: #1e3a8a; color: #fff; padding: 8px 6px; text-align: left; font-weight: 700; }
  td { border: 1px solid #cbd5e1; padding: 7px 6px; vertical-align: top; }
  .remarks { margin-top: 18px; }
  .remarks label { font-weight: 700; display: block; margin-bottom: 4px; }
  .footer { margin-top: 28px; display: flex; justify-content: space-between; gap: 24px; font-size: 11px; }
  .footer-bar { margin-top: 20px; border-top: 3px solid #1e3a8a; padding-top: 10px; text-align: center; font-size: 10px; color: #334155; line-height: 1.5; }
  .helpline { font-weight: 700; color: #1e3a8a; }
</style></head><body>
<div class="top">
  <div class="meta-grid">
    <div><label>Date:</label><span>${escapeHtml(docDate)}</span></div>
    <div><label>To:</label><span>${escapeHtml(toLine)}</span></div>
    <div><label>Att:</label><span>${escapeHtml(attLine)}</span></div>
  </div>
  <div class="brand">
    ${logoHtml(baseUrl, BRAND_NAME)}
    <h1>${escapeHtml(BRAND_NAME.toUpperCase())}</h1>
    <p>Definite Confirmation</p>
  </div>
</div>
<p class="intro">Thank you for considering ${escapeHtml(BRAND_NAME)} as your travel partner.</p>
<div class="summary">
  <div><label>Res No:</label><span>${escapeHtml(resNo)}</span></div>
  <div><label>Hotel Name:</label><span>${escapeHtml(primaryHotel)}</span></div>
  <div><label>Guest Name:</label><span>${escapeHtml(guestName)}</span></div>
  <div><label>Total PAX:</label><span>${totalPax || ''}</span></div>
</div>
<table>
  <thead>
    <tr>
      <th>QTY</th><th>Room Type</th><th>Checkin</th><th>Checkout</th><th>Nights</th><th>Confirmation</th><th>View</th><th>Meal Plan</th>
    </tr>
  </thead>
  <tbody>${tableBody || '<tr><td colspan="8" style="text-align:center;color:#64748b">No room details</td></tr>'}</tbody>
</table>
<div class="remarks">
  <label>Remarks:</label>
  <div>${escapeHtml(remarks)}</div>
</div>
<div class="footer">
  <div><span class="helpline">KSA HELPLINE: +966 59 129 1840</span></div>
  <div style="text-align:right">
    <div>Thanks &amp; Regards</div>
    ${staff ? `<div>${escapeHtml(staff)}</div>` : ''}
    ${staffPhone ? `<div>${escapeHtml(staffPhone)}</div>` : ''}
    <div>Reservation Print Date: ${escapeHtml(printDate)}</div>
  </div>
</div>
<div class="footer-bar">
  243 TIP, Main Boulevard Near Defence Road, Lahore | 042-36303030 - 0308-1114414 | huffazholiday@gmail.com | www.huffazholiday.com
</div>
</body></html>`;
}
