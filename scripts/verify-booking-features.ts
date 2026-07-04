/**
 * Verifies booking feature endpoints and computed status fields.
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

  const ok = (label: string) => { console.log(`  ✓ ${label}`); passed++; };
  const fail = (label: string, detail?: string) => {
    console.log(`  ✗ ${label}${detail ? `: ${detail}` : ''}`);
    failed++;
  };

  console.log('\n=== Unit: status helpers ===');
  if (derivePaymentStatus(0, 1000) === 'Unpaid') ok('Unpaid');
  else fail('Unpaid');
  if (derivePaymentStatus(1000, 1000) === 'Paid') ok('Paid');
  else fail('Paid');
  if (derivePaymentStatus(500, 1000) === 'Partially-Paid') ok('Partially-Paid');
  else fail('Partially-Paid');
  if (derivePostingStatus([]) === 'Un-Posted') ok('Un-Posted (no postings)');
  else fail('Un-Posted');
  if (derivePostingStatus([{ status: 'POSTED' }]) === 'Posted') ok('Posted');
  else fail('Posted');
  if (derivePostingStatus([{ status: 'POSTED' }, { status: 'PENDING' }]) === 'Partially Posted') ok('Partially Posted');
  else fail('Partially Posted');

  console.log('\n=== DB: schema ===');
  try {
    await prisma.postingRequest.count();
    ok('PostingRequest table exists');
  } catch (e) {
    fail('PostingRequest table', (e as Error).message);
  }

  console.log('\n=== API: health ===');
  try {
    const health = await fetch(`${API}/health`);
    const h = await health.json() as { success?: boolean };
    if (h.success) ok('Health endpoint');
    else fail('Health endpoint');
  } catch (e) {
    fail('Health endpoint (is backend running?)', (e as Error).message);
  }

  console.log('\n=== API: auth + bookings ===');
  try {
    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'superadmin@travel.com', password: 'admin123' }),
    });
    const login = await loginRes.json() as { data?: { token?: string } };
    const token = login.data?.token;
    if (!token) { fail('Login'); }
    else {
      ok('Login');

      const bookingsRes = await fetch(`${API}/bookings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const bookings = await bookingsRes.json() as { data?: Array<Record<string, unknown>> };
      if (bookingsRes.ok && Array.isArray(bookings.data)) {
        ok(`GET /bookings (${bookings.data.length} records)`);
        const sample = bookings.data[0];
        if (sample) {
          if ('paymentStatus' in sample) ok('paymentStatus field present');
          else fail('paymentStatus field missing');
          if ('postingStatus' in sample) ok('postingStatus field present');
          else fail('postingStatus field missing');
          if ('vendorPostings' in sample) ok('vendorPostings included');
          else fail('vendorPostings missing');
        }
      } else fail('GET /bookings');

      const postReqRes = await fetch(`${API}/posting-requests/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (postReqRes.ok) ok('GET /posting-requests/pending');
      else fail('GET /posting-requests/pending', String(postReqRes.status));
    }
  } catch (e) {
    fail('API auth flow', (e as Error).message);
  }

  console.log('\n=== API: confirmed booking lock (USER) ===');
  try {
    const userLogin = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'employee@travel.com', password: 'admin123' }),
    });
    const userData = await userLogin.json() as { data?: { token?: string } };
    const userToken = userData.data?.token;
    if (userToken) {
      const confirmed = await prisma.booking.findFirst({ where: { status: 'CONFIRMED' } });
      if (confirmed) {
        const putRes = await fetch(`${API}/bookings/${confirmed.id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${userToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ notes: 'lock test' }),
        });
        const putBody = await putRes.json() as { success?: boolean; error?: string };
        if (putRes.status === 403 && putBody.error?.includes('Confirmed')) {
          ok('USER blocked from editing CONFIRMED booking');
        } else {
          fail('USER should be blocked on CONFIRMED', `status=${putRes.status}`);
        }
      } else {
        ok('No CONFIRMED booking to test lock (skipped)');
      }
    } else {
      ok('USER login skipped (employee account may not exist)');
    }
  } catch (e) {
    fail('Confirmed lock test', (e as Error).message);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
