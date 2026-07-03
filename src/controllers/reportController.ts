import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { parseDateRange } from '../utils/helpers';

const VENDOR_PAYMENT_CATEGORIES = new Set(['AIRLINE', 'HOTEL', 'VISA']);

function getReportPeriod(startDate?: string, endDate?: string) {
  const range = parseDateRange(startDate, endDate);
  const start =
    range?.gte ??
    (() => {
      const d = new Date(new Date().getFullYear(), 0, 1);
      d.setHours(0, 0, 0, 0);
      return d;
    })();
  const end =
    range?.lte ??
    (() => {
      const d = new Date();
      d.setHours(23, 59, 59, 999);
      return d;
    })();
  return { start, end };
}

function isVendorPayment(expense: { category: string; vendorId: string | null }) {
  return Boolean(expense.vendorId) || VENDOR_PAYMENT_CATEGORIES.has(expense.category);
}

function sumRecord(values: Record<string, number>) {
  return Object.values(values).reduce((s, v) => s + v, 0);
}

export async function getIncomeStatement(req: AuthRequest, res: Response) {
  const { start, end } = getReportPeriod(req.query.startDate as string, req.query.endDate as string);

  const [incomeEntries, payments, expenses, costAllocations, postedVendorPostings] = await Promise.all([
    prisma.incomeEntry.findMany({ where: { entryDate: { gte: start, lte: end } } }),
    prisma.payment.findMany({ where: { paymentDate: { gte: start, lte: end } } }),
    prisma.expense.findMany({
      where: { expenseDate: { gte: start, lte: end } },
      include: { vendorRef: { select: { name: true } } },
    }),
    prisma.vendorCostAllocation.findMany({
      where: { createdAt: { gte: start, lte: end } },
      include: { vendor: { select: { name: true } } },
    }),
    prisma.vendorPosting.findMany({
      where: { status: 'POSTED', postedAt: { gte: start, lte: end } },
    }),
  ]);

  const income: Record<string, number> = {};
  incomeEntries.forEach((e) => {
    income[e.category] = (income[e.category] || 0) + Number(e.amount);
  });
  payments.forEach((p) => {
    income.PAYMENTS = (income.PAYMENTS || 0) + Number(p.amount);
  });

  const costOfSales: Record<string, number> = {};
  costAllocations.forEach((a) => {
    const key = a.serviceType;
    costOfSales[key] = (costOfSales[key] || 0) + Number(a.amount);
  });
  // Booking vendor costs now flow through vendor postings; once posted, recognise them in PKR.
  postedVendorPostings.forEach((p) => {
    const amount = Number(p.actualCost ?? p.expectedCost);
    const pkr = p.currency === 'SAR' ? amount * Number(p.exchangeRate || 1) : amount;
    costOfSales[p.serviceType] = (costOfSales[p.serviceType] || 0) + pkr;
  });

  const operatingExpenses: Record<string, number> = {};
  const vendorPayments: Record<string, number> = {};
  expenses.forEach((e) => {
    const amount = Number(e.amount);
    if (isVendorPayment(e)) {
      const label = e.vendorRef?.name ? `Payment: ${e.vendorRef.name}` : e.category;
      vendorPayments[label] = (vendorPayments[label] || 0) + amount;
    } else {
      operatingExpenses[e.category] = (operatingExpenses[e.category] || 0) + amount;
    }
  });

  const totalIncome = sumRecord(income);
  const totalCostOfSales = sumRecord(costOfSales);
  const totalOperatingExpenses = sumRecord(operatingExpenses);
  const totalVendorPayments = sumRecord(vendorPayments);
  const totalExpenses = totalCostOfSales + totalOperatingExpenses;

  return res.json({
    success: true,
    data: {
      period: { start, end },
      income,
      costOfSales,
      operatingExpenses,
      vendorPayments,
      expenses: { ...costOfSales, ...operatingExpenses },
      totalIncome,
      totalCostOfSales,
      totalOperatingExpenses,
      totalVendorPayments,
      totalExpenses,
      netIncome: totalIncome - totalExpenses,
    },
  });
}

export async function getProfitAndLoss(req: AuthRequest, res: Response) {
  return getIncomeStatement(req, res);
}

