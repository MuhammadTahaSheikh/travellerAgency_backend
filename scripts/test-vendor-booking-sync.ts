/**
 * End-to-end test: booking hotel-row vendor saves and syncs to vendor postings.
 * Run: API_URL=https://travel-api.bestechvision.com/api npx tsx scripts/test-vendor-booking-sync.ts
 */
import 'dotenv/config';

const API = process.env.API_URL || 'http://localhost:5001/api';
const EMAIL = process.env.TEST_EMAIL || 'tahasheikh682@gmail.com';
const PASSWORD = process.env.TEST_PASSWORD || 'Pakistan@123';
const TARGET_BOOKING = process.env.TEST_BOOKING_NUMBER || 'BK-001';
const TARGET_VENDOR_CODE = process.env.TEST_VENDOR_CODE || 'HHV-0001';

type ApiRes<T> = { success?: boolean; data?: T; error?: string };

async function api<T>(
  path: string,
  token: string,
  init?: RequestInit
): Promise<{ status: number; body: ApiRes<T> }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as ApiRes<T>;
  return { status: res.status, body };
}

async function login(): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = (await res.json()) as ApiRes<{ token: string }>;
  if (!body.data?.token) throw new Error(`Login failed: ${body.error || res.status}`);
  return body.data.token;
}

async function main() {
  console.log(`\nVendor sync test → ${API}\n`);

  const token = await login();
  console.log('✓ Logged in');

  const vendorsRes = await api<Array<{ id: string; name: string; vendorCode?: string }>>('/vendors?limit=200', token);
  const targetVendor = vendorsRes.body.data?.find((v) => v.vendorCode === TARGET_VENDOR_CODE);
  if (!targetVendor) throw new Error(`Vendor ${TARGET_VENDOR_CODE} not found`);
  console.log(`✓ Target vendor: ${targetVendor.name} (${targetVendor.vendorCode})`);

  const bookingsRes = await api<Array<{ id: string; bookingNumber: string; status: string }>>('/bookings?limit=100', token);
  const summary = bookingsRes.body.data?.find((b) => b.bookingNumber === TARGET_BOOKING);
  if (!summary) throw new Error(`Booking ${TARGET_BOOKING} not found`);
  console.log(`✓ Booking: ${summary.bookingNumber} (${summary.status})`);

  const bookingRes = await api<Record<string, unknown>>(`/bookings/${summary.id}`, token);
  const booking = bookingRes.body.data;
  if (!booking) throw new Error('Could not load booking detail');

  const serviceItems = booking.serviceItems as Array<{
    id: string;
    serviceType: string;
    description: string;
    amount: number;
    costAmount: number;
    vendorId?: string | null;
    vendor?: { id: string; name: string; vendorCode?: string } | null;
    details?: Record<string, unknown> | null;
  }>;

  const hotelItem = serviceItems.find((s) => s.serviceType === 'HOTEL');
  if (!hotelItem) throw new Error('No HOTEL service item on booking');

  const details = (hotelItem.details || {}) as Record<string, unknown>;
  const rows = Array.isArray(details.rows) ? [...(details.rows as Record<string, string>[])] : [];
  if (rows.length === 0) throw new Error('Hotel item has no rows in details');

  const originalRowVendor = rows[0].vendorId || '';
  const originalItemVendor = hotelItem.vendorId || '';
  console.log(`  Current row vendorId: ${originalRowVendor || '(empty)'}`);
  console.log(`  Current item vendorId: ${originalItemVendor || '(empty)'}`);

  rows[0] = { ...rows[0], vendorId: targetVendor.id };

  const payload = {
    bookingType: booking.bookingType,
    customerId: (booking.customer as { id: string })?.id,
    guestName: booking.guestName,
    packageId: booking.packageId,
    currency: booking.currency,
    priceMode: booking.priceMode,
    totalAmount: Number(booking.totalAmount),
    numTravelers: booking.numTravelers,
    adults: booking.adults,
    children: booking.children,
    infants: booking.infants,
    priceAdult: Number(booking.priceAdult),
    priceChild: Number(booking.priceChild),
    priceInfant: Number(booking.priceInfant),
    travelDate: booking.travelDate,
    returnDate: booking.returnDate,
    notes: booking.notes,
    status: booking.status,
    serviceItems: serviceItems.map((s) =>
      s.id === hotelItem.id
        ? {
            serviceType: s.serviceType,
            description: s.description,
            amount: Number(s.amount),
            costAmount: Number(s.costAmount),
            vendorId: targetVendor.id,
            details: { ...details, rows },
          }
        : {
            serviceType: s.serviceType,
            description: s.description,
            amount: Number(s.amount),
            costAmount: Number(s.costAmount),
            vendorId: s.vendorId || undefined,
            details: s.details || undefined,
          }
    ),
  };

  const updateRes = await api(`/bookings/${summary.id}`, token, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  if (!updateRes.body.success) throw new Error(`Update failed: ${updateRes.body.error || updateRes.status}`);
  console.log('✓ Booking updated with vendor on hotel row');

  const afterRes = await api<Record<string, unknown>>(`/bookings/${summary.id}`, token);
  const after = afterRes.body.data;
  const afterHotel = (after?.serviceItems as typeof serviceItems)?.find((s) => s.serviceType === 'HOTEL');
  const afterRows = (afterHotel?.details as Record<string, unknown>)?.rows as Record<string, string>[] | undefined;
  const afterRowVendor = afterRows?.[0]?.vendorId;
  const afterItemVendor = afterHotel?.vendorId;

  if (afterRowVendor !== targetVendor.id) {
    throw new Error(`Row vendor not saved: expected ${targetVendor.id}, got ${afterRowVendor || '(empty)'}`);
  }
  console.log(`✓ Service item row vendor saved: ${afterRowVendor}`);

  if (afterItemVendor !== targetVendor.id) {
    throw new Error(`Item vendorId not saved: expected ${targetVendor.id}, got ${afterItemVendor || '(empty)'}`);
  }
  console.log(`✓ Service item vendorId saved: ${afterItemVendor}`);

  const postings = (after?.vendorPostings || []) as Array<{
    serviceType: string;
    status: string;
    vendorId?: string | null;
    vendor?: { vendorCode?: string; name: string } | null;
    description: string;
  }>;

  const hotelPosting = postings.find((p) => p.serviceType === 'HOTEL');
  if (!hotelPosting) throw new Error('No HOTEL vendor posting found after sync');

  if (hotelPosting.vendorId !== targetVendor.id) {
    throw new Error(
      `Vendor posting not synced: expected ${targetVendor.id}, got ${hotelPosting.vendorId || '(empty)'}`
    );
  }
  if (hotelPosting.status !== 'PENDING' && hotelPosting.status !== 'POSTED') {
    throw new Error(`Unexpected posting status: ${hotelPosting.status} (expected PENDING or POSTED)`);
  }

  console.log(
    `✓ Vendor posting synced: ${hotelPosting.vendor?.name} (${hotelPosting.vendor?.vendorCode}) — ${hotelPosting.status}`
  );
  console.log(`  Posting description: ${hotelPosting.description}`);

  console.log('\n=== ALL TESTS PASSED ===\n');
  console.log('Client can be informed: booking vendor selection saves and syncs to Vendor Postings.\n');
}

main().catch((e) => {
  console.error('\n=== TEST FAILED ===');
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
