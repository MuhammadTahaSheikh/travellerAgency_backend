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
const SUMMARY_BG = '#cccccc';
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
  return `${escapeHtml(currency)} ${number(value).toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}/-`;
}

function dataTable(headers: string[], rows: string[][], aligns?: Array<'left' | 'center' | 'right'>): string {
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell, index) => {
      const align = aligns?.[index] || 'center';
      return `<td style="border:1px solid ${BORDER};padding:8px 6px;text-align:${align};font-size:13px;font-weight:400;color:${TEXT};background:transparent;">${cell}</td>`;
    }).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}" style="border:1px solid ${BORDER};padding:8px;text-align:center;color:#94a3b8;background:${WHITE};">—</td></tr>`;

  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:8px 0 18px;background:${WHITE};">
    <thead><tr>${headers.map((header) =>
      `<th style="background:${NAVY};color:${WHITE};font-size:13px;font-weight:700;padding:10px 6px;text-align:center;border:1px solid ${BORDER};">${escapeHtml(header)}</th>`
    ).join('')}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function sectionTitle(title: string): string {
  return `<div style="font-size:16px;font-weight:700;color:${TEXT};margin:18px 0 8px;">${escapeHtml(title)}</div>`;
}

function ticketRows(items: ServiceItem[]): string[][] {
  return items.flatMap((item) => {
    const details = (item.details as DetailMap | null) || {};
    const airline = text(details.airline) || item.description || '';
    const nested = Array.isArray(details.rows) && details.rows.length
      ? (details.rows as DetailMap[])
      : [];
    if (nested.some((row) => text(row.sector) || text(row.date))) {
      return nested.map((row) => [
        escapeHtml(airline),
        escapeHtml(text(row.sector || details.sector)),
        escapeHtml(formatDate(text(row.date || details.departureDate))),
        escapeHtml(formatDate(text(row.returnDate || details.returnDate))),
      ]);
    }
    return [[
      escapeHtml(airline),
      escapeHtml(text(details.sector)),
      escapeHtml(formatDate(text(details.departureDate))),
      escapeHtml(formatDate(text(details.returnDate))),
    ]];
  });
}

function visaRows(items: ServiceItem[]): string[][] {
  return items.map((item) => {
    const details = (item.details as DetailMap | null) || {};
    return [escapeHtml(text(details.visaType) || item.description || 'Visa')];
  });
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
          escapeHtml(text(row.roomType || details.roomType || fallback.roomDetails)),
          escapeHtml(formatDate(checkIn)),
          escapeHtml(formatDate(checkOut)),
          escapeHtml(nights ? String(nights) : ''),
          escapeHtml(text(row.view || details.view)),
          escapeHtml(text(row.mealPlan || details.mealPlan)),
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
        escapeHtml(text(fallback.roomDetails)),
        escapeHtml(formatDate(fallback.checkInDate)),
        escapeHtml(formatDate(fallback.checkOutDate)),
        escapeHtml(nights ? String(nights) : ''),
        '',
        '',
      ]],
    });
  }
  return groups;
}

function transportRows(items: ServiceItem[], fallback?: DetailMap): string[][] {
  const rows: string[][] = [];
  for (const item of items) {
    const details = (item.details as DetailMap | null) || {};
    for (const row of rowsOf(details)) {
      const sector = text(row.sector || details.sector || fallback?.sector) || '-';
      const vehicle = text(row.vehicleType || details.vehicleType || fallback?.vehicleType || item.description);
      rows.push([escapeHtml(sector), escapeHtml(vehicle)]);
    }
  }
  if (!rows.length && fallback && (fallback.sector || fallback.vehicleType || fallback.description)) {
    rows.push([
      escapeHtml(text(fallback.sector) || '-'),
      escapeHtml(text(fallback.vehicleType || fallback.description)),
    ]);
  }
  return rows;
}

function boldCell(label: string, value: string): string[] {
  return [
    `<span style="font-weight:700;">${label}</span>`,
    `<span style="font-weight:700;">${value}</span>`,
  ];
}

function invoicePricingRows(doc: CompletePackageDoc): string[][] {
  const currency = doc.booking?.currency || 'PKR';
  const invoice = doc.invoice;
  const items = invoice?.items || [];
  const rows: string[][] = [];

  for (const item of items) {
    const qty = Number(item.quantity) || 1;
    const label = qty > 1 ? `${item.description || 'Service'} × ${qty}` : (item.description || 'Service');
    rows.push([escapeHtml(label), money(item.amount ?? item.unitPrice, currency)]);
  }

  if (number(invoice?.subtotal)) rows.push(['Subtotal', money(invoice?.subtotal, currency)]);
  if (number(invoice?.tax)) rows.push(['Tax', money(invoice?.tax, currency)]);
  if (number(invoice?.discount)) rows.push(['Discount', money(invoice?.discount, currency)]);

  const total = number(invoice?.totalAmount ?? doc.booking?.totalAmount);
  const paid = number(invoice?.paidAmount);
  rows.push(boldCell('Total Amount', money(total, currency)));
  if (paid > 0) rows.push(['Paid', money(paid, currency)]);
  rows.push(boldCell('Balance Due', money(Math.max(0, total - paid), currency)));
  return rows.length ? rows : [boldCell('Total Amount', money(total, currency))];
}

