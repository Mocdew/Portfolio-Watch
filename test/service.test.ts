import { describe, it, expect } from 'vitest';
import { analyzeExplicit } from '../src/service';
import { AppError } from '../src/errors';

describe('analyzeExplicit validation', () => {
  it('rejects an empty position', () => {
    expect(() => analyzeExplicit({ position: [] })).toThrow(AppError);
  });

  it('rejects a bad kind', () => {
    expect(() =>
      analyzeExplicit({ position: [{ symbol: 'X', kind: 'foo' as never, amount: 1, priceUsd: 1 }] }),
    ).toThrow(/kind must be/);
  });

  it('rejects a non-numeric amount', () => {
    expect(() =>
      analyzeExplicit({
        position: [{ symbol: 'X', kind: 'collateral', amount: 'abc', priceUsd: 1, collateralFactor: 0.5 }],
      }),
    ).toThrow(/not a valid number/);
  });

  it('rejects a collateral factor outside 0..1', () => {
    expect(() =>
      analyzeExplicit({
        position: [{ symbol: 'X', kind: 'collateral', amount: 1, priceUsd: 1, collateralFactor: 2 }],
      }),
    ).toThrow(/between 0 and 1/);
  });

  it('rejects an out-of-range shock', () => {
    expect(() =>
      analyzeExplicit({
        position: [{ symbol: 'BNB', kind: 'collateral', amount: 1, priceUsd: 600, collateralFactor: 0.8 }],
        shocks: [1.5],
      }),
    ).toThrow(/between 0 and 1/);
  });

  it('analyzes a valid explicit position', () => {
    const r = analyzeExplicit({
      position: [
        { symbol: 'BNB', kind: 'collateral', amount: 10, priceUsd: 600, collateralFactor: 0.8 },
        { symbol: 'USDT', kind: 'borrow', amount: 2000, priceUsd: 1 },
      ],
    });
    expect(r.healthFactor).toBe('2.4000');
    expect(r.dataSources[0].source).toContain('caller-supplied');
  });
});
