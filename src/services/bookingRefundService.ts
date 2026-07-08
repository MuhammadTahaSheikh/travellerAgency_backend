import prisma, { TX_OPTS } from '../config/database';
import { createJournalEntry, createCustomerAccount, getOrCreateIncomeAccount } from './ledgerService';
import { getOrCreateCostOfSalesAccount, resyncUnpostedAccrualForPosting } from './vendorPostingService';
import { createVendorAccount } from './vendorService';

export async function processBookingRefund(data: {
  bookingId: string;
  createdById: string;
  customerAmount: number;
  currency: 'PKR' | 'SAR';
  exchangeRate?: number;
  vendorAmount?: number;
  vendorPostingId?: string;
  serviceItemId?: string;
  notes?: string;
}) {
  if (data.customerAmount <= 0) throw new Error('Refund amount must be greater than zero');

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: data.bookingId },
      include: {
        customer: { include: { account: true } },
        vendorPostings: { include: { vendor: true } },
      },
    });
    if (!booking) throw new Error('Booking not found');
    if (booking.status !== 'CONFIRMED' && booking.status !== 'COMPLETED') {
      throw new Error('Refunds are only allowed on confirmed or completed bookings');
    }

    let customerAccount = booking.customer?.account;
    if (!customerAccount) {
      customerAccount = await createCustomerAccount(booking.customerId, booking.customer!, tx);
    }

    const rate = data.exchangeRate ?? 75;
    const amountPkr = data.currency === 'SAR' ? data.customerAmount * rate : data.customerAmount;
    const amountSar = data.currency === 'SAR' ? data.customerAmount : data.customerAmount / rate;

    const incomeAccount = await getOrCreateIncomeAccount(tx);
    const lines: Parameters<typeof createJournalEntry>[1] = [
      {
        accountId: incomeAccount.id,
        debit: data.customerAmount,
        description: `Refund expense — ${booking.bookingNumber}`,
        currency: data.currency,
        exchangeRate: rate,
        amountPkr,
        amountSar,
      },
      {
        accountId: customerAccount.id,
        credit: data.customerAmount,
        description: `Customer refund payable — ${booking.bookingNumber}`,
        currency: data.currency,
        exchangeRate: rate,
        amountPkr,
        amountSar,
      },
    ];

    let isVendorPosted = false;
    let vendorAmount = data.vendorAmount;

    if (data.vendorPostingId) {
      const posting = booking.vendorPostings.find((p) => p.id === data.vendorPostingId);
      if (!posting) throw new Error('Vendor posting not found for this booking');

      if (posting.status === 'POSTED') {
        isVendorPosted = true;
        if (!vendorAmount || vendorAmount <= 0) {
          throw new Error('Enter the amount the vendor is returning');
        }
        if (!posting.vendorId || !posting.vendor) throw new Error('Vendor not found on posting');

        let vendorAccount = await tx.account.findFirst({ where: { vendorId: posting.vendorId } });
        if (!vendorAccount) {
          vendorAccount = await createVendorAccount(posting.vendorId, posting.vendor.name, tx);
        }

        const cosAccount = await getOrCreateCostOfSalesAccount(tx);
        const vPkr = data.currency === 'SAR' ? vendorAmount * rate : vendorAmount;
        const vSar = data.currency === 'SAR' ? vendorAmount : vendorAmount / rate;

        lines.push(
          {
            accountId: vendorAccount.id,
            debit: vendorAmount,
            description: `Vendor refund receivable — ${posting.description}`,
            currency: data.currency,
            exchangeRate: rate,
            amountPkr: vPkr,
            amountSar: vSar,
          },
          {
            accountId: cosAccount.id,
            credit: vendorAmount,
            description: `Cost recovery — ${posting.description}`,
            currency: data.currency,
            exchangeRate: rate,
            amountPkr: vPkr,
            amountSar: vSar,
          }
        );
      } else if (posting.status !== 'CANCELLED') {
        const deduct = vendorAmount ?? data.customerAmount;
        const newCost = Math.max(0, Number(posting.expectedCost) - deduct);
        await tx.vendorPosting.update({
          where: { id: posting.id },
          data: { expectedCost: newCost },
        });
        if (posting.unpostedJournalEntryId) {
          await resyncUnpostedAccrualForPosting(posting.id, tx);
        }
      }
    }

    const entry = await createJournalEntry(
      `Booking refund — ${booking.bookingNumber}`,
      lines,
      { reference: booking.bookingNumber, notes: data.notes },
      tx
    );

    const refund = await tx.bookingRefund.create({
      data: {
        bookingId: data.bookingId,
        serviceItemId: data.serviceItemId || null,
        vendorPostingId: data.vendorPostingId || null,
        customerAmount: data.customerAmount,
        vendorAmount: vendorAmount ?? null,
        currency: data.currency,
        isVendorPosted,
        notes: data.notes,
        journalEntryId: entry.id,
        createdById: data.createdById,
      },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    });

    return refund;
  }, TX_OPTS);
}
