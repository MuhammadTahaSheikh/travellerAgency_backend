import 'dotenv/config';
import prisma from '../src/config/database';
import { updateCustomerAccountLabel } from '../src/services/ledgerService';
import { formatCustomerLedgerLabel } from '../src/utils/customerDisplay';

async function main() {
  const accounts = await prisma.account.findMany({
    where: { customerId: { not: null }, isActive: true },
    include: { customer: true },
  });

  let updated = 0;
  for (const account of accounts) {
    if (!account.customer) continue;

    const openInvoice = await prisma.invoice.findFirst({
      where: {
        customerId: account.customerId!,
        confirmedAt: { not: null },
        status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] },
      },
      include: { booking: { select: { bookingNumber: true } } },
      orderBy: { confirmedAt: 'desc' },
    });

    const label = formatCustomerLedgerLabel(
      account.customer,
      openInvoice?.booking?.bookingNumber,
    );

    if (account.name !== label) {
      await updateCustomerAccountLabel(account.id, account.customer, openInvoice?.booking?.bookingNumber);
      console.log(`Updated: ${account.name} → ${label}`);
      updated += 1;
    }
  }

  console.log(`Done. ${updated} customer account label(s) updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
