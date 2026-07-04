/**
 * Backfill unposted ledger journal entries for pending vendor postings
 * that were created before the unposted-costs ledger feature.
 *
 * Usage: npx ts-node scripts/backfill-unposted-ledger.ts
 */
import { backfillUnpostedLedgerEntries } from '../src/services/vendorPostingService';

async function main() {
  const count = await backfillUnpostedLedgerEntries();
  console.log(`Backfilled unposted ledger entries for ${count} vendor posting(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
