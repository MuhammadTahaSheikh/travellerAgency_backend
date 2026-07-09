import 'dotenv/config';
import prisma from '../src/config/database';
import { syncBookingRefundStatus } from '../src/services/bookingRefundService';

async function main() {
  const bookings = await prisma.booking.findMany({
    where: { refunds: { some: {} } },
    select: { id: true, bookingNumber: true, status: true },
  });

  console.log(`Backfilling refund status for ${bookings.length} booking(s)...`);

  for (const booking of bookings) {
    const updated = await syncBookingRefundStatus(booking.id);
    if (updated && updated.status !== booking.status) {
      console.log(`${booking.bookingNumber}: ${booking.status} → ${updated.status}`);
    }
  }

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
