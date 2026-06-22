import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination, applyDateFilter } from '../utils/helpers';
import { paramId } from '../utils/params';
import {
  createJournalEntry,
  getLedgerTransactions,
  getTrialBalance,
} from '../services/ledgerService';
import { logActivity } from '../middleware/activityLogger';

export async function getAccounts(req: AuthRequest, res: Response) {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    include: { customer: true, employee: { select: { firstName: true, lastName: true } } },
    orderBy: { name: 'asc' },
  });
  return res.json({ success: true, data: accounts });
}

export async function getAccountTransactions(req: AuthRequest, res: Response) {
  const { startDate, endDate } = req.query;
  const transactions = await getLedgerTransactions({
    accountId: paramId(req),
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined,
  });

  let runningBalance = 0;
  const withBalance = transactions.map((t) => {
    runningBalance += Number(t.debit) - Number(t.credit);
    return { ...t, runningBalance };
  });

  return res.json({ success: true, data: withBalance });
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
  const { startDate, endDate, accountId } = req.query;
  const transactions = await getLedgerTransactions({
    accountId: accountId as string,
    startDate: startDate ? new Date(startDate as string) : undefined,
    endDate: endDate ? new Date(endDate as string) : undefined,
  });
  return res.json({ success: true, data: transactions });
}

export async function getTrialBalanceReport(_req: AuthRequest, res: Response) {
  const balance = await getTrialBalance();
  const totalDebit = balance.reduce((s, b) => s + b.debit, 0);
  const totalCredit = balance.reduce((s, b) => s + b.credit, 0);
  return res.json({ success: true, data: { accounts: balance, totalDebit, totalCredit } });
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
  });

  await logActivity(req, 'DELETE', 'JournalEntry', paramId(req));
  return res.json({ success: true, message: 'Journal entry deleted' });
}
