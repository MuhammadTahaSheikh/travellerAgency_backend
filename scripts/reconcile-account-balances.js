/**
 * Recalculates Account.balance from the sum of all ledger transactions.
 * Run: node scripts/reconcile-account-balances.js
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const accounts = await p.account.findMany({
    include: { transactions: true },
  });

  let fixed = 0;
  for (const account of accounts) {
    const computed = account.transactions.reduce(
      (sum, t) => sum + Number(t.debit) - Number(t.credit),
      0,
    );
    const stored = Number(account.balance);
    if (Math.abs(computed - stored) > 0.01) {
      console.log(
        `Fix ${account.name} (${account.code}): ${stored} -> ${computed}`,
      );
      await p.account.update({
        where: { id: account.id },
        data: { balance: computed },
      });
      fixed += 1;
    }
  }

  console.log(fixed === 0 ? 'All account balances are in sync.' : `Reconciled ${fixed} account(s).`);
  await p.$disconnect();
})();
