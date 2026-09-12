import fs from 'fs';
import path from 'path';
import { escapeHtml } from '../utils/exportHelpers';
import { BRAND_NAME } from './documentBrand';

type DetailMap = Record<string, unknown>;
type VoucherFormatName = 'COMPLETE' | 'HOTEL' | 'TRANSPORT';

type ServiceItem = {
  serviceType: string;
  description: string;
  details?: unknown;
};

type ConfirmationVoucher = {
  voucherNumber: string;
  guestName: string;
  hotelName?: string | null;
  checkInDate?: Date | null;
  checkOutDate?: Date | null;
  roomDetails?: string | null;
  issuedAt?: Date | null;
  transportDetails?: unknown;
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
    serviceItems?: ServiceItem[];
  } | null;
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
    path.join(__dirname, '../../assets/huffaz-holiday-logo-invoice.png'),
    path.join(__dirname, '../../assets/huffaz-holiday-logo.png'),
    path.join(__dirname, '../../../frontend/public/huffaz-holiday-logo-invoice.png'),
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

function splitSector(value: unknown): [string, string] {
  const parts = text(value).split(/\s*(?:-|–|→|>)\s*/).filter(Boolean);
  return [parts[0] || '', parts.slice(1).join(' - ')];
}

function itemsOf(booking: ConfirmationVoucher['booking'], type: string): ServiceItem[] {
  return (booking?.serviceItems || []).filter((item) => item.serviceType === type);
}

function field(label: string, value: string): string {
  return `<span style="font-weight:700;">${escapeHtml(label)}</span> <span style="font-weight:400;">${escapeHtml(value)}</span>`;
}

function tableCell(value: string): string {
  return `<td style="border:1px solid #000;padding:6px 4px;text-align:center;font-size:13px;font-weight:400;color:${TEXT};background:#ffffff;">${escapeHtml(value)}</td>`;
}

function confirmationTable(headers: string[], rows: string[][]): string {
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => tableCell(cell)).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}" style="border:1px solid #000;padding:8px;text-align:center;color:#94a3b8;">No details</td></tr>`;

  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;table-layout:fixed;margin-bottom:14px;">
    <thead>
      <tr>
        ${headers.map((header) =>
          `<th style="background:${NAVY};color:#fff;font-size:13px;font-weight:700;padding:7px 4px;text-align:center;border:1px solid #000;">${escapeHtml(header)}</th>`
        ).join('')}
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

function sectionLabel(title: string): string {
  return `<div style="font-size:13px;font-weight:700;color:${TEXT};margin:4px 0 6px;">${escapeHtml(title)}</div>`;
}

function keepTogether(inner: string): string {
  return `<div class="keep-together" style="display:block;page-break-inside:avoid;break-inside:avoid;">${inner}</div>`;
}

function hotelRows(
  items: ServiceItem[],
  fallback: { hotelName?: string | null; checkInDate?: Date | null; checkOutDate?: Date | null; roomDetails?: string | null }
): string[][] {
  const rows: string[][] = [];
  for (const item of items) {
    const details = (item.details as DetailMap | null) || {};
    for (const row of rowsOf(details)) {
      const checkIn = text(row.checkInDate || details.checkInDate) || fallback.checkInDate;
      const checkOut = text(row.checkOutDate || details.checkOutDate) || fallback.checkOutDate;
      const nights = nightsBetween(checkIn, checkOut);
      rows.push([
        text(row.numRooms) || '1',
        text(row.roomType || details.roomType || fallback.roomDetails),
        formatDisplayDate(checkIn),
        formatDisplayDate(checkOut),
        nights ? String(nights) : '',
        text(row.vendorResNo || details.vendorResNo),
        text(row.view || details.view),
        text(row.mealPlan || details.mealPlan),
      ]);
    }
  }
  if (!rows.length && (fallback.hotelName || fallback.checkInDate)) {
    const nights = nightsBetween(fallback.checkInDate, fallback.checkOutDate);
    rows.push([
      '1',
      text(fallback.roomDetails),
      formatDisplayDate(fallback.checkInDate),
      formatDisplayDate(fallback.checkOutDate),
      nights ? String(nights) : '',
      '',
      '',
      '',
    ]);
  }
  return rows;
}

function hotelNameFrom(items: ServiceItem[], fallback?: string | null): string {
  for (const item of items) {
    const details = (item.details as DetailMap | null) || {};
    for (const row of rowsOf(details)) {
      const name = text(row.hotelName || details.hotelName || fallback || item.description);
      if (name) return name;
    }
  }
  return text(fallback);
}

