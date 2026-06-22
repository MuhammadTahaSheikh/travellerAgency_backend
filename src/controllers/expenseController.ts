import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination, generateNumber, applyDateFilter } from '../utils/helpers';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';
import { createJournalEntry, getOrCreateExpenseAccount } from '../services/ledgerService';

export async function getExpenses(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const category = req.query.category as string;
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  applyDateFilter(where, 'expenseDate', startDate, endDate);

  const [expenses, total, aggregate] = await Promise.all([
    prisma.expense.findMany({
      where,
      skip,
      take: limit,
      orderBy: { expenseDate: 'desc' },
      include: { account: true, createdBy: { select: { firstName: true, lastName: true } } },
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
  ]);

  return res.json({
    success: true,
    data: expenses,
    pagination: formatPagination(total, page, limit),
    summary: { totalAmount: Number(aggregate._sum.amount || 0), count: total },
  });
}

export async function createExpense(req: AuthRequest, res: Response) {
  const { category, accountId, amount, description, vendor, expenseDate, receiptPath } = req.body;

  if (!category || !accountId || !amount || !description) {
    return res.status(400).json({ success: false, error: 'Category, account, amount, and description are required' });
  }

  const expenseAmount = Number(amount);
  if (expenseAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Amount must be greater than zero' });
  }

  try {
    const expense = await prisma.$transaction(async (tx) => {
      const payingAccount = await tx.account.findUnique({ where: { id: accountId } });
      if (!payingAccount) throw new Error('Selected account not found');

      const exp = await tx.expense.create({
        data: {
          expenseNumber: generateNumber('EXP'),
          category,
          accountId,
          amount: expenseAmount,
          description,
          vendor,
          expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
          receiptPath,
          createdById: req.user!.id,
        },
        include: { account: true },
      });

      const expenseAccount = await getOrCreateExpenseAccount(tx);

      await createJournalEntry(
        `Expense: ${description}`,
        [
          { accountId: expenseAccount.id, debit: expenseAmount, description: `Expense: ${category}` },
          { accountId, credit: expenseAmount, description: 'Payment for expense' },
        ],
        { reference: exp.expenseNumber, receiptPath },
        tx
      );

      return exp;
    });

    await logActivity(req, 'CREATE', 'Expense', expense.id);
    return res.status(201).json({ success: true, data: expense });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to record expense';
    return res.status(400).json({ success: false, error: message });
  }
}

export async function getIncomeEntries(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const [entries, total] = await Promise.all([
    prisma.incomeEntry.findMany({ skip, take: limit, orderBy: { entryDate: 'desc' } }),
    prisma.incomeEntry.count(),
  ]);
  return res.json({ success: true, data: entries, pagination: formatPagination(total, page, limit) });
}

export async function createIncomeEntry(req: AuthRequest, res: Response) {
  const { category, amount, description, reference, entryDate, receiptPath } = req.body;

  const entry = await prisma.incomeEntry.create({
    data: {
      entryNumber: generateNumber('INC'),
      category,
      amount,
      description,
      reference,
      entryDate: entryDate ? new Date(entryDate) : new Date(),
      receiptPath,
    },
  });

  await logActivity(req, 'CREATE', 'IncomeEntry', entry.id);
  return res.status(201).json({ success: true, data: entry });
}

export async function updateExpense(req: AuthRequest, res: Response) {
  const { category, description, vendor, expenseDate } = req.body;

  const existing = await prisma.expense.findUnique({ where: { id: paramId(req) } });
  if (!existing) return res.status(404).json({ success: false, error: 'Expense not found' });

  const expense = await prisma.expense.update({
    where: { id: paramId(req) },
    data: {
      category,
      description,
      vendor,
      expenseDate: expenseDate ? new Date(expenseDate) : undefined,
    },
    include: { account: true },
  });

  await logActivity(req, 'UPDATE', 'Expense', expense.id);
  return res.json({ success: true, data: expense });
}

export async function deleteExpense(req: AuthRequest, res: Response) {
  const expense = await prisma.expense.findUnique({ where: { id: paramId(req) } });
  if (!expense) return res.status(404).json({ success: false, error: 'Expense not found' });

  await prisma.deletedRecord.create({
    data: { entity: 'Expense', entityId: expense.id, data: JSON.stringify(expense), deletedBy: req.user?.id },
  });

  await prisma.expense.delete({ where: { id: paramId(req) } });
  await logActivity(req, 'DELETE', 'Expense', paramId(req));
  return res.json({ success: true, message: 'Expense deleted' });
}
