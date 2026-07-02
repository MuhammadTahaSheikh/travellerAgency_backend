import prisma from '../config/database';
import { Prisma } from '@prisma/client';

const PAD_LENGTH = 3;
const SEQUENCE_ID = 'booking';

type TxClient = Prisma.TransactionClient;

export function formatSequentialNumber(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(PAD_LENGTH, '0')}`;
}

/** Extract numeric suffix from BK-001 / INV-001 or legacy random formats. */
export function extractSequenceFromDocumentNumber(docNumber: string): number | null {
  const padded = docNumber.match(/^[A-Za-z]+-(\d{3,})$/);
  if (padded) return parseInt(padded[1], 10);
  return null;
}

export async function allocateDocumentSequence(tx?: TxClient): Promise<number> {
  const client = tx || prisma;
  const row = await client.documentSequence.upsert({
    where: { id: SEQUENCE_ID },
    create: { id: SEQUENCE_ID, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return row.nextValue - 1;
}

export async function allocateBookingNumber(tx?: TxClient): Promise<string> {
  const sequence = await allocateDocumentSequence(tx);
  return formatSequentialNumber('BK', sequence);
}

export async function allocateInvoiceNumber(prefix = 'INV', tx?: TxClient): Promise<string> {
  const sequence = await allocateDocumentSequence(tx);
  return formatSequentialNumber(prefix, sequence);
}

export function invoiceNumberFromBooking(bookingNumber: string, prefix = 'INV'): string | null {
  const sequence = extractSequenceFromDocumentNumber(bookingNumber);
  if (sequence === null) return null;
  return formatSequentialNumber(prefix, sequence);
}

export async function resolveInvoiceNumber(
  bookingNumber: string | null | undefined,
  prefix = 'INV',
  tx?: TxClient
): Promise<string> {
  if (bookingNumber) {
    const matched = invoiceNumberFromBooking(bookingNumber, prefix);
    if (matched) return matched;
  }
  return allocateInvoiceNumber(prefix, tx);
}

export async function voucherNumberFromLinkedDocument(
  bookingNumber?: string | null,
  invoiceNumber?: string | null,
  tx?: TxClient
): Promise<string> {
  const fromBooking = bookingNumber ? extractSequenceFromDocumentNumber(bookingNumber) : null;
  const fromInvoice = invoiceNumber ? extractSequenceFromDocumentNumber(invoiceNumber) : null;
  const sequence = fromBooking ?? fromInvoice;
  if (sequence !== null) return formatSequentialNumber('VCH', sequence);
  // Fallback for legacy documents
  const seq = await allocateDocumentSequence(tx);
  return formatSequentialNumber('VCH', seq);
}

export async function allocateInternalTransferReference(tx?: TxClient): Promise<string> {
  const client = tx || prisma;
  const row = await client.documentSequence.upsert({
    where: { id: 'internal_transfer' },
    create: { id: 'internal_transfer', nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return formatSequentialNumber('ITR', row.nextValue - 1);
}

/** Initialize sequence counter from existing sequential booking numbers. */
export async function syncDocumentSequenceFromDatabase(): Promise<void> {
  const bookings = await prisma.booking.findMany({ select: { bookingNumber: true } });
  let maxSeq = 0;
  for (const b of bookings) {
    const seq = extractSequenceFromDocumentNumber(b.bookingNumber);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }
  if (maxSeq === 0) return;
  await prisma.documentSequence.upsert({
    where: { id: SEQUENCE_ID },
    create: { id: SEQUENCE_ID, nextValue: maxSeq + 1 },
    update: { nextValue: { set: Math.max(maxSeq + 1, 1) } },
  });
}
