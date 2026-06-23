import prisma from '../config/database';
import { NotificationType } from '@prisma/client';

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
  link?: string
) {
  return prisma.notification.create({
    data: { userId, type, title, message, link },
  });
}

export async function notifyAllUsers(
  type: NotificationType,
  title: string,
  message: string,
  link?: string
) {
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
  await prisma.notification.createMany({
    data: users.map((u) => ({ userId: u.id, type, title, message, link })),
  });
}

export async function createBookingConfirmation(userId: string, bookingNumber: string) {
  return createNotification(
    userId,
    'BOOKING_CONFIRMATION',
    'Booking Confirmed',
    `Booking ${bookingNumber} has been confirmed.`,
    `/bookings`
  );
}

export async function createPaymentReminder(userId: string, invoiceNumber: string, dueDate: Date) {
  return createNotification(
    userId,
    'PAYMENT_REMINDER',
    'Payment Reminder',
    `Invoice ${invoiceNumber} is due on ${dueDate.toLocaleDateString()}.`,
    `/invoices`
  );
}

export async function createCheckInReminder(userId: string, guestName: string, hotelName: string, checkInDate: Date) {
  return createNotification(
    userId,
    'CHECK_IN_REMINDER',
    'Check-in Reminder',
    `Reminder: ${guestName} checks in at ${hotelName} tomorrow (${checkInDate.toLocaleDateString()}).`,
    '/check-ins'
  );
}

export async function createDueAlert(userId: string, message: string) {
  return createNotification(userId, 'DUE_ALERT', 'Due Alert', message);
}

export async function createSystemAnnouncement(title: string, message: string) {
  return notifyAllUsers('SYSTEM_ANNOUNCEMENT', title, message);
}
