import 'dotenv/config';
import prisma from '../src/config/database';
import { buildDetailedPostingDescription } from '../src/utils/postingDescription';
import {
  backfillVendorPostingDescriptions,
  createVendorPosting,
  postVendorCostToLedger,
} from '../src/services/vendorPostingService';
import { createVendorAccount } from '../src/services/vendorService';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log('=== Vendor Ledger Description Tests ===\n');

  const detailed = buildDetailedPostingDescription(
    'BK-004',
    'Asif',
    'HOTEL',
    'Accommodation',
    {},
    {
      hotelName: 'VOCO',
      roomType: 'QUAD',
      checkInDate: '2026-07-12',
      checkOutDate: '2026-07-16',
      vendorResNo: 'HTL-7788',
    }
  );

  check('Detailed hotel description format', detailed.includes('BK#004') && detailed.includes('VOCO') && detailed.includes('HTL-7788'));

  const superAdmin = await prisma.user.findFirst({ where: { role: { name: 'SUPER_ADMIN' } } });
  if (!superAdmin) {
    console.log('\nSkipping integration test — no super admin.');
  } else {
    let vendor = await prisma.vendor.findFirst({ where: { isActive: true } });
    if (!vendor) {
      vendor = await prisma.vendor.create({
        data: { name: 'Test Vendor', category: 'HOTEL', vendorCode: `TV-${Date.now()}` },
      });
    }

    await createVendorAccount(vendor.id, vendor.name);

    const customer = await prisma.customer.create({
      data: { firstName: 'Ledger', lastName: 'DescTest', phone: '03001112233' },
    });

    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `BK-LEDGER-TEST-${Date.now()}`,
        customerId: customer.id,
        createdById: superAdmin.id,
        status: 'CONFIRMED',
        totalAmount: 100000,
        paidAmount: 0,
      },
    });

    const posting = await createVendorPosting({
      bookingId: booking.id,
      serviceType: 'HOTEL',
      description: detailed,
      expectedCost: 960,
      currency: 'SAR',
      exchangeRate: 76,
      vendorId: vendor.id,
      postingType: 'PENDING',
    });

    const posted = await postVendorCostToLedger(posting.id, 960);
    const vendorAccount = await prisma.account.findFirst({ where: { vendorId: vendor.id } });
    const vendorLine = await prisma.transaction.findFirst({
      where: {
        journalEntryId: posted.journalEntryId || undefined,
        accountId: vendorAccount?.id,
        credit: { gt: 0 },
      },
    });

    check(
      'Vendor ledger line uses detailed description',
      vendorLine?.description === detailed,
      `got "${vendorLine?.description}"`,
    );

    await prisma.transaction.deleteMany({ where: { journalEntryId: posted.journalEntryId || '' } });
    await prisma.journalEntry.deleteMany({ where: { id: posted.journalEntryId || '' } });
    await prisma.vendorPosting.delete({ where: { id: posting.id } });
    await prisma.booking.delete({ where: { id: booking.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
  }

  const backfillCount = await backfillVendorPostingDescriptions();
  check('Backfill runs without error', backfillCount >= 0, `updated ${backfillCount}`);

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
