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
import { sendLedgerExport } from '../utils/ledgerExport';
import { createInternalTransfer, executeLedgerTransfer } from '../services/internalTransferService';

export async function getAccounts(req: AuthRequest, res: Response) {
  const search = (req.query.search as string)?.trim();
  const accounts = await prisma.account.findMany({
    where: {
      isActive: true,
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { code: { contains: search } },
            ],
          }
        : {}),
    },
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
  const unposted: AccountRow[] = [];

  for (const acc of accounts) {
    if (acc.code === 'UNPOSTED-001') unposted.push(acc);
    else if (acc.customerId) customers.push(acc);
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
      unposted: {
        label: 'Unposted Vendor Costs',
        accounts: unposted,
        totalBalance: sumBalance(unposted),
        totalBalancePkr: Math.abs(sumBalance(unposted, 'balancePkr')),
        totalBalanceSar: Math.abs(sumBalance(unposted, 'balanceSar')),
      },
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

export async function getTrialBalanceReport(req: AuthRequest, res: Response) {
  const currency = req.query.currency === 'SAR' ? 'SAR' : 'PKR';
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

  const rows = accounts.map((acc) => {
    const bal = currency === 'SAR'
      ? Number(acc.balanceSar || 0)
      : Number(acc.balancePkr ?? acc.balance);
    return {
      accountId: acc.id,
      accountName: acc.name,
      accountCode: acc.code,
      accountType: acc.type,
      customerId: acc.customerId,
      vendorId: acc.vendorId,
      employeeId: acc.employeeId,
      debit: bal > 0 ? bal : 0,
      credit: bal < 0 ? Math.abs(bal) : 0,
      balance: bal,
    };
  });

  const groupKey = (r: (typeof rows)[number]) => {
    if (r.accountCode === 'UNPOSTED-001') return 'unposted';
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
    unposted: [],
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
        unposted: { label: 'Unposted Vendor Costs', accounts: grouped.unposted },
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

export async function transferBetweenAccounts(req: AuthRequest, res: Response) {
  const { fromAccountId, toAccountId, amount, currency, exchangeRate, description, date, reference, notes } = req.body;

  try {
    const entry = await executeLedgerTransfer({
      fromAccountId,
      toAccountId,
      amount: Number(amount),
      currency: currency === 'SAR' ? 'SAR' : 'PKR',
      exchangeRate: exchangeRate ? Number(exchangeRate) : undefined,
      description,
      date: date ? new Date(date) : undefined,
      reference,
      notes,
    });

    await logActivity(req, 'CREATE', 'LedgerTransfer', entry.id);
    return res.status(201).json({ success: true, data: entry });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transfer failed';
    return res.status(400).json({ success: false, error: message });
  }
}

export async function createInternalTransferHandler(req: AuthRequest, res: Response) {
  const { sourceType, sourceEntityId, targetType, targetEntityId, amount, currency, exchangeRate, remarks, date } = req.body;

  try {
    const result = await createInternalTransfer({
      sourceType: sourceType === 'VENDOR' ? 'VENDOR' : 'B2B',
      sourceEntityId,
      targetType: targetType === 'VENDOR' ? 'VENDOR' : 'B2B',
      targetEntityId,
      amount: Number(amount),
      currency: currency === 'SAR' ? 'SAR' : 'PKR',
      exchangeRate: exchangeRate ? Number(exchangeRate) : undefined,
      remarks,
      date: date ? new Date(date) : undefined,
    });

    await logActivity(
      req,
      'CREATE',
      'InternalTransfer',
      result.entry.id,
      `${result.transferReference}: ${result.source.name} → ${result.target.name}`
    );

    return res.status(201).json({
      success: true,
      data: result,
      message: `Internal transfer ${result.transferReference} completed`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal transfer failed';
    return res.status(400).json({ success: false, error: message });
  }
}

export async function exportAccountTransactions(req: AuthRequest, res: Response) {
  const format = (req.query.format as string) || 'csv';
  const { startDate, endDate, currency } = req.query;
  const currencyView: CurrencyView = currency === 'SAR' ? 'SAR' : 'PKR';

  const account = await prisma.account.findUnique({ where: { id: paramId(req) } });
  if (!account) return res.status(404).json({ success: false, error: 'Account not found' });

  await logActivity(req, 'EXPORT', 'Account', account.id);
  return sendLedgerExport(res, {
    accountId: account.id,
    title: `Ledger — ${account.name}`,
    subtitle: account.code,
    filename: `ledger-${account.code}.csv`,
    format,
    currencyView,
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined,
  });
}

export async function exportGeneralLedger(req: AuthRequest, res: Response) {
  const format = (req.query.format as string) || 'csv';
  const { startDate, endDate, accountId, currency } = req.query;
  const currencyView: CurrencyView = currency === 'SAR' ? 'SAR' : 'PKR';

  await logActivity(req, 'EXPORT', 'GeneralLedger', 'export');

  if (accountId) {
    const account = await prisma.account.findUnique({ where: { id: accountId as string } });
    if (!account) return res.status(404).json({ success: false, error: 'Account not found' });
    return sendLedgerExport(res, {
      accountId: account.id,
      title: `Ledger — ${account.name}`,
      subtitle: account.code,
      filename: `ledger-${account.code}.csv`,
      format,
      currencyView,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });
  }

  const transactions = await getLedgerTransactions({
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined,
  });
  const rows = buildLedgerRows(transactions, currencyView).reverse();

  if (format === 'html') {
    const body = `
      <h1>General Ledger</h1>
      <p class="meta">${currencyView} view · ${rows.length} transaction(s)</p>
      <table>
        <thead><tr><th>Date</th><th>Entry</th><th>Account</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${r.journalEntry?.date ? new Date(r.journalEntry.date).toISOString().split('T')[0] : ''}</td><td>${r.journalEntry?.entryNumber || ''}</td><td>${r.account?.name || ''}</td><td>${r.description || r.journalEntry?.description || ''}</td><td class="num">${r.debit}</td><td class="num">${r.credit}</td><td class="num">${r.runningBalance}</td></tr>`).join('')}</tbody>
      </table>`;
    const { wrapHtmlDocument } = await import('../utils/exportHelpers');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(wrapHtmlDocument('General Ledger', body));
  }

  const { rowsToCsv } = await import('../utils/exportHelpers');
  const csv = rowsToCsv(
    ['Date', 'Entry', 'Account', 'Description', 'Debit', 'Credit', 'Balance', 'Currency'],
    rows.map((r) => [
      r.journalEntry?.date ? new Date(r.journalEntry.date).toISOString().split('T')[0] : '',
      r.journalEntry?.entryNumber || '',
      r.account?.name || '',
      r.description || r.journalEntry?.description || '',
      r.debit,
      r.credit,
      r.runningBalance,
      r.displayCurrency,
    ])
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="general-ledger.csv"');
  return res.send(csv);
}
