import { escapeHtml } from '../utils/exportHelpers';
import { BRAND_NAME } from './documentBrand';
import { flightPathGraphic, getLogoDataUri, icons, sectionIcon, serviceIcon, BLUE as ICON_BLUE } from './invoicePatternIcons';

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
  baseUrl?: string;
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

const FOOTER_ADDRESS = '243-TIP Link Main Boulevard, Khayaban-e-Amin Near Defence Road, Lahore';
const FOOTER_PHONES = ['+92-320-4455954', '+92-316-6666661'];
const FOOTER_WEBSITE = 'www.huffazholiday.com';

const IMPORTANT_NOTES_UR = [
  'براہ کرم تمام نام، تاریخیں اور ریزرویشن کی تفصیلات کی تصدیق کر لیں۔',
  'سفر کے دوران درست شناختی دستاویزات اور پاسپورٹ ساتھ رکھیں۔',
  'ہوٹل اور ٹرانسپورٹ کے اوقات سپلائر کنفرمیشن کے مطابق ہوں گے۔',
  'تبدیلی اور کینسلیشن پر لاگو چارجز لاگو ہوں گے۔',
];

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

function moneySummary(value: unknown): string {
  return `${number(value).toLocaleString('en-PK', { maximumFractionDigits: 0 })}/-`;
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
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;table-layout:fixed;border-radius:6px;overflow:hidden;">
    <thead><tr>${headers.map((header) =>
      `<th style="background:${headerBg};color:#fff;font-size:7px;padding:5px 3px;text-align:center;border:1px solid ${headerBg};font-weight:700;">${escapeHtml(header)}</th>`
    ).join('')}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function emptyRow(columns: number): string {
  return `<tr><td colspan="${columns}" style="border:1px solid ${COLORS.line};padding:8px;text-align:center;color:#94a3b8;font-size:8px;">—</td></tr>`;
}

function cells(values: string[]): string {
  return values
    .map((value) => `<td style="border:1px solid ${COLORS.line};color:#334155;font-size:7px;padding:5px 3px;text-align:center;word-wrap:break-word;">${escapeHtml(value)}</td>`)
    .join('');
}

function serviceBlock(num: string, title: string, accent: string, tableHtml: string, type: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:10px 0;border:1px solid ${COLORS.line};border-radius:8px;overflow:hidden;">
    <tr>
      <td width="46" valign="top" style="width:46px;background:${accent};padding:10px 6px;vertical-align:top;">
        <div style="background:#fff;color:${accent};font-size:14px;font-weight:800;text-align:center;padding:5px 2px;line-height:1;border-radius:2px;">${num}</div>
      </td>
      <td style="padding:8px 10px 10px;background:#fff;">
        <div style="color:${accent};font-size:9px;font-weight:800;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:center;gap:4px;">
          ${sectionIcon(type, accent)} ${escapeHtml(title)}
        </div>
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
  return serviceBlock(num, 'Ticket Details', COLORS.navy, dataTable(headers, body || emptyRow(headers.length), COLORS.navy), 'TICKET');
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
  return serviceBlock(num, 'Visa Details', COLORS.visa, dataTable(headers, body || emptyRow(headers.length), COLORS.visa), 'VISA');
}

function renderHotel(
  items: NonNullable<PatternVoucher['booking']>['serviceItems'],
  showPrice: boolean,
  currency: string,
  num: string
): string {
  const headers = ['Hotel Name', 'City', 'Nights', 'Check-in', 'Check-out', 'Room Type', 'Meal Plan', 'Qty'];
  if (showPrice) headers.push('Rate Per Night (SR)', `Total (${currency})`);
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
      ];
      if (showPrice) {
        const ratePerNight = number(row.salePerNight);
        const rowTotal = ratePerNight * nights * rooms;
        values.push(ratePerNight ? money(ratePerNight, 'SR') : '—');
        values.push(money(rowTotal || servicePrice(item, details), currency));
      }
      return `<tr>${cells(values)}</tr>`;
    });
  }).join('');
  return serviceBlock(num, 'Hotel Details', COLORS.navy, dataTable(headers, body || emptyRow(headers.length), COLORS.navy), 'HOTEL');
}

