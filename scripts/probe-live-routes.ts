/** Read-only live route probe — no auth, no mutations. */
const API = process.env.API_URL || 'https://travel-api.bestechvision.com/api';

async function probe(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

async function main() {
  console.log(`Live API: ${API}\n`);
  const checks: { id: string; name: string; ok: boolean; detail: string }[] = [];

  const health = await probe('GET', '/health');
  checks.push({ id: '0', name: 'API running', ok: health === 200, detail: `HTTP ${health}` });

  const routes: { id: string; name: string; method: string; path: string; body?: unknown }[] = [
    { id: '17', name: 'User Performance API', method: 'GET', path: '/ledger/user-performance' },
    { id: '7', name: 'Request Confirmation API', method: 'POST', path: '/bookings/x/request-confirmation', body: {} },
    { id: '12', name: 'Refund API', method: 'POST', path: '/bookings/x/refund', body: { customerAmount: 0 } },
    { id: '14', name: 'Vendor Postings (OTHER enum)', method: 'POST', path: '/vendor-postings', body: { serviceType: 'OTHER', description: 'x', expectedCost: 1 } },
    { id: '1', name: 'Company Accounts API', method: 'POST', path: '/payments/accounts', body: { name: 'x', type: 'BANK', currency: 'SAR' } },
    { id: '5', name: 'Vendor Postings list', method: 'GET', path: '/vendor-postings' },
    { id: '8', name: 'Travel Schedules', method: 'GET', path: '/check-ins' },
    { id: '9', name: 'Ledger accounts search', method: 'GET', path: '/ledger/accounts?search=HHV' },
    { id: '4', name: 'Bookings list', method: 'GET', path: '/bookings' },
  ];

  for (const r of routes) {
    const status = await probe(r.method, r.path, r.body);
    const deployed = status !== 404;
    checks.push({
      id: r.id,
      name: r.name,
      ok: deployed,
      detail: status === 404 ? 'NOT DEPLOYED (404)' : `route live (HTTP ${status})`,
    });
  }

  // Login optional
  const loginStatus = await probe('POST', '/auth/login', { email: 'invalid@test.com', password: 'x' });
  checks.push({
    id: 'auth',
    name: 'Auth endpoint',
    ok: loginStatus === 401 || loginStatus === 400 || loginStatus === 200,
    detail: `HTTP ${loginStatus}`,
  });

  let passed = 0;
  for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} [${c.id}] ${c.name} — ${c.detail}`);
    if (c.ok) passed += 1;
  }
  console.log(`\n=== Route probe: ${passed}/${checks.length} deployed ===`);
  console.log('\nNote: Functional tests (data fields, UI, permissions) need login.');
  console.log('Run with credentials: TEST_EMAIL=... TEST_PASS=... npx tsx scripts/test-live-internal-working.ts');
}

main();