function transportRows(items: ServiceItem[], fallback?: DetailMap): string[][] {
  const rows: string[][] = [];
  for (const item of items) {
    const details = (item.details as DetailMap | null) || {};
    for (const row of rowsOf(details)) {
      const [from, to] = splitSector(row.sector || details.sector || fallback?.sector);
      rows.push([
        text(row.quantity || details.quantity) || '1',
        text(row.vehicleType || details.vehicleType || fallback?.vehicleType),
        from,
        to,
        formatDisplayDate(text(row.date || details.date || details.transportDate || fallback?.date || fallback?.transportDate)),
        text(row.vendorResNo || details.vendorResNo || fallback?.vendorResNo),
      ]);
    }
  }
  if (!rows.length && fallback && (fallback.sector || fallback.vehicleType || fallback.description)) {
    const [from, to] = splitSector(fallback.sector);
    rows.push([
      '1',
      text(fallback.vehicleType),
      from,
      to,
      formatDisplayDate(text(fallback.date || fallback.transportDate)),
      text(fallback.vendorResNo),
    ]);
  }
  return rows;
}

function ticketRows(items: ServiceItem[]): string[][] {
  return items.flatMap((item) => {
    const details = (item.details as DetailMap | null) || {};
    return rowsOf(details).map((row) => {
      const [from, to] = splitSector(row.sector || details.sector);
      return [
        '1',
        text(row.airline || details.airline),
        text(row.sector || details.sector) || [from, to].filter(Boolean).join('-'),
        formatDisplayDate(text(row.date || details.departureDate)),
        text(row.class || details.class),
        text(row.vendorResNo || details.vendorResNo),
      ];
    });
  });
}

function visaRows(items: ServiceItem[]): string[][] {
  return items.map((item) => {
    const details = (item.details as DetailMap | null) || {};
    return [
      text(details.quantity) || '1',
      text(details.visaType) || item.description,
      text(details.country),
      text(details.validity),
      text(details.vendorResNo),
    ];
  });
}

function transportFallback(voucher: ConfirmationVoucher): DetailMap {
  const raw = (voucher.transportDetails as DetailMap | null) || {};
  return {
    ...raw,
    sector: raw.sector || [raw.pickupLocation, raw.dropoffLocation].filter(Boolean).join(' - '),
    date: raw.date || raw.transportDate,
    vehicleType: raw.vehicleType,
    description: raw.description,
    vendorResNo: raw.vendorResNo,
  };
}