function renderTransport(
  items: NonNullable<PatternVoucher['booking']>['serviceItems'],
  showPrice: boolean,
  currency: string,
  num: string
): string {
  const headers = ['Service Type', 'From', 'To', 'Date', 'Vehicle Type', 'Qty'];
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
      ];
      if (showPrice) values.push(money(number(row.sale) || servicePrice(item, details), currency));
      return `<tr>${cells(values)}</tr>`;
    });
  }).join('');
  return serviceBlock(num, 'Transport Details', COLORS.transport, dataTable(headers, body || emptyRow(headers.length), COLORS.transport), 'TRANSPORT');
}

function pricingSummary(voucher: PatternVoucher, showBreakdown: boolean, currency: string): string {
  const booking = voucher.booking;
  const total = number(voucher.invoice?.totalAmount ?? booking?.totalAmount);
  const paid = number(voucher.invoice?.paidAmount);
  const balance = Math.max(0, total - paid);

  const rows: Array<[string, string, boolean]> = showBreakdown
    ? [
        ['Total Package Amount', moneySummary(total), false],
        ['Advance Paid', moneySummary(paid), false],
        ['Balance Amount', moneySummary(balance), true],
      ]
    : [
        ...[
          { label: 'Price per Adult', count: booking?.adults || 0, price: booking?.priceAdult },
          { label: 'Price per Child', count: booking?.children || 0, price: booking?.priceChild },
          { label: 'Price per Infant', count: booking?.infants || 0, price: booking?.priceInfant },
        ]
          .filter((row) => row.count > 0)
          .map((row) => [`${row.label}`, moneySummary(row.price), false] as [string, string, boolean]),
        ['Advance Paid', moneySummary(paid), false],
        ['Balance Amount', moneySummary(balance), true],
      ];

  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid ${COLORS.line};border-radius:8px;overflow:hidden;">
    <tr><td colspan="3" style="background:${COLORS.navy};color:#fff;text-align:center;padding:6px;font-size:9px;font-weight:800;text-transform:uppercase;">Price Summary</td></tr>
    ${rows.map(([label, value, highlight]) =>
      `<tr>
        <td style="border-top:1px solid ${COLORS.line};padding:6px 8px;font-size:8px;color:#475569;width:52%;">${escapeHtml(label)}</td>
        <td style="border-top:1px solid ${COLORS.line};padding:6px 8px;font-size:8px;text-align:center;color:#64748b;width:14%;">${escapeHtml(currency)}</td>
        <td style="border-top:1px solid ${COLORS.line};padding:6px 8px;font-size:8px;text-align:right;font-weight:700;color:${highlight ? '#dc2626' : COLORS.text};width:34%;">${value}</td>
      </tr>`
    ).join('')}
    <tr>
      <td style="background:${COLORS.navy};color:#fff;padding:7px 8px;font-size:8px;font-weight:800;">Total Amount Payable</td>
      <td style="background:${COLORS.navy};color:#fff;padding:7px 8px;font-size:8px;font-weight:800;text-align:center;">${escapeHtml(currency)}</td>
      <td style="background:${COLORS.navy};color:#fff;padding:7px 8px;font-size:8px;font-weight:800;text-align:right;">${moneySummary(total)}</td>
    </tr>
  </table>`;
}

function packageIncludes(included: Set<string>): string {
  const items = SERVICE_ORDER.map((type, index) => {
    const active = included.has(type);
    const accent = type === 'VISA' ? COLORS.visa : type === 'TRANSPORT' ? COLORS.transport : COLORS.blue;
    const divider = index < SERVICE_ORDER.length - 1 ? `border-right:1px solid ${COLORS.line};` : '';
    return `<td width="25%" align="center" style="width:25%;padding:12px 4px 10px;text-align:center;${divider}">
      ${serviceIcon(type, active, accent)}
      <div style="font-size:8px;font-weight:800;text-transform:uppercase;color:${active ? accent : COLORS.muted};margin-top:5px;">${type}</div>
    </td>`;
  }).join('');

  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:10px 0 8px;">
    <tr>
      <td width="32%" style="border-bottom:1px solid ${COLORS.line};"></td>
      <td align="center" style="white-space:nowrap;padding:0 10px 4px;font-size:8px;font-weight:800;text-transform:uppercase;color:${COLORS.navy};letter-spacing:0.5px;">Package Includes</td>
      <td width="32%" style="border-bottom:1px solid ${COLORS.line};"></td>
    </tr>
    <tr><td colspan="3" style="padding-top:6px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid ${COLORS.line};border-radius:8px;overflow:hidden;">
        <tr>${items}</tr>
      </table>
    </td></tr>
  </table>`;
}

