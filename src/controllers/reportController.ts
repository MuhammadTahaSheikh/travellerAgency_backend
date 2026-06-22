import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';

export async function getIncomeStatement(req: AuthRequest, res: Response) {
  const { startDate, endDate } = req.query;
  const start = startDate ? new Date(startDate as string) : new Date(new Date().getFullYear(), 0, 1);
  const end = endDate ? new Date(endDate as string) : new Date();

  const [incomeEntries, payments, expenses] = await Promise.all([
    prisma.incomeEntry.findMany({ where: { entryDate: { gte: start, lte: end } } }),
    prisma.payment.findMany({ where: { paymentDate: { gte: start, lte: end } } }),
    prisma.expense.findMany({ where: { expenseDate: { gte: start, lte: end } } }),
  ]);

  const incomeByCategory: Record<string, number> = {};
  incomeEntries.forEach((e) => {
    incomeByCategory[e.category] = (incomeByCategory[e.category] || 0) + Number(e.amount);
  });
  payments.forEach((p) => {
    incomeByCategory['PAYMENTS'] = (incomeByCategory['PAYMENTS'] || 0) + Number(p.amount);
  });

  const expensesByCategory: Record<string, number> = {};
  expenses.forEach((e) => {
    expensesByCategory[e.category] = (expensesByCategory[e.category] || 0) + Number(e.amount);
  });

  const totalIncome = Object.values(incomeByCategory).reduce((s, v) => s + v, 0);
  const totalExpenses = Object.values(expensesByCategory).reduce((s, v) => s + v, 0);

  return res.json({
    success: true,
    data: {
      period: { start, end },
      income: incomeByCategory,
      expenses: expensesByCategory,
      totalIncome,
      totalExpenses,
      netIncome: totalIncome - totalExpenses,
    },
  });
}

export async function getProfitAndLoss(req: AuthRequest, res: Response) {
  return getIncomeStatement(req, res);
}

export async function getCashFlowReport(req: AuthRequest, res: Response) {
  const { startDate, endDate } = req.query;
  const start = startDate ? new Date(startDate as string) : new Date(new Date().getFullYear(), 0, 1);
  const end = endDate ? new Date(endDate as string) : new Date();

  const [cashIn, cashOut] = await Promise.all([
    prisma.payment.findMany({
      where: { paymentDate: { gte: start, lte: end } },
      include: { account: true },
    }),
    prisma.expense.findMany({
      where: { expenseDate: { gte: start, lte: end } },
      include: { account: true },
    }),
  ]);

  const inflows = cashIn.reduce((s, p) => s + Number(p.amount), 0);
  const outflows = cashOut.reduce((s, e) => s + Number(e.amount), 0);

  return res.json({
    success: true,
    data: {
      period: { start, end },
      inflows: { total: inflows, transactions: cashIn },
      outflows: { total: outflows, transactions: cashOut },
      netCashFlow: inflows - outflows,
    },
  });
}

export async function getExpenseReport(req: AuthRequest, res: Response) {
  const { startDate, endDate, category } = req.query;
  const start = startDate ? new Date(startDate as string) : new Date(new Date().getFullYear(), 0, 1);
  const end = endDate ? new Date(endDate as string) : new Date();

  const where: Record<string, unknown> = { expenseDate: { gte: start, lte: end } };
  if (category) where.category = category;

  const expenses = await prisma.expense.findMany({
    where,
    include: { account: true, createdBy: { select: { firstName: true, lastName: true } } },
    orderBy: { expenseDate: 'desc' },
  });

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  return res.json({ success: true, data: { expenses, total, period: { start, end } } });
}

export async function getCustomerOutstanding(_req: AuthRequest, res: Response) {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] } },
    include: { customer: true, booking: { include: { package: true } } },
  });

  const outstanding = invoices.map((inv) => ({
    invoiceId: inv.id,
    invoiceNumber: inv.invoiceNumber,
    customer: inv.customer,
    totalAmount: Number(inv.totalAmount),
    paidAmount: Number(inv.paidAmount),
    outstanding: Number(inv.totalAmount) - Number(inv.paidAmount),
    dueDate: inv.dueDate,
    status: inv.status,
  }));

  const totalOutstanding = outstanding.reduce((s, o) => s + o.outstanding, 0);
  return res.json({ success: true, data: { customers: outstanding, totalOutstanding } });
}

export async function getDailyCollectionReport(req: AuthRequest, res: Response) {
  const date = req.query.date ? new Date(req.query.date as string) : new Date();
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const payments = await prisma.payment.findMany({
    where: { paymentDate: { gte: start, lte: end } },
    include: { invoice: { include: { customer: true } }, account: true },
  });

  const byMethod: Record<string, number> = {};
  payments.forEach((p) => {
    byMethod[p.method] = (byMethod[p.method] || 0) + Number(p.amount);
  });

  const total = payments.reduce((s, p) => s + Number(p.amount), 0);
  return res.json({ success: true, data: { date: start, payments, byMethod, total } });
}
