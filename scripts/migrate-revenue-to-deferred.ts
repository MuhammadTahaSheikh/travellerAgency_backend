import 'dotenv/config';
import {
  createJournalEntry,
  getOrCreateDeferredRevenueAccount,
  getOrCreateIncomeAccount,
} from '../src/services/ledgerService';

/**
 * Moves early-recognized revenue (credit on INCOME-001) into DEFERRED-001
 * so income is only recognized when payment is collected.
 */
async function main() {
  const income = await getOrCreateIncomeAccount();
  const deferred = await getOrCreateDeferredRevenueAccount();
  const incomeBal = Number(income.balancePkr ?? income.balance);

  if (incomeBal >= 0) {
    console.log('No early-recognized revenue to migrate.');
    return;
  }

  const amount = Math.abs(incomeBal);
  await createJournalEntry('Migrate early revenue to deferred (pending collection)', [
    {
      accountId: income.id,
      debit: amount,
      description: 'Reverse premature revenue recognition',
      currency: 'PKR',
      amountPkr: amount,
    },
    {
      accountId: deferred.id,
      credit: amount,
      description: 'Sale pending collection',
      currency: 'PKR',
      amountPkr: amount,
    },
  ]);

  console.log(`Moved Rs ${amount.toLocaleString()} from Income to Deferred Revenue.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