function passengerDetails(adults: number, children: number, infants: number): string {
  const row = (icon: string, label: string, count: number) =>
    `<tr>
      <td style="border-top:1px solid ${COLORS.line};padding:5px 8px;font-size:8px;width:26px;text-align:center;">${icon}</td>
      <td style="border-top:1px solid ${COLORS.line};padding:5px 8px;font-size:8px;color:#475569;">${label}</td>
      <td style="border-top:1px solid ${COLORS.line};padding:5px 8px;font-size:8px;text-align:center;font-weight:700;width:36px;color:${COLORS.text};">${count}</td>
    </tr>`;

  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid ${COLORS.line};border-radius:6px;overflow:hidden;">
    <tr><td colspan="3" style="background:${COLORS.navy};color:#fff;text-align:center;padding:5px;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0.3px;">Passenger Details</td></tr>
    ${row(icons.adults, 'Adults', adults)}
    ${row(icons.child, 'Children', children)}
    ${row(icons.infant, 'Infants', infants)}
  </table>`;
}

function brandHeader(): string {
  const logoSrc = getLogoDataUri();
  const logoBlock = logoSrc
    ? `<img src="${logoSrc}" alt="${escapeHtml(BRAND_NAME)}" style="max-height:58px;max-width:200px;object-fit:contain;display:block;" />`
    : `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td style="border:3px solid ${ICON_BLUE};color:${ICON_BLUE};font-size:20px;font-weight:900;padding:2px 6px;line-height:1;">H</td>
          <td style="padding-left:8px;color:${ICON_BLUE};font-size:15px;font-weight:900;line-height:1.05;">
            HUFFAZ<br><span style="font-size:8px;letter-spacing:2px;">HOLIDAY</span>
          </td>
        </tr>
      </table>`;

  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
    <tr>
      <td width="30%" valign="top" style="width:30%;vertical-align:top;">
        ${logoBlock}
        <div style="color:#5682ad;font-size:7px;margin-top:4px;font-style:italic;">Your Journey, Our Priority</div>
      </td>
      <td width="36%" align="center" valign="middle" style="width:36%;text-align:center;vertical-align:middle;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;color:${COLORS.navy};letter-spacing:2px;">{{TITLE}}</div>
        <div style="margin:7px auto 0;width:90px;border-top:2px solid ${COLORS.navy};position:relative;text-align:center;">
          <span style="display:inline-block;margin-top:-8px;background:#fff;padding:0 5px;color:${COLORS.blue};font-size:12px;font-weight:700;">+</span>
        </div>
      </td>
      <td width="34%" valign="top" style="width:34%;vertical-align:top;font-size:8px;">
        ${flightPathGraphic()}
        {{META}}
      </td>
    </tr>
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
  const invoiceDate = formatDate(voucher.invoice?.issueDate || voucher.issuedAt || new Date());

  const metaRows = [
    `<tr><td style="padding:2px 0;color:${COLORS.navy};font-weight:700;white-space:nowrap;">${escapeHtml(options.primaryLabel || 'Voucher No.')} :</td><td style="padding:2px 0 2px 6px;">${escapeHtml(voucher.voucherNumber)}</td></tr>`,
    options.showInvoiceMeta !== false && voucher.invoice?.invoiceNumber
      ? `<tr><td style="padding:2px 0;color:${COLORS.navy};font-weight:700;">Invoice No. :</td><td style="padding:2px 0 2px 6px;">${escapeHtml(voucher.invoice.invoiceNumber)}</td></tr>`
      : '',
    `<tr><td style="padding:2px 0;color:${COLORS.navy};font-weight:700;">Date :</td><td style="padding:2px 0 2px 6px;">${invoiceDate}</td></tr>`,
    `<tr><td style="padding:2px 0;color:${COLORS.navy};font-weight:700;">Booking Ref. :</td><td style="padding:2px 0 2px 6px;">${escapeHtml(booking?.bookingNumber || '—')}</td></tr>`,
    `<tr><td style="padding:2px 0;color:${COLORS.navy};font-weight:700;">Issue Date :</td><td style="padding:2px 0 2px 6px;">${issueDate}</td></tr>`,
  ].join('');

  const headerHtml = brandHeader()
    .replace('{{TITLE}}', escapeHtml(title))
    .replace('{{META}}', `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-top:2px;">${metaRows}</table>`);

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
<table width="780" cellpadding="0" cellspacing="0" style="width:780px;max-width:100%;margin:0 auto;border-collapse:collapse;">
  <tr>
    <td style="padding:12px 14px 8px;">
      ${headerHtml}

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-top:14px;">
        <tr>
          <td width="68%" valign="bottom" style="width:68%;vertical-align:bottom;line-height:1.6;color:#334155;padding-right:14px;">
            <strong style="font-size:11px;">Dear ${escapeHtml(guestName)},</strong><br>
            Thank you for choosing ${escapeHtml(BRAND_NAME)}.<br>
            Please find below the details of your Umrah package.
          </td>
          <td width="32%" valign="top" style="width:32%;vertical-align:top;">
            ${passengerDetails(adults, children, infants)}
          </td>
        </tr>
      </table>

      ${packageIncludes(includedTypes)}
      ${sections}

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-top:10px;">
        <tr>
          <td width="50%" valign="top" style="width:50%;vertical-align:top;padding-right:8px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid #b8d4eb;border-radius:6px;min-height:130px;background:#f8fbfe;">
              <tr><td style="padding:8px 10px;">
                <div style="color:${COLORS.navy};font-size:8px;font-weight:800;text-transform:uppercase;margin-bottom:6px;">Important Notes:</div>
                <ul style="margin:0;padding-left:14px;color:#475569;font-size:8px;line-height:1.6;direction:rtl;text-align:right;">
                  ${IMPORTANT_NOTES_UR.map((note) => `<li style="margin-bottom:4px;">${escapeHtml(note)}</li>`).join('')}
                </ul>
                ${booking?.notes ? `<div style="margin-top:6px;font-size:8px;direction:ltr;text-align:left;"><b>Booking note:</b> ${escapeHtml(booking.notes)}</div>` : ''}
                <div style="margin-top:12px;padding-top:8px;border-top:1px solid ${COLORS.line};font-size:8px;color:${COLORS.navy};">
                  Quotation Given By:
                  <span style="font-family:'Brush Script MT',cursive;color:#355b89;font-size:17px;margin-left:8px;">${escapeHtml(staffName || BRAND_NAME)}</span>
                </div>
              </td></tr>
            </table>
          </td>
          <td width="50%" valign="top" style="width:50%;vertical-align:top;padding-left:8px;">
            ${pricingSummary(voucher, showBreakdown, currency)}
          </td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin-top:14px;border-top:2px solid ${COLORS.navy};padding-top:10px;">
        <tr>
          <td width="34%" valign="bottom" style="width:34%;vertical-align:bottom;font-size:8px;color:#64748b;line-height:1.5;">
            Chairman ${escapeHtml(BRAND_NAME)}:<br>
            <span style="display:inline-block;margin-top:2px;color:#31567d;font-size:10px;font-weight:700;">Allama Ibtisam Elahi Zaheer</span>
          </td>
          <td width="33%" valign="bottom" style="width:33%;vertical-align:bottom;font-size:8px;color:#64748b;padding:0 8px;line-height:1.5;">
            ${icons.pin} ${escapeHtml(FOOTER_ADDRESS)}
          </td>
          <td width="33%" align="right" valign="bottom" style="width:33%;text-align:right;vertical-align:bottom;font-size:8px;color:#64748b;line-height:1.7;">
            ${FOOTER_PHONES.map((phone) => `<div>${icons.phone} ${escapeHtml(phone)}</div>`).join('')}
            <div>${icons.globe} ${escapeHtml(FOOTER_WEBSITE)}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body></html>`;
}