export async function renderDefiniteConfirmationHtml(
  voucher: ConfirmationVoucher,
  format: VoucherFormatName = 'HOTEL'
): Promise<string> {
  const booking = voucher.booking;
  const customer = booking?.customer;
  const isB2B = customer?.customerType === 'B2B' && !!customer.companyName;
  const guestName = booking?.guestName
    || (customer && customer.customerType !== 'B2B'
      ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim()
      : '')
    || voucher.guestName;
  const toLine = isB2B ? customer!.companyName! : guestName;
  const attLine = isB2B ? (customer!.contactPerson || guestName) : guestName;
  const totalPax = (booking?.adults ?? 0) + (booking?.children ?? 0) + (booking?.infants ?? 0);
  const resNo = booking?.bookingNumber || voucher.voucherNumber;
  const printDate = formatDisplayDate(voucher.issuedAt || new Date());
  const remarksValue = text(booking?.notes);
  const staff = booking?.createdBy
    ? `${booking.createdBy.firstName || ''} ${booking.createdBy.lastName || ''}`.trim()
    : '';
  const staffPhone = text(booking?.createdBy?.phone);
  const logo = squareLogoDataUri();

  const hotelItems = itemsOf(booking, 'HOTEL');
  const transportItems = itemsOf(booking, 'TRANSPORT');
  const ticketItems = itemsOf(booking, 'TICKET');
  const visaItems = itemsOf(booking, 'VISA');
  const showHotel = format !== 'TRANSPORT';
  const showTransport = format !== 'HOTEL';
  const showTicket = format === 'COMPLETE';
  const showVisa = format === 'COMPLETE';

  const hotelTableRows = showHotel ? hotelRows(hotelItems, {
    hotelName: voucher.hotelName,
    checkInDate: voucher.checkInDate,
    checkOutDate: voucher.checkOutDate,
    roomDetails: voucher.roomDetails,
  }) : [];
  const transportTableRows = showTransport ? transportRows(transportItems, transportFallback(voucher)) : [];
  const ticketTableRows = showTicket ? ticketRows(ticketItems) : [];
  const visaTableRows = showVisa ? visaRows(visaItems) : [];

  const primaryHotel = hotelNameFrom(hotelItems, voucher.hotelName);
  const primaryVehicle = transportTableRows[0]?.[1] || text((voucher.transportDetails as DetailMap | null)?.vehicleType);
  const secondaryLabel = format === 'TRANSPORT' || (format === 'COMPLETE' && !primaryHotel)
    ? 'Service:'
    : 'Hotel Name:';
  const secondaryValue = format === 'TRANSPORT'
    ? (primaryVehicle || 'Transport')
    : primaryHotel || (ticketTableRows.length ? 'Ticket' : visaTableRows.length ? 'Visa' : primaryVehicle);

  const stacked = [hotelTableRows, transportTableRows, ticketTableRows, visaTableRows].filter((rows) => rows.length).length > 1;
  const tables = [
    hotelTableRows.length
      ? keepTogether(`${stacked ? sectionLabel('Hotel') : ''}${confirmationTable(['QTY', 'Room Type', 'Checkin', 'Checkout', 'Nights', 'Confirmation', 'View', 'Meal Plan'], hotelTableRows)}`)
      : '',
    transportTableRows.length
      ? keepTogether(`${stacked ? sectionLabel('Transport') : ''}${confirmationTable(['QTY', 'Vehicle Type', 'From', 'To', 'Date', 'Confirmation'], transportTableRows)}`)
      : '',
    ticketTableRows.length
      ? keepTogether(`${stacked ? sectionLabel('Ticket') : ''}${confirmationTable(['QTY', 'Airline', 'Sector', 'Date', 'Class', 'Confirmation'], ticketTableRows)}`)
      : '',
    visaTableRows.length
      ? keepTogether(`${stacked ? sectionLabel('Visa') : ''}${confirmationTable(['QTY', 'Visa Type', 'Country', 'Validity', 'Confirmation'], visaTableRows)}`)
      : '',
  ].join('');

  const remarkItems = STANDARD_REMARKS.map((note) => `
    <tr>
      <td valign="top" style="width:14px;padding:0 8px 8px 0;font-size:13px;line-height:18px;color:${NOTE};">&#9642;</td>
      <td valign="top" style="padding:0 0 8px;color:${NOTE};font-size:13px;line-height:18px;font-weight:400;">${escapeHtml(note)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Definite Confirmation ${escapeHtml(voucher.voucherNumber)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm 14mm; background: #ffffff; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff !important; color: ${TEXT}; font-family: Arial, Helvetica, sans-serif; font-size: 13px; }
  table, td, th { background-color: transparent; }
  img { border: 0; }
  #invoice-root { width: 100%; max-width: 780px; margin: 0 auto; position: relative; background: #ffffff; padding: 22px 28px 16px; }
  .keep-together {
    display: block;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
</style>
</head>
<body style="background:#ffffff;margin:0;padding:0;">
<div id="invoice-root">
      ${logo ? `<img src="${logo}" alt="" style="position:absolute;left:50%;top:248px;width:320px;height:209px;margin-left:-160px;opacity:0.05;pointer-events:none;" />` : ''}

      ${keepTogether(`
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <tr>
          <td width="58%" valign="top" style="width:58%;vertical-align:top;font-size:13px;line-height:1.55;color:${TEXT};">
            ${field('Date:', printDate)}<br>
            ${field('To:', toLine)}<br>
            ${field('Att:', attLine)}
          </td>
          <td width="42%" valign="top" align="right" style="width:42%;vertical-align:top;text-align:right;">
            <table cellpadding="0" cellspacing="0" align="right" style="border-collapse:collapse;">
              <tr><td align="right" style="text-align:right;">
                ${logo ? `<img src="${logo}" alt="${escapeHtml(BRAND_NAME)}" width="132" height="86" style="width:132px;height:86px;object-fit:contain;object-position:right center;display:block;margin:0 0 4px auto;" />` : ''}
                <div style="font-size:15px;font-weight:700;letter-spacing:0.3px;color:${TEXT};line-height:1.2;">${escapeHtml(BRAND_NAME.toUpperCase())}</div>
                <div style="font-size:11px;font-weight:400;color:${TEXT};margin-top:2px;">Definite Confirmation</div>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
      <div style="border-top:1px solid ${LINE};margin:10px 0 14px;"></div>
      <div style="font-size:13px;color:${TEXT};margin-bottom:16px;">Thank you for considering ${escapeHtml(BRAND_NAME)} as your travel partner.</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-bottom:18px;background:#ffffff;">
        <tr>
          <td width="50%" style="width:50%;padding:6px 8px 6px 0;font-size:15px;color:${TEXT};background:#ffffff;">${field('Res No:', resNo)}</td>
          <td width="50%" style="width:50%;padding:6px 0;font-size:15px;color:${TEXT};background:#ffffff;">${field(secondaryLabel, secondaryValue)}</td>
        </tr>
        <tr>
          <td width="50%" style="width:50%;padding:6px 8px 6px 0;font-size:15px;color:${TEXT};background:#ffffff;">${field('Guest Name:', guestName)}</td>
          <td width="50%" style="width:50%;padding:6px 0;font-size:15px;color:${TEXT};background:#ffffff;">${field('Total PAX:', totalPax ? String(totalPax) : '')}</td>
        </tr>
      </table>
      `)}

      ${tables || keepTogether(confirmationTable(['QTY', 'Details'], []))}

      ${keepTogether(`
      <div style="margin-top:12px;font-size:12px;font-style:italic;font-weight:700;color:${MUTED};">
        Remarks:${remarksValue ? ` ${escapeHtml(remarksValue)}` : ''}
      </div>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:10px;">
        ${remarkItems}
      </table>
      `)}

      ${keepTogether(`
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
      `)}
</div>
</body></html>`;
}

export async function renderHotelDefiniteConfirmationHtml(voucher: ConfirmationVoucher): Promise<string> {
  return renderDefiniteConfirmationHtml(voucher, 'HOTEL');
}
