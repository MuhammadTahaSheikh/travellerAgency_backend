import prisma from '../src/config/database';

async function main() {
  const acc = await prisma.account.findFirst({ where: { code: 'UNPOSTED-001' } });
  if (!acc) throw new Error('UNPOSTED-001 not found');

  const txs = await prisma.transaction.findMany({
    where: { accountId: acc.id, journalEntry: { isDeleted: false } },
    include: { journalEntry: { select: { description: true } } },
    orderBy: [{ journalEntry: { date: 'asc' } }, { createdAt: 'asc' }],
  });

  console.log('balanceSar:', acc.balanceSar, 'balancePkr:', acc.balancePkr);
  console.log('Active transactions:', txs.length);
  let sar = 0;
  for (const t of txs) {
    sar += (Number(t.debit) > 0 ? Number(t.amountSar ?? 0) : 0) - (Number(t.credit) > 0 ? Number(t.amountSar ?? 0) : 0);
    console.log(
      `${t.journalEntry.description?.slice(0, 55)} | Dr:${t.debit} Cr:${t.credit} SAR:${t.amountSar} runSAR:${sar}`
    );
  }
}

main().finally(() => prisma.$disconnect());
