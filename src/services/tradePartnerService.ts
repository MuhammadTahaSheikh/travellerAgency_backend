import prisma from '../config/database';
import { Prisma } from '@prisma/client';

const COUNTER_KEY = 'htp_trade_partner_counter';
const START_NUMBER = 1000;

const VENDOR_COUNTER_KEY = 'hhv_vendor_counter';

export async function getNextTradePartnerId(tx?: Prisma.TransactionClient): Promise<string> {
  const client = tx || prisma;

  const existing = await client.setting.findUnique({ where: { key: COUNTER_KEY } });
  const nextNum = existing ? parseInt(existing.value, 10) + 1 : START_NUMBER;

  await client.setting.upsert({
    where: { key: COUNTER_KEY },
    update: { value: String(nextNum) },
    create: { key: COUNTER_KEY, value: String(nextNum), category: 'customers' },
  });

  return `HTP${nextNum}`;
}

/**
 * Sequential vendor code in the form HHV-0001, HHV-0002, ... Mirrors the B2B client
 * (trade partner) code scheme so every vendor has a stable human-readable identifier.
 */
export async function getNextVendorCode(tx?: Prisma.TransactionClient): Promise<string> {
  const client = tx || prisma;

  const existing = await client.setting.findUnique({ where: { key: VENDOR_COUNTER_KEY } });
  const nextNum = existing ? parseInt(existing.value, 10) + 1 : 1;

  await client.setting.upsert({
    where: { key: VENDOR_COUNTER_KEY },
    update: { value: String(nextNum) },
    create: { key: VENDOR_COUNTER_KEY, value: String(nextNum), category: 'vendors' },
  });

  return `HHV-${String(nextNum).padStart(4, '0')}`;
}
