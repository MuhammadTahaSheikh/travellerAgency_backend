import prisma, { TX_OPTS } from '../config/database';
import { Prisma, ServiceType } from '@prisma/client';
import { createJournalEntry, reverseJournalEntry } from './ledgerService';
import { createVendorAccount } from './vendorService';
import { formatVendorDisplay } from '../utils/vendorDisplay';
import { buildDetailedPostingDescription } from '../utils/postingDescription';

type TxClient = Prisma.TransactionClient;

export const UNPOSTED_VENDOR_COSTS_CODE = 'UNPOSTED-001';
export const COST_OF_SALES_CODE = 'COS-001';

export async function getOrCreateCostOfSalesAccount(tx?: TxClient) {
  const client = tx || prisma;
  let account = await client.account.findFirst({ where: { code: COST_OF_SALES_CODE } });
  if (!account) {
    account = await client.account.create({
      data: { name: 'Cost of Sales', code: COST_OF_SALES_CODE, type: 'SUPPLIER' },
    });
  }
  return account;
}

export async function getOrCreateUnpostedVendorCostsAccount(tx?: TxClient) {
  const client = tx || prisma;
  let account = await client.account.findFirst({ where: { code: UNPOSTED_VENDOR_COSTS_CODE } });
  if (!account) {
    account = await client.account.create({
      data: {
        name: 'Unposted Vendor Costs',
        code: UNPOSTED_VENDOR_COSTS_CODE,
        type: 'SUPPLIER',
        description: 'Service costs accrued on booking confirm — transferred to vendor ledgers when posted',
      },
    });
  }
  return account;
}

async function postingAmounts(
  cost: number,
  currency: 'PKR' | 'SAR',
  exchangeRate?: number | null
) {
  const rate = Number(exchangeRate || (await import('./currencyService').then((m) => m.getDefaultExchangeRate())));
  const { amountPkr, amountSar } = (await import('./currencyService')).convertCurrency(cost, currency, rate);
  return { rate, amountPkr, amountSar };
}

function journalLine(
  accountId: string,
  side: 'debit' | 'credit',
  amount: number,
  payCurrency: 'PKR' | 'SAR',
  amounts: Awaited<ReturnType<typeof postingAmounts>>,
  description: string
) {
  return {
    accountId,
    [side]: amount,
    description,
    currency: payCurrency,
    exchangeRate: amounts.rate,
    amountPkr: amounts.amountPkr,
    amountSar: amounts.amountSar,
  };
}

/** Reverse stale unposted accrual and re-book at the current expectedCost. */
export async function resyncUnpostedAccrualForPosting(postingId: string, tx?: TxClient) {
  const run = async (client: TxClient) => {
    const posting = await client.vendorPosting.findUnique({ where: { id: postingId } });
    if (!posting || posting.status === 'POSTED' || posting.status === 'CANCELLED') return posting;

    const cost = Number(posting.expectedCost);
    if (cost <= 0) {
      if (posting.unpostedJournalEntryId) {
        await reverseJournalEntry(
          posting.unpostedJournalEntryId,
          `Reverse unposted accrual: ${posting.description}`,
          client
        );
        return client.vendorPosting.update({
          where: { id: postingId },
          data: { unpostedJournalEntryId: null },
        });
      }
      return posting;
    }

    if (posting.unpostedJournalEntryId) {
      await reverseJournalEntry(
        posting.unpostedJournalEntryId,
        `Reverse stale unposted accrual: ${posting.description}`,
        client
      );
      await client.vendorPosting.update({
        where: { id: postingId },
        data: { unpostedJournalEntryId: null },
      });
    }

    return accrueUnpostedCostToLedger(postingId, client);
  };

  if (tx) return run(tx);
  return prisma.$transaction(run, TX_OPTS);
}

