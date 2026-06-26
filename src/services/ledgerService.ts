import prisma from '../config/database';
import { AccountType, Prisma } from '@prisma/client';
import { generateNumber } from '../utils/helpers';

type TxClient = Prisma.TransactionClient;

export async function createJournalEntry(
  description: string,
  lines: {
    accountId: string;
    debit?: number;
    credit?: number;
    description?: string;
    currency?: 'PKR' | 'SAR';
    exchangeRate?: number;
    amountPkr?: number;
    amountSar?: number;
    paymentMethod?: string;
    remarks?: string;
    attachmentPath?: string;
  }[],
  options?: { date?: Date; reference?: string; notes?: string; receiptPath?: string },
  tx?: TxClient
) {
  const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error('Journal entry must balance: debits must equal credits');
  }

  const run = async (client: TxClient) => {
    const entry = await client.journalEntry.create({
      data: {
        entryNumber: generateNumber('JE'),
        date: options?.date || new Date(),
        description,
        reference: options?.reference,
        notes: options?.notes,
        receiptPath: options?.receiptPath,
        transactions: {
          create: lines.map((line) => ({
            accountId: line.accountId,
            debit: line.debit || 0,
            credit: line.credit || 0,
            description: line.description,
            currency: line.currency || 'PKR',
            exchangeRate: line.exchangeRate,
            amountPkr: line.amountPkr,
            amountSar: line.amountSar,
            paymentMethod: line.paymentMethod as import('@prisma/client').PaymentMethod | undefined,
            remarks: line.remarks,
            attachmentPath: line.attachmentPath,
          })),
        },
      },
      include: { transactions: true },
    });

    for (const line of lines) {
      const balanceChange = (line.debit || 0) - (line.credit || 0);
      const pkrChange = line.amountPkr != null
        ? (line.debit ? line.amountPkr : line.credit ? -line.amountPkr : 0)
        : balanceChange;
      const sarChange = line.amountSar != null
        ? (line.debit ? line.amountSar : line.credit ? -line.amountSar : 0)
        : 0;

      await client.account.update({
        where: { id: line.accountId },
        data: {
          balance: { increment: balanceChange },
          balancePkr: { increment: pkrChange },
          ...(line.amountSar != null ? { balanceSar: { increment: sarChange } } : {}),
        },
      });
    }

    return entry;
  };

  if (tx) return run(tx);
  return prisma.$transaction(run);
}

export async function getAccountBalance(accountId: string) {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  return account?.balance || new Prisma.Decimal(0);
}

export async function getOrCreateCashAccount() {
  let account = await prisma.account.findFirst({ where: { type: 'CASH', code: 'CASH-001' } });
  if (!account) {
    account = await prisma.account.create({
      data: { name: 'Cash Account', code: 'CASH-001', type: 'CASH' as AccountType },
    });
  }
  return account;
}

export async function getOrCreateBankAccount() {
  let account = await prisma.account.findFirst({ where: { type: 'BANK', code: 'BANK-001' } });
  if (!account) {
    account = await prisma.account.create({
      data: { name: 'Bank Account', code: 'BANK-001', type: 'BANK' as AccountType },
    });
  }
  return account;
}

export async function createCustomerAccount(customerId: string, customerName: string, tx?: TxClient) {
  const client = tx || prisma;
  const existing = await client.account.findFirst({ where: { customerId } });
  if (existing) return existing;

  return client.account.create({
    data: {
      name: `Customer: ${customerName}`,
      code: generateNumber('CUST'),
      type: 'CUSTOMER',
      customerId,
    },
  });
}

export async function recordIncomeEntry(
  category: string,
  amount: number,
  description: string,
  accountId: string,
  reference?: string
) {
  const incomeAccount = await getOrCreateIncomeAccount();
  return createJournalEntry(
    description,
    [
      { accountId, debit: amount, description: `Income: ${category}` },
      { accountId: incomeAccount.id, credit: amount, description },
    ],
    { reference }
  );
}

async function getOrCreateIncomeAccount() {
  let account = await prisma.account.findFirst({ where: { code: 'INCOME-001' } });
  if (!account) {
    account = await prisma.account.create({
      data: { name: 'Income Account', code: 'INCOME-001', type: 'CASH' },
    });
  }
  return account;
}

export async function getOrCreateReceivableAccount(tx?: TxClient) {
  const client = tx || prisma;
  let account = await client.account.findFirst({ where: { code: 'AR-001' } });
  if (!account) {
    account = await client.account.create({
      data: { name: 'Accounts Receivable', code: 'AR-001', type: 'CUSTOMER' },
    });
  }
  return account;
}

export async function getOrCreateExpenseAccount(tx?: TxClient) {
  const client = tx || prisma;
  let account = await client.account.findFirst({ where: { code: 'EXPENSE-001' } });
  if (!account) {
    account = await client.account.create({
      data: { name: 'General Expense', code: 'EXPENSE-001', type: 'SUPPLIER' },
    });
  }
  return account;
}

export async function resolvePaymentCreditAccount(invoiceId?: string, tx?: TxClient) {
  const client = tx || prisma;
  if (invoiceId) {
    const invoice = await client.invoice.findUnique({
      where: { id: invoiceId },
      include: { customer: { include: { account: true } } },
    });
    if (invoice?.customer?.account) {
      return invoice.customer.account;
    }
  }
  return getOrCreateReceivableAccount(tx);
}

