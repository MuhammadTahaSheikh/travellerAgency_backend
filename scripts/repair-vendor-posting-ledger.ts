/**
 * Repair vendor postings that were posted with old logic (partial unposted clear).
 * Reverses the transfer JE, resets posting to PENDING, re-posts with corrected logic.
 *
 * Run: npx tsx scripts/repair-vendor-posting-ledger.ts BK-001
 */
import 'dotenv/config';
import prisma from '../src/config/database';
import { postVendorCostToLedger, UNPOSTED_VENDOR_COSTS_CODE } from '../src/services/vendorPostingService';
import { reverseJournalEntry } from '../src/services/ledgerService';

const bookingNumber = process.argv[2] || 'BK-001';

async function accountBalance(code: string) {
  const account = await prisma.account.findFirst({ where: { code } });
  return account ? Number(account.balancePkr ?? account.balance ?? 0) : 0;
}

async function main() {
  console.log(`\nRepair vendor posting ledger for ${bookingNumber}\n`);

  const beforeUnposted = await accountBalance(UNPOSTED_VENDOR_COSTS_CODE);
  console.log(`Unposted before: ${beforeUnposted}`);

  const booking = await prisma.booking.findFirst({
    where: { bookingNumber },
    include: {
      vendorPostings: {
        where: { status: 'POSTED', journalEntryId: { not: null } },
        include: { vendor: true },
        orderBy: { postedAt: 'asc' },
      },
    },
  });
  if (!booking) throw new Error(`Booking ${bookingNumber} not found`);

  if (booking.vendorPostings.length === 0) {
    console.log('No POSTED vendor postings with journal entries to repair.');
    return;
  }

  for (const posting of booking.vendorPostings) {
    const actual = Number(posting.actualCost ?? posting.expectedCost);
    const estimated = Number(posting.expectedCost);
    const journalEntryId = posting.journalEntryId!;

    const entry = await prisma.journalEntry.findUnique({
      where: { id: journalEntryId },
      include: { transactions: { include: { account: true } } },
    });
    if (!entry || entry.isDeleted) {
      console.log(`Skip ${posting.description} — transfer JE missing or already reversed`);
      continue;
    }

    const unpostedLine = entry.transactions.find((t) => t.account.code === UNPOSTED_VENDOR_COSTS_CODE);
    const unpostedDebit = unpostedLine ? Number(unpostedLine.debit) : 0;

    // Old logic debited unposted by actual only; new logic debits by full estimated accrual.
    const needsRepair =
      posting.unpostedJournalEntryId != null &&
      Math.abs(unpostedDebit - actual) < 0.01 &&
      Math.abs(estimated - actual) > 0.01;

    if (!needsRepair && Math.abs(unpostedDebit - estimated) < 0.01) {
      console.log(`✓ ${posting.description} already uses corrected transfer logic`);
      continue;
    }

    if (!needsRepair && !posting.unpostedJournalEntryId) {
      console.log(`✓ ${posting.description} direct post (no unposted accrual) — skip`);
      continue;
    }

    console.log(
      `Repairing ${posting.description}: estimated=${estimated}, actual=${actual}, unposted debit was ${unpostedDebit}`
    );

    await prisma.$transaction(async (tx) => {
      await reverseJournalEntry(journalEntryId, `Repair stale vendor post: ${posting.description}`, tx);
      await tx.vendorPosting.update({
        where: { id: posting.id },
        data: {
          status: 'PENDING',
          journalEntryId: null,
          postedAt: null,
        },
      });
    });

    await postVendorCostToLedger(posting.id, actual);
    const refreshed = await prisma.vendorPosting.findUnique({ where: { id: posting.id } });
    console.log(
      `  → Reposted: status=${refreshed?.status}, expectedCost=${refreshed?.expectedCost}, actualCost=${refreshed?.actualCost}`
    );
  }

  const afterUnposted = await accountBalance(UNPOSTED_VENDOR_COSTS_CODE);
  console.log(`\nUnposted after: ${afterUnposted} (delta ${afterUnposted - beforeUnposted})`);
  console.log('\n=== REPAIR COMPLETE ===\n');
}

main()
  .catch((e) => {
    console.error('REPAIR FAILED:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
