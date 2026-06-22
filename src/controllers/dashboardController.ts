import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination } from '../utils/helpers';

export async function getDashboardStats(req: AuthRequest, res: Response) {
  const [
    totalCustomers,
    totalBookings,
    pendingBookings,
    confirmedBookings,
    totalPackages,
    totalInvoices,
    overdueInvoices,
    recentBookings,
    recentPayments,
    totalRevenue,
    totalExpenses,
    unreadNotifications,
  ] = await Promise.all([
    prisma.customer.count({ where: { isActive: true } }),
    prisma.booking.count(),
    prisma.booking.count({ where: { status: 'PENDING' } }),
    prisma.booking.count({ where: { status: 'CONFIRMED' } }),
    prisma.package.count({ where: { isActive: true } }),
    prisma.invoice.count(),
    prisma.invoice.count({ where: { status: 'OVERDUE' } }),
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
    prisma.payment.aggregate({ _sum: { amount: true } }),
    prisma.expense.aggregate({ _sum: { amount: true } }),
    prisma.notification.count({ where: { userId: req.user!.id, isRead: false } }),
  ]);

  const revenue = Number(totalRevenue._sum.amount || 0);
  const expenses = Number(totalExpenses._sum.amount || 0);

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
        totalRevenue: revenue,
        totalExpenses: expenses,
        netProfit: revenue - expenses,
        unreadNotifications,
      },
      recentBookings,
      recentPayments,
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
