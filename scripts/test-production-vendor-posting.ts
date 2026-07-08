/**
 * Production check: inspect BK-001 ledger state and post PENDING vendor cost with actual ≠ estimated.
 * Run: API_URL=https://travel-api.bestechvision.com/api TEST_EMAIL=... TEST_PASSWORD=... npx tsx scripts/test-production-vendor-posting.ts
 */
import 'dotenv/config';

const API = process.env.API_URL || 'https://travel-api.bestechvision.com/api';
const EMAIL = process.env.TEST_EMAIL || '';
const PASSWORD = process.env.TEST_PASSWORD || '';
const TARGET_BOOKING = process.env.TEST_BOOKING_NUMBER || 'BK-001';
const DRY_RUN = process.env.DRY_RUN === '1';

type ApiRes<T> = { success?: boolean; data?: T; error?: string; message?: string };

async function api<T>(path: string, token: string, init?: RequestInit): Promise<{ status: number; body: ApiRes<T> }> {
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
  if (!EMAIL || !PASSWORD) throw new Error('Set TEST_EMAIL and TEST_PASSWORD env vars');
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = (await res.json()) as ApiRes<{ token: string }>;
  if (!body.data?.token) throw new Error(`Login failed: ${body.error || res.status}`);
  return body.data.token;
}

function bal(row?: { balancePkr?: unknown; balance?: unknown }) {
  return Number(row?.balancePkr ?? row?.balance ?? 0);
}

async function main() {
  console.log(`\nProduction vendor posting check → ${API}${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  const token = await login();
  console.log('✓ Logged in');

  const accountsRes = await api<Array<{ id: string; code?: string; name: string; balance?: unknown; balancePkr?: unknown }>>(
    '/ledger/accounts',
    token
  );
  const accounts = accountsRes.body.data || [];
  const unposted = accounts.find((a) => a.code === 'UNPOSTED-001');
  const cos = accounts.find((a) => a.code === 'COS-001');
  const aden = accounts.find((a) => (a.name || '').toUpperCase().includes('ADEN'));

  console.log('\n=== LEDGER (before) ===');
  console.log(`UNPOSTED-001: ${bal(unposted)}`);
  console.log(`COS-001: ${bal(cos)}`);
  if (aden) console.log(`ADEN: ${bal(aden)}`);

  const bookingsRes = await api<Array<{ id: string; bookingNumber: string }>>('/bookings?limit=50', token);
  const summary = bookingsRes.body.data?.find((b) => b.bookingNumber === TARGET_BOOKING);
  if (!summary) throw new Error(`Booking ${TARGET_BOOKING} not found`);

  const bookingRes = await api<{ vendorPostings?: Array<Record<string, unknown>> }>(`/bookings/${summary.id}`, token);
  const postings = bookingRes.body.data?.vendorPostings || [];
  console.log(`\n=== ${TARGET_BOOKING} vendor postings ===`);
  for (const p of postings) {
    console.log(
      `- ${p.serviceType} | ${p.status} | expected=${p.expectedCost} actual=${p.actualCost ?? '—'} | ${p.description}`
    );
  }

  const pending = postings.find((p) => p.status === 'PENDING') as
    | { id: string; expectedCost: unknown; description?: string }
    | undefined;
  if (!pending) {
    console.log('\nNo PENDING posting to test. Ledger snapshot only — done.\n');
    return;
  }

  const estimated = Number(pending.expectedCost);
  const actual = estimated === 180000 ? 82500 : Math.round(estimated * 0.55);
  console.log(`\n=== Will post "${pending.description}" ===`);
  console.log(`Estimated: ${estimated} → Actual: ${actual}`);

  if (DRY_RUN) {
    console.log('\nDRY_RUN=1 — skipping post. Set DRY_RUN=0 to execute.\n');
    return;
  }

  const beforeUnposted = bal(unposted);
  const beforeCos = bal(cos);
  const beforeAden = aden ? bal(aden) : 0;

  const postRes = await api<Record<string, unknown>>(`/vendor-postings/${pending.id}/confirm`, token, {
    method: 'POST',
    body: JSON.stringify({ actualCost: actual }),
  });
  if (!postRes.body.success) throw new Error(`Post failed: ${postRes.body.error || postRes.status}`);

  const updated = postRes.body.data!;
  console.log(`✓ Posted — status=${updated.status} expectedCost=${updated.expectedCost} actualCost=${updated.actualCost}`);

  const accountsAfter = (await api<typeof accounts>('/ledger/accounts', token)).body.data || [];
  const afterUnposted = bal(accountsAfter.find((a) => a.code === 'UNPOSTED-001'));
  const afterCos = bal(accountsAfter.find((a) => a.code === 'COS-001'));
  const afterAden = aden ? bal(accountsAfter.find((a) => a.id === aden.id)) : 0;

  const unpostedDelta = afterUnposted - beforeUnposted;
  const cosDelta = afterCos - beforeCos;
  const adenDelta = afterAden - beforeAden;

  console.log('\n=== LEDGER (deltas) ===');
  console.log(`Unposted delta: ${unpostedDelta} (expect +${estimated} to clear accrual)`);
  console.log(`COS delta: ${cosDelta}`);
  console.log(`ADEN delta: ${adenDelta} (expect -${actual})`);

  const cleared = Math.abs(unpostedDelta - estimated) < 2;
  const vendorOk = Math.abs(adenDelta + actual) < 2;
  const synced =
    Number(updated.expectedCost) === actual && Number(updated.actualCost) === actual;

  console.log('\n=== VERIFICATION ===');
  console.log(cleared ? '✓ Unposted accrual fully cleared' : '✗ Unposted stale residual detected');
  console.log(vendorOk ? '✓ Vendor payable matches actual' : '✗ Vendor payable mismatch');
  console.log(synced ? '✓ expectedCost synced to actual' : '✗ Cost fields not synced');

  if (!cleared || !vendorOk || !synced) process.exit(1);
  console.log('\n=== ALL PRODUCTION CHECKS PASSED ===\n');
}

main().catch((e) => {
  console.error('\n=== FAILED ===');
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
