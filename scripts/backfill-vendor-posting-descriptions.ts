import 'dotenv/config';
import prisma from '../src/config/database';
import {
  backfillVendorPostingDescriptions,
  repairVendorLedgerDescriptions,
} from '../src/services/vendorPostingService';

async function main() {
  const bookingNumber = process.argv[2];
  let bookingId: string | undefined;

  if (bookingNumber) {
    const booking = await prisma.booking.findFirst({ where: { bookingNumber } });
    if (!booking) {
      console.error(`Booking ${bookingNumber} not found`);
      process.exit(1);
    }
    bookingId = booking.id;
  }

  const descCount = await backfillVendorPostingDescriptions(bookingId);
  console.log(`Updated ${descCount} posting description(s)`);

  const repairCount = await repairVendorLedgerDescriptions(bookingId);
  console.log(`Repaired ${repairCount} ledger line(s)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
