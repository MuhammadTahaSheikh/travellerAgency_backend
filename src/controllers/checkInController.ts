import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination, parseDateRange } from '../utils/helpers';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';
import { rowsToCsv, wrapHtmlDocument } from '../utils/exportHelpers';

function buildCheckInWhere(query: Record<string, unknown>) {
  const upcoming = query.upcoming === 'true';
  const scheduleType = query.scheduleType as string | undefined;
  const startDate = query.startDate as string | undefined;
  const endDate = query.endDate as string | undefined;
  const customerId = query.customerId as string | undefined;
  const vendorId = query.vendorId as string | undefined;
  const b2bOnly = query.b2bOnly === 'true';

  const where: Record<string, unknown> = {};
  if (scheduleType) where.scheduleType = scheduleType;

  if (upcoming) {
    const now = new Date();
    where.OR = [
      { checkInDate: { gte: now } },
      { transportDate: { gte: now } },
    ];
  }

  const dateRange = parseDateRange(startDate, endDate);
  if (dateRange) {
    const dateOr = [
      { checkInDate: dateRange },
      { transportDate: dateRange },
    ];
    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: dateOr }];
      delete where.OR;
    } else {
      where.OR = dateOr;
    }
  }

  const bookingWhere: Record<string, unknown> = {};
  if (customerId) bookingWhere.customerId = customerId;
  if (b2bOnly) bookingWhere.customer = { customerType: 'B2B' };
  if (vendorId) bookingWhere.serviceItems = { some: { vendorId } };

  if (Object.keys(bookingWhere).length > 0) {
    where.booking = bookingWhere;
  }

  return where;
}

async function fetchCheckIns(where: Record<string, unknown>, skip?: number, limit?: number) {
  return prisma.checkInRecord.findMany({
    where,
    skip,
    take: limit,
    orderBy: [{ checkInDate: 'asc' }, { transportDate: 'asc' }],
    include: {
      booking: {
        include: {
          customer: true,
          serviceItems: { include: { vendor: true } },
        },
      },
    },
  });
}

export async function getCheckIns(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const where = buildCheckInWhere(req.query as Record<string, unknown>);

  const [checkIns, total] = await Promise.all([
    fetchCheckIns(where, skip, limit),
    prisma.checkInRecord.count({ where }),
  ]);

  return res.json({ success: true, data: checkIns, pagination: formatPagination(total, page, limit) });
}

export async function exportCheckIns(req: AuthRequest, res: Response) {
  const format = (req.query.format as string) || 'csv';
  const where = buildCheckInWhere(req.query as Record<string, unknown>);
  const checkIns = await fetchCheckIns(where);

  const rows = checkIns.map((c) => {
    const customer = c.booking?.customer;
    const customerLabel = customer?.customerType === 'B2B' && customer.companyName
      ? customer.companyName
      : customer ? `${customer.firstName} ${customer.lastName}` : '';
    const vendors = c.booking?.serviceItems
      ?.map((si) => si.vendor?.name)
      .filter(Boolean)
      .join(', ') || '';
    const eventDate = c.scheduleType === 'HOTEL'
      ? c.checkInDate
      : c.transportDate || c.checkInDate;

    return {
      type: c.scheduleType,
      guest: c.guestName || customerLabel,
      customer: customerLabel,
      b2b: customer?.customerType === 'B2B' ? 'Yes' : 'No',
      hotel: c.hotelName || '',
      pickup: c.pickupLocation || '',
      dropoff: c.dropoffLocation || '',
      room: c.roomDetails || '',
      date: eventDate ? new Date(eventDate).toISOString().split('T')[0] : '',
      vendors,
      vendorPosted: c.vendorPosted ? 'Yes' : 'No',
      booking: c.booking?.bookingNumber || '',
    };
  });

  await logActivity(req, 'EXPORT', 'CheckInRecord', 'export');

  if (format === 'html') {
    const tableRows = rows.map((r) => `
      <tr>
        <td>${r.type}</td>
        <td>${r.guest}</td>
        <td>${r.customer}</td>
        <td>${r.b2b}</td>
        <td>${r.hotel || `${r.pickup} → ${r.dropoff}`}</td>
        <td>${r.date}</td>
        <td>${r.vendors}</td>
        <td>${r.vendorPosted}</td>
        <td>${r.booking}</td>
      </tr>`).join('');

    const html = wrapHtmlDocument('Arrival Sheet', `
      <h1>Arrival Sheet</h1>
      <p class="meta">Generated ${new Date().toLocaleString()} · ${rows.length} record(s)</p>
      <table>
        <thead>
          <tr>
            <th>Type</th><th>Guest</th><th>Customer</th><th>B2B</th><th>Details</th>
            <th>Date</th><th>Vendors</th><th>Vendor Posted</th><th>Booking</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    `);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }

  const csv = rowsToCsv(
    ['Type', 'Guest', 'Customer', 'B2B', 'Hotel', 'Pickup', 'Dropoff', 'Room', 'Date', 'Vendors', 'Vendor Posted', 'Booking'],
    rows.map((r) => [r.type, r.guest, r.customer, r.b2b, r.hotel, r.pickup, r.dropoff, r.room, r.date, r.vendors, r.vendorPosted, r.booking])
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="arrival-sheet.csv"');
  return res.send(csv);
}

export async function createCheckIn(req: AuthRequest, res: Response) {
  const {
    bookingId,
    invoiceId,
    scheduleType,
    hotelName,
    checkInDate,
    transportDate,
    pickupLocation,
    dropoffLocation,
    guestName,
    roomDetails,
    vendorPosted,
  } = req.body;

  const type = scheduleType || 'HOTEL';
  if (type === 'HOTEL' && !hotelName && !checkInDate) {
    return res.status(400).json({ success: false, error: 'Hotel name and check-in date are required' });
  }
  if (type === 'TRANSPORT' && !transportDate) {
    return res.status(400).json({ success: false, error: 'Transport date is required' });
  }

  const record = await prisma.checkInRecord.create({
    data: {
      bookingId: bookingId || null,
      invoiceId: invoiceId || null,
      scheduleType: type,
      hotelName,
      checkInDate: checkInDate ? new Date(checkInDate) : undefined,
      transportDate: transportDate ? new Date(transportDate) : undefined,
      pickupLocation,
      dropoffLocation,
      guestName,
      roomDetails,
      vendorPosted: vendorPosted ?? false,
    },
    include: { booking: { include: { customer: true } } },
  });

  await logActivity(req, 'CREATE', 'CheckInRecord', record.id);
  return res.status(201).json({ success: true, data: record });
}

export async function updateCheckIn(req: AuthRequest, res: Response) {
  const record = await prisma.checkInRecord.update({
    where: { id: paramId(req) },
    data: {
      ...req.body,
      checkInDate: req.body.checkInDate ? new Date(req.body.checkInDate) : undefined,
      transportDate: req.body.transportDate ? new Date(req.body.transportDate) : undefined,
    },
    include: { booking: { include: { customer: true } } },
  });

  await logActivity(req, 'UPDATE', 'CheckInRecord', record.id);
  return res.json({ success: true, data: record });
}

export async function deleteCheckIn(req: AuthRequest, res: Response) {
  await prisma.checkInRecord.delete({ where: { id: paramId(req) } });
  await logActivity(req, 'DELETE', 'CheckInRecord', paramId(req));
  return res.json({ success: true, message: 'Schedule record deleted' });
}
