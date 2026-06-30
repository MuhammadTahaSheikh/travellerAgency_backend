import { Response } from 'express';
import prisma, { TX_OPTS } from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination, applyDateFilter } from '../utils/helpers';
import { paramId } from '../utils/params';
import {
  createJournalEntry,
  getLedgerTransactions,
  buildLedgerRows,
  CurrencyView,
} from '../services/ledgerService';
import { logActivity } from '../middleware/activityLogger';

export async function getAccounts(req: AuthRequest, res: Response) {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, phone: true, companyName: true, tradePartnerId: true, customerType: true } },
      vendor: { select: { id: true, name: true, category: true } },
      employee: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { name: 'asc' },
  });

  type AccountRow = (typeof accounts)[number];
  const company: AccountRow[] = [];
  const customers: AccountRow[] = [];
  const vendors: AccountRow[] = [];
  const employees: AccountRow[] = [];

  for (const acc of accounts) {
    if (acc.customerId) customers.push(acc);
    else if (acc.vendorId) vendors.push(acc);
    else if (acc.employeeId) employees.push(acc);
    else company.push(acc);
  }

  const sumBalance = (list: AccountRow[], field: 'balance' | 'balancePkr' | 'balanceSar' = 'balance') =>
    list.reduce((s, a) => s + Number(a[field]), 0);

  return res.json({
    success: true,
    data: accounts,
    grouped: {
      company: { label: 'Company (Agency)', accounts: company, totalBalance: sumBalance(company), totalBalancePkr: sumBalance(company, 'balancePkr'), totalBalanceSar: sumBalance(company, 'balanceSar') },
      customers: { label: 'Customers', accounts: customers, totalBalance: sumBalance(customers), totalBalancePkr: sumBalance(customers, 'balancePkr'), totalBalanceSar: sumBalance(customers, 'balanceSar') },
      vendors: { label: 'Vendors', accounts: vendors, totalBalance: sumBalance(vendors), totalBalancePkr: sumBalance(vendors, 'balancePkr'), totalBalanceSar: sumBalance(vendors, 'balanceSar') },
      employees: { label: 'Employees', accounts: employees, totalBalance: sumBalance(employees), totalBalancePkr: sumBalance(employees, 'balancePkr'), totalBalanceSar: sumBalance(employees, 'balanceSar') },
    },
  });
}

export async function getAccountTransactions(req: AuthRequest, res: Response) {
  const { startDate, endDate, currency } = req.query;
  const currencyView: CurrencyView = currency === 'SAR' ? 'SAR' : 'PKR';

  const account = await prisma.account.findUnique({
    where: { id: paramId(req) },
    include: {
      customer: true,
      vendor: true,
    },
  });
  if (!account) return res.status(404).json({ success: false, error: 'Account not found' });

  const transactions = await getLedgerTransactions({
    accountId: paramId(req),
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined,
  });

  const rows = buildLedgerRows(transactions, currencyView).reverse();

  return res.json({
    success: true,
    data: {
      account,
      currency: currencyView,
      balancePkr: Number(account.balancePkr),
      balanceSar: Number(account.balanceSar),
      balance: Number(account.balance),
      transactions: rows,
    },
  });
}

export async function getJournalEntries(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  const where = applyDateFilter({ isDeleted: false }, 'date', startDate, endDate);

  const [entries, total] = await Promise.all([
    prisma.journalEntry.findMany({
      where,
      skip,
      take: limit,
      orderBy: { date: 'desc' },
      include: { transactions: { include: { account: true } } },
    }),
    prisma.journalEntry.count({ where }),
  ]);

  return res.json({ success: true, data: entries, pagination: formatPagination(total, page, limit) });
}

export async function createJournalEntryHandler(req: AuthRequest, res: Response) {
  const { description, lines, date, reference, notes, receiptPath } = req.body;

  if (!description || !lines?.length) {
    return res.status(400).json({ success: false, error: 'Description and transaction lines required' });
  }

  const entry = await createJournalEntry(description, lines, { date: date ? new Date(date) : undefined, reference, notes, receiptPath });
  await logActivity(req, 'CREATE', 'JournalEntry', entry.id);
  return res.status(201).json({ success: true, data: entry });
}

export async function getGeneralLedger(req: AuthRequest, res: Response) {
  const { startDate, endDate, accountId, currency } = req.query;
  const currencyView: CurrencyView = currency === 'SAR' ? 'SAR' : 'PKR';

  const transactions = await getLedgerTransactions({
    accountId: accountId as string,
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined,
  });

  const rows = buildLedgerRows(transactions, currencyView).reverse();
  return res.json({ success: true, data: rows, currency: currencyView });
}

export async function getTrialBalanceReport(_req: AuthRequest, res: Response) {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
      balance: true,
      balancePkr: true,
      balanceSar: true,
      customerId: true,
      vendorId: true,
      employeeId: true,
    },
    orderBy: { name: 'asc' },
  });

  const rows = accounts.map((acc) => ({
    accountId: acc.id,
    accountName: acc.name,
    accountCode: acc.code,
    accountType: acc.type,
    customerId: acc.customerId,
    vendorId: acc.vendorId,
    employeeId: acc.employeeId,
    debit: Number(acc.balance) > 0 ? Number(acc.balance) : 0,
    credit: Number(acc.balance) < 0 ? Math.abs(Number(acc.balance)) : 0,
    balance: Number(acc.balance),
  }));

  const groupKey = (r: (typeof rows)[number]) => {
    if (r.customerId) return 'customers';
    if (r.vendorId) return 'vendors';
    if (r.employeeId) return 'employees';
    return 'company';
  };

  const grouped: Record<string, typeof rows> = {
    company: [],
    customers: [],
    vendors: [],
    employees: [],
  };
  rows.forEach((r) => grouped[groupKey(r)].push(r));

  const totalDebit = rows.reduce((s, b) => s + b.debit, 0);
  const totalCredit = rows.reduce((s, b) => s + b.credit, 0);

  return res.json({
    success: true,
    data: {
      accounts: rows,
      grouped: {
        company: { label: 'Company (Agency)', accounts: grouped.company },
        customers: { label: 'Customers', accounts: grouped.customers },
        vendors: { label: 'Vendors', accounts: grouped.vendors },
        employees: { label: 'Employees', accounts: grouped.employees },
      },
      totalDebit,
      totalCredit,
    },
  });
}

export async function deleteJournalEntry(req: AuthRequest, res: Response) {
  const entry = await prisma.journalEntry.findUnique({
    where: { id: paramId(req) },
    include: { transactions: true },
  });

  if (!entry) return res.status(404).json({ success: false, error: 'Journal entry not found' });

  await prisma.$transaction(async (tx) => {
    for (const t of entry.transactions) {
      await tx.account.update({
        where: { id: t.accountId },
        data: { balance: { decrement: Number(t.debit) - Number(t.credit) } },
      });
    }
    await tx.journalEntry.update({ where: { id: paramId(req) }, data: { isDeleted: true } });
  }, TX_OPTS);

  await logActivity(req, 'DELETE', 'JournalEntry', paramId(req));
  return res.json({ success: true, message: 'Journal entry deleted' });
}
