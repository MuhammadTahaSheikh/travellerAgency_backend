import prisma, { TX_OPTS } from '../config/database';
import { Prisma, ServiceType } from '@prisma/client';
import { createJournalEntry } from './ledgerService';
import { createVendorAccount } from './vendorService';

type TxClient = Prisma.TransactionClient;

async function getOrCreateCostOfSalesAccount(tx: TxClient) {
  let account = await tx.account.findFirst({ where: { code: 'COS-001' } });
  if (!account) {
    account = await tx.account.create({
      data: { name: 'Cost of Sales', code: 'COS-001', type: 'SUPPLIER' },
    });
  }
  return account;
}

export async function createVendorPosting(
  data: {
    invoiceId?: string;
    bookingId?: string;
    invoiceItemId?: string;
    vendorId?: string;
    serviceType: ServiceType;
    description: string;
    expectedCost: number;
    currency?: 'PKR' | 'SAR';
    exchangeRate?: number;
    postingType: 'INSTANT' | 'PENDING';
    dueDate?: Date;
  },
  tx?: TxClient
) {
  const client = tx || prisma;

  const posting = await client.vendorPosting.create({
    data: {
      invoiceId: data.invoiceId,
      bookingId: data.bookingId,
      invoiceItemId: data.invoiceItemId,
      vendorId: data.vendorId,
      serviceType: data.serviceType,
      description: data.description,
      expectedCost: data.expectedCost,
      currency: data.currency || 'PKR',
      exchangeRate: data.exchangeRate,
      postingType: data.postingType,
      status: data.postingType === 'INSTANT' ? 'POSTED' : 'PENDING',
      dueDate: data.dueDate,
      postedAt: data.postingType === 'INSTANT' ? new Date() : undefined,
    },
    include: { vendor: true, invoiceItem: true },
  });

  if (data.postingType === 'INSTANT' && data.vendorId) {
    await postVendorCostToLedger(posting.id, data.expectedCost, client);
  }

  return posting;
}

export async function postVendorCostToLedger(
  postingId: string,
  actualCost?: number,
  tx?: TxClient
) {
  const run = async (client: TxClient) => {
    const posting = await client.vendorPosting.findUnique({
      where: { id: postingId },
      include: { vendor: true },
    });
    if (!posting) throw new Error('Vendor posting not found');
    if (posting.status === 'POSTED' && posting.journalEntryId) return posting;

    const cost = actualCost ?? Number(posting.actualCost ?? posting.expectedCost);
    if (!posting.vendorId || !posting.vendor) throw new Error('Vendor is required to post cost');

    let vendorAccount = await client.account.findFirst({ where: { vendorId: posting.vendorId } });
    if (!vendorAccount) {
      vendorAccount = await createVendorAccount(posting.vendorId, posting.vendor.name, client);
    }

    const payCurrency = posting.currency || 'PKR';
    const rate = Number(posting.exchangeRate || (await import('./currencyService').then((m) => m.getDefaultExchangeRate())));
    const { amountPkr, amountSar } = (await import('./currencyService')).convertCurrency(cost, payCurrency, rate);

    const entry = await createJournalEntry(
      `Vendor cost: ${posting.description}`,
      [
        {
          accountId: (await getOrCreateCostOfSalesAccount(client)).id,
          debit: cost,
          description: posting.description,
          currency: payCurrency,
          exchangeRate: rate,
          amountPkr,
          amountSar,
        },
        {
          accountId: vendorAccount.id,
          credit: cost,
          description: `Payable to ${posting.vendor.name}`,
          currency: payCurrency,
          exchangeRate: rate,
          amountPkr,
          amountSar,
        },
      ],
      { reference: posting.id },
      client
    );

    return client.vendorPosting.update({
      where: { id: postingId },
      data: {
        status: 'POSTED',
        actualCost: cost,
        postedAt: new Date(),
        journalEntryId: entry.id,
      },
      include: { vendor: true, invoice: true },
    });
  };

  if (tx) return run(tx);
  return prisma.$transaction(run, TX_OPTS);
}

export async function getPendingVendorCosts() {
  const postings = await prisma.vendorPosting.findMany({
    where: { status: 'PENDING' },
    include: { vendor: true, invoice: { include: { customer: true } }, invoiceItem: true },
    orderBy: { dueDate: 'asc' },
  });

  const totalPending = postings.reduce((s, p) => s + Number(p.expectedCost), 0);
  return { postings, totalPending };
}