/** Recognize cost in COS and park payable in the unposted vendor costs ledger. */
export async function accrueUnpostedCostToLedger(postingId: string, tx?: TxClient) {
  const run = async (client: TxClient) => {
    const posting = await client.vendorPosting.findUnique({ where: { id: postingId } });
    if (!posting) throw new Error('Vendor posting not found');
    if (posting.unpostedJournalEntryId) return posting;
    if (posting.status === 'POSTED') return posting;

    const cost = Number(posting.expectedCost);
    if (cost <= 0) return posting;

    const cosAccount = await getOrCreateCostOfSalesAccount(client);
    const unpostedAccount = await getOrCreateUnpostedVendorCostsAccount(client);
    const payCurrency = (posting.currency || 'PKR') as 'PKR' | 'SAR';
    const { rate, amountPkr, amountSar } = await postingAmounts(cost, payCurrency, posting.exchangeRate != null ? Number(posting.exchangeRate) : undefined);

    const entry = await createJournalEntry(
      `Unposted vendor cost: ${posting.description}`,
      [
        {
          accountId: cosAccount.id,
          debit: cost,
          description: `${posting.serviceType}: ${posting.description}`,
          currency: payCurrency,
          exchangeRate: rate,
          amountPkr,
          amountSar,
        },
        {
          accountId: unpostedAccount.id,
          credit: cost,
          description: posting.description,
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
      data: { unpostedJournalEntryId: entry.id },
      include: { vendor: true, invoice: true },
    });
  };

  if (tx) return run(tx);
  return prisma.$transaction(run, TX_OPTS);
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

  const status =
    data.postingType === 'INSTANT' && data.vendorId
      ? 'POSTED'
      : data.vendorId
        ? 'PENDING'
        : 'UNASSIGNED';

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
      status,
      dueDate: data.dueDate,
      postedAt: status === 'POSTED' ? new Date() : undefined,
    },
    include: { vendor: true, invoiceItem: true },
  });

  if (status === 'POSTED') {
    await postVendorCostToLedger(posting.id, data.expectedCost, client);
  } else if (Number(data.expectedCost) > 0) {
    await accrueUnpostedCostToLedger(posting.id, client);
  }

  return client.vendorPosting.findUniqueOrThrow({
    where: { id: posting.id },
    include: { vendor: true, invoiceItem: true },
  });
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
    if (posting.status === 'UNASSIGNED') {
      throw new Error('Assign a vendor on the Vendor Postings page before posting to ledger');
    }
    if (posting.status === 'POSTED' && posting.journalEntryId) return posting;

    const estimated = Number(posting.expectedCost);
    const cost = actualCost ?? Number(posting.actualCost ?? posting.expectedCost);
    if (!posting.vendorId || !posting.vendor) throw new Error('Vendor is required to post cost');

    let vendorAccount = await client.account.findFirst({ where: { vendorId: posting.vendorId } });
    if (!vendorAccount) {
      vendorAccount = await createVendorAccount(posting.vendorId, posting.vendor.name, client);
    }

    const payCurrency = (posting.currency || 'PKR') as 'PKR' | 'SAR';
    const rateArg = posting.exchangeRate != null ? Number(posting.exchangeRate) : undefined;
    const estimatedAmt = await postingAmounts(estimated, payCurrency, rateArg);
    const actualAmt = await postingAmounts(cost, payCurrency, rateArg);

    const vendorLabel = formatVendorDisplay(posting.vendor, posting.vendor.name);

    let entry;
    if (posting.unpostedJournalEntryId) {
      const unpostedAccount = await getOrCreateUnpostedVendorCostsAccount(client);
      const cosAccount = await getOrCreateCostOfSalesAccount(client);
      const lines = [
        journalLine(
          unpostedAccount.id,
          'debit',
          estimated,
          payCurrency,
          estimatedAmt,
          `Clear unposted accrual — ${posting.description}`
        ),
        journalLine(
          vendorAccount.id,
          'credit',
          cost,
          payCurrency,
          actualAmt,
          `Payable to ${vendorLabel}`
        ),
      ];

      const variance = estimated - cost;
      if (Math.abs(variance) > 0.01) {
        const varianceAmt = await postingAmounts(Math.abs(variance), payCurrency, rateArg);
        if (variance > 0) {
          lines.push(
            journalLine(
              cosAccount.id,
              'credit',
              variance,
              payCurrency,
              varianceAmt,
              `Cost adjustment (estimated → actual): ${posting.description}`
            )
          );
        } else {
          lines.push(
            journalLine(
              cosAccount.id,
              'debit',
              Math.abs(variance),
              payCurrency,
              varianceAmt,
              `Cost adjustment (estimated → actual): ${posting.description}`
            )
          );
        }
      }

      entry = await createJournalEntry(
        `Vendor cost posted: ${posting.description}`,
        lines,
        { reference: posting.id },
        client
      );
    } else {
      entry = await createJournalEntry(
        `Vendor cost: ${posting.description}`,
        [
          journalLine(
            (await getOrCreateCostOfSalesAccount(client)).id,
            'debit',
            cost,
            payCurrency,
            actualAmt,
            posting.description
          ),
          journalLine(
            vendorAccount.id,
            'credit',
            cost,
            payCurrency,
            actualAmt,
            `Payable to ${vendorLabel}`
          ),
        ],
        { reference: posting.id },
        client
      );
    }

    const updated = await client.vendorPosting.update({
      where: { id: postingId },
      data: {
        status: 'POSTED',
        actualCost: cost,
        expectedCost: cost,
        postedAt: new Date(),
        journalEntryId: entry.id,
      },
      include: { vendor: true, invoice: true },
    });

    if ((posting.serviceType === 'HOTEL' || posting.serviceType === 'TRANSPORT') && (posting.bookingId || posting.invoiceId)) {
      await client.checkInRecord.updateMany({
        where: {
          scheduleType: posting.serviceType,
          ...(posting.bookingId ? { bookingId: posting.bookingId } : { invoiceId: posting.invoiceId }),
        },
        data: { vendorPosted: true },
      });
    }

    return updated;
  };

  if (tx) return run(tx);
  return prisma.$transaction(run, TX_OPTS);
}