function voucherPricingRows(doc: CompletePackageDoc): string[][] {
  const booking = doc.booking;
  const currency = booking?.currency || 'PKR';
  const total = number(doc.invoice?.totalAmount ?? booking?.totalAmount);
  const paid = number(doc.invoice?.paidAmount);
  const adults = booking?.adults || 0;
  const children = booking?.children || 0;
  const infants = booking?.infants || 0;
  const determined = booking?.priceMode !== 'BREAKDOWN';

  if (determined) {
    const rows: string[][] = [];
    if (adults > 0) rows.push(['Price per Adult', money(booking?.priceAdult, currency)]);
    if (children > 0) rows.push(['Price per Child', money(booking?.priceChild, currency)]);
    if (infants > 0) rows.push(['Price per Infant', money(booking?.priceInfant, currency)]);
    rows.push(boldCell('Total Price', money(total, currency)));
    return rows;
  }

  return [
    ['Total Package Amount', money(total, currency)],
    ['Advance Paid', money(paid, currency)],
    ['Balance Amount', money(Math.max(0, total - paid), currency)],
    boldCell('Total Price', money(total, currency)),
  ];
}

function pricingRows(doc: CompletePackageDoc): string[][] {
  return doc.documentKind === 'invoice' ? invoicePricingRows(doc) : voucherPricingRows(doc);
}

