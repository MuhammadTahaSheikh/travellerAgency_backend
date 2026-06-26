import prisma from '../config/database';
import { Prisma } from '@prisma/client';

const COUNTER_KEY = 'htp_trade_partner_counter';
const START_NUMBER = 1000;

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
