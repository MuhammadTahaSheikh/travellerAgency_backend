import fs from 'fs';
import path from 'path';
import { escapeHtml } from '../utils/exportHelpers';
import { BRAND_NAME } from './documentBrand';

type DetailMap = Record<string, unknown>;

type ServiceItem = {
  serviceType: string;
  description: string;
  amount?: unknown;
  details?: unknown;
};

export type CompletePackageDoc = {
  voucherNumber: string;
  guestName: string;
  documentKind: 'invoice' | 'voucher';
  hotelName?: string | null;
  checkInDate?: Date | null;
  checkOutDate?: Date | null;
  roomDetails?: string | null;
  issuedAt?: Date | null;
  transportDetails?: unknown;
  booking?: {
    bookingNumber?: string;
    guestName?: string | null;
    currency?: string;
    priceMode?: string;
    adults?: number;
    children?: number;
    infants?: number;
    priceAdult?: unknown;
    priceChild?: unknown;
    priceInfant?: unknown;
    totalAmount?: unknown;
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
  invoice?: {
    invoiceNumber?: string;
    issueDate?: Date | null;
    dueDate?: Date | null;
    subtotal?: unknown;
    tax?: unknown;
    discount?: unknown;
    totalAmount?: unknown;
    paidAmount?: unknown;
    items?: Array<{
      description: string;
      quantity?: number;
      unitPrice?: unknown;
      amount?: unknown;
    }>;
  } | null;
};

const NAVY = '#242a70';
const TEXT = '#222222';
const BORDER = '#999999';
const BOX_BORDER = '#cccccc';
const WHITE = '#ffffff';
const FOOTER_ADDRESS = '243 TIP, Main Boulevard Near Defence Road, Lahore';
const FOOTER_PHONE = '+92 320 4455954';
const FOOTER_EMAIL = 'huffazholiday@gmail.com';
const FOOTER_WEB = 'www.huffazholiday.com';

const INCLUDE_LABELS: Record<string, string> = {
  TICKET: 'Ticket',
  VISA: 'Visa',
  HOTEL: 'Accommodation',
  TRANSPORT: 'Transport',
};

let cachedLogo: string | null | undefined;

function logoDataUri(): string {
  if (cachedLogo !== undefined) return cachedLogo || '';
  const candidates = [
    path.join(__dirname, '../../assets/huffaz-holiday-logo-invoice.png'),
    path.join(__dirname, '../../assets/huffaz-holiday-logo.png'),
    path.join(__dirname, '../../../frontend/public/huffaz-holiday-logo-invoice.png'),
    path.join(__dirname, '../../../frontend/public/huffaz-holiday-logo.png'),
  ];
  for (const logoPath of candidates) {
    if (fs.existsSync(logoPath)) {
      cachedLogo = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
      return cachedLogo;
    }
  }
  cachedLogo = '';
  return '';
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value?: string | Date | null): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(String(value));
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
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

function itemsOf(booking: CompletePackageDoc['booking'], type: string): ServiceItem[] {
  return (booking?.serviceItems || []).filter((item) => item.serviceType === type);
}

function money(value: unknown, currency = 'PKR'): string {
  return `${escapeHtml(currency)} ${number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}/-`;
}

const TH = `background:${NAVY};color:#ffffff;font-size:13px;font-weight:700;padding:8px 10px;text-align:left;border:1px solid ${BORDER};-webkit-print-color-adjust:exact;print-color-adjust:exact;`;
const TD = `border:1px solid ${BORDER};padding:8px 10px;font-size:13px;font-weight:400;color:${TEXT};background:${WHITE};`;

function heading(title: string): string {
  return `<div style="font-size:16px;font-weight:700;color:${TEXT};margin:18px 0 8px;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(title)}</div>`;
}

function dataTable(
  headers: string[],
  rows: string[][],
  aligns?: Array<'left' | 'center' | 'right'>,
  options?: { width?: string; colWidths?: string[] }
): string {
  const width = options?.width || '70%';
  const colgroup = options?.colWidths?.length
    ? `<colgroup>${options.colWidths.map((w) => `<col style="width:${w};">`).join('')}</colgroup>`
    : '';
  const body = (rows.length ? rows : [headers.map(() => '-')]).map((row) =>
    `<tr>${row.map((cell, index) => {
      const align = aligns?.[index] || 'left';
      const colWidth = options?.colWidths?.[index] ? `width:${options.colWidths[index]};` : '';
      return `<td style="${TD}${colWidth}text-align:${align};">${cell || '&nbsp;'}</td>`;
    }).join('')}</tr>`
  ).join('');

  return `<table width="${width}" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:${width};max-width:750px;margin:8px 0 16px;background:${WHITE};">
    ${colgroup}
    <thead><tr>${headers.map((header, index) => {
      const colWidth = options?.colWidths?.[index] ? `width:${options.colWidths[index]};` : '';
      return `<th style="${TH}${colWidth}">${escapeHtml(header)}</th>`;
    }).join('')}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function ticketTable(items: ServiceItem[]): string {
  const rows: Array<{ airline: string; sector: string; depart: string; ret: string }> = [];
  for (const item of items) {
    const details = (item.details as DetailMap | null) || {};
    const airline = text(details.airline) || item.description || '-';
    const nested = Array.isArray(details.rows) && details.rows.length
      ? (details.rows as DetailMap[])
      : [];
    if (nested.some((row) => text(row.sector) || text(row.date) || text(row.departureDate))) {
      for (const row of nested) {
        rows.push({
          airline,
          sector: text(row.sector || details.sector) || '-',
          depart: formatDate(text(row.date || row.departureDate || details.departureDate)) || '-',
          ret: formatDate(text(row.returnDate || details.returnDate)),
        });
      }
    } else {
      rows.push({
        airline,
        sector: text(details.sector) || '-',
        depart: formatDate(text(details.departureDate || details.date)) || '-',
        ret: formatDate(text(details.returnDate)),
      });
    }
  }
  if (!rows.length) {
    rows.push({ airline: '-', sector: '-', depart: '-', ret: '' });
  }
  const roundTrip = rows.some((row) => row.ret);
  if (roundTrip) {
    return dataTable(
      ['Airline Name', 'Sector', 'Departure Date', 'Return Date'],
      rows.map((row) => [escapeHtml(row.airline), escapeHtml(row.sector), escapeHtml(row.depart), escapeHtml(row.ret || '-')]),
      ['left', 'left', 'left', 'left'],
      { colWidths: ['40%', '20%', '20%', '20%'] },
    );
  }
  return dataTable(
    ['Airline Name', 'Sector', 'Date'],
    rows.map((row) => [escapeHtml(row.airline), escapeHtml(row.sector), escapeHtml(row.depart)]),
    ['left', 'left', 'left'],
    { colWidths: ['50%', '30%', '20%'] },
  );
}

function visaTable(items: ServiceItem[]): string {
  const rows = items.map((item) => {
    const details = (item.details as DetailMap | null) || {};
    const visaType = text(details.visaType) || item.description || 'Umrah';
    const country = text(details.country);
    return { visaType, country };
  });
  const showCountry = rows.some((row) => row.country);
  if (showCountry) {
    return dataTable(
      ['Visa Type', 'Country'],
      rows.map((row) => [escapeHtml(row.visaType), escapeHtml(row.country || '-')]),
      ['left', 'left'],
      { colWidths: ['50%', '50%'] },
    );
  }
  return dataTable(
    ['Visa Type'],
    (rows.length ? rows : [{ visaType: 'Umrah', country: '' }]).map((row) => [escapeHtml(row.visaType)]),
    ['left'],
  );
}

type HotelGroup = { name: string; city: string; rows: string[][] };

function hotelGroups(
  items: ServiceItem[],
  fallback: { hotelName?: string | null; checkInDate?: Date | null; checkOutDate?: Date | null; roomDetails?: string | null }
): HotelGroup[] {
  const groups: HotelGroup[] = [];
  const index = new Map<string, HotelGroup>();

  const push = (name: string, city: string, row: string[]) => {
    const key = `${name}|${city}`;
    let group = index.get(key);
    if (!group) {
      group = { name, city, rows: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.rows.push(row);
  };

  for (const item of items) {
    const details = (item.details as DetailMap | null) || {};
    for (const row of rowsOf(details)) {
      const checkIn = text(row.checkInDate || details.checkInDate) || fallback.checkInDate;
      const checkOut = text(row.checkOutDate || details.checkOutDate) || fallback.checkOutDate;
      const nights = nightsBetween(checkIn, checkOut);
      push(
        text(row.hotelName || details.hotelName || fallback.hotelName || item.description) || '-',
        text(row.city || details.city),
        [
          escapeHtml(text(row.numRooms) || '1'),
          escapeHtml(text(row.roomType || details.roomType || fallback.roomDetails) || '-'),
          escapeHtml(formatDate(checkIn) || '-'),
          escapeHtml(formatDate(checkOut) || '-'),
          escapeHtml(nights ? String(nights) : '-'),
          escapeHtml(text(row.view || details.view) || '-'),
          escapeHtml(text(row.mealPlan || details.mealPlan) || '-'),
        ],
      );
    }
  }

  if (!groups.length && (fallback.hotelName || fallback.checkInDate)) {
    const nights = nightsBetween(fallback.checkInDate, fallback.checkOutDate);
    groups.push({
      name: text(fallback.hotelName) || '-',
      city: '',
      rows: [[
        '1',
        escapeHtml(text(fallback.roomDetails) || '-'),
        escapeHtml(formatDate(fallback.checkInDate) || '-'),
        escapeHtml(formatDate(fallback.checkOutDate) || '-'),
        escapeHtml(nights ? String(nights) : '-'),
        '-',
        '-',
      ]],
    });
  }
  return groups;
}

function transportTable(items: ServiceItem[], fallback?: DetailMap): string {
  const rows: string[][] = [];
  for (const item of items) {
    const details = (item.details as DetailMap | null) || {};
    for (const row of rowsOf(details)) {
      const sector = text(row.sector || details.sector || fallback?.sector) || '-';
      const vehicle = text(row.vehicleType || details.vehicleType || fallback?.vehicleType || item.description) || '-';
      rows.push([escapeHtml(sector), escapeHtml(vehicle)]);
    }
  }
  if (!rows.length && fallback && (fallback.sector || fallback.vehicleType || fallback.description)) {
    rows.push([
      escapeHtml(text(fallback.sector) || '-'),
      escapeHtml(text(fallback.vehicleType || fallback.description) || '-'),
    ]);
  }
  if (!rows.length) rows.push(['-', '-']);
  return dataTable(['Sector', 'Transport Type'], rows, ['left', 'left'], { colWidths: ['50%', '50%'] });
}

function pricingTable(doc: CompletePackageDoc): string {
  const booking = doc.booking;
  const currency = booking?.currency || 'PKR';
  const total = number(doc.invoice?.totalAmount ?? booking?.totalAmount);
  const adults = booking?.adults || 0;
  const children = booking?.children || 0;
  const infants = booking?.infants || 0;
  const determined = booking?.priceMode !== 'BREAKDOWN';
  const rows: string[][] = [];

  if (determined) {
    if (adults > 0 && number(booking?.priceAdult) > 0) {
      rows.push(['Price per Adult', money(booking?.priceAdult, currency)]);
    }
    if (children > 0 && number(booking?.priceChild) > 0) {
      rows.push(['Price per Child', money(booking?.priceChild, currency)]);
    }
    if (infants > 0 && number(booking?.priceInfant) > 0) {
      rows.push(['Price per Infant', money(booking?.priceInfant, currency)]);
    }
    rows.push([`<strong>Total Price</strong>`, `<strong>${money(total, currency)}</strong>`]);
  } else {
    const paid = number(doc.invoice?.paidAmount);
    rows.push(['Total Package Amount', money(total, currency)]);
    if (paid > 0) rows.push(['Advance Paid', money(paid, currency)]);
    rows.push([`<strong>Total Price</strong>`, `<strong>${money(total, currency)}</strong>`]);
  }

  return dataTable(['Description', 'Amount'], rows, ['left', 'right'], { colWidths: ['60%', '40%'] });
}

export async function renderCompletePackageHtml(doc: CompletePackageDoc): Promise<string> {
  const booking = doc.booking;
  const customer = booking?.customer;
  const isB2B = customer?.customerType === 'B2B' && !!customer.companyName;
  const guestName = booking?.guestName
    || (isB2B ? text(customer?.contactPerson) : `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim())
    || doc.guestName
    || 'Guest';
  const toLine = isB2B ? (customer!.companyName || guestName) : guestName;
  const isInvoice = doc.documentKind === 'invoice';
  const title = isInvoice ? 'Invoice' : 'Voucher';
  const greetingKind = isInvoice ? 'invoice' : 'voucher';
  const printDate = formatDate(doc.issuedAt || new Date()) || '-';
  const logo = logoDataUri();
  const adults = booking?.adults || 0;
  const children = booking?.children || 0;
  const infants = booking?.infants || 0;
  const totalPax = adults + children + infants;

  const ticketItems = itemsOf(booking, 'TICKET');
  const visaItems = itemsOf(booking, 'VISA');
  const hotelItems = itemsOf(booking, 'HOTEL');
  const transportItems = itemsOf(booking, 'TRANSPORT');
  const included = (['TICKET', 'VISA', 'HOTEL', 'TRANSPORT'] as const)
    .filter((type) => itemsOf(booking, type).length > 0)
    .map((type) => INCLUDE_LABELS[type]);

  const transportFallback = (() => {
    const raw = (doc.transportDetails as DetailMap | null) || {};
    return {
      ...raw,
      sector: raw.sector || [raw.pickupLocation, raw.dropoffLocation].filter(Boolean).join(' - '),
      vehicleType: raw.vehicleType,
      description: raw.description,
    };
  })();

  const hotels = hotelGroups(hotelItems, {
    hotelName: doc.hotelName,
    checkInDate: doc.checkInDate,
    checkOutDate: doc.checkOutDate,
    roomDetails: doc.roomDetails,
  });

  const staff = booking?.createdBy
    ? `${booking.createdBy.firstName || ''} ${booking.createdBy.lastName || ''}`.trim()
    : '';
  const staffPhone = text(booking?.createdBy?.phone);

  const includeRows = (included.length ? included : ['-']).map((label) =>
    `<tr><td style="${TD}">${escapeHtml(label)}</td></tr>`
  ).join('');

  const passengerRows = [
    ...(adults > 0 ? [`<tr><td style="${TD}width:70%;">Adults</td><td style="${TD}width:30%;text-align:center;">${adults}</td></tr>`] : []),
    ...(children > 0 ? [`<tr><td style="${TD}">Children</td><td style="${TD}text-align:center;">${children}</td></tr>`] : []),
    ...(infants > 0 ? [`<tr><td style="${TD}">Infants</td><td style="${TD}text-align:center;">${infants}</td></tr>`] : []),
    `<tr><td style="${TD}"><strong>Total Pax</strong></td><td style="${TD}text-align:center;"><strong>${totalPax}</strong></td></tr>`,
  ].join('');

  const hotelHtml = hotels.map((group) => {
    const cityPart = group.city ? ` (${escapeHtml(group.city)})` : '';
    return `${heading('Accommodation Details')}
      <div style="font-size:14px;font-weight:700;color:${TEXT};margin:0 0 8px;">Hotel Name: ${escapeHtml(group.name)}${cityPart}</div>
      ${dataTable(
        ['QTY', 'Room Type', 'Check In', 'Check Out', 'Nights', 'View', 'Meal Plan'],
        group.rows,
        ['left', 'left', 'left', 'left', 'left', 'left', 'left'],
        { width: '70%', colWidths: ['8%', '18%', '16%', '16%', '10%', '16%', '16%'] },
      )}`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} ${escapeHtml(doc.voucherNumber)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; background: #ffffff; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff !important; color: ${TEXT}; font-family: Arial, Helvetica, sans-serif; font-size: 14px; }
  img { border: 0; }
  .keep-together { page-break-inside: avoid !important; break-inside: avoid !important; }
</style>
</head>
<body style="background:#ffffff;margin:0;padding:0;">
<table id="invoice-root" width="740" cellpadding="0" cellspacing="0" style="width:740px;max-width:100%;margin:0 auto;border-collapse:collapse;position:relative;background:#ffffff;">
  <tr>
    <td style="padding:16px 18px 18px;position:relative;background:#ffffff;">
      ${logo ? `<img src="${logo}" alt="" style="position:absolute;left:50%;top:280px;width:360px;height:235px;margin-left:-180px;opacity:0.065;pointer-events:none;z-index:0;">` : ''}

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;position:relative;z-index:1;">
        <tr>
          <td width="58%" valign="middle" style="width:58%;vertical-align:middle;font-size:14px;color:${TEXT};line-height:1.7;padding:8px 8px 8px 0;">
            <div style="margin-top:10px;"><strong>Date:</strong> ${escapeHtml(printDate)}</div>
            <div style="margin-top:8px;"><strong>To:</strong> ${escapeHtml(toLine)}</div>
          </td>
          <td width="42%" valign="middle" align="right" style="width:42%;vertical-align:middle;text-align:right;">
            ${logo ? `<img src="${logo}" alt="${escapeHtml(BRAND_NAME)}" width="148" height="97" style="width:148px;height:97px;margin:0 0 6px auto;object-fit:contain;object-position:right center;display:block;">` : ''}
            <div style="font-weight:800;font-size:20px;color:${TEXT};margin-top:4px;">${escapeHtml(BRAND_NAME.toUpperCase())}</div>
            <div style="font-weight:700;margin-top:4px;font-size:14px;">${escapeHtml(title)}</div>
          </td>
        </tr>
      </table>

      <hr style="border:2px solid #000;margin:10px 0;">

      <div style="margin:14px 0;font-size:15px;color:${TEXT};line-height:1.6;">Dear ${escapeHtml(guestName)},<br><br>Following is the ${greetingKind} for your booking. We hope it meets your requirement.</div>

      ${heading('Booking Summary')}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid ${BOX_BORDER};margin:0 0 18px;background:${WHITE};">
        <tr>
          <td width="48%" valign="top" style="width:48%;vertical-align:top;padding:12px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
              <thead><tr><th style="${TH}text-align:left;">Booking Includes</th></tr></thead>
              <tbody>${includeRows}</tbody>
            </table>
          </td>
          <td width="4%" style="width:4%;border-left:1px solid ${BORDER};"></td>
          <td width="48%" valign="top" style="width:48%;vertical-align:top;padding:12px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
              <thead><tr><th colspan="2" style="${TH}">Passenger Details</th></tr></thead>
              <tbody>${passengerRows}</tbody>
            </table>
          </td>
        </tr>
      </table>

      ${ticketItems.length ? `${heading('Ticket Details')}${ticketTable(ticketItems)}` : ''}
      ${visaItems.length ? `${heading('Visa Details')}${visaTable(visaItems)}` : ''}
      ${hotelHtml}
      ${transportItems.length || transportFallback.sector || transportFallback.vehicleType
        ? `${heading('Transport Details')}${transportTable(transportItems, transportFallback)}`
        : ''}
      ${heading('Pricing Details')}
      ${pricingTable(doc)}

      <table class="keep-together" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:18px;page-break-inside:avoid;break-inside:avoid;page-break-before:auto;">
        <tr>
          <td style="border-top:6px solid ${NAVY};padding-top:10px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
              <tr>
                <td width="40%"></td>
                <td width="60%" align="right" style="text-align:right;font-size:14px;color:${TEXT};line-height:1.45;">
                  <div style="font-weight:700;">Thanks &amp; Regards</div>
                  ${staff ? `<div>${escapeHtml(staff)}</div>` : ''}
                  ${staffPhone ? `<div><strong>Phone:</strong> ${escapeHtml(staffPhone)}</div>` : ''}
                  <div><strong>Reservation Print Date:</strong> ${escapeHtml(printDate)}</div>
                </td>
              </tr>
            </table>
            <div style="margin-top:16px;line-height:1.5;font-size:13px;color:${TEXT};">
              <strong>${escapeHtml(BRAND_NAME.toUpperCase())}</strong> - ${escapeHtml(FOOTER_ADDRESS)}<br>
              &#9742; ${escapeHtml(FOOTER_PHONE)} &nbsp; | &nbsp; &#9993; ${escapeHtml(FOOTER_EMAIL)} &nbsp; | &nbsp; ${escapeHtml(FOOTER_WEB)}
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
