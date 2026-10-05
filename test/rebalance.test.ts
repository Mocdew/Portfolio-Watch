import { describe, it, expect } from 'vitest';
import { rebalanceRequest } from '../src/rebalance-service';

// Portfolio worth $10,000: BNB 60% ($6,000), USDT 40% ($4,000).
const base = [
  { symbol: 'BNB', amount: 10, priceUsd: 600, targetWeight: 0.5 },
  { symbol: 'USDT', amount: 4000, priceUsd: 1, targetWeight: 0.5 },
];

describe('rebalance: drift-threshold policy', () => {
  it('proposes a self-financing rebalance when a band is breached', () => {
    const r = rebalanceRequest({ portfolio: base, driftThreshold: 0.05 });
    expect(r.schema).toBe('waterline.rebalance.v1');
    expect(r.portfolioValueUsd).toBe('10000.00');
    expect(r.rebalanceRequired).toBe(true);
    expect(r.maxDriftPct).toBe('10.00');

    const bnb = r.assets.find((a) => a.symbol === 'BNB')!;
    const usdt = r.assets.find((a) => a.symbol === 'USDT')!;
    expect(bnb.currentWeightPct).toBe('60.00');
    expect(bnb.driftPct).toBe('10.00');
    expect(bnb.action).toBe('sell');
    expect(bnb.tradeUsd).toBe('-1000.00');
    expect(usdt.action).toBe('buy');
    expect(usdt.tradeUsd).toBe('1000.00');

    // Buys net against sells: turnover is one side.
    expect(r.turnoverUsd).toBe('1000.00');
    expect(r.turnoverPct).toBe('10.00');
  });

  it('holds everything when drift is inside the band', () => {
    const r = rebalanceRequest({ portfolio: base, driftThreshold: 0.15 });
    expect(r.rebalanceRequired).toBe(false);
    expect(r.turnoverUsd).toBe('0.00');
    expect(r.assets.every((a) => a.action === 'hold')).toBe(true);
    // Target weights are still reported for transparency.
    expect(r.assets.find((a) => a.symbol === 'BNB')!.targetWeightPct).toBe('50.00');
  });

  it('defaults to equal weight when no targets are given', () => {
    const r = rebalanceRequest({
      portfolio: [
        { symbol: 'BNB', amount: 10, priceUsd: 600 },
        { symbol: 'USDT', amount: 4000, priceUsd: 1 },
      ],
      driftThreshold: 0.05,
    });
    expect(r.assets.find((a) => a.symbol === 'BNB')!.targetWeightPct).toBe('50.00');
    expect(r.rebalanceRequired).toBe(true); // 60/40 vs equal 50/50
  });

  it('defaults the drift threshold to 5%', () => {
    const r = rebalanceRequest({ portfolio: base });
    expect(r.policy.driftThresholdPct).toBe('5.00');
    expect(r.rebalanceRequired).toBe(true);
  });

  it('normalizes target weights that sum to ~1', () => {
    const r = rebalanceRequest({
      portfolio: [
        { symbol: 'A', amount: 1, priceUsd: 100, targetWeight: 0.3 },
        { symbol: 'B', amount: 1, priceUsd: 100, targetWeight: 0.7 },
      ],
    });
    expect(r.portfolioValueUsd).toBe('200.00');
    expect(r.assets.find((a) => a.symbol === 'A')!.targetWeightPct).toBe('30.00');
  });

  it('rejects target weights that do not sum to ~1', () => {
    expect(() =>
      rebalanceRequest({
        portfolio: [
          { symbol: 'A', amount: 1, priceUsd: 100, targetWeight: 0.3 },
          { symbol: 'B', amount: 1, priceUsd: 100, targetWeight: 0.3 },
        ],
      }),
    ).toThrow(/sum to ~1/);
  });

  it('rejects an empty portfolio', () => {
    expect(() => rebalanceRequest({ portfolio: [] })).toThrow(/non-empty/);
  });

  it('rejects an out-of-range drift threshold', () => {
    expect(() => rebalanceRequest({ portfolio: base, driftThreshold: 2 })).toThrow(
      /between 0 and 1/,
    );
  });

  it('handles a zero-value portfolio without dividing by zero', () => {
    const r = rebalanceRequest({
      portfolio: [{ symbol: 'A', amount: 0, priceUsd: 0, targetWeight: 1 }],
    });
    expect(r.portfolioValueUsd).toBe('0.00');
    expect(r.rebalanceRequired).toBe(false);
    expect(r.verdict).toMatch(/no USD value/);
  });
});
