import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination } from '../utils/helpers';
import { paramId } from '../utils/params';
import { createCustomerAccount } from '../services/ledgerService';
import { logActivity } from '../middleware/activityLogger';

export async function getCustomers(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const search = req.query.search as string;

  const where = search
    ? {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' as const } },
          { lastName: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
          { phone: { contains: search } },
        ],
      }
    : {};

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { bookings: true, documents: true } } },
    }),
    prisma.customer.count({ where }),
  ]);

  return res.json({
    success: true,
    data: customers,
    pagination: formatPagination(total, page, limit),
  });
}

export async function getCustomer(req: AuthRequest, res: Response) {
  const customer = await prisma.customer.findUnique({
    where: { id: paramId(req) },
    include: {
      documents: true,
      bookings: { include: { package: true } },
      invoices: true,
      account: true,
    },
  });

  if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });
  return res.json({ success: true, data: customer });
}

export async function createCustomer(req: AuthRequest, res: Response) {
  const { firstName, lastName, email, phone, address, city, country, passportNo, nationalId, dateOfBirth, notes } =
    req.body;

  if (!firstName || !lastName || !phone) {
    return res.status(400).json({ success: false, error: 'First name, last name, and phone are required' });
  }

  const customer = await prisma.customer.create({
    data: { firstName, lastName, email, phone, address, city, country, passportNo, nationalId, dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined, notes },
  });

  await createCustomerAccount(customer.id, `${firstName} ${lastName}`);
  await logActivity(req, 'CREATE', 'Customer', customer.id);

  return res.status(201).json({ success: true, data: customer });
}

export async function updateCustomer(req: AuthRequest, res: Response) {
  const customer = await prisma.customer.update({
    where: { id: paramId(req) },
    data: {
      ...req.body,
      dateOfBirth: req.body.dateOfBirth ? new Date(req.body.dateOfBirth) : undefined,
    },
  });

  await logActivity(req, 'UPDATE', 'Customer', customer.id);
  return res.json({ success: true, data: customer });
}

export async function deleteCustomer(req: AuthRequest, res: Response) {
  const customer = await prisma.customer.findUnique({ where: { id: paramId(req) } });
  if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

  await prisma.deletedRecord.create({
    data: { entity: 'Customer', entityId: customer.id, data: JSON.stringify(customer), deletedBy: req.user?.id },
  });

  await prisma.customer.update({ where: { id: paramId(req) }, data: { isActive: false } });
  await logActivity(req, 'DELETE', 'Customer', paramId(req));

  return res.json({ success: true, message: 'Customer deactivated' });
}

export async function addCustomerDocument(req: AuthRequest, res: Response) {
  const { type, fileName, filePath, notes } = req.body;
  const doc = await prisma.customerDocument.create({
    data: { customerId: paramId(req), type, fileName, filePath, notes },
  });
  return res.status(201).json({ success: true, data: doc });
}

export async function getCustomerDocuments(req: AuthRequest, res: Response) {
  const docs = await prisma.customerDocument.findMany({
    where: { customerId: paramId(req) },
    orderBy: { uploadedAt: 'desc' },
  });
  return res.json({ success: true, data: docs });
}

export async function deleteCustomerDocument(req: AuthRequest, res: Response) {
  await prisma.customerDocument.delete({ where: { id: paramId(req, "docId") } });
  return res.json({ success: true, message: 'Document deleted' });
}
