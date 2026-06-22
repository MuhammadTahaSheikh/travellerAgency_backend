import prisma from '../config/database';
import { AccountType, Prisma } from '@prisma/client';
import { generateNumber } from '../utils/helpers';

type TxClient = Prisma.TransactionClient;

export async function createJournalEntry(
  description: string,
  lines: { accountId: string; debit?: number; credit?: number; description?: string }[],
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
          })),
        },
      },
      include: { transactions: true },
    });

    for (const line of lines) {
      const balanceChange = (line.debit || 0) - (line.credit || 0);
      await client.account.update({
        where: { id: line.accountId },
        data: { balance: { increment: balanceChange } },
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

export async function createCustomerAccount(customerId: string, customerName: string) {
  const existing = await prisma.account.findFirst({ where: { customerId } });
  if (existing) return existing;

  return prisma.account.create({
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
      account: true,
      journalEntry: true,
    },
    orderBy: { journalEntry: { date: 'desc' } },
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