type BookingPostingSpec = {
  key: string;
  serviceType: ServiceType;
  description: string;
  expectedCost: number;
  vendorId?: string;
  currency: 'PKR' | 'SAR';
  exchangeRate?: number;
};

type ServiceItemRow = {
  serviceType: ServiceType;
  description: string;
  costAmount: unknown;
  vendorId?: string | null;
  details?: (Record<string, unknown> & { rows?: Record<string, string>[] }) | null;
};

const resolveVendorId = (provided?: string | null) => (provided ? provided : undefined);

function bookingPostingContext(booking: {
  bookingNumber: string;
  guestName?: string | null;
  customer?: { firstName: string; lastName: string; companyName?: string | null } | null;
}): PostingContext {
  const customerName =
    booking.guestName ||
    booking.customer?.companyName ||
    `${booking.customer?.firstName || ''} ${booking.customer?.lastName || ''}`.trim() ||
    'Customer';
  return { bookingNumber: booking.bookingNumber, customerName };
}

function rowPostingLabel(serviceType: ServiceType, row: Record<string, string>, fallback: string) {
  if (serviceType === 'HOTEL') {
    return [row.hotelName, row.city, row.roomType].filter(Boolean).join(' - ') || fallback;
  }
  if (serviceType === 'TRANSPORT') {
    return [row.sector, row.vehicleType].filter(Boolean).join(' - ') || fallback;
  }
  return fallback;
}

type PostingContext = { bookingNumber: string; customerName: string };

