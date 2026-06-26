import prisma from '../config/database';

const DEFAULT_RATE_KEY = 'default_pkr_sar_rate';
const DEFAULT_RATE = 75;

export async function getDefaultExchangeRate(): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { key: DEFAULT_RATE_KEY } });
  return setting ? parseFloat(setting.value) : DEFAULT_RATE;
}

export function convertCurrency(
  amount: number,
  currency: 'PKR' | 'SAR',
  exchangeRate: number
): { amountPkr: number; amountSar: number } {
  if (currency === 'PKR') {
    return {
      amountPkr: amount,
      amountSar: exchangeRate > 0 ? amount / exchangeRate : 0,
    };
  }
  return {
    amountPkr: amount * exchangeRate,
    amountSar: amount,
  };
}
