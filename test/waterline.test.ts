import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  analyze,
  healthFactor,
  liquidationPriceForCollateral,
  liquidationPriceForBorrow,
  weightedCollateralUsd,
  totalBorrowUsd,
} from '../src/engine/waterline';
import type { PositionLeg } from '../src/engine/types';

function collateral(symbol: string, amount: number, price: number, cf: number): PositionLeg {
  return {
    symbol,
    kind: 'collateral',
    amount: new Decimal(amount),
    priceUsd: new Decimal(price),
    collateralFactor: new Decimal(cf),
    decimals: 18,
  };
}
function borrow(symbol: string, amount: number, price: number): PositionLeg {
  return {
    symbol,
    kind: 'borrow',
    amount: new Decimal(amount),
    priceUsd: new Decimal(price),
    collateralFactor: new Decimal(0),
    decimals: 18,
  };
}

describe('waterline math', () => {
  it('computes a simple health factor', () => {
    // 10 BNB @ $600, CF 0.8 => weighted 4800; borrow 2000 USDT @ $1 => HF 2.4
    const legs = [collateral('BNB', 10, 600, 0.8), borrow('USDT', 2000, 1)];
    expect(weightedCollateralUsd(legs).toString()).toBe('4800');
    expect(totalBorrowUsd(legs).toString()).toBe('2000');
    expect(healthFactor(legs)!.toFixed(4)).toBe('2.4000');
  });

  it('returns null HF when there is no debt', () => {
    const legs = [collateral('BNB', 10, 600, 0.8)];
    expect(healthFactor(legs)).toBeNull();
  });

  it('finds the collateral liquidation price', () => {
    // HF=1 when BNB = (2000 - 0) / (10 * 0.8) = 250
    const legs = [collateral('BNB', 10, 600, 0.8), borrow('USDT', 2000, 1)];
    expect(liquidationPriceForCollateral(legs, 'BNB')!.toString()).toBe('250');
  });

  it('accounts for other collateral when finding a liquidation price', () => {
    // BTCB contributes 1*50000*0.7 = 35000 weighted; borrow 40000
    // BNB liq price = (40000 - 35000) / (10 * 0.8) = 625
    const legs = [
      collateral('BNB', 10, 600, 0.8),
      collateral('BTCB', 1, 50000, 0.7),
      borrow('USDT', 40000, 1),
    ];
    expect(liquidationPriceForCollateral(legs, 'BNB')!.toString()).toBe('625');
  });

  it('reports a borrowed asset is safe from one collateral alone when others cover it', () => {
    // If other collateral already exceeds borrow, this asset falling to 0 is still safe
    const legs = [
      collateral('BNB', 10, 600, 0.8), // weighted 4800
      collateral('USDC', 5000, 1, 0.9), // weighted 4500
      borrow('USDT', 1000, 1),
    ];
    // BNB liq price = (1000 - 4500) / 8 < 0 => clamped to 0
    expect(liquidationPriceForCollateral(legs, 'BNB')!.toString()).toBe('0');
  });

  it('finds the borrowed-asset price that triggers liquidation on an up-move', () => {
    // weighted collateral 4800; HF=1 when USDT price = 4800/2000 = 2.4
    const legs = [collateral('BNB', 10, 600, 0.8), borrow('USDT', 2000, 1)];
    expect(liquidationPriceForBorrow(legs, 'USDT')!.toString()).toBe('2.4');
  });
});

describe('waterline.analyze', () => {
  const legs = [collateral('BNB', 10, 600, 0.8), borrow('USDT', 2000, 1)];

  it('produces a complete, machine-readable report', () => {
    const r = analyze(legs, { chainId: 56 });
    expect(r.schema).toBe('waterline.report.v1');
    expect(r.healthFactor).toBe('2.4000');
    expect(r.liquidatable).toBe(false);
    expect(r.weightedCollateralUsd).toBe('4800.00');
    expect(r.totalBorrowUsd).toBe('2000.00');
    const bnb = r.assets.find((a) => a.symbol === 'BNB')!;
    expect(bnb.liquidationPriceUsd).toBe('250');
    expect(bnb.bufferPct).toBe('58.33'); // (600-250)/600
    expect(r.stress.length).toBe(3);
    expect(r.disclaimer).toContain('read-only');
    expect(r.verdict).toContain('2.4000');
  });

  it('flags a liquidatable position', () => {
    const under = [collateral('BNB', 10, 200, 0.8), borrow('USDT', 2000, 1)];
    const r = analyze(under, { chainId: 56 });
    // weighted = 1600 < borrow 2000 => HF 0.8, liquidatable
    expect(r.liquidatable).toBe(true);
    expect(r.healthFactor).toBe('0.8000');
    expect(r.shortfallUsd).toBe('400.00');
    expect(r.verdict).toContain('LIQUIDATABLE NOW');
  });

  it('stress rows reflect downward collateral shocks', () => {
    const r = analyze(legs, { chainId: 56, shocks: [new Decimal('0.2')] });
    // BNB -20% => $480, weighted 3840, HF 1.92
    expect(r.stress[0].collateralShockPct).toBe('20.0');
    expect(r.stress[0].healthFactor).toBe('1.9200');
    expect(r.stress[0].liquidatable).toBe(false);
  });
});
