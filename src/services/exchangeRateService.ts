import { getDefaultExchangeRate } from './currencyService';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const LIVE_API_URL = 'https://open.er-api.com/v6/latest/SAR';

export type ExchangeRateInfo = {
  pkrPerSar: number;
  sarPerPkr: number;
  source: 'live' | 'cached' | 'manual';
  provider?: string;
  fetchedAt: string;
  cached: boolean;
  manualDefault: number;
};

let cache: { data: ExchangeRateInfo; expiresAt: number } | null = null;

async function fetchLivePkrPerSar(): Promise<{ rate: number; provider: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(LIVE_API_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`Rate API HTTP ${res.status}`);

    const json = (await res.json()) as {
      result?: string;
      provider?: string;
      rates?: { PKR?: number };
    };

    const pkr = Number(json.rates?.PKR);
    if (!Number.isFinite(pkr) || pkr <= 0) {
      throw new Error('Invalid PKR rate from provider');
    }

    return {
      rate: Math.round(pkr * 10000) / 10000,
      provider: json.provider || 'exchangerate-api.com',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildInfo(
  pkrPerSar: number,
  source: ExchangeRateInfo['source'],
  manualDefault: number,
  cached: boolean,
  provider?: string
): ExchangeRateInfo {
  return {
    pkrPerSar,
    sarPerPkr: pkrPerSar > 0 ? Math.round((1 / pkrPerSar) * 1000000) / 1000000 : 0,
    source,
    provider,
    fetchedAt: new Date().toISOString(),
    cached,
    manualDefault,
  };
}

export async function getExchangeRateInfo(forceRefresh = false): Promise<ExchangeRateInfo> {
  const manualDefault = await getDefaultExchangeRate();
  const now = Date.now();

  if (!forceRefresh && cache && cache.expiresAt > now) {
    return { ...cache.data, cached: true, source: cache.data.source === 'manual' ? 'manual' : 'cached' };
  }

  try {
    const { rate, provider } = await fetchLivePkrPerSar();
    const info = buildInfo(rate, 'live', manualDefault, false, provider);
    cache = { data: info, expiresAt: now + CACHE_TTL_MS };
    return info;
  } catch {
    if (cache) {
      return { ...cache.data, cached: true, source: 'cached' };
    }

    const info = buildInfo(manualDefault, 'manual', manualDefault, false);
    cache = { data: info, expiresAt: now + 5 * 60 * 1000 };
    return info;
  }
}
