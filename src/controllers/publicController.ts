import { Response, Request } from 'express';
import prisma from '../config/database';
import { paramId } from '../utils/params';

const PUBLIC_SETTING_KEYS = [
  'company_name',
  'company_email',
  'company_phone',
  'company_address',
  'currency',
  'currency_locale',
];

export async function getPublicPackages(_req: unknown, res: Response) {
  const packages = await prisma.package.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
    include: { destinations: { orderBy: { order: 'asc' } } },
  });

  return res.json({ success: true, data: packages });
}

export async function getPublicPackage(req: Request, res: Response) {
  const pkg = await prisma.package.findFirst({
    where: { id: paramId(req), isActive: true },
    include: { destinations: { orderBy: { order: 'asc' } } },
  });

  if (!pkg) return res.status(404).json({ success: false, error: 'Package not found' });

  return res.json({ success: true, data: pkg });
}

export async function getPublicCompany(_req: unknown, res: Response) {
  const settings = await prisma.setting.findMany({
    where: { key: { in: PUBLIC_SETTING_KEYS } },
  });

  const data = settings.reduce<Record<string, string>>((acc, s) => {
    acc[s.key] = s.value;
    return acc;
  }, {});

  return res.json({
    success: true,
    data: {
      companyName: data.company_name || 'Huffaz Holiday',
      email: data.company_email || '',
      phone: data.company_phone || '',
      address: data.company_address || '',
      currency: data.currency || 'PKR',
      currencyLocale: data.currency_locale || 'en-PK',
    },
  });
}