export async function renderCompletePackageHtml(doc: CompletePackageDoc): Promise<string> {
  const booking = doc.booking;
  const customer = booking?.customer;
  const isB2B = customer?.customerType === 'B2B' && !!customer.companyName;
  const guestName = booking?.guestName
    || (isB2B ? text(customer?.contactPerson) : `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim())
    || doc.guestName;
  const toLine = isB2B ? (customer!.companyName || guestName) : guestName;
  const firstName = (isB2B ? (customer?.contactPerson || guestName) : guestName).split(' ')[0] || guestName;
  const isInvoice = doc.documentKind === 'invoice';
  const title = isInvoice ? 'Invoice' : 'Voucher';
  const numberLabel = isInvoice ? 'Invoice No' : 'Voucher No';
  const docNumber = isInvoice
    ? (doc.invoice?.invoiceNumber || doc.voucherNumber)
    : doc.voucherNumber;
  const dueDate = isInvoice ? formatDate(doc.invoice?.dueDate) : '';
  const greeting = isInvoice
    ? 'Following is the invoice for your booking. We hope it meets your requirement.'
    : 'Following is the voucher for your booking. We hope it meets your requirement.';
  const printDate = formatDate(doc.issuedAt || new Date());
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
  const tickets = ticketRows(ticketItems);
  const visas = visaRows(visaItems);
  const transports = transportRows(transportItems, transportFallback);
  const prices = pricingRows(doc);

  const staff = booking?.createdBy
    ? `${booking.createdBy.firstName || ''} ${booking.createdBy.lastName || ''}`.trim()
    : '';
  const staffPhone = text(booking?.createdBy?.phone);

  const passengerRows = [
    ['Adults', String(adults)],
    ...(children > 0 ? [['Children', String(children)]] : []),
    ...(infants > 0 ? [['Infants', String(infants)]] : []),
    [
      `<span style="font-weight:700;">Total Pax</span>`,
      `<span style="font-weight:700;">${totalPax || ''}</span>`,
    ],
  ];

  const includeRows = (included.length ? included : ['—']).map((label) =>
    `<tr><td style="border:1px solid ${BORDER};padding:9px 10px;font-size:14px;color:${TEXT};background:${WHITE};">${escapeHtml(label)}</td></tr>`
  ).join('');

  const passengerHtml = passengerRows.map((row) =>
    `<tr>
      <td style="border:1px solid ${BORDER};padding:9px 10px;font-size:14px;color:${TEXT};background:${WHITE};width:70%;">${row[0]}</td>
      <td style="border:1px solid ${BORDER};padding:9px 10px;font-size:14px;color:${TEXT};background:${WHITE};text-align:center;">${row[1]}</td>
    </tr>`
  ).join('');

  const hotelHtml = hotels.map((group) => {
    const cityPart = group.city ? ` (${escapeHtml(group.city)})` : '';
    return `${sectionTitle('Accommodation Details')}
      <div style="font-size:14px;font-weight:700;color:${TEXT};margin:0 0 6px;">Hotel Name: ${escapeHtml(group.name)}${cityPart}</div>
      ${dataTable(['QTY', 'Room Type', 'Check In', 'Check Out', 'Nights', 'View', 'Meal Plan'], group.rows)}`;
  }).join('');

  const watermark = logo
    ? `<img src="${logo}" alt="" style="position:absolute;left:50%;top:280px;width:380px;height:380px;margin-left:-190px;opacity:0.09;pointer-events:none;z-index:0;" />
       <img src="${logo}" alt="" style="position:absolute;left:50%;top:920px;width:340px;height:340px;margin-left:-170px;opacity:0.08;pointer-events:none;z-index:0;" />`
    : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)} ${escapeHtml(docNumber)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm 12mm; background: #ffffff; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff !important; color: ${TEXT}; font-family: Arial, Helvetica, sans-serif; font-size: 13px; }
  img { border: 0; }
</style>
</head>
<body style="background:#ffffff;margin:0;padding:0;">
<table width="780" cellpadding="0" cellspacing="0" style="width:780px;max-width:100%;margin:0 auto;border-collapse:collapse;position:relative;background:#ffffff;">
  <tr>
    <td style="padding:18px 22px 16px;position:relative;background:#ffffff;">
      ${watermark}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <tr>
          <td width="55%" valign="top" style="width:55%;vertical-align:top;font-size:14px;font-weight:700;color:${TEXT};line-height:1.8;">
            Date: ${escapeHtml(printDate)}<br>
            To: ${escapeHtml(toLine)}<br>
            ${escapeHtml(numberLabel)}: ${escapeHtml(docNumber)}${dueDate ? `<br>Due Date: ${escapeHtml(dueDate)}` : ''}
          </td>
          <td width="45%" valign="top" align="right" style="width:45%;vertical-align:top;text-align:right;">
            ${logo ? `<img src="${logo}" alt="${escapeHtml(BRAND_NAME)}" width="118" height="80" style="width:118px;height:80px;object-fit:contain;display:inline-block;" />` : ''}
            <div style="font-size:18px;font-weight:700;color:${TEXT};margin-top:4px;letter-spacing:0.2px;">${escapeHtml(BRAND_NAME.toUpperCase())}</div>
            <div style="font-size:22px;font-weight:700;color:${NAVY};margin-top:4px;letter-spacing:0.4px;">${escapeHtml(title)}</div>
          </td>
        </tr>
      </table>

      <div style="border-top:3px solid #000;margin:14px 0 16px;"></div>

      <div style="font-size:13px;color:${TEXT};line-height:1.7;">
        Dear ${escapeHtml(firstName)},<br><br>
        ${escapeHtml(greeting)}
      </div>

      ${sectionTitle('Booking Summary')}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;background:${SUMMARY_BG};">
        <tr>
          <td style="padding:12px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
              <tr>
                <td width="48%" valign="top" style="width:48%;vertical-align:top;padding-right:10px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
                    <tr><th style="background:${NAVY};color:${WHITE};font-size:14px;font-weight:700;padding:10px;text-align:left;border:1px solid ${BORDER};">Booking Includes</th></tr>
                    ${includeRows}
                  </table>
                </td>
                <td width="52%" valign="top" style="width:52%;vertical-align:top;padding-left:10px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
                    <tr><th colspan="2" style="background:${NAVY};color:${WHITE};font-size:14px;font-weight:700;padding:10px;text-align:left;border:1px solid ${BORDER};">Passenger Details</th></tr>
                    ${passengerHtml}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      ${tickets.length ? `${sectionTitle('Ticket Details')}${dataTable(['Airline Name', 'Sector', 'Departure Date', 'Return Date'], tickets)}` : ''}
      ${visas.length ? `${sectionTitle('Visa Details')}${dataTable(['Visa Type'], visas, ['left'])}` : ''}
      ${hotelHtml}
      ${transports.length ? `${sectionTitle('Transport Details')}${dataTable(['Sector', 'Transport Type'], transports, ['left', 'left'])}` : ''}
      ${sectionTitle('Pricing Details')}${dataTable(['Description', 'Amount'], prices, ['left', 'right'])}

      <div style="border-top:5px solid ${NAVY};margin:22px 0 14px;"></div>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <tr>
          <td width="50%"></td>
          <td width="50%" align="right" style="text-align:right;font-size:14px;color:${TEXT};line-height:1.55;">
            <div style="font-weight:700;">Thanks &amp; Regards</div>
            ${staff ? `<div style="font-weight:400;">${escapeHtml(staff)}</div>` : ''}
            ${staffPhone ? `<div style="font-weight:700;">Phone: ${escapeHtml(staffPhone)}</div>` : ''}
            <div style="font-weight:700;">Reservation Print Date: ${escapeHtml(printDate)}</div>
          </td>
        </tr>
      </table>

      <div style="margin-top:22px;font-size:11px;color:${TEXT};line-height:1.7;">
        <span style="font-weight:700;">${escapeHtml(BRAND_NAME.toUpperCase())} - ${escapeHtml(FOOTER_ADDRESS)}</span><br>
        <span style="font-weight:400;">&#128222; ${escapeHtml(FOOTER_PHONE)} &nbsp; | &nbsp; &#9993; ${escapeHtml(FOOTER_EMAIL)} &nbsp; | &nbsp; ${escapeHtml(FOOTER_WEB)}</span>
      </div>
    </td>
  </tr>
</table>
</body></html>`;
}
