import fs from 'fs';
import path from 'path';
import { escapeHtml } from '../utils/exportHelpers';
import { BRAND_NAME } from './documentBrand';

type DetailMap = Record<string, unknown>;

type HotelTableRow = {
  qty: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  nights: string;
  confirmation: string;
  view: string;
  mealPlan: string;
  hotelName: string;
};

const NAVY = '#1e2a78';
const LINE = '#9a9a9a';
const TEXT = '#000000';
const MUTED = '#666666';
const NOTE = '#333333';
const FOOTER_ADDRESS = '243 TIP, Main Boulevard Near Defence Road, Lahore';
const FOOTER_PHONE = '+92 320 4455954';
const FOOTER_EMAIL = 'huffazholiday@gmail.com';
const FOOTER_WEB = 'www.huffazholiday.com';
const KSA_HELPLINE = '+966 59 129 1840';

const STANDARD_REMARKS = [
  'We hope the reservation is in accordance with your request.',
  'Any amendment to the booking is subject to availability.',
  'Cancellation Policy - The booking is non-refundable once confirmed on a definite basis.',
  'Check-in after 16:00 hours and check-out at 12:00 hours.',
];

let cachedSquareLogo: string | null | undefined;

function squareLogoDataUri(): string {
  if (cachedSquareLogo !== undefined) return cachedSquareLogo || '';
  const candidates = [
    path.join(__dirname, '../../assets/huffaz-holiday-logo.png'),
    path.join(__dirname, '../../../frontend/public/huffaz-holiday-logo.png'),
  ];
  for (const logoPath of candidates) {
    if (fs.existsSync(logoPath)) {
      cachedSquareLogo = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
      return cachedSquareLogo;
    }
  }
  cachedSquareLogo = '';
  return '';
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function formatDisplayDate(value?: string | Date | null): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(String(value));
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function nightsBetween(checkIn?: string | Date | null, checkOut?: string | Date | null): number {
  if (!checkIn || !checkOut) return 0;
  const from = checkIn instanceof Date ? checkIn : new Date(checkIn);
  const to = checkOut instanceof Date ? checkOut : new Date(checkOut);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

function rowsOf(details: DetailMap): DetailMap[] {
  return Array.isArray(details.rows) && details.rows.length
    ? details.rows.filter((row): row is DetailMap => !!row && typeof row === 'object')
    : [details];
}

function collectHotelRows(
  booking: {
    serviceItems?: Array<{
      serviceType: string;
      description: string;
      details?: unknown;
    }>;
  } | null | undefined,
  fallback: {
    hotelName?: string | null;
    checkInDate?: Date | null;
    checkOutDate?: Date | null;
    roomDetails?: string | null;
  }
): HotelTableRow[] {
  const items = (booking?.serviceItems || []).filter((item) => item.serviceType === 'HOTEL');
  const rows: HotelTableRow[] = [];

  for (const item of items) {
    const details = (item.details as DetailMap | null) || {};
    for (const row of rowsOf(details)) {
      const checkIn = text(row.checkInDate || details.checkInDate) || fallback.checkInDate;
      const checkOut = text(row.checkOutDate || details.checkOutDate) || fallback.checkOutDate;
      const nights = nightsBetween(checkIn, checkOut);
      rows.push({
        qty: text(row.numRooms) || '1',
        roomType: text(row.roomType || details.roomType || fallback.roomDetails),
        checkIn: formatDisplayDate(checkIn),
        checkOut: formatDisplayDate(checkOut),
        nights: nights ? String(nights) : '',
        confirmation: text(row.vendorResNo || details.vendorResNo),
        view: text(row.view || details.view),
        mealPlan: text(row.mealPlan || details.mealPlan),
        hotelName: text(row.hotelName || details.hotelName || fallback.hotelName || item.description),
      });
    }
  }

  if (rows.length === 0 && (fallback.hotelName || fallback.checkInDate)) {
    const nights = nightsBetween(fallback.checkInDate, fallback.checkOutDate);
    rows.push({
      qty: '1',
      roomType: text(fallback.roomDetails),
      checkIn: formatDisplayDate(fallback.checkInDate),
      checkOut: formatDisplayDate(fallback.checkOutDate),
      nights: nights ? String(nights) : '',
      confirmation: '',
      view: '',
      mealPlan: '',
      hotelName: text(fallback.hotelName),
    });
  }

  return rows;
}

function field(label: string, value: string): string {
  return `<span style="font-weight:700;">${escapeHtml(label)}</span> <span style="font-weight:700;">${escapeHtml(value)}</span>`;
}

function tableCell(value: string, extra = ''): string {
  return `<td style="border:1px solid #000;padding:6px 4px;text-align:center;font-size:13px;color:${TEXT};${extra}">${escapeHtml(value)}</td>`;
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
      notes?: string | null;
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
        details?: unknown;
      }>;
    } | null;
  }
): Promise<string> {
  const booking = voucher.booking;
  const customer = booking?.customer;
  const isB2B = customer?.customerType === 'B2B' && !!customer.companyName;
  const hotelRows = collectHotelRows(booking, {
    hotelName: voucher.hotelName,
    checkInDate: voucher.checkInDate,
    checkOutDate: voucher.checkOutDate,
    roomDetails: voucher.roomDetails,
  });

  const guestName = booking?.guestName
    || (customer && customer.customerType !== 'B2B'
      ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim()
      : '')
    || voucher.guestName;
  const toLine = isB2B ? customer!.companyName! : guestName;
  const attLine = isB2B ? (customer!.contactPerson || guestName) : guestName;
  const primaryHotel = hotelRows[0]?.hotelName || voucher.hotelName || '';
  const totalPax = (booking?.adults ?? 0) + (booking?.children ?? 0) + (booking?.infants ?? 0);
  const resNo = booking?.bookingNumber || voucher.voucherNumber;
  const printDate = formatDisplayDate(voucher.issuedAt || new Date());
  const remarksValue = text(booking?.notes);
  const staff = booking?.createdBy
    ? `${booking.createdBy.firstName || ''} ${booking.createdBy.lastName || ''}`.trim()
    : '';
  const staffPhone = text(booking?.createdBy?.phone);
  const logo = squareLogoDataUri();

  const tableBody = hotelRows.map((row) => `
    <tr>
      ${tableCell(row.qty, 'width:7%;')}
      ${tableCell(row.roomType, 'width:15%;')}
      ${tableCell(row.checkIn, 'width:13%;')}
      ${tableCell(row.checkOut, 'width:13%;')}
      ${tableCell(row.nights, 'width:10%;')}
      ${tableCell(row.confirmation, 'width:16%;')}
      ${tableCell(row.view, 'width:13%;')}
      ${tableCell(row.mealPlan, 'width:13%;')}
    </tr>`).join('');

  const remarkItems = STANDARD_REMARKS.map((note) => `
    <tr>
      <td valign="top" style="width:16px;padding:7px 8px 6px 0;">
        <div style="width:5px;height:5px;background:${NOTE};"></div>
      </td>
      <td style="padding:0 0 8px;color:${NOTE};font-size:13px;line-height:1.45;">${escapeHtml(note)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Definite Confirmation ${escapeHtml(voucher.voucherNumber)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; background: #fff; color: ${TEXT}; font-family: Arial, Helvetica, sans-serif; font-size: 13px; }
  img { border: 0; }
</style>
</head>
<body>
<table width="780" cellpadding="0" cellspacing="0" style="width:780px;max-width:100%;margin:0 auto;border-collapse:collapse;position:relative;">
  <tr>
    <td style="padding:22px 28px 16px;position:relative;">
      ${logo ? `<img src="${logo}" alt="" style="position:absolute;left:50%;top:248px;width:280px;height:280px;margin-left:-140px;opacity:0.08;pointer-events:none;" />` : ''}

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <tr>
          <td width="58%" valign="top" style="width:58%;vertical-align:top;font-size:13px;line-height:1.55;color:${TEXT};">
            ${field('Date:', printDate)}<br>
            ${field('To:', toLine)}<br>
            ${field('Att:', attLine)}
          </td>
          <td width="42%" valign="top" align="right" style="width:42%;vertical-align:top;text-align:right;">
            <table cellpadding="0" cellspacing="0" align="right" style="border-collapse:collapse;">
              <tr><td align="center" style="text-align:center;">
                ${logo ? `<img src="${logo}" alt="${escapeHtml(BRAND_NAME)}" width="48" height="48" style="width:48px;height:48px;object-fit:contain;display:block;margin:0 auto 2px;" />` : ''}
                <div style="font-size:15px;font-weight:700;letter-spacing:0.3px;color:${TEXT};line-height:1.2;">${escapeHtml(BRAND_NAME.toUpperCase())}</div>
                <div style="font-size:11px;font-weight:400;color:${TEXT};margin-top:2px;">Definite Confirmation</div>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>

      <div style="border-top:1px solid ${LINE};margin:10px 0 14px;"></div>

      <div style="font-size:13px;color:${TEXT};margin-bottom:16px;">Thank you for considering ${escapeHtml(BRAND_NAME)} as your travel partner.</div>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-bottom:18px;">
        <tr>
          <td width="50%" style="width:50%;padding:6px 8px 6px 0;font-size:15px;font-weight:700;color:${TEXT};">${field('Res No:', resNo)}</td>
          <td width="50%" style="width:50%;padding:6px 0;font-size:15px;font-weight:700;color:${TEXT};">${field('Hotel Name:', primaryHotel)}</td>
        </tr>
        <tr>
          <td width="50%" style="width:50%;padding:6px 8px 6px 0;font-size:15px;font-weight:700;color:${TEXT};">${field('Guest Name:', guestName)}</td>
          <td width="50%" style="width:50%;padding:6px 0;font-size:15px;font-weight:700;color:${TEXT};">${field('Total PAX:', totalPax ? String(totalPax) : '')}</td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;table-layout:fixed;">
        <thead>
          <tr>
            ${['QTY', 'Room Type', 'Checkin', 'Checkout', 'Nights', 'Confirmation', 'View', 'Meal Plan'].map((header) =>
              `<th style="background:${NAVY};color:#fff;font-size:13px;font-weight:700;padding:7px 4px;text-align:center;border:1px solid #000;">${header}</th>`
            ).join('')}
          </tr>
        </thead>
        <tbody>${tableBody || `<tr><td colspan="8" style="border:1px solid #000;padding:8px;text-align:center;color:#94a3b8;">No room details</td></tr>`}</tbody>
      </table>

      <div style="margin-top:12px;font-size:12px;font-style:italic;font-weight:700;color:${MUTED};">
        Remarks:${remarksValue ? ` ${escapeHtml(remarksValue)}` : ''}
      </div>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:10px;">
        ${remarkItems}
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-top:36px;">
        <tr>
          <td width="50%" valign="top" style="width:50%;vertical-align:top;font-size:15px;color:${TEXT};line-height:1.45;">
            <div style="font-weight:700;">KSA HELPLINE:</div>
            <div>${escapeHtml(KSA_HELPLINE)}</div>
          </td>
          <td width="50%" valign="top" align="right" style="width:50%;vertical-align:top;text-align:right;font-size:15px;color:${TEXT};line-height:1.45;">
            <div style="font-weight:700;">Thanks &amp; Regards</div>
            ${staff ? `<div>${escapeHtml(staff)}</div>` : ''}
            ${staffPhone ? `<div style="font-size:11px;font-weight:700;">Phone: ${escapeHtml(staffPhone)}</div>` : ''}
            <div style="font-size:11px;font-weight:700;">Reservation Print Date: ${escapeHtml(printDate)}</div>
          </td>
        </tr>
      </table>

      <div style="margin-top:22px;font-size:11px;font-weight:700;color:${TEXT};line-height:1.6;">
        ${escapeHtml(BRAND_NAME.toUpperCase())} - ${escapeHtml(FOOTER_ADDRESS)}<br>
        <span style="font-weight:400;">&#128222; ${escapeHtml(FOOTER_PHONE)} &nbsp; | &nbsp; &#9993; ${escapeHtml(FOOTER_EMAIL)} &nbsp; | &nbsp; &#127760; ${escapeHtml(FOOTER_WEB)}</span>
      </div>
    </td>
  </tr>
</table>
</body></html>`;
}
