import prisma from '../config/database';
import { escapeHtml } from '../utils/exportHelpers';

type DetailMap = Record<string, unknown>;
type VoucherFormatName = 'COMPLETE' | 'HOTEL' | 'TRANSPORT';

type PatternVoucher = {
  voucherNumber: string;
  guestName: string;
  issuedAt?: Date | null;
  remainingBalance?: unknown;
  paymentStatus?: string | null;
  booking?: {
    bookingNumber: string;
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
    customer?: {
      customerType?: string;
      companyName?: string | null;
      contactPerson?: string | null;
      firstName?: string;
      lastName?: string;
    } | null;
    createdBy?: {
      id?: string;
      firstName?: string;
      lastName?: string;
      phone?: string | null;
    } | null;
    serviceItems?: Array<{
      serviceType: string;
      description: string;
      amount?: unknown;
      details?: unknown;
    }>;
  } | null;
  invoice?: {
    invoiceNumber?: string;
    issueDate?: Date;
    totalAmount?: unknown;
    paidAmount?: unknown;
  } | null;
};

type PatternRenderOptions = {
  title?: string;
  primaryLabel?: string;
  showInvoiceMeta?: boolean;
};

const SERVICE_ORDER = ['TICKET', 'VISA', 'HOTEL', 'TRANSPORT'] as const;

const COLORS = {
  navy: '#063d79',
  blue: '#07529a',
  visa: '#078d91',
  transport: '#087862',
  muted: '#9aa8b6',
  line: '#d4dee8',
  text: '#183153',
};

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown, currency = 'PKR'): string {
  return `${number(value).toLocaleString('en-PK', { maximumFractionDigits: 2 })} ${escapeHtml(currency)}`;
}

