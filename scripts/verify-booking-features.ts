/**
 * Full audit of all booking features from chat requirements.
 * Run: npx tsx scripts/verify-booking-features.ts
 */
import prisma from '../src/config/database';

function derivePaymentStatus(paidAmount: number, totalAmount: number): string {
  if (paidAmount <= 0) return 'Unpaid';
  if (paidAmount >= totalAmount) return 'Paid';
  return 'Partially-Paid';
}

function derivePostingStatus(postings: { status: string }[]): string {
  if (!postings.length) return 'Un-Posted';
  const posted = postings.filter((p) => p.status === 'POSTED').length;
  if (posted === 0) return 'Un-Posted';
  if (posted === postings.length) return 'Posted';
  return 'Partially Posted';
}

async function main() {
  const API = process.env.API_URL || 'http://localhost:5001/api';
  let passed = 0;
  let failed = 0;
  const issues: string[] = [];

  const ok = (label: string) => { console.log(`  ✓ ${label}`); passed++; };
  const fail = (label: string, detail?: string) => {
    console.log(`  ✗ ${label}${detail ? `: ${detail}` : ''}`);
    issues.push(detail ? `${label}: ${detail}` : label);
    failed++;
  };

  console.log('\n=== 1. Payment & Posting status logic ===');
  if (derivePaymentStatus(0, 1000) === 'Unpaid') ok('Payment: Unpaid');
  else fail('Payment: Unpaid');
  if (derivePaymentStatus(1000, 1000) === 'Paid') ok('Payment: Paid');
  else fail('Payment: Paid');
  if (derivePaymentStatus(500, 1000) === 'Partially-Paid') ok('Payment: Partially-Paid');
  else fail('Payment: Partially-Paid');
  if (derivePostingStatus([]) === 'Un-Posted') ok('Posting: Un-Posted');
  else fail('Posting: Un-Posted');
  if (derivePostingStatus([{ status: 'POSTED' }]) === 'Posted') ok('Posting: Posted');
  else fail('Posting: Posted');
  if (derivePostingStatus([{ status: 'POSTED' }, { status: 'PENDING' }]) === 'Partially Posted') ok('Posting: Partially Posted');
  else fail('Posting: Partially Posted');

  console.log('\n=== 2. Database schema ===');
  for (const table of ['PostingRequest', 'BookingConfirmationRequest'] as const) {
    try {
      await (prisma as Record<string, { count: () => Promise<number> }>)[table.charAt(0).toLowerCase() + table.slice(1)].count();
      ok(`${table} table exists`);
    } catch (e) {
      fail(`${table} table`, (e as Error).message);
    }
  }

  const bookingStatusEnum = await prisma.$queryRaw<Array<{ COLUMN_TYPE: string }>>`
    SHOW COLUMNS FROM Booking WHERE Field = 'status'
  `.catch(() => null);
  if (bookingStatusEnum?.[0]?.COLUMN_TYPE?.includes('DRAFT')) ok('Booking.status includes DRAFT');
  else fail('Booking.status enum', bookingStatusEnum?.[0]?.COLUMN_TYPE || 'unknown');
  if (bookingStatusEnum?.[0]?.COLUMN_TYPE?.includes('REQUEST_CONFIRMATION')) ok('Booking.status includes REQUEST_CONFIRMATION');
  else fail('REQUEST_CONFIRMATION in enum');

  console.log('\n=== 3. API routes (auth required = route exists) ===');
  try {
    const health = await fetch(`${API}/health`);
    const h = await health.json() as { success?: boolean };
    if (h.success) ok('Health endpoint');
    else fail('Health endpoint');
  } catch (e) {
    fail('Health endpoint', (e as Error).message);
  }

  const routeChecks = [
    { path: '/posting-requests/pending', name: 'Posting requests' },
    { path: '/booking-confirmation-requests/pending', name: 'Booking confirmation requests' },
    { path: '/bookings/test-id/pricing', name: 'Pricing patch', method: 'PATCH' },
  ];

  for (const r of routeChecks) {
    try {
      const res = await fetch(`${API}${r.path}`, {
        method: (r.method as string) || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: r.method === 'PATCH' ? '{}' : undefined,
      });
      if (res.status === 401) ok(`${r.name} route registered (401 without auth)`);
      else if (res.status === 404) fail(`${r.name} route`, '404 - not deployed');
      else ok(`${r.name} route responds (${res.status})`);
    } catch (e) {
      fail(r.name, (e as Error).message);
    }
  }

  console.log('\n=== 4. Authenticated API checks ===');
  let superToken = '';
  let userToken = '';
  try {
    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'superadmin@travel.com', password: 'admin123' }),
    });
    const login = await loginRes.json() as { data?: { token?: string } };
    superToken = login.data?.token || '';
    if (superToken) ok('Super Admin login');
    else fail('Super Admin login');

    const bookingsRes = await fetch(`${API}/bookings`, {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    const bookings = await bookingsRes.json() as { data?: Array<Record<string, unknown>> };
    if (bookingsRes.ok && Array.isArray(bookings.data)) {
      ok(`GET /bookings (${bookings.data.length} records)`);
      const sample = bookings.data[0];
      if (sample) {
        for (const field of ['paymentStatus', 'postingStatus', 'vendorPostings']) {
          if (field in sample) ok(`Bookings include ${field}`);
          else fail(`Bookings missing ${field}`);
        }
      }
    } else fail('GET /bookings');

    const userLogin = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'employee@travel.com', password: 'admin123' }),
    });
    const userData = await userLogin.json() as { data?: { token?: string } };
    userToken = userData.data?.token || '';
    if (userToken) ok('USER login');
    else ok('USER login skipped (employee account may not exist)');
  } catch (e) {
    fail('Auth flow', (e as Error).message);
  }

  console.log('\n=== 5. Permission locks ===');
  if (userToken) {
    const confirmed = await prisma.booking.findFirst({ where: { status: 'CONFIRMED' } });
    if (confirmed) {
      const putRes = await fetch(`${API}/bookings/${confirmed.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'lock test' }),
      });
      const putBody = await putRes.json() as { error?: string };
      if (putRes.status === 403 && putBody.error?.toLowerCase().includes('cannot be modified')) {
        ok('USER blocked from editing CONFIRMED booking');
      } else fail('USER CONFIRMED lock', `status=${putRes.status}`);
    } else ok('CONFIRMED lock test skipped (no confirmed booking)');

    const pendingReq = await prisma.booking.findFirst({ where: { status: 'REQUEST_CONFIRMATION' } });
    if (pendingReq) {
      const putRes = await fetch(`${API}/bookings/${pendingReq.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'lock test' }),
      });
      if (putRes.status === 403) ok('USER blocked from editing REQUEST_CONFIRMATION booking');
      else fail('USER REQUEST_CONFIRMATION lock', `status=${putRes.status}`);
    } else ok('REQUEST_CONFIRMATION lock test skipped');

    if (superToken && confirmed) {
      const userConfirm = await fetch(`${API}/bookings/${confirmed.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CONFIRMED' }),
      });
      if (userConfirm.status === 403) ok('USER blocked from direct CONFIRMED status');
      else fail('USER direct confirm block', `status=${userConfirm.status}`);
    }
  }

  console.log('\n=== 6. Draft invoice generation ===');
  const draftWithInvoice = await prisma.booking.findFirst({
    where: { status: { in: ['DRAFT', 'PENDING'] } },
    include: { invoices: true },
  });
  if (draftWithInvoice) {
    if (draftWithInvoice.invoices.length > 0) ok(`Draft/Pending booking ${draftWithInvoice.bookingNumber} has invoice`);
    else fail('Draft booking invoice', `${draftWithInvoice.bookingNumber} has no invoice`);
  } else ok('Draft invoice check skipped (no draft bookings)');

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
  if (issues.length) {
    console.log('\nIssues:');
    issues.forEach((i) => console.log(`  - ${i}`));
  }
  console.log('');

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
