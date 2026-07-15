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

const SERVICE_ORDER = ['TICKET', 'VISA', 'HOTEL', 'TRANSPORT'] as const;
const SERVICE_LABELS: Record<(typeof SERVICE_ORDER)[number], string> = {
  TICKET: 'Ticket',
  VISA: 'Visa',
  HOTEL: 'Hotel',
  TRANSPORT: 'Transport',
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

function table(headers: string[], body: string): string {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

function emptyRow(columns: number): string {
  return `<tr><td colspan="${columns}" class="empty">No details available</td></tr>`;
}

function servicePrice(item: PatternVoucher['booking'] extends infer B
  ? B extends { serviceItems?: Array<infer I> } ? I : never
  : never, details: DetailMap): number {
  return number(details.saleOriginal) || number(item?.amount);
}

function renderTicket(items: NonNullable<PatternVoucher['booking']>['serviceItems'], showPrice: boolean, currency: string): string {
  const headers = ['Airline', 'Sector', 'Departure', 'Arrival', 'Date', 'Class', 'Qty'];
  if (showPrice) headers.push(`Fare (${currency})`);
  const body = (items || []).flatMap((item) => {
    const details = (item.details as DetailMap | null) || {};
    const sourceRows = rowsOf(details);
    return sourceRows.map((row) => {
      const [departure, arrival] = splitSector(row.sector || details.sector);
      const cells = [
        text(row.airline || details.airline) || '—',
        text(row.sector || details.sector) || '—',
        departure,
        arrival,
        formatDate(text(row.date || details.departureDate)),
        text(row.class || details.class) || '—',
        '1',
      ];
      if (showPrice) cells.push(money(servicePrice(item, details), currency));
      return `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`;
    });
  }).join('');
  return serviceSection('01', 'Ticket Details', '✈', table(headers, body || emptyRow(headers.length)), 'ticket');
}

function renderVisa(items: NonNullable<PatternVoucher['booking']>['serviceItems'], showPrice: boolean, currency: string): string {
  const headers = ['Visa Type', 'Country', 'Validity', 'Processing Time', 'Qty'];
  if (showPrice) headers.push(`Price (${currency})`);
  const body = (items || []).map((item) => {
    const details = (item.details as DetailMap | null) || {};
    const cells = [
      text(details.visaType) || item.description || '—',
      text(details.country) || '—',
      text(details.validity) || '—',
      text(details.processingTime) || '—',
      text(details.quantity) || '1',
    ];
    if (showPrice) cells.push(money(servicePrice(item, details), currency));
    return `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`;
  }).join('');
  return serviceSection('02', 'Visa Details', '◆', table(headers, body || emptyRow(headers.length)), 'visa');
}

function renderHotel(items: NonNullable<PatternVoucher['booking']>['serviceItems'], showPrice: boolean, currency: string): string {
  const headers = ['Hotel Name', 'City', 'Nights', 'Check-in', 'Check-out', 'Room Type', 'Meal Plan', 'Qty', 'Res #'];
  if (showPrice) headers.push(`Total (${currency})`);
  const body = (items || []).flatMap((item) => {
    const details = (item.details as DetailMap | null) || {};
    return rowsOf(details).map((row) => {
      const nights = nightsBetween(row.checkInDate, row.checkOutDate);
      const rooms = number(row.numRooms) || 1;
      const cells = [
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
        cells.push(money(rowTotal || servicePrice(item, details), currency));
      }
      return `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`;
    });
  }).join('');
  return serviceSection('03', 'Hotel Details', '⌂', table(headers, body || emptyRow(headers.length)), 'hotel');
}

function renderTransport(items: NonNullable<PatternVoucher['booking']>['serviceItems'], showPrice: boolean, currency: string): string {
  const headers = ['Service Type', 'From', 'To', 'Date', 'Vehicle Type', 'Qty', 'Res #'];
  if (showPrice) headers.push(`Price (${currency})`);
  const body = (items || []).flatMap((item) => {
    const details = (item.details as DetailMap | null) || {};
    return rowsOf(details).map((row) => {
      const [from, to] = splitSector(row.sector || details.sector);
      const cells = [
        item.description || 'Transport',
        from,
        to,
        formatDate(text(row.date || details.date || details.transportDate)),
        text(row.vehicleType || details.vehicleType) || '—',
        text(row.quantity || details.quantity) || '1',
        text(row.vendorResNo || details.vendorResNo) || '—',
      ];
      if (showPrice) cells.push(money(number(row.sale) || servicePrice(item, details), currency));
      return `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`;
    });
  }).join('');
  return serviceSection('04', 'Transport Details', '◆', table(headers, body || emptyRow(headers.length)), 'transport');
}

function serviceSection(numberLabel: string, title: string, icon: string, content: string, colorClass: string): string {
  return `<section class="service-section ${colorClass}">
    <div class="section-number">${numberLabel}</div>
    <div class="section-content">
      <h3><span>${icon}</span>${escapeHtml(title)}</h3>
      ${content}
    </div>
  </section>`;
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

  if (showBreakdown) {
    return `<div class="price-box">
      <h4>Price Summary</h4>
      <div><span>Total Package Amount</span><b>${money(total, currency)}</b></div>
      <div><span>Advance Paid</span><b>${money(paid, currency)}</b></div>
      <div><span>Balance Amount</span><b class="${balance > 0 ? 'due' : ''}">${money(balance, currency)}</b></div>
      <div class="price-total"><span>Total Amount Payable</span><b>${money(total, currency)}</b></div>
    </div>`;
  }

  const passengerRows = [
    { label: 'Price / Adult', count: booking?.adults || 0, price: booking?.priceAdult },
    { label: 'Price / Child', count: booking?.children || 0, price: booking?.priceChild },
    { label: 'Price / Infant', count: booking?.infants || 0, price: booking?.priceInfant },
  ].filter((row) => row.count > 0);

  return `<div class="price-box">
    <h4>Price Summary</h4>
    ${passengerRows.map((row) => `<div><span>${row.label} (${row.count} passenger${row.count === 1 ? '' : 's'})</span><b>${money(row.price, currency)}</b></div>`).join('')}
    <div><span>Advance Paid</span><b>${money(paid, currency)}</b></div>
    <div><span>Balance Amount</span><b class="${balance > 0 ? 'due' : ''}">${money(balance, currency)}</b></div>
    <div class="price-total"><span>Total Amount Payable</span><b>${money(total, currency)}</b></div>
  </div>`;
}

type PatternRenderOptions = {
  title?: string;
  primaryLabel?: string;
  showInvoiceMeta?: boolean;
};

export async function renderVoucherPatternHtml(
  voucher: PatternVoucher,
  format: VoucherFormatName,
  options: PatternRenderOptions = {}
): Promise<string> {
  const booking = voucher.booking;
  const allItems = booking?.serviceItems || [];
  const permittedTypes = format === 'COMPLETE' ? SERVICE_ORDER : format === 'HOTEL' ? ['HOTEL'] : ['TRANSPORT'];
  const includedTypes = new Set(allItems.map((item) => item.serviceType).filter((type) => permittedTypes.includes(type as never)));
  const currency = booking?.currency || 'PKR';
  const showBreakdown = booking?.priceMode === 'BREAKDOWN';
  const staff = booking?.createdBy;
  const staffName = `${staff?.firstName || ''} ${staff?.lastName || ''}`.trim();
  const code = await staffCode(staff?.id);
  const customer = booking?.customer;
  const guestName = booking?.guestName
    || (customer?.customerType === 'B2B' ? customer.companyName : `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim())
    || voucher.guestName;
  const title = options.title || (format === 'HOTEL' ? 'HOTEL VOUCHER' : format === 'TRANSPORT' ? 'TRANSPORT VOUCHER' : 'TRAVEL VOUCHER');
  const itemsByType = (type: string) => allItems.filter((item) => item.serviceType === type);
  const sections = [
    includedTypes.has('TICKET') ? renderTicket(itemsByType('TICKET'), showBreakdown, currency) : '',
    includedTypes.has('VISA') ? renderVisa(itemsByType('VISA'), showBreakdown, currency) : '',
    includedTypes.has('HOTEL') ? renderHotel(itemsByType('HOTEL'), showBreakdown, currency) : '',
    includedTypes.has('TRANSPORT') ? renderTransport(itemsByType('TRANSPORT'), showBreakdown, currency) : '',
  ].join('');
  const adults = booking?.adults || 0;
  const children = booking?.children || 0;
  const infants = booking?.infants || 0;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)} ${escapeHtml(voucher.voucherNumber)}</title>
<style>
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  body { width: 100%; margin: 0; color: #183153; font-family: Arial, Helvetica, sans-serif; font-size: 10px; background: #fff; }
  .page { min-height: 277mm; padding: 10px 12px 7px; position: relative; border: 1px solid #dbe5f0; overflow: hidden; }
  .page::after { content: ""; position: absolute; right: -44px; bottom: -44px; width: 90px; height: 90px; background: #063d79; transform: rotate(45deg); }
  .header { display: grid; grid-template-columns: 1fr 1.2fr 1fr; align-items: start; gap: 12px; }
  .logo-mark { display: flex; align-items: center; gap: 7px; color: #07529a; }
  .logo-box { border: 3px solid #07529a; font-size: 21px; font-weight: 900; padding: 1px 5px; line-height: 1; }
  .logo-name { font-size: 16px; font-weight: 900; line-height: .9; }
  .logo-name small { display: block; letter-spacing: 3px; font-size: 7px; margin-top: 4px; }
  .tagline { color: #5682ad; font-size: 7px; margin-top: 5px; }
  .title { text-align: center; color: #173c69; }
  .title h1 { margin: 12px 0 3px; font-family: Georgia, serif; letter-spacing: 1px; font-size: 23px; }
  .title .line { width: 74px; border-top: 2px solid #173c69; margin: 0 auto; position: relative; }
  .title .line::after { content: "✈"; position: absolute; top: -9px; left: 31px; background: #fff; padding: 0 4px; color: #2471ae; }
  .meta { font-size: 8px; margin-top: 5px; }
  .meta div { display: grid; grid-template-columns: 64px 1fr; margin-bottom: 4px; }
  .meta b { color: #173c69; }
  .intro-row { display: grid; grid-template-columns: 1fr 205px; gap: 22px; align-items: end; margin: 10px 0 8px; }
  .intro { line-height: 1.6; color: #334155; }
  .intro strong { font-size: 11px; }
  .passengers { border: 1px solid #cbd8e6; border-radius: 3px; overflow: hidden; }
  .passengers h3 { margin: 0; background: #073f7e; color: #fff; text-align: center; padding: 5px; font-size: 9px; text-transform: uppercase; }
  .passengers div { display: grid; grid-template-columns: 1fr 45px; border-top: 1px solid #dce5ee; padding: 4px 9px; }
  .passengers b:last-child { text-align: center; }
  .includes-title { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 800; text-transform: uppercase; color: #1f2937; margin: 8px 0 6px; }
  .includes-title::before, .includes-title::after { content: ""; height: 1px; background: #b8c8d9; flex: 1; }
  .includes { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #cbd8e6; border-radius: 5px; padding: 8px 10px; margin-bottom: 8px; }
  .service-pill { display: flex; align-items: center; justify-content: center; gap: 6px; position: relative; text-transform: uppercase; font-size: 8px; font-weight: 800; color: #9aa8b6; }
  .service-pill .icon { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; background: #d5dbe1; color: #fff; font-size: 11px; }
  .service-pill.active { color: #123f72; }
  .service-pill.active .icon { background: #07529a; }
  .service-pill.visa.active { color: #078d91; } .service-pill.visa.active .icon { background: #11a6a7; }
  .service-pill.transport.active { color: #087862; } .service-pill.transport.active .icon { background: #119b7c; }
  .service-pill:not(.active)::after { content: "×"; color: #dc2626; font-size: 15px; font-weight: 900; position: absolute; right: 10px; bottom: -5px; }
  .service-section { display: grid; grid-template-columns: 39px 1fr; margin: 7px 0; border: 1px solid #d5e0eb; border-radius: 4px; overflow: hidden; break-inside: avoid; }
  .section-number { background: #07529a; color: #fff; font-size: 18px; font-weight: 800; display: grid; place-items: center; }
  .section-content { padding: 4px 7px 6px; min-width: 0; }
  .section-content h3 { color: #07529a; margin: 0 0 4px; font-size: 8px; text-transform: uppercase; display: flex; gap: 4px; align-items: center; }
  .visa .section-number { background: #11a6a7; } .visa h3 { color: #078d91; }
  .transport .section-number { background: #119b7c; } .transport h3 { color: #087862; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  th { background: #063d79; color: white; font-size: 6.8px; padding: 4px 3px; text-align: center; white-space: nowrap; }
  td { border: 1px solid #d7e0e9; color: #334155; font-size: 6.8px; padding: 4px 3px; text-align: center; overflow-wrap: anywhere; }
  .visa th { background: #078d91; } .transport th { background: #087862; }
  td.empty { color: #94a3b8; padding: 8px; }
  .bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; align-items: stretch; break-inside: avoid; }
  .notes { border: 1px solid #d4dee8; border-radius: 4px; padding: 7px 9px; line-height: 1.45; color: #475569; min-height: 104px; }
  .notes h4, .price-box h4 { margin: 0 0 5px; color: #173c69; text-transform: uppercase; font-size: 8px; }
  .notes ul { padding-left: 13px; margin: 0; }
  .price-box { border: 1px solid #d4dee8; border-radius: 4px; overflow: hidden; }
  .price-box h4 { background: #063d79; color: #fff; text-align: center; padding: 5px; margin: 0; }
  .price-box > div { display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 5px 8px; border-top: 1px solid #dce5ee; }
  .price-box .due { color: #dc2626; }
  .price-box .price-total { background: #063d79; color: #fff; font-weight: 800; }
  .given-by { margin-top: 6px; font-size: 7px; color: #64748b; }
  .signature { font-family: "Brush Script MT", cursive; color: #355b89; font-size: 13px; margin-left: 5px; }
  .footer { margin-top: 9px; display: grid; grid-template-columns: 1.15fr 1fr; gap: 18px; align-items: end; }
  .chairman { font-size: 7px; color: #64748b; }
  .chairman b { display: block; color: #31567d; font-size: 9px; margin-top: 2px; }
  .stamp { border: 2px solid #173c69; border-radius: 6px; padding: 6px 9px; text-align: center; line-height: 1.5; color: #111827; }
  .stamp h3 { color: #173c69; margin: 0; font-size: 12px; }
  .stamp strong { font-size: 12px; letter-spacing: .3px; }
  .stamp b { color: #173c69; }
  .contact-bar { border-top: 2px solid #173c69; margin-top: 7px; padding-top: 5px; font-size: 6.8px; color: #335b82; text-align: center; }
</style></head><body><main class="page">
  <header class="header">
    <div>
      <div class="logo-mark"><span class="logo-box">HH</span><span class="logo-name">HUFFAZ<small>HOLIDAY</small></span></div>
      <div class="tagline">Your Journey, Our Priority</div>
    </div>
    <div class="title"><h1>${escapeHtml(title)}</h1><div class="line"></div></div>
    <div class="meta">
      <div><b>${escapeHtml(options.primaryLabel || 'Voucher No.')}</b><span>${escapeHtml(voucher.voucherNumber)}</span></div>
      ${options.showInvoiceMeta === false ? '' : `<div><b>Invoice No.</b><span>${escapeHtml(voucher.invoice?.invoiceNumber || '—')}</span></div>`}
      <div><b>Booking Ref.</b><span>${escapeHtml(booking?.bookingNumber || '—')}</span></div>
      <div><b>Issue Date</b><span>${formatDate(voucher.issuedAt || voucher.invoice?.issueDate || new Date())}</span></div>
    </div>
  </header>
  <div class="intro-row">
    <div class="intro"><strong>Dear ${escapeHtml(guestName)},</strong><br>Thank you for choosing Huffaz Holiday.<br>Please find below the details of your travel arrangements.</div>
    <div class="passengers"><h3>Passenger Details</h3>
      <div><b>♟ &nbsp;Adults</b><b>${adults}</b></div>
      <div><b>♟ &nbsp;Children</b><b>${children}</b></div>
      <div><b>♟ &nbsp;Infants</b><b>${infants}</b></div>
    </div>
  </div>
  <div class="includes-title">Package Includes</div>
  <div class="includes">
    ${SERVICE_ORDER.map((type) => `<div class="service-pill ${type.toLowerCase()} ${includedTypes.has(type) ? 'active' : ''}"><span class="icon">${type === 'TICKET' ? '✈' : type === 'HOTEL' ? '⌂' : '◆'}</span>${SERVICE_LABELS[type]}</div>`).join('')}
  </div>
  ${sections}
  <div class="bottom">
    <div class="notes"><h4>Important Notes</h4>
      <ul><li>Please verify all names, dates and reservation details.</li><li>Carry valid travel documents and identification.</li><li>Hotel and transport timings are subject to supplier confirmation.</li><li>Changes and cancellations are subject to applicable charges.</li></ul>
      ${booking?.notes ? `<div style="margin-top:4px"><b>Booking note:</b> ${escapeHtml(booking.notes)}</div>` : ''}
      <div class="given-by">Reservation given by <span class="signature">${escapeHtml(staffName || 'Huffaz Holiday')}</span></div>
    </div>
    ${pricingSummary(voucher, showBreakdown, currency)}
  </div>
  <div class="footer">
    <div class="chairman">Chairman Huffaz Holiday<b>Allama Ibtisam Elahi Zaheer</b></div>
    <div class="stamp">
      <h3>Thanks &amp; Regards</h3>
      <strong>${escapeHtml(code)} - ${escapeHtml((staffName || 'HUFFAZ HOLIDAY').toUpperCase())}</strong><br>
      ${staff?.phone ? `<b>Phone:</b> ${escapeHtml(staff.phone)}<br>` : ''}
      <b>Reservation Print Date:</b> ${formatDate(new Date())}
    </div>
  </div>
  <div class="contact-bar">243 TIP, Main Boulevard Near Defence Road, Lahore &nbsp; | &nbsp; +92-320-7000721 &nbsp; | &nbsp; huffazholiday@gmail.com &nbsp; | &nbsp; www.huffazholiday.com</div>
</main></body></html>`;
}
