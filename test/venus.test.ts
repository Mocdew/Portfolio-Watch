import { describe, it, expect } from 'vitest';
import { normalizeVenusPrice } from '../src/venus';

describe('normalizeVenusPrice (Venus/Compound oracle scaling)', () => {
  it('normalizes an 18-decimal stablecoin to ~$1', () => {
    // USDT (18 decimals): raw scaled to 1e(36-18)=1e18 => $1
    const raw = 10n ** 18n;
    expect(normalizeVenusPrice(raw, 18).toString()).toBe('1');
  });

  it('normalizes an 18-decimal asset priced at $600', () => {
    const raw = 600n * 10n ** 18n;
    expect(normalizeVenusPrice(raw, 18).toString()).toBe('600');
  });

  it('normalizes an 8-decimal asset', () => {
    // 8 decimals => scale 1e(36-8)=1e28; price $30000
    const raw = 30000n * 10n ** 28n;
    expect(normalizeVenusPrice(raw, 8).toString()).toBe('30000');
  });
});
