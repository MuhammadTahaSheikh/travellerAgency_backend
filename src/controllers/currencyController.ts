import { Response } from 'express';
import { AuthRequest } from '../types';
import { getExchangeRateInfo } from '../services/exchangeRateService';
import prisma from '../config/database';

const DEFAULT_RATE_KEY = 'default_pkr_sar_rate';

export async function getLiveExchangeRate(req: AuthRequest, res: Response) {
  const forceRefresh = req.query.refresh === 'true';
  const data = await getExchangeRateInfo(forceRefresh);
  return res.json({ success: true, data });
}

export async function setDefaultExchangeRate(req: AuthRequest, res: Response) {
  const { rate } = req.body;
  const value = Number(rate);

  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ success: false, error: 'Valid exchange rate required' });
  }

  const normalized = String(Math.round(value * 10000) / 10000);

  await prisma.setting.upsert({
    where: { key: DEFAULT_RATE_KEY },
    update: { value: normalized },
    create: { key: DEFAULT_RATE_KEY, value: normalized, category: 'financial' },
  });

  return res.json({
    success: true,
    data: { rate: parseFloat(normalized) },
    message: 'Default PKR/SAR rate updated',
  });
}