export async function getCashFlowReport(req: AuthRequest, res: Response) {
  const { start, end } = getReportPeriod(req.query.startDate as string, req.query.endDate as string);

  const [cashIn, cashOut] = await Promise.all([
    prisma.payment.findMany({
      where: { paymentDate: { gte: start, lte: end } },
      include: { account: true, invoice: { include: { customer: true } } },
    }),
    prisma.expense.findMany({
      where: { expenseDate: { gte: start, lte: end } },
      include: { account: true, vendorRef: { select: { name: true } } },
    }),
  ]);

  const inflows = cashIn.reduce((s, p) => s + Number(p.amount), 0);
  const outflows = cashOut.reduce((s, e) => s + Number(e.amount), 0);

  const outflowsByCategory: Record<string, number> = {};
  cashOut.forEach((e) => {
    const key = isVendorPayment(e)
      ? `Vendor: ${e.vendorRef?.name || e.category}`
      : e.category;
    outflowsByCategory[key] = (outflowsByCategory[key] || 0) + Number(e.amount);
  });

  return res.json({
    success: true,
    data: {
      period: { start, end },
      inflows: { total: inflows, transactions: cashIn },
      outflows: { total: outflows, byCategory: outflowsByCategory, transactions: cashOut },
      netCashFlow: inflows - outflows,
    },
  });
}

export async function getExpenseReport(req: AuthRequest, res: Response) {
  const { start, end } = getReportPeriod(req.query.startDate as string, req.query.endDate as string);
  const category = req.query.category as string | undefined;

  const where: Record<string, unknown> = { expenseDate: { gte: start, lte: end } };
  if (category) where.category = category;

  const expenses = await prisma.expense.findMany({
    where,
    include: {
      account: true,
      vendorRef: { select: { name: true } },
      createdBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { expenseDate: 'desc' },
  });

  const byCategory: Record<string, number> = {};
  const vendorPayments: Record<string, number> = {};
  const operating: Record<string, number> = {};

  expenses.forEach((e) => {
    const amount = Number(e.amount);
    byCategory[e.category] = (byCategory[e.category] || 0) + amount;
    if (isVendorPayment(e)) {
      const key = e.vendorRef?.name || e.category;
      vendorPayments[key] = (vendorPayments[key] || 0) + amount;
    } else {
      operating[e.category] = (operating[e.category] || 0) + amount;
    }
  });

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);

  return res.json({
    success: true,
    data: {
      expenses,
      total,
      byCategory,
      vendorPayments,
      operatingExpenses: operating,
      period: { start, end },
    },
  });
}

export async function getCustomerOutstanding(_req: AuthRequest, res: Response) {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ['SENT', 'PARTIAL', 'OVERDUE'] } },
    include: { customer: true, booking: { include: { package: true } } },
  });

  const outstanding = invoices
    .map((inv) => ({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customer: inv.customer,
      totalAmount: Number(inv.totalAmount),
      paidAmount: Number(inv.paidAmount),
      outstanding: Number(inv.totalAmount) - Number(inv.paidAmount),
      dueDate: inv.dueDate,
      status: inv.status,
    }))
    .filter((o) => o.outstanding > 0);

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

export async function getCustomerStatement(req: AuthRequest, res: Response) {
  const customerId = req.query.customerId as string;
  if (!customerId) {
    return res.status(400).json({ success: false, error: 'customerId is required' });
  }

  try {
    const currency = req.query.currency === 'SAR' ? 'SAR' : 'PKR';
    const { getCustomerStatementData } = await import('../services/statementService');
    const data = await getCustomerStatementData(customerId, currency);
    return res.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Customer not found';
    return res.status(404).json({ success: false, error: message });
  }
}

export async function getCustomerStatementHtml(req: AuthRequest, res: Response) {
  const customerId = req.query.customerId as string;
  if (!customerId) {
    return res.status(400).json({ success: false, error: 'customerId is required' });
  }

  try {
    const currency = req.query.currency === 'SAR' ? 'SAR' : 'PKR';
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const { renderCustomerStatementHtml } = await import('../services/statementService');
    const html = await renderCustomerStatementHtml(customerId, currency, baseUrl);
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Customer not found';
    return res.status(404).json({ success: false, error: message });
  }
}

export async function getB2BPartnerReport(_req: AuthRequest, res: Response) {
  const partners = await prisma.customer.findMany({
    where: { customerType: 'B2B', isActive: true },
    include: {
      account: true,
      invoices: { where: { status: { not: 'CANCELLED' } } },
    },
    orderBy: { tradePartnerId: 'asc' },
  });

  const data = partners.map((p) => {
    const totalBilled = p.invoices.reduce((s, i) => s + Number(i.totalAmount), 0);
    const totalPaid = p.invoices.reduce((s, i) => s + Number(i.paidAmount), 0);
    return {
      tradePartnerId: p.tradePartnerId,
      companyName: p.companyName,
      contactPerson: p.contactPerson,
      phone: p.phone,
      email: p.email,
      address: p.address,
      totalBilled,
      totalPaid,
      outstanding: totalBilled - totalPaid,
      balancePkr: Number(p.account?.balancePkr || 0),
      balanceSar: Number(p.account?.balanceSar || 0),
      invoiceCount: p.invoices.length,
    };
  });

  return res.json({ success: true, data });
}
