/**
 * Verifies estimated vs actual vendor posting clears full unposted accrual.
 * Run: npx tsx scripts/test-vendor-estimated-actual-posting.ts
 */
import 'dotenv/config';
import prisma from '../src/config/database';
import {
  createVendorPosting,
  postVendorCostToLedger,
  UNPOSTED_VENDOR_COSTS_CODE,
  COST_OF_SALES_CODE,
} from '../src/services/vendorPostingService';
import { createVendorAccount } from '../src/services/vendorService';

async function accountBalance(code: string) {
  const account = await prisma.account.findFirst({ where: { code } });
  return account ? Number(account.balancePkr ?? account.balance ?? 0) : 0;
}

async function vendorBalance(vendorId: string) {
  const account = await prisma.account.findFirst({ where: { vendorId } });
  return account ? Number(account.balancePkr ?? account.balance ?? 0) : 0;
}

function assertClose(label: string, actual: number, expected: number, tolerance = 1) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
  console.log(`✓ ${label}: ${actual}`);
}

async function main() {
  console.log('\nEstimated vs actual vendor posting test\n');

  const vendor = await prisma.vendor.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!vendor) throw new Error('Need at least one vendor in the database');

  await createVendorAccount(vendor.id, vendor.name);

  const ESTIMATED = 180000;
  const ACTUAL = 82500;
  const label = `TEST est/act ${Date.now()}`;

  const beforeUnposted = await accountBalance(UNPOSTED_VENDOR_COSTS_CODE);
  const beforeCos = await accountBalance(COST_OF_SALES_CODE);
  const beforeVendor = await vendorBalance(vendor.id);

  const posting = await createVendorPosting({
    vendorId: vendor.id,
    serviceType: 'HOTEL',
    description: label,
    expectedCost: ESTIMATED,
    postingType: 'PENDING',
  });

  const afterAccrueUnposted = await accountBalance(UNPOSTED_VENDOR_COSTS_CODE);
  const afterAccrueCos = await accountBalance(COST_OF_SALES_CODE);

  assertClose('Unposted after accrue (delta)', afterAccrueUnposted - beforeUnposted, -ESTIMATED);
  assertClose('COS after accrue (delta)', afterAccrueCos - beforeCos, ESTIMATED);

  await postVendorCostToLedger(posting.id, ACTUAL);

  const afterPostUnposted = await accountBalance(UNPOSTED_VENDOR_COSTS_CODE);
  const afterPostCos = await accountBalance(COST_OF_SALES_CODE);
  const afterVendor = await vendorBalance(vendor.id);

  assertClose('Unposted cleared (no stale residual)', afterPostUnposted - beforeUnposted, 0);
  assertClose('COS reflects actual cost only', afterPostCos - beforeCos, ACTUAL);
  assertClose('Vendor payable from this posting', afterVendor - beforeVendor, -ACTUAL);

  const refreshed = await prisma.vendorPosting.findUnique({ where: { id: posting.id } });
  if (refreshed?.status !== 'POSTED') throw new Error('Posting should be POSTED');
  assertClose('expectedCost synced to actual after post', Number(refreshed.expectedCost), ACTUAL);
  assertClose('actualCost saved', Number(refreshed.actualCost), ACTUAL);

  console.log('\n=== ALL TESTS PASSED ===\n');
  console.log(`Test posting "${label}" left in DB as POSTED (safe to ignore or delete).\n`);

  // Scenario 2: actual higher than estimate
  const EST2 = 100000;
  const ACT2 = 150000;
  const label2 = `TEST est/act high ${Date.now()}`;
  const beforeUnposted2 = await accountBalance(UNPOSTED_VENDOR_COSTS_CODE);
  const beforeCos2 = await accountBalance(COST_OF_SALES_CODE);
  const beforeVendor2 = await vendorBalance(vendor.id);

  const posting2 = await createVendorPosting({
    vendorId: vendor.id,
    serviceType: 'TRANSPORT',
    description: label2,
    expectedCost: EST2,
    postingType: 'PENDING',
  });

  await postVendorCostToLedger(posting2.id, ACT2);

  assertClose('Higher actual — unposted cleared', (await accountBalance(UNPOSTED_VENDOR_COSTS_CODE)) - beforeUnposted2, 0);
  assertClose('Higher actual — COS net', (await accountBalance(COST_OF_SALES_CODE)) - beforeCos2, ACT2);
  assertClose('Higher actual — vendor payable', (await vendorBalance(vendor.id)) - beforeVendor2, -ACT2);

  console.log('\n=== HIGHER-ACTUAL SCENARIO PASSED ===\n');
}

main()
  .catch((e) => {
    console.error('\n=== TEST FAILED ===');
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
