import {
  convertRefundAmountToBookingCurrency,
  deriveBookingRefundStatus,
  processBookingRefund,
} from '../src/services/bookingRefundService';
import prisma from '../src/config/database';

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
  console.log('=== Booking Refund Status Tests ===\n');

  check(
    'Partial refund status',
    deriveBookingRefundStatus(1000, [{ customerAmount: 400, currency: 'PKR' }]) === 'PARTIALLY_REFUNDED',
  );
  check(
    'Full refund status',
    deriveBookingRefundStatus(1000, [{ customerAmount: 1000, currency: 'PKR' }]) === 'REFUNDED',
  );
  check(
    'Multiple partial refunds become full refund',
    deriveBookingRefundStatus(1000, [
      { customerAmount: 400, currency: 'PKR' },
      { customerAmount: 600, currency: 'PKR' },
    ]) === 'REFUNDED',
  );
  check(
    'SAR refund converts against PKR booking total',
    deriveBookingRefundStatus(7500, [{ customerAmount: 100, currency: 'SAR' }], 'PKR') === 'REFUNDED',
  );
  check(
    'Currency conversion helper',
    convertRefundAmountToBookingCurrency(100, 'SAR', 'PKR') === 7500,
  );
  check('No refunds leaves status unchanged', deriveBookingRefundStatus(1000, []) === null);

  const superAdmin = await prisma.user.findFirst({
    where: { role: { name: 'SUPER_ADMIN' } },
    select: { id: true },
  });
  const booking = await prisma.booking.findFirst({
    where: { status: { in: ['CONFIRMED', 'COMPLETED', 'PARTIALLY_REFUNDED'] } },
    select: { id: true, status: true, totalAmount: true, bookingNumber: true },
  });

  if (!superAdmin || !booking) {
    console.log('\nNo existing refundable booking — creating temporary test booking...');

    if (!superAdmin) {
      check('Integration setup: super admin exists', false);
    } else {
      const customer = await prisma.customer.create({
        data: {
          firstName: 'Refund',
          lastName: 'StatusTest',
          phone: '03000000000',
        },
      });

      const testBooking = await prisma.booking.create({
        data: {
          bookingNumber: `BK-REFUND-TEST-${Date.now()}`,
          customerId: customer.id,
          createdById: superAdmin.id,
          status: 'CONFIRMED',
          totalAmount: 1000,
          paidAmount: 0,
        },
      });

      await processBookingRefund({
        bookingId: testBooking.id,
        createdById: superAdmin.id,
        customerAmount: 250,
        currency: 'PKR',
        notes: 'Automated refund status test (partial)',
      });

      const afterPartial = await prisma.booking.findUnique({
        where: { id: testBooking.id },
        select: { status: true },
      });
      check(
        'Integration: partial refund updates status',
        afterPartial?.status === 'PARTIALLY_REFUNDED',
        `got ${afterPartial?.status}`,
      );

      await processBookingRefund({
        bookingId: testBooking.id,
        createdById: superAdmin.id,
        customerAmount: 750,
        currency: 'PKR',
        notes: 'Automated refund status test (full)',
      });

      const afterFull = await prisma.booking.findUnique({
        where: { id: testBooking.id },
        select: { status: true },
      });
      check(
        'Integration: full refund updates status',
        afterFull?.status === 'REFUNDED',
        `got ${afterFull?.status}`,
      );

      await prisma.bookingRefund.deleteMany({ where: { bookingId: testBooking.id } });
      await prisma.booking.delete({ where: { id: testBooking.id } });
      await prisma.customer.delete({ where: { id: customer.id } });
    }
  } else {
    const partialAmount = Math.max(1, Math.floor(Number(booking.totalAmount) / 4));
    await processBookingRefund({
      bookingId: booking.id,
      createdById: superAdmin.id,
      customerAmount: partialAmount,
      currency: 'PKR',
      notes: 'Automated refund status test (partial)',
    });

    const afterPartial = await prisma.booking.findUnique({
      where: { id: booking.id },
      select: { status: true },
    });
    check(
      `Integration: ${booking.bookingNumber} partial refund updates status`,
      afterPartial?.status === 'PARTIALLY_REFUNDED',
      `got ${afterPartial?.status}`,
    );

    const remaining = Number(booking.totalAmount) - partialAmount;
    if (remaining > 0) {
      await processBookingRefund({
        bookingId: booking.id,
        createdById: superAdmin.id,
        customerAmount: remaining,
        currency: 'PKR',
        notes: 'Automated refund status test (full)',
      });

      const afterFull = await prisma.booking.findUnique({
        where: { id: booking.id },
        select: { status: true },
      });
      check(
        `Integration: ${booking.bookingNumber} full refund updates status`,
        afterFull?.status === 'REFUNDED',
        `got ${afterFull?.status}`,
      );
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
