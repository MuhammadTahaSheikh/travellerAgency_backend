export function generateNumber(prefix: string): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

export function paginate(page?: string | number, limit?: string | number) {
  const p = Math.max(1, parseInt(String(page || 1), 10));
  const l = Math.min(100, Math.max(1, parseInt(String(limit || 20), 10)));
  return { page: p, limit: l, skip: (p - 1) * l };
}

export function formatPagination(total: number, page: number, limit: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

export function parseDateRange(startDate?: string, endDate?: string) {
  const range: { gte?: Date; lte?: Date } = {};
  if (startDate) {
    const start = new Date(startDate);
    if (!isNaN(start.getTime())) {
      start.setHours(0, 0, 0, 0);
      range.gte = start;
    }
  }
  if (endDate) {
    const end = new Date(endDate);
    if (!isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      range.lte = end;
    }
  }
  return Object.keys(range).length ? range : undefined;
}

export function applyDateFilter(
  where: Record<string, unknown>,
  field: string,
  startDate?: string,
  endDate?: string
) {
  const range = parseDateRange(startDate, endDate);
  if (range) where[field] = range;
  return where;
}
