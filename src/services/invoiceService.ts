import prisma, { TX_OPTS } from '../config/database';
import { Prisma } from '@prisma/client';
import { generateNumber } from '../utils/helpers';
import {
  allocateInvoiceNumber,
  resolveInvoiceNumber,
} from './numberingService';
import {
  createJournalEntry,
  createCustomerAccount,
  getOrCreateDeferredRevenueAccount,
  updateCustomerAccountLabel,
} from './ledgerService';
import { convertCurrency, getDefaultExchangeRate } from './currencyService';
import { renderVoucherPatternHtml } from './voucherPatternTemplate';
import { createVendorPostingsFromBooking } from './vendorPostingService';
import {
  createVendorAccount,
  getOrCreateVendorByCategory,
  vendorCategoryFromService,
} from './vendorService';

type TxClient = Prisma.TransactionClient;

async function getInvoicePrefix(tx?: TxClient) {
  const client = tx || prisma;
  const setting = await client.setting.findUnique({ where: { key: 'invoice_prefix' } });
  return setting?.value || 'INV';
}

async function getDefaultTemplate() {
  let template = await prisma.invoiceTemplate.findFirst({ where: { isDefault: true } });
  if (!template) {
    template = await prisma.invoiceTemplate.create({
      data: {
        name: 'Default Invoice',
        isDefault: true,
        header: 'Huffaz Holiday\nProfessional Travel Services',
        footer: 'Thank you for choosing Huffaz Holiday!',
        terms: 'Payment is due by the due date shown above. Late payments may incur additional charges.',
      },
    });
  }
  return template;
}

export async function generateInvoiceFromBooking(bookingId: string, dueDays = 14, tx?: TxClient) {
  const client = tx || prisma;
  const booking = await client.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: { include: { account: true } },
      package: true,
      serviceItems: true,
    },
  });

  if (!booking) throw new Error('Booking not found');

  const existing = await client.invoice.findFirst({ where: { bookingId, status: { not: 'CANCELLED' } } });
  if (existing) return existing;

  const items: {
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    costAmount?: number;
    vendorId?: string;
    serviceType?: string;
    details?: unknown;
  }[] = [];

  if (booking.package) {
    items.push({
      description: `${booking.package.name} (${booking.numTravelers} traveler(s))`,
      quantity: booking.numTravelers,
      unitPrice: Number(booking.package.price),
      amount: Number(booking.package.price) * booking.numTravelers,
      serviceType: 'PACKAGE',
    });
  }

  for (const item of booking.serviceItems) {
    items.push({
      description: item.description,
      quantity: 1,
      unitPrice: Number(item.amount),
      amount: Number(item.amount),
      costAmount: Number(item.costAmount || 0),
      vendorId: item.vendorId || undefined,
      serviceType: item.serviceType,
      details: item.details || undefined,
    });
  }

  // Determined-price bookings capture cost only on their service items (sale = 0), so the
  // customer-facing figure lives on booking.totalAmount. Fall back to it when no priced lines exist.
  const pricedTotal = items.reduce((sum, i) => sum + i.amount, 0);
  if (items.length === 0 || pricedTotal <= 0) {
    items.length = 0;
    items.push({
      description: `Booking ${booking.bookingNumber}`,
      quantity: 1,
      unitPrice: Number(booking.totalAmount),
      amount: Number(booking.totalAmount),
    });
  }

  const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
  const discount = Number(booking.discount);
  const totalAmount = subtotal - discount;
  const prefix = await getInvoicePrefix(tx);
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + dueDays);

  const invoiceNumber = await resolveInvoiceNumber(booking.bookingNumber, prefix, tx);

  return client.invoice.create({
    data: {
      invoiceNumber,
      bookingId,
      customerId: booking.customerId,
      subtotal,
      discount,
      totalAmount,
      dueDate,
      status: 'SENT',
      items: {
        create: items.map((i) => ({
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          amount: i.amount,
          costAmount: i.costAmount ?? 0,
          vendorId: i.vendorId,
          serviceType: i.serviceType as 'PACKAGE' | 'TICKET' | 'VISA' | 'HOTEL' | 'TRANSPORT' | undefined,
          details: i.details ?? undefined,
        })),
      },
    },
    include: { items: true, customer: true, booking: true },
  });
}

