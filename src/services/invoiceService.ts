import prisma, { TX_OPTS } from '../config/database';
import { Prisma } from '@prisma/client';
import { generateNumber } from '../utils/helpers';
import {
  allocateInvoiceNumber,
  resolveInvoiceNumber,
} from './numberingService';
import { createJournalEntry, createCustomerAccount } from './ledgerService';
import { convertCurrency, getDefaultExchangeRate } from './currencyService';
import { logoHtml, BRAND_NAME, BRAND_TAGLINE } from './documentBrand';
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

async function getOrCreateIncomeAccount(tx?: TxClient) {
  const client = tx || prisma;
  let account = await client.account.findFirst({ where: { code: 'INCOME-001' } });
  if (!account) {
    account = await client.account.create({
      data: { name: 'Revenue Account', code: 'INCOME-001', type: 'CASH' },
    });
  }
  return account;
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

  const items: { description: string; quantity: number; unitPrice: number; amount: number; serviceType?: string }[] = [];

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
      serviceType: item.serviceType,
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
          serviceType: i.serviceType as 'PACKAGE' | 'TICKET' | 'VISA' | 'HOTEL' | 'TRANSPORT' | undefined,
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
      include: { customer: { include: { account: true } } },
    });

    if (!invoice) throw new Error('Invoice not found');
    if (invoice.confirmedAt) throw new Error('Invoice already confirmed');
    if (invoice.status === 'CANCELLED') throw new Error('Cannot confirm cancelled invoice');

    let customerAccount = invoice.customer?.account;
    if (!customerAccount) {
      customerAccount = await createCustomerAccount(
        invoice.customerId,
        `${invoice.customer?.firstName} ${invoice.customer?.lastName}`,
        client,
      );
    }

    const incomeAccount = await getOrCreateIncomeAccount(client);
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
          accountId: incomeAccount.id,
          credit: amount,
          description: 'Revenue recognized',
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

export async function renderInvoiceHtml(invoiceId: string, baseUrl?: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: true,
      booking: { include: { package: true, serviceItems: true } },
      items: true,
    },
  });

  if (!invoice) throw new Error('Invoice not found');

  const template = await getDefaultTemplate();
  const itemRows = invoice.items
    .map(
      (i) =>
        `<tr><td>${i.description}</td><td style="text-align:center">${i.quantity}</td><td style="text-align:right">${Number(i.unitPrice).toLocaleString()}</td><td style="text-align:right">${Number(i.amount).toLocaleString()}</td></tr>`
    )
    .join('');

  const billTo = invoice.customer?.customerType === 'B2B' && invoice.customer.companyName
    ? `<strong>${invoice.customer.companyName}</strong>${invoice.customer.tradePartnerId ? `<br>Trade Partner: ${invoice.customer.tradePartnerId}` : ''}`
    : `<strong>${invoice.customer?.firstName} ${invoice.customer?.lastName}</strong>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Invoice ${invoice.invoiceNumber}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; color: #1e293b; }
  .header { border-bottom: 2px solid #0d9488; padding-bottom: 16px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin: 24px 0; }
  th, td { border: 1px solid #e2e8f0; padding: 10px; }
  th { background: #f1f5f9; text-align: left; }
  .totals { text-align: right; margin-top: 16px; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; white-space: pre-line; color: #64748b; font-size: 14px; }
</style></head><body>
<div class="header">
  <div style="margin-bottom:12px">${logoHtml(baseUrl, BRAND_NAME)}</div>
  <strong style="font-size:18px;color:#0d9488">${BRAND_NAME}</strong><br>
  <span style="color:#64748b">${BRAND_TAGLINE}</span>
</div>
<h2>INVOICE ${invoice.invoiceNumber}</h2>
<p><strong>Bill To:</strong> ${billTo}<br>
${invoice.customer?.phone || ''} ${invoice.customer?.email ? `| ${invoice.customer.email}` : ''}</p>
<p><strong>Issue Date:</strong> ${new Date(invoice.issueDate).toLocaleDateString()}<br>
<strong>Due Date:</strong> ${new Date(invoice.dueDate).toLocaleDateString()}<br>
<strong>Status:</strong> ${invoice.status}</p>
<table>
  <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
  <tbody>${itemRows}</tbody>
</table>
<div class="totals">
  <p>Subtotal: ${Number(invoice.subtotal).toLocaleString()}</p>
  ${Number(invoice.tax) > 0 ? `<p>Tax: ${Number(invoice.tax).toLocaleString()}</p>` : ''}
  ${Number(invoice.discount) > 0 ? `<p>Discount: -${Number(invoice.discount).toLocaleString()}</p>` : ''}
  <p><strong>Total: ${Number(invoice.totalAmount).toLocaleString()}</strong></p>
  <p>Paid: ${Number(invoice.paidAmount).toLocaleString()}</p>
  <p><strong>Outstanding: ${(Number(invoice.totalAmount) - Number(invoice.paidAmount)).toLocaleString()}</strong></p>
</div>
${template.terms ? `<p><strong>Terms:</strong> ${template.terms}</p>` : ''}
<div class="footer">${template.footer}</div>
</body></html>`;
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
  const guestName = booking.customer
    ? `${booking.customer.firstName} ${booking.customer.lastName}`.trim()
    : booking.guestName || 'Guest';

  for (const item of booking.serviceItems) {
    const details = item.details as (Record<string, string> & { rows?: Record<string, string>[] }) | null;
    // Multi-row services store each hotel/sector as a row; fall back to the flat detail shape.
    const rows = Array.isArray(details?.rows) && details!.rows!.length > 0 ? details!.rows! : [details || {}];

    if (item.serviceType === 'HOTEL') {
      for (const row of rows) {
        const checkInDate = row?.checkInDate ? new Date(row.checkInDate) : booking.travelDate;
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
        const transportDate = row?.date ? new Date(row.date) : booking.travelDate;
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
