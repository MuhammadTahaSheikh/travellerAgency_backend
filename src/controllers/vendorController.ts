import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination, paginateSearch, generateNumber } from '../utils/helpers';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';
import { createVendorAccount } from '../services/vendorService';
import { getNextVendorCode } from '../services/tradePartnerService';
import { createJournalEntry } from '../services/ledgerService';
import { convertCurrency, getDefaultExchangeRate } from '../services/currencyService';
import { getLedgerTransactions, buildLedgerRows, CurrencyView } from '../services/ledgerService';
import { sendLedgerExport } from '../utils/ledgerExport';

export async function getVendors(req: AuthRequest, res: Response) {
  const search = (req.query.search as string)?.trim();
  const useSearchPagination = Boolean(search);
  const { page, limit, skip } = useSearchPagination
    ? paginateSearch(req.query.page as string, req.query.limit as string)
    : paginate(req.query.page as string, req.query.limit as string);
  const category = req.query.category as string;

  const where: Record<string, unknown> = { isActive: true };
  if (category) where.category = category;
  if (search) {
    where.OR = [
      { vendorCode: { contains: search } },
      { name: { contains: search } },
      { contactPerson: { contains: search } },
      { email: { contains: search } },
      { phone: { contains: search } },
    ];
  }

  const [vendors, total] = await Promise.all([
    prisma.vendor.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
      include: { account: true, _count: { select: { costAllocations: true } } },
    }),
    prisma.vendor.count({ where }),
  ]);

  return res.json({ success: true, data: vendors, pagination: formatPagination(total, page, limit) });
}

export async function getVendor(req: AuthRequest, res: Response) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: paramId(req) },
    include: {
      account: true,
      costAllocations: { include: { booking: true }, orderBy: { createdAt: 'desc' }, take: 20 },
      expenses: { orderBy: { expenseDate: 'desc' }, take: 20 },
    },
  });

  if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found' });
  return res.json({ success: true, data: vendor });
}

export async function createVendor(req: AuthRequest, res: Response) {
  const { name, category, contactPerson, email, phone, address } = req.body;

  if (!name) {
    return res.status(400).json({ success: false, error: 'Vendor name is required' });
  }

  // A vendor can supply multiple service types, so category is optional (defaults to OTHER).
  const vendorCategory = category || 'OTHER';

  const vendor = await prisma.$transaction(async (tx) => {
    const vendorCode = await getNextVendorCode(tx);
    return tx.vendor.create({
      data: { vendorCode, name, category: vendorCategory, contactPerson, email, phone, address },
    });
  });

  await createVendorAccount(vendor.id, vendor.name);
  await logActivity(req, 'CREATE', 'Vendor', vendor.id);

  const full = await prisma.vendor.findUnique({
    where: { id: vendor.id },
    include: { account: true },
  });

  return res.status(201).json({ success: true, data: full });
}

export async function updateVendor(req: AuthRequest, res: Response) {
  const vendor = await prisma.vendor.update({
    where: { id: paramId(req) },
    data: req.body,
    include: { account: true },
  });

  await logActivity(req, 'UPDATE', 'Vendor', vendor.id);
  return res.json({ success: true, data: vendor });
}

export async function deleteVendor(req: AuthRequest, res: Response) {
  await prisma.vendor.update({ where: { id: paramId(req) }, data: { isActive: false } });
  await logActivity(req, 'DELETE', 'Vendor', paramId(req));
  return res.json({ success: true, message: 'Vendor deactivated' });
}

export async function getVendorLedger(req: AuthRequest, res: Response) {
  const currency = req.query.currency === 'SAR' ? 'SAR' : 'PKR';
  const vendor = await prisma.vendor.findUnique({
    where: { id: paramId(req) },
    include: { account: true },
  });
  if (!vendor?.account) return res.status(404).json({ success: false, error: 'Vendor account not found' });

  const transactions = await getLedgerTransactions({ accountId: vendor.account.id });
  const rows = buildLedgerRows(transactions, currency).reverse();

  return res.json({
    success: true,
    data: {
      vendor,
      currency,
      balancePkr: Number(vendor.account.balancePkr),
      balanceSar: Number(vendor.account.balanceSar),
      balance: Number(vendor.account.balance),
      transactions: rows,
    },
  });
}