/** Build expected vendor posting lines from booking service items (same order as create). */
export function buildPostingSpecsFromServiceItems(
  serviceItems: ServiceItemRow[],
  context?: PostingContext
): BookingPostingSpec[] {
  const specs: BookingPostingSpec[] = [];

  for (const item of serviceItems) {
    const details = item.details || {};
    const currency: 'PKR' | 'SAR' = details.currency === 'SAR' ? 'SAR' : 'PKR';
    const exchangeRate = details.exchangeRate ? Number(details.exchangeRate) : undefined;
    const rowBased = item.serviceType === 'HOTEL' || item.serviceType === 'TRANSPORT';
    const rows = Array.isArray(details.rows) ? details.rows : [];

    if (rowBased && rows.length > 0) {
      for (const row of rows) {
        const cost = Number(row.costTotal || 0);
        if (cost <= 0) continue;
        const shortLabel = rowPostingLabel(item.serviceType, row, item.description);
        const description = context
          ? buildDetailedPostingDescription(
              context.bookingNumber,
              context.customerName,
              item.serviceType,
              item.description,
              details,
              row
            )
          : shortLabel;
        specs.push({
          key: `${item.serviceType}::${shortLabel}`,
          serviceType: item.serviceType,
          description,
          expectedCost: cost,
          vendorId: resolveVendorId(row.vendorId),
          currency,
          exchangeRate,
        });
      }
      continue;
    }

    const cost = details.costOriginal != null ? Number(details.costOriginal) : Number(item.costAmount);
    if (cost <= 0) continue;
    const description = context
      ? buildDetailedPostingDescription(
          context.bookingNumber,
          context.customerName,
          item.serviceType,
          item.description,
          details
        )
      : item.description;
    specs.push({
      key: `${item.serviceType}::${item.description}`,
      serviceType: item.serviceType,
      description,
      expectedCost: cost,
      vendorId: resolveVendorId(item.vendorId),
      currency,
      exchangeRate,
    });
  }

  return specs;
}

/**
 * Sync PENDING vendor postings from the booking's current service items — updates vendor,
 * cost, and currency when the booking is edited after confirmation.
 */
export async function syncPendingVendorPostingsFromBooking(bookingId: string, tx?: TxClient) {
  const run = async (client: TxClient) => {
    const booking = await client.booking.findUnique({
      where: { id: bookingId },
      include: { serviceItems: true, customer: true },
    });
    if (!booking) return [];

    const context = bookingPostingContext(booking);
    const specs = buildPostingSpecsFromServiceItems(booking.serviceItems as ServiceItemRow[], context);
    const pending = await client.vendorPosting.findMany({
      where: { bookingId, status: { in: ['PENDING', 'UNASSIGNED'] } },
      orderBy: { createdAt: 'asc' },
    });

    // Legacy rows: pending without vendor belong in UNASSIGNED queue
    await client.vendorPosting.updateMany({
      where: { bookingId, status: 'PENDING', vendorId: null },
      data: { status: 'UNASSIGNED' },
    });

    if (specs.length === 0 && pending.length === 0) return [];

    const pendingByKey = new Map<string, typeof pending>();
    for (const posting of pending) {
      const key = `${posting.serviceType}::${posting.description}`;
      const list = pendingByKey.get(key) || [];
      list.push(posting);
      pendingByKey.set(key, list);
    }

    const updated: Awaited<ReturnType<typeof createVendorPosting>>[] = [];

    for (const spec of specs) {
      const queue = pendingByKey.get(spec.key) || [];
      const posting = queue.shift();
      pendingByKey.set(spec.key, queue);

      if (posting) {
        const vendorId = spec.vendorId ?? null;
        const data: {
          expectedCost: number;
          currency: 'PKR' | 'SAR';
          exchangeRate?: number;
          vendorId?: string | null;
          status?: 'UNASSIGNED' | 'PENDING';
        } = {
          expectedCost: spec.expectedCost,
          currency: spec.currency,
          exchangeRate: spec.exchangeRate,
        };

        if (posting.status !== 'POSTED' && posting.status !== 'CANCELLED') {
          data.vendorId = vendorId;
          data.status = vendorId ? 'PENDING' : 'UNASSIGNED';
        }

        await client.vendorPosting.update({
          where: { id: posting.id },
          data: { ...data, description: spec.description },
        });
        if (Number(posting.expectedCost) !== spec.expectedCost && posting.unpostedJournalEntryId) {
          await resyncUnpostedAccrualForPosting(posting.id, client);
        }
        updated.push(
          await client.vendorPosting.findUniqueOrThrow({
            where: { id: posting.id },
            include: { vendor: true, invoiceItem: true },
          })
        );
        continue;
      }

      const created = await createVendorPosting(
        {
          bookingId,
          serviceType: spec.serviceType,
          description: spec.description,
          expectedCost: spec.expectedCost,
          currency: spec.currency,
          exchangeRate: spec.exchangeRate,
          vendorId: spec.vendorId,
          postingType: 'PENDING',
        },
        client
      );
      updated.push(created);
    }

    return updated;
  };

  if (tx) return run(tx);
  return prisma.$transaction(run, TX_OPTS);
}

