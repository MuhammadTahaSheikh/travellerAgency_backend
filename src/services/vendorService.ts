import prisma from '../config/database';
import { Prisma, VendorCategory } from '@prisma/client';
import { generateNumber } from '../utils/helpers';

type TxClient = Prisma.TransactionClient;

const categoryToExpense: Record<VendorCategory, string> = {
  HOTEL: 'HOTEL',
  VISA: 'VISA',
  TICKETING: 'AIRLINE',
  TRANSPORT: 'OTHER',
  OTHER: 'OTHER',
};

export function vendorCategoryFromService(serviceType: string): VendorCategory {
  const map: Record<string, VendorCategory> = {
    HOTEL: 'HOTEL',
    VISA: 'VISA',
    TICKET: 'TICKETING',
    TRANSPORT: 'TRANSPORT',
    PACKAGE: 'OTHER',
  };
  return map[serviceType] || 'OTHER';
}

export async function createVendorAccount(vendorId: string, vendorName: string, tx?: TxClient) {
  const client = tx || prisma;
  const existing = await client.account.findFirst({ where: { vendorId } });
  if (existing) return existing;

  return client.account.create({
    data: {
      name: `Vendor: ${vendorName}`,
      code: generateNumber('VND'),
      type: 'SUPPLIER',
      vendorId,
    },
  });
}

export async function getOrCreateVendorByCategory(category: VendorCategory, tx?: TxClient) {
  const client = tx || prisma;
  const defaultNames: Record<VendorCategory, string> = {
    HOTEL: 'Default Hotel Vendor',
    VISA: 'Default Visa Vendor',
    TICKETING: 'Default Ticketing Vendor',
    TRANSPORT: 'Default Transport Vendor',
    OTHER: 'Default Vendor',
  };

  let vendor = await client.vendor.findFirst({ where: { category, isActive: true } });
  if (!vendor) {
    vendor = await client.vendor.create({
      data: { name: defaultNames[category], category },
    });
    await createVendorAccount(vendor.id, vendor.name, client);
  }
  return vendor;
}

export function expenseCategoryFromVendor(category: VendorCategory) {
  return categoryToExpense[category] as 'HOTEL' | 'VISA' | 'AIRLINE' | 'OTHER';
}
