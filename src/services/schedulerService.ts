import prisma from '../config/database';
import { createNotification } from './notificationService';

export async function processCheckInReminders() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const start = new Date(tomorrow);
  start.setHours(0, 0, 0, 0);
  const end = new Date(tomorrow);
  end.setHours(23, 59, 59, 999);

  const checkIns = await prisma.checkInRecord.findMany({
    where: {
      checkInDate: { gte: start, lte: end },
      reminderSent: false,
    },
    include: { booking: { include: { customer: true } } },
  });

  if (checkIns.length === 0) return 0;

  const users = await prisma.user.findMany({
    where: { isActive: true, role: { name: { in: ['SUPER_ADMIN', 'ADMIN'] } } },
    select: { id: true },
  });

  let sent = 0;
  for (const checkIn of checkIns) {
    const guest = checkIn.guestName || `${checkIn.booking.customer.firstName} ${checkIn.booking.customer.lastName}`;
    const message = `Reminder: ${guest} checks in at ${checkIn.hotelName} tomorrow (${checkIn.checkInDate.toLocaleDateString()}).`;

    for (const user of users) {
      await createNotification(
        user.id,
        'CHECK_IN_REMINDER',
        'Check-in Reminder',
        message,
        '/check-ins',
      );
    }

    await prisma.checkInRecord.update({
      where: { id: checkIn.id },
      data: { reminderSent: true },
    });
    sent++;
  }

  return sent;
}

export async function processOverdueInvoices() {
  const overdue = await prisma.invoice.findMany({
    where: {
      dueDate: { lt: new Date() },
      status: { in: ['SENT', 'PARTIAL'] },
    },
  });

  for (const inv of overdue) {
    await prisma.invoice.update({
      where: { id: inv.id },
      data: { status: 'OVERDUE' },
    });
  }

  return overdue.length;
}

export function startScheduler() {
  const HOUR = 60 * 60 * 1000;

  const run = async () => {
    try {
      const reminders = await processCheckInReminders();
      const overdue = await processOverdueInvoices();
      if (reminders > 0 || overdue > 0) {
        console.log(`Scheduler: ${reminders} check-in reminder(s), ${overdue} overdue invoice(s) updated`);
      }
    } catch (err) {
      console.error('Scheduler error:', err);
    }
  };

  setTimeout(run, 10000);
  setInterval(run, HOUR);
}
