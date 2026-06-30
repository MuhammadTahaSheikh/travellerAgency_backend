import { Response } from 'express';
import prisma, { TX_OPTS } from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination, serializeForDeletedRecord } from '../utils/helpers';
import { paramId } from '../utils/params';
import { createCustomerAccount } from '../services/ledgerService';
import { logActivity } from '../middleware/activityLogger';
import { getNextTradePartnerId } from '../services/tradePartnerService';
import { getLedgerTransactions, buildLedgerRows } from '../services/ledgerService';
import { CustomerType } from '@prisma/client';

export async function getCustomers(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const search = req.query.search as string;

  const where = search
    ? {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' as const } },
          { lastName: { contains: search, mode: 'insensitive' as const } },
          { companyName: { contains: search, mode: 'insensitive' as const } },
          { tradePartnerId: { contains: search, mode: 'insensitive' as const } },
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
  const {
    customerType,
    firstName,
    lastName,
    companyName,
    contactPerson,
    ntn,
    email,
    phone,
    address,
    city,
    country,
    passportNo,
    nationalId,
    dateOfBirth,
    notes,
  } = req.body;

  const type: CustomerType = customerType === 'B2B' ? 'B2B' : 'B2C';

  if (type === 'B2B') {
    if (!companyName || !phone) {
      return res.status(400).json({ success: false, error: 'Company name and phone are required for B2B customers' });
    }
  } else if (!firstName || !lastName || !phone) {
    return res.status(400).json({ success: false, error: 'First name, last name, and phone are required' });
  }

  const customer = await prisma.$transaction(async (tx) => {
    const tradePartnerId = type === 'B2B' ? await getNextTradePartnerId(tx) : undefined;

    return tx.customer.create({
      data: {
        customerType: type,
        firstName: firstName || companyName,
        lastName: lastName || (type === 'B2B' ? 'Partner' : ''),
        companyName: type === 'B2B' ? companyName : undefined,
        contactPerson: type === 'B2B' ? contactPerson : undefined,
        ntn: type === 'B2B' ? ntn : undefined,
        tradePartnerId,
        email,
        phone,
        address,
        city,
        country,
        passportNo,
        nationalId,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
        notes,
      },
    });
  }, TX_OPTS);

  const displayName = type === 'B2B' ? companyName : `${firstName} ${lastName}`;
  await createCustomerAccount(customer.id, displayName);
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
    data: { entity: 'Customer', entityId: customer.id, data: serializeForDeletedRecord(customer), deletedBy: req.user?.id },
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

export async function getCustomerLedger(req: AuthRequest, res: Response) {
  const customer = await prisma.customer.findUnique({
    where: { id: paramId(req) },
    include: {
      account: true,
      invoices: { orderBy: { issueDate: 'desc' } },
      bookings: { select: { id: true, bookingNumber: true, totalAmount: true, paidAmount: true, status: true } },
    },
  });

  if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

  const totalBilled = customer.invoices
    .filter((i) => i.status !== 'CANCELLED')
    .reduce((s, i) => s + Number(i.totalAmount), 0);
  const totalPaid = customer.invoices
    .filter((i) => i.status !== 'CANCELLED')
    .reduce((s, i) => s + Number(i.paidAmount), 0);
  const outstanding = totalBilled - totalPaid;

  let transactions: unknown[] = [];
  let ledgerDetail = null;
  if (customer.account) {
    const currency = (req.query.currency as string) === 'SAR' ? 'SAR' : 'PKR';
    const raw = await getLedgerTransactions({ accountId: customer.account.id });
    const rows = buildLedgerRows(raw, currency).reverse();
    transactions = rows.slice(0, 100);
    ledgerDetail = {
      currency,
      balancePkr: Number(customer.account.balancePkr),
      balanceSar: Number(customer.account.balanceSar),
      balance: Number(customer.account.balance),
    };
  }

  return res.json({
    success: true,
    data: {
      customer: {
        id: customer.id,
        customerType: customer.customerType,
        firstName: customer.firstName,
        lastName: customer.lastName,
        companyName: customer.companyName,
        tradePartnerId: customer.tradePartnerId,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        contactPerson: customer.contactPerson,
      },
      account: customer.account,
      ledgerDetail,
      summary: {
        totalBilled,
        totalPaid,
        outstanding,
        ledgerBalance: Number(customer.account?.balance || 0),
        ledgerBalancePkr: Number(customer.account?.balancePkr || 0),
        ledgerBalanceSar: Number(customer.account?.balanceSar || 0),
      },
      invoices: customer.invoices,
      bookings: customer.bookings,
      transactions,
    },
  });
}

export async function deleteCustomerDocument(req: AuthRequest, res: Response) {
  await prisma.customerDocument.delete({ where: { id: paramId(req, "docId") } });
  return res.json({ success: true, message: 'Document deleted' });
}