export async function confirmInvoice(invoiceId: string, tx?: TxClient) {
  const run = async (client: TxClient) => {
    const invoice = await client.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: { include: { account: true } },
        booking: { select: { bookingNumber: true } },
      },
    });

    if (!invoice) throw new Error('Invoice not found');
    if (invoice.confirmedAt) {
      return client.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        include: { items: true, customer: true, booking: true },
      });
    }
    if (invoice.status === 'CANCELLED') throw new Error('Cannot confirm cancelled invoice');

    let customerAccount = invoice.customer?.account;
    const bookingNumber = invoice.booking?.bookingNumber;
    if (!customerAccount && invoice.customer) {
      customerAccount = await createCustomerAccount(
        invoice.customerId,
        invoice.customer,
        client,
        bookingNumber,
      );
    } else if (customerAccount && invoice.customer && bookingNumber) {
      customerAccount = await updateCustomerAccountLabel(
        customerAccount.id,
        invoice.customer,
        bookingNumber,
        client,
      );
    }

    if (!customerAccount) throw new Error('Customer ledger account could not be created');

    const deferredAccount = await getOrCreateDeferredRevenueAccount(client);
    const amount = Number(invoice.totalAmount);
    const rate = await getDefaultExchangeRate();
    const { amountSar } = convertCurrency(amount, 'PKR', rate);

    const entry = await createJournalEntry(
      `Invoice confirmed: ${invoice.invoiceNumber}`,
      [
        {
          accountId: customerAccount.id,
          debit: amount,
          description: 'Customer receivable',
          currency: 'PKR',
          amountPkr: amount,
          amountSar,
          exchangeRate: rate,
        },
        {
          accountId: deferredAccount.id,
          credit: amount,
          description: 'Sale pending collection',
          currency: 'PKR',
          amountPkr: amount,
          amountSar,
          exchangeRate: rate,
        },
      ],
      { reference: invoice.invoiceNumber },
      client,
    );

    return client.invoice.update({
      where: { id: invoiceId },
      data: { confirmedAt: new Date(), journalEntryId: entry.id, status: 'SENT' },
      include: { items: true, customer: true, booking: true },
    });
  };

  if (tx) return run(tx);
  return prisma.$transaction(run, TX_OPTS);
}

/** Idempotently ensures a booking has an invoice, customer ledger entry, and vendor postings. */
export async function syncBookingInvoiceAndLedger(bookingId: string, tx?: TxClient) {
  const invoice = await generateInvoiceFromBooking(bookingId, 14, tx);
  if (!invoice.confirmedAt) {
    await confirmInvoice(invoice.id, tx);
  }
  await createVendorPostingsFromBooking(bookingId, tx);
  return invoice;
}

export async function renderInvoiceHtml(invoiceId: string, baseUrl?: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: true,
      booking: {
        include: {
          package: true,
          customer: true,
          createdBy: { select: { id: true, firstName: true, lastName: true, phone: true } },
          serviceItems: true,
        },
      },
      items: true,
    },
  });

  if (!invoice) throw new Error('Invoice not found');

  const billTo = invoice.customer?.customerType === 'B2B' && invoice.customer.companyName
    ? invoice.customer.companyName
    : `${invoice.customer?.firstName || ''} ${invoice.customer?.lastName || ''}`.trim();

  return renderVoucherPatternHtml({
    voucherNumber: invoice.invoiceNumber,
    guestName: billTo,
    issuedAt: invoice.issueDate,
    remainingBalance: Number(invoice.totalAmount) - Number(invoice.paidAmount),
    paymentStatus: invoice.status,
    booking: invoice.booking,
    invoice,
  }, 'COMPLETE', {
    title: 'INVOICE',
    primaryLabel: 'Invoice No.',
    showInvoiceMeta: false,
  });
}