export async function getLedgerTransactions(filters?: {
  accountId?: string;
  startDate?: Date;
  endDate?: Date;
}) {
  const where: Prisma.TransactionWhereInput = {};
  if (filters?.accountId) where.accountId = filters.accountId;
  if (filters?.startDate || filters?.endDate) {
    where.journalEntry = {
      date: {
        ...(filters.startDate ? { gte: filters.startDate } : {}),
        ...(filters.endDate ? { lte: filters.endDate } : {}),
      },
    };
  }

  return prisma.transaction.findMany({
    where,
    include: {
      account: {
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, companyName: true, tradePartnerId: true, customerType: true } },
          vendor: { select: { id: true, name: true, category: true } },
        },
      },
      journalEntry: {
        include: {
          transactions: {
            include: {
              account: { select: { id: true, name: true, type: true, code: true } },
            },
          },
        },
      },
    },
    orderBy: [{ journalEntry: { date: 'asc' } }, { createdAt: 'asc' }],
  });
}

export type CurrencyView = 'PKR' | 'SAR';

function amountInCurrency(
  t: { debit: unknown; credit: unknown; amountPkr: unknown; amountSar: unknown; currency?: string },
  view: CurrencyView
) {
  const debit = Number(t.debit);
  const credit = Number(t.credit);
  if (view === 'SAR' && t.amountSar != null) {
    return {
      debit: debit > 0 ? Number(t.amountSar) : 0,
      credit: credit > 0 ? Number(t.amountSar) : 0,
    };
  }
  const pkr = t.amountPkr != null ? Number(t.amountPkr) : debit || credit;
  return {
    debit: debit > 0 ? pkr : 0,
    credit: credit > 0 ? pkr : 0,
  };
}

export function buildLedgerRows(
  transactions: Awaited<ReturnType<typeof getLedgerTransactions>>,
  currencyView: CurrencyView = 'PKR'
) {
  let runningBalance = 0;
  let runningPkr = 0;
  let runningSar = 0;

  return transactions.map((t) => {
    const { debit, credit } = amountInCurrency(t, currencyView);
    const debitPkr = Number(t.amountPkr ?? t.debit);
    const creditPkr = Number(t.amountPkr ?? t.credit);
    const debitSar = Number(t.amountSar ?? 0);
    const creditSar = Number(t.amountSar ?? 0);

    runningBalance += debit - credit;
    runningPkr += (Number(t.debit) > 0 ? debitPkr : 0) - (Number(t.credit) > 0 ? creditPkr : 0);
    runningSar += (Number(t.debit) > 0 ? debitSar : 0) - (Number(t.credit) > 0 ? creditSar : 0);

    const siblings = t.journalEntry.transactions.filter((s) => s.id !== t.id);
    const bankAccount = siblings.find((s) => ['CASH', 'BANK'].includes(s.account.type))?.account;
    const counterAccount = siblings[0]?.account;

    return {
      ...t,
      debit,
      credit,
      displayCurrency: currencyView,
      runningBalance,
      runningBalancePkr: runningPkr,
      runningBalanceSar: runningSar,
      bankAccount: bankAccount || (['CASH', 'BANK'].includes(t.account.type) ? t.account : null),
      counterAccount: counterAccount || null,
      attachmentPath: t.attachmentPath || t.journalEntry.receiptPath,
    };
  });
}

export async function reverseJournalEntry(
  journalEntryId: string,
  description: string,
  tx?: TxClient
) {
  const client = tx || prisma;
  const original = await client.journalEntry.findUnique({
    where: { id: journalEntryId },
    include: { transactions: true },
  });

  if (!original || original.isDeleted) return null;

  const reversedLines = original.transactions.map((t) => ({
    accountId: t.accountId,
    debit: Number(t.credit),
    credit: Number(t.debit),
    description: `Reversal: ${t.description || ''}`,
  }));

  const reversal = await createJournalEntry(description, reversedLines, { reference: original.reference || undefined }, client);
  await client.journalEntry.update({ where: { id: journalEntryId }, data: { isDeleted: true } });
  return reversal;
}

export async function getOrCreateVendorExpenseAccount(vendorId: string, vendorName: string, tx?: TxClient) {
  const client = tx || prisma;
  const existing = await client.account.findFirst({ where: { vendorId } });
  if (existing) return existing;

  return client.account.create({
    data: {
      name: `Vendor: ${vendorName}`,
      code: generateNumber('VND'),
      type: 'SUPPLIER',
      vendorId,
    },
  });
}
export async function getTrialBalance(asOfDate?: Date) {
  const accounts = await prisma.account.findMany({ where: { isActive: true } });
  return accounts.map((acc) => ({
    accountId: acc.id,
    accountName: acc.name,
    accountCode: acc.code,
    accountType: acc.type,
    debit: Number(acc.balance) > 0 ? Number(acc.balance) : 0,
    credit: Number(acc.balance) < 0 ? Math.abs(Number(acc.balance)) : 0,
    balance: Number(acc.balance),
  }));
}
