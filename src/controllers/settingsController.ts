import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { logActivity } from '../middleware/activityLogger';

export async function getSettings(_req: AuthRequest, res: Response) {
  const settings = await prisma.setting.findMany({ orderBy: { category: 'asc' } });
  const grouped = settings.reduce(
    (acc, s) => {
      if (!acc[s.category]) acc[s.category] = {};
      acc[s.category][s.key] = s.value;
      return acc;
    },
    {} as Record<string, Record<string, string>>
  );
  return res.json({ success: true, data: grouped });
}

export async function updateSetting(req: AuthRequest, res: Response) {
  const { key, value, category } = req.body;
  const setting = await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value, category: category || 'general' },
  });

  await logActivity(req, 'UPDATE', 'Setting', setting.id, `Updated ${key}`);
  return res.json({ success: true, data: setting });
}

export async function bulkUpdateSettings(req: AuthRequest, res: Response) {
  const { settings } = req.body as { settings: { key: string; value: string; category?: string }[] };

  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: { key: s.key, value: s.value, category: s.category || 'general' },
    });
  }

  await logActivity(req, 'UPDATE', 'Settings', undefined, 'Bulk settings update');
  return res.json({ success: true, message: 'Settings updated' });
}