export async function allocateVendorCosts(bookingId: string, tx?: TxClient) {
  const run = async (client: TxClient) => {
    const booking = await client.booking.findUnique({
      where: { id: bookingId },
      include: { serviceItems: { include: { vendor: { include: { account: true } } } } },
    });

    if (!booking) throw new Error('Booking not found');

    const existing = await client.vendorCostAllocation.count({ where: { bookingId } });
    if (existing > 0) return [];

    const costOfSalesAccount = await getOrCreateCostOfSalesAccount(client);
    const allocations = [];

    for (const item of booking.serviceItems) {
      const cost = Number(item.costAmount);
      if (cost <= 0) continue;

      const vendorRecord = item.vendor || (await getOrCreateVendorByCategory(vendorCategoryFromService(item.serviceType), client));
      const vendorWithAccount = await client.vendor.findUnique({
        where: { id: vendorRecord.id },
        include: { account: true },
      });
      const vendorAccount = vendorWithAccount?.account || (await createVendorAccount(vendorRecord.id, vendorRecord.name, client));

      const entry = await createJournalEntry(
        `Vendor cost: ${item.description} (${booking.bookingNumber})`,
        [
          { accountId: vendorAccount.id, credit: cost, description: `Payable to ${vendorRecord.name}` },
          { accountId: costOfSalesAccount.id, debit: cost, description: `Cost: ${item.serviceType}` },
        ],
        { reference: booking.bookingNumber },
        client,
      );

      const allocation = await client.vendorCostAllocation.create({
        data: {
          bookingId,
          vendorId: vendorRecord.id,
          serviceType: item.serviceType,
          amount: cost,
          description: item.description,
          journalEntryId: entry.id,
        },
        include: { vendor: true },
      });
      allocations.push(allocation);
    }

    return allocations;
  };

  if (tx) return run(tx);
  return prisma.$transaction(run, TX_OPTS);
}

async function getOrCreateCostOfSalesAccount(tx?: TxClient) {
  const client = tx || prisma;
  let account = await client.account.findFirst({ where: { code: 'COS-001' } });
  if (!account) {
    account = await client.account.create({
      data: { name: 'Cost of Sales', code: 'COS-001', type: 'SUPPLIER' },
    });
  }
  return account;
}

export async function createCheckInsFromBooking(bookingId: string, tx?: TxClient) {
  const client = tx || prisma;
  const booking = await client.booking.findUnique({
    where: { id: bookingId },
    include: { customer: true, serviceItems: true },
  });

  if (!booking) return [];

  // Replace any previously generated schedule rows for this booking so edits to the
  // booking (hotels/transport sectors/dates) stay reflected on the arrival schedule.
  await client.checkInRecord.deleteMany({ where: { bookingId } });

  const records = [];
  const guestName = booking.customer?.customerType === 'B2B' && booking.customer.companyName
    ? booking.customer.companyName
    : booking.customer
      ? `${booking.customer.firstName} ${booking.customer.lastName}`.trim()
      : booking.guestName || 'Guest';

  const fallbackDate = booking.travelDate || booking.returnDate || booking.createdAt;

  for (const item of booking.serviceItems) {
    const details = item.details as (Record<string, string> & { rows?: Record<string, string>[] }) | null;
    // Multi-row services store each hotel/sector as a row; fall back to the flat detail shape.
    const rows = Array.isArray(details?.rows) && details!.rows!.length > 0 ? details!.rows! : [details || {}];

    if (item.serviceType === 'HOTEL') {
      for (const row of rows) {
        const checkInDate = row?.checkInDate ? new Date(row.checkInDate) : fallbackDate ? new Date(fallbackDate) : null;
        if (!checkInDate) continue;

        const hotelName = row?.hotelName || item.description;
        const roomDetails = [row?.roomType || row?.roomDetails, row?.mealPlan, row?.view, row?.city]
          .filter(Boolean)
          .join(' · ') || null;

        records.push(
          await client.checkInRecord.create({
            data: {
              bookingId,
              scheduleType: 'HOTEL',
              hotelName,
              checkInDate,
              guestName,
              roomDetails,
            },
          })
        );
      }
      continue;
    }

    if (item.serviceType === 'TRANSPORT') {
      for (const row of rows) {
        const transportDate = row?.date ? new Date(row.date) : fallbackDate ? new Date(fallbackDate) : null;
        if (!transportDate) continue;

        const sector = row?.sector || item.description || '';
        const [pickup, dropoff] = sector.split(/\s*[-–>]\s*/);

        records.push(
          await client.checkInRecord.create({
            data: {
              bookingId,
              scheduleType: 'TRANSPORT',
              transportDate,
              pickupLocation: pickup || sector || null,
              dropoffLocation: dropoff || null,
              roomDetails: row?.vehicleType || null,
              guestName,
            },
          })
        );
      }
    }
  }

  return records;
}