export async function exportVendorLedger(req: AuthRequest, res: Response) {
  const format = (req.query.format as string) || 'csv';
  const currencyView: CurrencyView = req.query.currency === 'SAR' ? 'SAR' : 'PKR';
  const vendor = await prisma.vendor.findUnique({
    where: { id: paramId(req) },
    include: { account: true },
  });
  if (!vendor?.account) return res.status(404).json({ success: false, error: 'Vendor account not found' });

  await logActivity(req, 'EXPORT', 'VendorLedger', vendor.id);
  return sendLedgerExport(res, {
    accountId: vendor.account.id,
    title: `Vendor Ledger — ${vendor.name}`,
    subtitle: vendor.category,
    filename: `vendor-ledger-${vendor.name.replace(/\s+/g, '-').toLowerCase()}.csv`,
    format,
    currencyView,
  });
}

export async function payVendor(req: AuthRequest, res: Response) {
  const { accountId, amount, currency, exchangeRate, method, reference, notes, attachmentPath } = req.body;

  if (!accountId || !amount) {
    return res.status(400).json({ success: false, error: 'Bank/cash account and amount are required' });
  }

  const payAmount = Number(amount);
  if (payAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Amount must be greater than zero' });
  }

  const vendor = await prisma.vendor.findUnique({
    where: { id: paramId(req) },
    include: { account: true },
  });
  if (!vendor?.account) return res.status(404).json({ success: false, error: 'Vendor account not found' });

  const bankAccount = await prisma.account.findUnique({ where: { id: accountId } });
  if (!bankAccount || !['CASH', 'BANK'].includes(bankAccount.type)) {
    return res.status(400).json({ success: false, error: 'Payment must be from a Cash or Bank account' });
  }

  const payCurrency: 'PKR' | 'SAR' = currency === 'SAR' ? 'SAR' : 'PKR';
  const rate = exchangeRate ? Number(exchangeRate) : await getDefaultExchangeRate();
  const { amountPkr, amountSar } = convertCurrency(payAmount, payCurrency, rate);

  const entry = await createJournalEntry(
    `Vendor payment: ${vendor.name}`,
    [
      {
        accountId: vendor.account.id,
        debit: payAmount,
        description: `Payment to ${vendor.name}`,
        currency: payCurrency,
        exchangeRate: rate,
        amountPkr,
        amountSar,
        paymentMethod: method || 'BANK_TRANSFER',
        remarks: notes,
        attachmentPath,
      },
      {
        accountId: bankAccount.id,
        credit: payAmount,
        description: `Paid from ${bankAccount.name}`,
        currency: payCurrency,
        exchangeRate: rate,
        amountPkr,
        amountSar,
        paymentMethod: method || 'BANK_TRANSFER',
        attachmentPath,
      },
    ],
    { reference: reference || vendor.name, receiptPath: attachmentPath, notes }
  );

  await prisma.expense.create({
    data: {
      expenseNumber: generateNumber('EXP'),
      category: 'OTHER',
      accountId: bankAccount.id,
      amount: payAmount,
      description: `Vendor payment: ${vendor.name}`,
      vendorId: vendor.id,
      receiptPath: attachmentPath,
      createdById: req.user!.id,
    },
  });

  await logActivity(req, 'CREATE', 'VendorPayment', vendor.id, `Paid ${payAmount} ${payCurrency}`);
  return res.status(201).json({ success: true, data: { journalEntry: entry, vendor }, message: 'Vendor payment recorded' });
}

export async function getVendorPayables(_req: AuthRequest, res: Response) {
  const vendors = await prisma.vendor.findMany({
    where: { isActive: true },
    include: {
      account: true,
      costAllocations: true,
      expenses: true,
    },
  });

  const payables = vendors.map((v) => {
    const legacyAllocated = v.costAllocations.reduce((s, a) => s + Number(a.amount), 0);
    const paid = v.expenses.reduce((s, e) => s + Number(e.amount), 0);
    // Both legacy cost allocations and confirmed (POSTED) vendor postings credit the vendor
    // account, while vendor payments debit it. A payable therefore shows as a negative account
    // balance, so outstanding is its inverse. Fall back to the legacy calc when no ledger movement.
    const ledgerBalance = Number(v.account?.balance || 0);
    const outstanding = ledgerBalance !== 0 ? -ledgerBalance : legacyAllocated - paid;
    return {
      vendorId: v.id,
      vendorName: v.name,
      vendorCode: v.vendorCode,
      category: v.category,
      accountBalance: ledgerBalance,
      totalAllocated: outstanding + paid,
      totalPaid: paid,
      outstanding,
    };
  });

  return res.json({ success: true, data: payables });
}
