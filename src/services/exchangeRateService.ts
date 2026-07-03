import { getDefaultExchangeRate } from './currencyService';

export type ExchangeRateInfo = {
  pkrPerSar: number;
  sarPerPkr: number;
  source: 'live' | 'cached' | 'manual';
  provider?: string;
  fetchedAt: string;
  cached: boolean;
  manualDefault: number;
};

function buildInfo(pkrPerSar: number, manualDefault: number): ExchangeRateInfo {
  return {
    pkrPerSar,
    sarPerPkr: pkrPerSar > 0 ? Math.round((1 / pkrPerSar) * 1000000) / 1000000 : 0,
    source: 'manual',
    provider: 'manual',
    fetchedAt: new Date().toISOString(),
    cached: false,
    manualDefault,
  };
}

/**
 * The PKR/SAR rate is manually configured (Settings → Exchange Rate) rather than pulled
 * from any external/live provider. This always returns the manually-set default rate.
 */
export async function getExchangeRateInfo(_forceRefresh = false): Promise<ExchangeRateInfo> {
  const manualDefault = await getDefaultExchangeRate();
  return buildInfo(manualDefault, manualDefault);
}
