import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination } from '../utils/helpers';
import { getPendingVendorCosts } from '../services/vendorPostingService';

export async function getDashboardStats(req: AuthRequest, res: Response) {
  const [
    totalCustomers,
    totalBookings,
    pendingBookings,
    confirmedBookings,
    totalPackages,
    totalInvoices,
    overdueInvoices,
    pendingApprovals,
    recentBookings,
    recentPayments,
    totalRevenue,
    totalExpenses,
    postedVendorCosts,
    unreadNotifications,
    pendingCosts,
  ] = await Promise.all([
    prisma.customer.count({ where: { isActive: true } }),
    prisma.booking.count(),
    prisma.booking.count({ where: { status: 'PENDING' } }),
    prisma.booking.count({ where: { status: 'CONFIRMED' } }),
    prisma.package.count({ where: { isActive: true } }),
    prisma.invoice.count(),
    prisma.invoice.count({ where: { status: 'OVERDUE' } }),
    prisma.invoice.count({ where: { approvalStatus: 'PENDING', paidAmount: { gt: 0 } } }),
    prisma.booking.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { customer: true, package: true },
    }),
    prisma.payment.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { invoice: { include: { customer: true } } },
    }),
    prisma.payment.aggregate({ where: { verificationStatus: 'VERIFIED' }, _sum: { amountPkr: true, amount: true } }),
    prisma.expense.aggregate({ _sum: { amount: true } }),
    prisma.vendorPosting.aggregate({ where: { status: 'POSTED' }, _sum: { actualCost: true, expectedCost: true } }),
    prisma.notification.count({ where: { userId: req.user!.id, isRead: false } }),
    getPendingVendorCosts(),
  ]);

  const revenue = Number(totalRevenue._sum.amountPkr || totalRevenue._sum.amount || 0);
  const expenses = Number(totalExpenses._sum.amount || 0);
  const paidExpenses = Number(postedVendorCosts._sum.actualCost || postedVendorCosts._sum.expectedCost || 0);
  const pendingExpenses = pendingCosts.totalPending;
  const estimatedProfit = revenue - paidExpenses - pendingExpenses;
  const netProfit = revenue - expenses - paidExpenses;

  return res.json({
    success: true,
    data: {
      stats: {
        totalCustomers,
        totalBookings,
        pendingBookings,
        confirmedBookings,
        totalPackages,
        totalInvoices,
        overdueInvoices,
        pendingApprovals,
        totalRevenue: revenue,
        totalSale: revenue,
        totalExpenses: expenses,
        paidExpenses,
        actualExpenses: paidExpenses,
        pendingExpenses,
        estimatedProfit,
        netProfit,
        unreadNotifications,
      },
      recentBookings,
      recentPayments,
      pendingVendorPostings: pendingCosts.postings.slice(0, 5),
    },
  });
}

export async function getDashboardChartData(_req: AuthRequest, res: Response) {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const payments = await prisma.payment.findMany({
    where: { paymentDate: { gte: sixMonthsAgo } },
    select: { amount: true, paymentDate: true },
  });

  const expenses = await prisma.expense.findMany({
    where: { expenseDate: { gte: sixMonthsAgo } },
    select: { amount: true, expenseDate: true },
  });

  const monthlyData: Record<string, { revenue: number; expenses: number }> = {};

  payments.forEach((p) => {
    const key = p.paymentDate.toISOString().slice(0, 7);
    if (!monthlyData[key]) monthlyData[key] = { revenue: 0, expenses: 0 };
    monthlyData[key].revenue += Number(p.amount);
  });

  expenses.forEach((e) => {
    const key = e.expenseDate.toISOString().slice(0, 7);
    if (!monthlyData[key]) monthlyData[key] = { revenue: 0, expenses: 0 };
    monthlyData[key].expenses += Number(e.amount);
  });

  return res.json({ success: true, data: monthlyData });
}
