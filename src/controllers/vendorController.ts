import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination, generateNumber } from '../utils/helpers';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';
import { createVendorAccount } from '../services/vendorService';

export async function getVendors(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const category = req.query.category as string;

  const where: Record<string, unknown> = { isActive: true };
  if (category) where.category = category;

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

  if (!name || !category) {
    return res.status(400).json({ success: false, error: 'Name and category are required' });
  }

  const vendor = await prisma.vendor.create({
    data: { name, category, contactPerson, email, phone, address },
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
    const allocated = v.costAllocations.reduce((s, a) => s + Number(a.amount), 0);
    const paid = v.expenses.reduce((s, e) => s + Number(e.amount), 0);
    const balance = allocated - paid;
    return {
      vendorId: v.id,
      vendorName: v.name,
      category: v.category,
      accountBalance: Number(v.account?.balance || 0),
      totalAllocated: allocated,
      totalPaid: paid,
      outstanding: balance,
    };
  });

  return res.json({ success: true, data: payables });
}