/**
 * Creates vendor postings for a confirmed booking's service items. Postings default to
 * PENDING ("Unposted") — cost hits the unposted vendor costs ledger immediately; on post,
 * entries move to the selected vendor's ledger account.
 */
export async function createVendorPostingsFromBooking(bookingId: string, tx?: TxClient) {
  const run = async (client: TxClient) => {
    const existing = await client.vendorPosting.count({ where: { bookingId } });
    if (existing > 0) return syncPendingVendorPostingsFromBooking(bookingId, client);

    const booking = await client.booking.findUnique({
      where: { id: bookingId },
      include: { serviceItems: true, customer: true },
    });
    if (!booking) return [];

    const context = bookingPostingContext(booking);
    const specs = buildPostingSpecsFromServiceItems(booking.serviceItems as ServiceItemRow[], context);
    const postings = [];

    for (const spec of specs) {
      const posting = await createVendorPosting(
        {
          bookingId,
          serviceType: spec.serviceType,
          description: spec.description,
          expectedCost: spec.expectedCost,
          currency: spec.currency,
          exchangeRate: spec.exchangeRate,
          vendorId: spec.vendorId,
          postingType: 'PENDING',
        },
        client
      );
      postings.push(posting);
    }

    return postings;
  };

  if (tx) return run(tx);
  return prisma.$transaction(run, TX_OPTS);
}

async function migrateUnassignedPostings() {
  const result = await prisma.vendorPosting.updateMany({
    where: { status: 'PENDING', vendorId: null },
    data: { status: 'UNASSIGNED' },
  });
  return result.count;
}

/** Backfill unposted ledger entries for pending postings created before this feature. */
export async function backfillUnpostedLedgerEntries() {
  await migrateUnassignedPostings();
  const pending = await prisma.vendorPosting.findMany({
    where: {
      status: 'PENDING',
      unpostedJournalEntryId: null,
      expectedCost: { gt: 0 },
    },
  });

  let count = 0;
  for (const posting of pending) {
    await accrueUnpostedCostToLedger(posting.id);
    count += 1;
  }
  return count;
}

export async function getUnpostedCostsLedgerSummary() {
  const account = await getOrCreateUnpostedVendorCostsAccount();
  const balancePkr = Number(account.balancePkr ?? account.balance);
  const balanceSar = Number(account.balanceSar ?? 0);
  return {
    account,
    balancePkr: Math.abs(balancePkr),
    balanceSar: Math.abs(balanceSar),
    /** Credit-normal liability — stored as negative balance in the account. */
    rawBalancePkr: balancePkr,
  };
}

export async function getPendingVendorCosts() {
  const postings = await prisma.vendorPosting.findMany({
    where: { status: { in: ['PENDING', 'UNASSIGNED'] } },
    include: {
      vendor: true,
      invoice: { include: { customer: true } },
      invoiceItem: true,
      booking: { select: { bookingNumber: true, guestName: true } },
    },
    orderBy: { dueDate: 'asc' },
  });

  const totalPending = postings.reduce((s, p) => s + Number(p.expectedCost), 0);
  const unpostedLedger = await getUnpostedCostsLedgerSummary();
  return { postings, totalPending, unpostedLedger };
}
