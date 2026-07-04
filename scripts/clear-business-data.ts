import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteAllBusinessData() {
  await prisma.$transaction(async (tx) => {
    await tx.postingRequest.deleteMany();
    await tx.bookingConfirmationRequest.deleteMany();
    await tx.vendorPosting.deleteMany();
    await tx.vendorCostAllocation.deleteMany();
    await tx.checkInRecord.deleteMany();
    await tx.voucher.deleteMany();
    await tx.payment.deleteMany();
    await tx.invoiceItem.deleteMany();
    await tx.invoice.deleteMany();
    await tx.transaction.deleteMany();
    await tx.journalEntry.deleteMany();
    await tx.expense.deleteMany();
    await tx.incomeEntry.deleteMany();
    await tx.bookingServiceItem.deleteMany();
    await tx.bookingCustomer.deleteMany();
    await tx.booking.deleteMany();
    await tx.notification.deleteMany();
    await tx.activityLog.deleteMany();
    await tx.loginHistory.deleteMany();
    await tx.deletedRecord.deleteMany();
    await tx.customerDocument.deleteMany();
    await tx.packageDestination.deleteMany();
    await tx.account.deleteMany();
    await tx.customer.deleteMany();
    await tx.vendor.deleteMany();
    await tx.package.deleteMany();
    await tx.invoiceTemplate.deleteMany();
    await tx.documentSequence.deleteMany();
    await tx.setting.deleteMany();
  });
}

async function seedFreshDefaults() {
  const accounts = [
    { name: 'Cash Account', code: 'CASH-001', type: 'CASH' as const },
    { name: 'Bank Account', code: 'BANK-001', type: 'BANK' as const },
    { name: 'Income Account', code: 'INCOME-001', type: 'REVENUE' as const },
    { name: 'Deferred Revenue', code: 'DEFERRED-001', type: 'REVENUE' as const },
    { name: 'Cost of Sales', code: 'COS-001', type: 'SUPPLIER' as const },
    { name: 'Unposted Vendor Costs', code: 'UNPOSTED-001', type: 'SUPPLIER' as const },
  ];

  for (const acc of accounts) {
    await prisma.account.create({ data: acc });
  }

  const settings = [
    { key: 'company_name', value: 'Huffaz Holiday', category: 'general' },
    { key: 'company_email', value: 'info@moazintravel.com', category: 'general' },
    { key: 'company_phone', value: '+1234567890', category: 'general' },
    { key: 'company_address', value: '123 Travel Street, City', category: 'general' },
    { key: 'currency', value: 'PKR', category: 'financial' },
    { key: 'currency_locale', value: 'en-PK', category: 'financial' },
    { key: 'default_pkr_sar_rate', value: '75', category: 'financial' },
    { key: 'tax_rate', value: '0', category: 'financial' },
    { key: 'invoice_prefix', value: 'INV', category: 'financial' },
  ];

  for (const setting of settings) {
    await prisma.setting.create({ data: setting });
  }

  await prisma.invoiceTemplate.create({
    data: {
      name: 'Default Invoice',
      isDefault: true,
      header: 'Huffaz Holiday\nProfessional Travel Services',
      footer: 'Thank you for choosing Huffaz Holiday!',
      terms: 'Payment is due by the due date shown above.',
    },
  });

  await prisma.documentSequence.create({
    data: { id: 'booking', nextValue: 1 },
  });
}

async function main() {
  if (process.env.CLEAR_DATA_CONFIRM !== 'yes') {
    console.error('Refusing to run without CLEAR_DATA_CONFIRM=yes');
    console.error('Example: CLEAR_DATA_CONFIRM=yes npm run db:clear-business-data');
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL || '';
  const dbLabel = dbUrl.replace(/:[^:@]+@/, ':****@');
  console.log(`Target database: ${dbLabel}`);
  console.log('Clearing all business data (users, roles, and permissions are kept)...');

  const userCount = await prisma.user.count();
  await deleteAllBusinessData();
  await seedFreshDefaults();

  console.log(`Done. ${userCount} user(s) preserved.`);
  console.log('Fresh defaults restored: accounts, settings, invoice template, booking sequence.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