function formatDate(value?: string | Date | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(String(value));
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function rowsOf(details: DetailMap): DetailMap[] {
  return Array.isArray(details.rows) && details.rows.length
    ? details.rows.filter((row): row is DetailMap => !!row && typeof row === 'object')
    : [details];
}

function splitSector(value: unknown): [string, string] {
  const parts = text(value).split(/\s*(?:-|–|→|>)\s*/);
  return [parts[0] || '—', parts.slice(1).join(' - ') || '—'];
}

function nightsBetween(start: unknown, end: unknown): number {
  const from = new Date(text(start));
  const to = new Date(text(end));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

function servicePrice(
  item: { amount?: unknown } | undefined,
  details: DetailMap
): number {
  return number(details.saleOriginal) || number(item?.amount);
}

function dataTable(headers: string[], body: string, headerBg: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;table-layout:fixed;">
    <thead><tr>${headers.map((header) =>
      `<th style="background:${headerBg};color:#fff;font-size:7px;padding:5px 3px;text-align:center;border:1px solid ${headerBg};">${escapeHtml(header)}</th>`
    ).join('')}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function emptyRow(columns: number): string {
  return `<tr><td colspan="${columns}" style="border:1px solid ${COLORS.line};padding:8px;text-align:center;color:#94a3b8;font-size:8px;">No details available</td></tr>`;
}

function cells(values: string[]): string {
  return values
    .map((value) => `<td style="border:1px solid ${COLORS.line};color:#334155;font-size:7px;padding:5px 3px;text-align:center;word-wrap:break-word;">${escapeHtml(value)}</td>`)
    .join('');
}

function serviceBlock(num: string, title: string, accent: string, tableHtml: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:8px 0;border:1px solid ${COLORS.line};">
    <tr>
      <td width="42" valign="middle" style="width:42px;background:${accent};color:#fff;font-size:18px;font-weight:800;text-align:center;padding:8px 4px;">${num}</td>
      <td style="padding:6px 8px;">
        <div style="color:${accent};font-size:9px;font-weight:800;text-transform:uppercase;margin-bottom:4px;">${escapeHtml(title)}</div>
        ${tableHtml}
      </td>
    </tr>
  </table>`;
}

function renderTicket(
  items: NonNullable<PatternVoucher['booking']>['serviceItems'],
  showPrice: boolean,
  currency: string,
  num: string
): string {
  const headers = ['Airline', 'Sector', 'Departure', 'Arrival', 'Date', 'Class', 'Qty'];
  if (showPrice) headers.push(`Fare (${currency})`);
  const body = (items || []).flatMap((item) => {
    const details = (item.details as DetailMap | null) || {};
    return rowsOf(details).map((row) => {
      const [departure, arrival] = splitSector(row.sector || details.sector);
      const values = [
        text(row.airline || details.airline) || '—',
        text(row.sector || details.sector) || '—',
        departure,
        arrival,
        formatDate(text(row.date || details.departureDate)),
        text(row.class || details.class) || '—',
        '1',
      ];
      if (showPrice) values.push(money(servicePrice(item, details), currency));
      return `<tr>${cells(values)}</tr>`;
    });
  }).join('');
  return serviceBlock(num, 'Ticket Details', COLORS.blue, dataTable(headers, body || emptyRow(headers.length), COLORS.navy));
}

function renderVisa(
  items: NonNullable<PatternVoucher['booking']>['serviceItems'],
  showPrice: boolean,
  currency: string,
  num: string
): string {
  const headers = ['Visa Type', 'Country', 'Validity', 'Processing Time', 'Qty'];
  if (showPrice) headers.push(`Price (${currency})`);
  const body = (items || []).map((item) => {
    const details = (item.details as DetailMap | null) || {};
    const values = [
      text(details.visaType) || item.description || '—',
      text(details.country) || '—',
      text(details.validity) || '—',
      text(details.processingTime) || '—',
      text(details.quantity) || '1',
    ];
    if (showPrice) values.push(money(servicePrice(item, details), currency));
    return `<tr>${cells(values)}</tr>`;
  }).join('');
  return serviceBlock(num, 'Visa Details', COLORS.visa, dataTable(headers, body || emptyRow(headers.length), COLORS.visa));
}

function renderHotel(
  items: NonNullable<PatternVoucher['booking']>['serviceItems'],
  showPrice: boolean,
  currency: string,
  num: string
): string {
  const headers = ['Hotel Name', 'City', 'Nights', 'Check-in', 'Check-out', 'Room Type', 'Meal Plan', 'Qty', 'Res #'];
  if (showPrice) headers.push(`Total (${currency})`);
  const body = (items || []).flatMap((item) => {
    const details = (item.details as DetailMap | null) || {};
    return rowsOf(details).map((row) => {
      const nights = nightsBetween(row.checkInDate, row.checkOutDate);
      const rooms = number(row.numRooms) || 1;
      const values = [
        text(row.hotelName || details.hotelName) || item.description || '—',
        text(row.city || details.city) || '—',
        String(nights || '—'),
        formatDate(text(row.checkInDate || details.checkInDate)),
        formatDate(text(row.checkOutDate || details.checkOutDate)),
        text(row.roomType || details.roomType) || '—',
        text(row.mealPlan || details.mealPlan) || '—',
        String(rooms),
        text(row.vendorResNo || details.vendorResNo) || '—',
      ];
      if (showPrice) {
        const rowTotal = number(row.salePerNight) * nights * rooms;
        values.push(money(rowTotal || servicePrice(item, details), currency));
      }
      return `<tr>${cells(values)}</tr>`;
    });
  }).join('');
  return serviceBlock(num, 'Hotel Details', COLORS.navy, dataTable(headers, body || emptyRow(headers.length), COLORS.navy));
}

function renderTransport(
  items: NonNullable<PatternVoucher['booking']>['serviceItems'],
  showPrice: boolean,
  currency: string,
  num: string
): string {
  const headers = ['Service Type', 'From', 'To', 'Date', 'Vehicle Type', 'Qty', 'Res #'];
  if (showPrice) headers.push(`Price (${currency})`);
  const body = (items || []).flatMap((item) => {
    const details = (item.details as DetailMap | null) || {};
    return rowsOf(details).map((row) => {
      const [from, to] = splitSector(row.sector || details.sector);
      const values = [
        item.description || 'Transport',
        from,
        to,
        formatDate(text(row.date || details.date || details.transportDate)),
        text(row.vehicleType || details.vehicleType) || '—',
        text(row.quantity || details.quantity) || '1',
        text(row.vendorResNo || details.vendorResNo) || '—',
      ];
      if (showPrice) values.push(money(number(row.sale) || servicePrice(item, details), currency));
      return `<tr>${cells(values)}</tr>`;
    });
  }).join('');
  return serviceBlock(num, 'Transport Details', COLORS.transport, dataTable(headers, body || emptyRow(headers.length), COLORS.transport));
}

async function staffCode(userId?: string): Promise<string> {
  if (!userId) return '01 HHH';
  const users = await prisma.user.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
  const index = users.findIndex((user) => user.id === userId);
  return `${String(index >= 0 ? index + 1 : 1).padStart(2, '0')} HHH`;
}

function pricingSummary(voucher: PatternVoucher, showBreakdown: boolean, currency: string): string {
  const booking = voucher.booking;
  const total = number(voucher.invoice?.totalAmount ?? booking?.totalAmount);
  const paid = number(voucher.invoice?.paidAmount);
  const balance = Math.max(0, total - paid);

  const rows = showBreakdown
    ? [
        ['Total Package Amount', money(total, currency)],
        ['Advance Paid', money(paid, currency)],
        ['Balance Amount', money(balance, currency)],
      ]
    : [
        ...[
          { label: 'Price / Adult', count: booking?.adults || 0, price: booking?.priceAdult },
          { label: 'Price / Child', count: booking?.children || 0, price: booking?.priceChild },
          { label: 'Price / Infant', count: booking?.infants || 0, price: booking?.priceInfant },
        ]
          .filter((row) => row.count > 0)
          .map((row) => [`${row.label} (${row.count})`, money(row.price, currency)] as [string, string]),
        ['Advance Paid', money(paid, currency)],
        ['Balance Amount', money(balance, currency)],
      ];

  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid ${COLORS.line};">
    <tr><td colspan="2" style="background:${COLORS.navy};color:#fff;text-align:center;padding:6px;font-size:9px;font-weight:800;text-transform:uppercase;">Price Summary</td></tr>
    ${rows.map(([label, value]) =>
      `<tr>
        <td style="border-top:1px solid ${COLORS.line};padding:6px 8px;font-size:8px;color:#475569;">${escapeHtml(label)}</td>
        <td style="border-top:1px solid ${COLORS.line};padding:6px 8px;font-size:8px;text-align:right;font-weight:700;color:${label === 'Balance Amount' && balance > 0 ? '#dc2626' : COLORS.text};">${value}</td>
      </tr>`
    ).join('')}
    <tr>
      <td style="background:${COLORS.navy};color:#fff;padding:7px 8px;font-size:8px;font-weight:800;">Total Amount Payable</td>
      <td style="background:${COLORS.navy};color:#fff;padding:7px 8px;font-size:8px;font-weight:800;text-align:right;">${money(total, currency)}</td>
    </tr>
  </table>`;
}

function packageIncludes(included: Set<string>): string {
  const items = SERVICE_ORDER.map((type) => {
    const active = included.has(type);
    const accent = type === 'VISA' ? COLORS.visa : type === 'TRANSPORT' ? COLORS.transport : COLORS.blue;
    const icon = type === 'TICKET' ? '✈' : type === 'HOTEL' ? '⌂' : '◆';
    return `<td width="25%" align="center" style="width:25%;padding:8px 4px;text-align:center;position:relative;">
      <div style="display:inline-block;width:24px;height:24px;line-height:24px;border-radius:50%;background:${active ? accent : '#d5dbe1'};color:#fff;font-size:11px;margin-bottom:4px;">${icon}</div>
      <div style="font-size:8px;font-weight:800;text-transform:uppercase;color:${active ? accent : COLORS.muted};">${type}</div>
      ${active ? '' : `<div style="color:#dc2626;font-size:16px;font-weight:900;line-height:1;">×</div>`}
    </td>`;
  }).join('');

  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid ${COLORS.line};margin-bottom:8px;">
    <tr>${items}</tr>
  </table>`;
}

export async function renderVoucherPatternHtml(
  voucher: PatternVoucher,
  format: VoucherFormatName,
  options: PatternRenderOptions = {}
): Promise<string> {
  const booking = voucher.booking;
  const allItems = booking?.serviceItems || [];
  const permittedTypes = format === 'COMPLETE' ? SERVICE_ORDER : format === 'HOTEL' ? ['HOTEL'] : ['TRANSPORT'];
  const includedTypes = new Set(
    allItems.map((item) => item.serviceType).filter((type) => permittedTypes.includes(type as never))
  );
  const currency = booking?.currency || 'PKR';
  const showBreakdown = booking?.priceMode === 'BREAKDOWN';
  const staff = booking?.createdBy;
  const staffName = `${staff?.firstName || ''} ${staff?.lastName || ''}`.trim();
  const code = await staffCode(staff?.id);
  const customer = booking?.customer;
  const guestName = booking?.guestName
    || (customer?.customerType === 'B2B' ? customer.companyName : `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim())
    || voucher.guestName;
  const title = options.title
    || (format === 'HOTEL' ? 'HOTEL VOUCHER' : format === 'TRANSPORT' ? 'TRANSPORT VOUCHER' : 'TRAVEL VOUCHER');
  const itemsByType = (type: string) => allItems.filter((item) => item.serviceType === type);

  let sectionNo = 1;
  const nextNum = () => String(sectionNo++).padStart(2, '0');
  const sections = [
    includedTypes.has('TICKET') ? renderTicket(itemsByType('TICKET'), showBreakdown, currency, nextNum()) : '',
    includedTypes.has('VISA') ? renderVisa(itemsByType('VISA'), showBreakdown, currency, nextNum()) : '',
    includedTypes.has('HOTEL') ? renderHotel(itemsByType('HOTEL'), showBreakdown, currency, nextNum()) : '',
    includedTypes.has('TRANSPORT') ? renderTransport(itemsByType('TRANSPORT'), showBreakdown, currency, nextNum()) : '',
  ].join('');

  const adults = booking?.adults || 0;
  const children = booking?.children || 0;
  const infants = booking?.infants || 0;
  const issueDate = formatDate(voucher.issuedAt || voucher.invoice?.issueDate || new Date());

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)} ${escapeHtml(voucher.voucherNumber)}</title>
<style>
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; background: #fff; color: ${COLORS.text}; font-family: Arial, Helvetica, sans-serif; font-size: 10px; }
  img { border: 0; }
</style>
</head>
<body>
<table width="780" cellpadding="0" cellspacing="0" style="width:780px;max-width:100%;margin:0 auto;border-collapse:collapse;border:1px solid ${COLORS.line};">
  <tr>
    <td style="padding:14px 16px 10px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <tr>
          <td width="28%" valign="top" style="width:28%;vertical-align:top;">
            <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <td style="border:3px solid ${COLORS.blue};color:${COLORS.blue};font-size:20px;font-weight:900;padding:2px 6px;line-height:1;">HH</td>
                <td style="padding-left:8px;color:${COLORS.blue};font-size:15px;font-weight:900;line-height:1.05;">
                  HUFFAZ<br><span style="font-size:8px;letter-spacing:2px;">HOLIDAY</span>
                </td>
              </tr>
            </table>
            <div style="color:#5682ad;font-size:7px;margin-top:5px;">Your Journey, Our Priority</div>
          </td>
          <td width="36%" align="center" valign="middle" style="width:36%;text-align:center;vertical-align:middle;">
            <div style="font-family:Georgia, serif;font-size:24px;font-weight:700;color:${COLORS.navy};letter-spacing:1px;">${escapeHtml(title)}</div>
            <div style="width:70px;border-top:2px solid ${COLORS.navy};margin:6px auto 0;position:relative;"></div>
          </td>
          <td width="36%" valign="top" style="width:36%;vertical-align:top;font-size:8px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
              <tr><td style="padding:2px 0;color:${COLORS.navy};font-weight:700;width:78px;">${escapeHtml(options.primaryLabel || 'Voucher No.')}</td><td style="padding:2px 0;">${escapeHtml(voucher.voucherNumber)}</td></tr>
              ${options.showInvoiceMeta === false ? '' : `<tr><td style="padding:2px 0;color:${COLORS.navy};font-weight:700;">Invoice No.</td><td style="padding:2px 0;">${escapeHtml(voucher.invoice?.invoiceNumber || '—')}</td></tr>`}
              <tr><td style="padding:2px 0;color:${COLORS.navy};font-weight:700;">Booking Ref.</td><td style="padding:2px 0;">${escapeHtml(booking?.bookingNumber || '—')}</td></tr>
              <tr><td style="padding:2px 0;color:${COLORS.navy};font-weight:700;">Issue Date</td><td style="padding:2px 0;">${issueDate}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-top:12px;">
        <tr>
          <td width="68%" valign="bottom" style="width:68%;vertical-align:bottom;line-height:1.55;color:#334155;padding-right:16px;">
            <strong style="font-size:11px;">Dear ${escapeHtml(guestName)},</strong><br>
            Thank you for choosing Huffaz Holiday.<br>
            Please find below the details of your travel arrangements.
          </td>
          <td width="32%" valign="top" style="width:32%;vertical-align:top;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid ${COLORS.line};">
              <tr><td colspan="2" style="background:${COLORS.navy};color:#fff;text-align:center;padding:5px;font-size:8px;font-weight:800;text-transform:uppercase;">Passenger Details</td></tr>
              <tr><td style="border-top:1px solid ${COLORS.line};padding:4px 8px;font-size:8px;">Adults</td><td style="border-top:1px solid ${COLORS.line};padding:4px 8px;font-size:8px;text-align:center;font-weight:700;">${adults}</td></tr>
              <tr><td style="border-top:1px solid ${COLORS.line};padding:4px 8px;font-size:8px;">Children</td><td style="border-top:1px solid ${COLORS.line};padding:4px 8px;font-size:8px;text-align:center;font-weight:700;">${children}</td></tr>
              <tr><td style="border-top:1px solid ${COLORS.line};padding:4px 8px;font-size:8px;">Infants</td><td style="border-top:1px solid ${COLORS.line};padding:4px 8px;font-size:8px;text-align:center;font-weight:700;">${infants}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <div style="text-align:center;font-size:11px;font-weight:800;text-transform:uppercase;color:#1f2937;margin:12px 0 6px;">Package Includes</div>
      ${packageIncludes(includedTypes)}
      ${sections}

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-top:8px;">
        <tr>
          <td width="50%" valign="top" style="width:50%;vertical-align:top;padding-right:8px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid ${COLORS.line};min-height:120px;">
              <tr><td style="padding:8px 10px;">
                <div style="color:${COLORS.navy};font-size:8px;font-weight:800;text-transform:uppercase;margin-bottom:5px;">Important Notes</div>
                <ul style="margin:0;padding-left:14px;color:#475569;font-size:8px;line-height:1.5;">
                  <li>Please verify all names, dates and reservation details.</li>
                  <li>Carry valid travel documents and identification.</li>
                  <li>Hotel and transport timings are subject to supplier confirmation.</li>
                  <li>Changes and cancellations are subject to applicable charges.</li>
                </ul>
                ${booking?.notes ? `<div style="margin-top:6px;font-size:8px;"><b>Booking note:</b> ${escapeHtml(booking.notes)}</div>` : ''}
                <div style="margin-top:8px;font-size:7px;color:#64748b;">
                  Reservation given by
                  <span style="font-family:'Brush Script MT',cursive;color:#355b89;font-size:14px;margin-left:4px;">${escapeHtml(staffName || 'Huffaz Holiday')}</span>
                </div>
              </td></tr>
            </table>
          </td>
          <td width="50%" valign="top" style="width:50%;vertical-align:top;padding-left:8px;">
            ${pricingSummary(voucher, showBreakdown, currency)}
          </td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-top:12px;">
        <tr>
          <td width="48%" valign="bottom" style="width:48%;vertical-align:bottom;font-size:8px;color:#64748b;">
            Chairman Huffaz Holiday<br>
            <span style="display:inline-block;margin-top:3px;color:#31567d;font-size:10px;font-weight:700;">Allama Ibtisam Elahi Zaheer</span>
          </td>
          <td width="52%" align="right" valign="bottom" style="width:52%;text-align:right;vertical-align:bottom;">
            <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:2px solid ${COLORS.navy};display:inline-block;text-align:center;">
              <tr><td style="padding:8px 12px;line-height:1.45;">
                <div style="color:${COLORS.navy};font-size:12px;font-weight:700;">Thanks &amp; Regards</div>
                <div style="font-size:12px;font-weight:800;margin-top:2px;">${escapeHtml(code)} - ${escapeHtml((staffName || 'HUFFAZ HOLIDAY').toUpperCase())}</div>
                ${staff?.phone ? `<div style="font-size:9px;margin-top:2px;"><span style="color:${COLORS.navy};font-weight:700;">Phone:</span> ${escapeHtml(staff.phone)}</div>` : ''}
                <div style="font-size:9px;margin-top:2px;"><span style="color:${COLORS.navy};font-weight:700;">Reservation Print Date:</span> ${formatDate(new Date())}</div>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>

      <div style="border-top:2px solid ${COLORS.navy};margin-top:10px;padding-top:6px;font-size:7px;color:#335b82;text-align:center;">
        243 TIP, Main Boulevard Near Defence Road, Lahore &nbsp;|&nbsp; +92-320-7000721 &nbsp;|&nbsp; huffazholiday@gmail.com &nbsp;|&nbsp; www.huffazholiday.com
      </div>
    </td>
  </tr>
</table>
</body></html>`;
}
