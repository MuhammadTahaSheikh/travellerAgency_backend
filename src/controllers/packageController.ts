import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination } from '../utils/helpers';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';

export async function getPackages(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const search = req.query.search as string;

  const where = {
    isActive: req.query.includeInactive !== 'true',
    ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
  };

  const [packages, total] = await Promise.all([
    prisma.package.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { destinations: { orderBy: { order: 'asc' } }, _count: { select: { bookings: true } } },
    }),
    prisma.package.count({ where }),
  ]);

  return res.json({ success: true, data: packages, pagination: formatPagination(total, page, limit) });
}

export async function getPackage(req: AuthRequest, res: Response) {
  const pkg = await prisma.package.findUnique({
    where: { id: paramId(req) },
    include: { destinations: { orderBy: { order: 'asc' } }, bookings: { include: { customer: true } } },
  });
  if (!pkg) return res.status(404).json({ success: false, error: 'Package not found' });
  return res.json({ success: true, data: pkg });
}

export async function createPackage(req: AuthRequest, res: Response) {
  const { name, description, price, duration, maxCapacity, destinations } = req.body;
  if (!name || !price || !duration) {
    return res.status(400).json({ success: false, error: 'Name, price, and duration are required' });
  }

  const pkg = await prisma.package.create({
    data: {
      name,
      description,
      price,
      duration,
      maxCapacity: maxCapacity || 1,
      destinations: destinations?.length
        ? { create: destinations.map((d: { destination: string; country?: string; nights?: number }, i: number) => ({
            destination: d.destination,
            country: d.country,
            nights: d.nights || 1,
            order: i,
          })) }
        : undefined,
    },
    include: { destinations: true },
  });

  await logActivity(req, 'CREATE', 'Package', pkg.id);
  return res.status(201).json({ success: true, data: pkg });
}

export async function updatePackage(req: AuthRequest, res: Response) {
  const { destinations, ...data } = req.body;

  if (destinations) {
    await prisma.packageDestination.deleteMany({ where: { packageId: paramId(req) } });
    await prisma.packageDestination.createMany({
      data: destinations.map((d: { destination: string; country?: string; nights?: number }, i: number) => ({
        packageId: paramId(req),
        destination: d.destination,
        country: d.country,
        nights: d.nights || 1,
        order: i,
      })),
    });
  }

  const pkg = await prisma.package.update({
    where: { id: paramId(req) },
    data,
    include: { destinations: true },
  });

  await logActivity(req, 'UPDATE', 'Package', pkg.id);
  return res.json({ success: true, data: pkg });
}

export async function deletePackage(req: AuthRequest, res: Response) {
  const pkg = await prisma.package.findUnique({ where: { id: paramId(req) } });
  if (!pkg) return res.status(404).json({ success: false, error: 'Package not found' });

  await prisma.deletedRecord.create({
    data: { entity: 'Package', entityId: pkg.id, data: JSON.stringify(pkg), deletedBy: req.user?.id },
  });

  await prisma.package.update({ where: { id: paramId(req) }, data: { isActive: false } });
  await logActivity(req, 'DELETE', 'Package', paramId(req));
  return res.json({ success: true, message: 'Package deactivated' });
}
