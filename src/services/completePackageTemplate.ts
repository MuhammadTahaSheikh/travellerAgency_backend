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
    path.join(__dirname, '../../assets/huffaz-holiday-logo.png'),
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

function heading(title: string): string {
  return `<h3>${escapeHtml(title)}</h3>`;
}

function dataTable(headers: string[], rows: string[][], aligns?: Array<'left' | 'center' | 'right'>, fullWidth = false): string {
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell, index) => {
      const align = aligns?.[index] || 'left';
      return `<td style="text-align:${align};">${cell}</td>`;
    }).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">-</td></tr>`;

  return `<table class="centered${fullWidth ? ' full' : ''}">
    <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
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
    );
  }
  return dataTable(
    ['Airline Name', 'Sector', 'Date'],
    rows.map((row) => [escapeHtml(row.airline), escapeHtml(row.sector), escapeHtml(row.depart)]),
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
    );
  }
  return dataTable(
    ['Visa Type'],
    (rows.length ? rows : [{ visaType: 'Umrah', country: '' }]).map((row) => [escapeHtml(row.visaType)]),
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
  return dataTable(['Sector', 'Transport Type'], rows);
}

function pricingTable(doc: CompletePackageDoc): string {
  const booking = doc.booking;
  const currency = booking?.currency || 'PKR';
  const total = number(doc.invoice?.totalAmount ?? booking?.totalAmount);
  const adults = booking?.adults || 0;
  const children = booking?.children || 0;
  const infants = booking?.infants || 0;
  const determined = booking?.priceMode !== 'BREAKDOWN';
  const rows: string[] = [];

  if (determined) {
    if (adults > 0 && number(booking?.priceAdult) > 0) {
      rows.push(`<tr><td>Price per Adult</td><td style="text-align:right">${money(booking?.priceAdult, currency)}</td></tr>`);
    }
    if (children > 0 && number(booking?.priceChild) > 0) {
      rows.push(`<tr><td>Price per Child</td><td style="text-align:right">${money(booking?.priceChild, currency)}</td></tr>`);
    }
    if (infants > 0 && number(booking?.priceInfant) > 0) {
      rows.push(`<tr><td>Price per Infant</td><td style="text-align:right">${money(booking?.priceInfant, currency)}</td></tr>`);
    }
    rows.push(`<tr><td><strong>Total Price</strong></td><td style="text-align:right"><strong>${money(total, currency)}</strong></td></tr>`);
  } else {
    const paid = number(doc.invoice?.paidAmount);
    rows.push(`<tr><td>Total Package Amount</td><td style="text-align:right">${money(total, currency)}</td></tr>`);
    if (paid > 0) rows.push(`<tr><td>Advance Paid</td><td style="text-align:right">${money(paid, currency)}</td></tr>`);
    rows.push(`<tr><td><strong>Total Price</strong></td><td style="text-align:right"><strong>${money(total, currency)}</strong></td></tr>`);
  }

  return `<table class="centered">
    <thead><tr><th>Description</th><th>Amount</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
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
    `<tr><td>${escapeHtml(label)}</td></tr>`
  ).join('');

  const passengerRows = [
    ...(adults > 0 ? [`<tr><td>Adults</td><td>${adults}</td></tr>`] : []),
    ...(children > 0 ? [`<tr><td>Children</td><td>${children}</td></tr>`] : []),
    ...(infants > 0 ? [`<tr><td>Infants</td><td>${infants}</td></tr>`] : []),
    `<tr><td><strong>Total Pax</strong></td><td><strong>${totalPax}</strong></td></tr>`,
  ].join('');

  const hotelHtml = hotels.map((group) => {
    const cityPart = group.city ? ` (${escapeHtml(group.city)})` : '';
    return `<div class="hotel-sector">
      ${heading('Accommodation Details')}
      <div class="hotel-title"><strong>Hotel Name:</strong> ${escapeHtml(group.name)}${cityPart}</div>
      ${dataTable(['QTY', 'Room Type', 'Check In', 'Check Out', 'Nights', 'View', 'Meal Plan'], group.rows, ['center', 'center', 'center', 'center', 'center', 'center', 'center'], true)}
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} ${escapeHtml(doc.voucherNumber)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: ${TEXT};
    font-family: Arial, Helvetica, sans-serif;
    font-size: 14px;
  }
  #invoice-root { position: relative; padding: 8px 4px 12px; background: #ffffff; }
  .quote-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 8px; }
  .quote-left { line-height: 1.6; }
  .quote-right { text-align: center; }
  .quote-title { font-weight: 800; font-size: 20px; margin-top: 4px; color: ${TEXT}; }
  .quote-intro { margin: 14px 0; font-size: 15px; }
  h3 { font-size: 16px; font-weight: 700; margin: 18px 0 8px; color: ${TEXT}; }
  .outer-box {
    display: flex;
    align-items: stretch;
    border: 1px solid ${BOX_BORDER};
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 18px;
    max-width: 1000px;
  }
  .outer-box .box { flex: 1; min-width: 0; display: flex; justify-content: center; }
  .outer-box .box table { width: 100%; max-width: 380px; border-collapse: collapse; }
  .outer-box .box table th, .outer-box .box table td {
    border: 1px solid ${BORDER};
    padding: 8px;
    text-align: left;
    background: ${WHITE};
  }
  .outer-box .divider { border-left: 1px solid ${BORDER}; margin: 0 12px; flex-shrink: 0; }
  table.centered {
    border-collapse: collapse;
    margin: 12px 0;
    width: 70%;
    max-width: 750px;
  }
  table.centered.full { width: 100%; max-width: none; }
  table.centered th, table.centered td {
    border: 1px solid ${BORDER};
    padding: 8px;
    text-align: left;
    background: ${WHITE};
  }
  table.centered thead th,
  .outer-box .box table thead th {
    background: ${NAVY} !important;
    color: ${WHITE} !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .hotel-sector { width: 100%; max-width: 1000px; margin: 18px 0; }
  .hotel-sector table.centered { width: 100%; max-width: none; }
  .hotel-sector th, .hotel-sector td { text-align: center; }
  .hotel-title { margin-bottom: 8px; font-size: 14px; }
  .quotation-closing { border-top: 6px solid ${NAVY}; margin-top: 18px; padding-top: 8px; }
  .closing-signature { text-align: right; line-height: 1.35; }
  .closing-company { margin-top: 24px; line-height: 1.5; font-size: 13px; }
  img { border: 0; }
</style>
</head>
<body>
<div id="invoice-root">
  ${logo ? `<img src="${logo}" alt="" style="position:absolute;left:50%;top:38%;width:520px;margin-left:-260px;opacity:0.065;pointer-events:none;z-index:0;">` : ''}
  <div style="position:relative;z-index:1;">
    <div class="quote-header">
      <div class="quote-left">
        <div style="margin-top:10px;"><strong>Date:</strong> ${escapeHtml(printDate)}</div>
        <div style="margin-top:8px;"><strong>To:</strong> ${escapeHtml(toLine)}</div>
      </div>
      <div class="quote-right">
        ${logo ? `<img src="${logo}" alt="${escapeHtml(BRAND_NAME)}" style="width:120px;height:auto;margin-bottom:6px;object-fit:contain;">` : ''}
        <div class="quote-title">${escapeHtml(BRAND_NAME.toUpperCase())}</div>
        <div style="font-weight:700;margin-top:4px">${escapeHtml(title)}</div>
      </div>
    </div>

    <hr style="border:2px solid #000;margin:10px 0;">

    <div class="quote-intro">Dear ${escapeHtml(guestName)},<br><br>Following is the ${greetingKind} for your booking. We hope it meets your requirement.</div>

    ${heading('Booking Summary')}
    <div class="outer-box">
      <div class="box">
        <table>
          <thead><tr><th>Booking Includes</th></tr></thead>
          <tbody>${includeRows}</tbody>
        </table>
      </div>
      <div class="divider" aria-hidden="true"></div>
      <div class="box">
        <table>
          <thead><tr><th colspan="2" style="text-align:center">Passenger Details</th></tr></thead>
          <tbody>${passengerRows}</tbody>
        </table>
      </div>
    </div>

    ${ticketItems.length ? `${heading('Ticket Details')}${ticketTable(ticketItems)}` : ''}
    ${visaItems.length ? `${heading('Visa Details')}${visaTable(visaItems)}` : ''}
    ${hotelHtml}
    ${transportItems.length || transportFallback.sector || transportFallback.vehicleType
      ? `${heading('Transport Details')}${transportTable(transportItems, transportFallback)}`
      : ''}
    ${heading('Pricing Details')}
    ${pricingTable(doc)}

    <footer class="quotation-closing">
      <div class="closing-signature">
        <strong>Thanks &amp; Regards</strong><br>
        ${staff ? `${escapeHtml(staff)}<br>` : ''}
        ${staffPhone ? `<strong>Phone:</strong> ${escapeHtml(staffPhone)}<br>` : ''}
        <strong>Reservation Print Date:</strong> ${escapeHtml(printDate)}
      </div>
      <div class="closing-company">
        <strong>${escapeHtml(BRAND_NAME.toUpperCase())}</strong> - ${escapeHtml(FOOTER_ADDRESS)}<br>
        &#9742; ${escapeHtml(FOOTER_PHONE)} &nbsp; | &nbsp; &#9993; ${escapeHtml(FOOTER_EMAIL)} &nbsp; | &nbsp; ${escapeHtml(FOOTER_WEB)}
      </div>
    </footer>
  </div>
</div>
</body>
</html>`;
}
