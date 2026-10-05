import Decimal from 'decimal.js';
import {
  AnalyzeMeta,
  AssetRisk,
  PositionLeg,
  StressPoint,
  WaterlineReport,
} from './types';

const ZERO = new Decimal(0);
const ONE = new Decimal(1);

const DISCLAIMER =
  'Waterline is a read-only, point-in-time risk estimate for Venus Core-pool ' +
  'positions on BNB Smart Chain. It executes nothing and moves no funds. Every ' +
  'number depends on the oracle prices and protocol parameters read at the stated ' +
  'block and can change within a single block. Not financial advice; no outcome is ' +
  'guaranteed.';

/** Σ(collateral amount × price × collateral factor). */
export function weightedCollateralUsd(legs: PositionLeg[]): Decimal {
  return legs
    .filter((l) => l.kind === 'collateral')
    .reduce((acc, l) => acc.plus(l.amount.mul(l.priceUsd).mul(l.collateralFactor)), ZERO);
}

/** Σ(borrow amount × price). */
export function totalBorrowUsd(legs: PositionLeg[]): Decimal {
  return legs
    .filter((l) => l.kind === 'borrow')
    .reduce((acc, l) => acc.plus(l.amount.mul(l.priceUsd)), ZERO);
}

/** HF = weighted collateral / total borrow. null when there is no debt. */
export function healthFactor(legs: PositionLeg[]): Decimal | null {
  const borrow = totalBorrowUsd(legs);
  if (borrow.lte(ZERO)) return null;
  return weightedCollateralUsd(legs).div(borrow);
}

/** Price a collateral asset must fall to for HF = 1, holding everything else fixed. */
export function liquidationPriceForCollateral(
  legs: PositionLeg[],
  symbol: string,
): Decimal | null {
  const leg = legs.find((l) => l.kind === 'collateral' && l.symbol === symbol);
  if (!leg) return null;
  const borrow = totalBorrowUsd(legs);
  if (borrow.lte(ZERO)) return null; // no debt: never liquidated
  const othersWeighted = weightedCollateralUsd(legs.filter((l) => l !== leg));
  const denom = leg.amount.mul(leg.collateralFactor);
  if (denom.lte(ZERO)) return null;
  const price = borrow.minus(othersWeighted).div(denom);
  return price.lte(ZERO) ? ZERO : price; // <=0 means safe from this asset alone even at $0
}

/** Price a borrowed asset must rise to for HF = 1, holding everything else fixed. */
export function liquidationPriceForBorrow(
  legs: PositionLeg[],
  symbol: string,
): Decimal | null {
  const leg = legs.find((l) => l.kind === 'borrow' && l.symbol === symbol);
  if (!leg || leg.amount.lte(ZERO)) return null;
  const collateral = weightedCollateralUsd(legs);
  const othersBorrow = totalBorrowUsd(legs.filter((l) => l !== leg));
  const price = collateral.minus(othersBorrow).div(leg.amount);
  return price.lte(ZERO) ? ZERO : price;
}

/** Apply a uniform downward shock to all collateral prices. */
export function applyCollateralShock(legs: PositionLeg[], shockPct: Decimal): PositionLeg[] {
  const factor = Decimal.max(ZERO, ONE.minus(shockPct));
  return legs.map((l) =>
    l.kind === 'collateral' ? { ...l, priceUsd: l.priceUsd.mul(factor) } : l,
  );
}

function fmtUsd(d: Decimal): string {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function fmtPrice(d: Decimal): string {
  return d.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toString();
}

function verdict(hf: Decimal | null, liquidatable: boolean, liquidity: Decimal): string {
  if (hf === null)
    return 'No outstanding debt in this position; it cannot be liquidated.';
  if (liquidatable)
    return `LIQUIDATABLE NOW: health factor ${hf.toFixed(4)} (<1). On-paper shortfall $${liquidity.abs().toFixed(2)}.`;
  let band: string;
  if (hf.gte(2)) band = 'comfortable';
  else if (hf.gte(1.5)) band = 'moderate';
  else if (hf.gte(1.1)) band = 'elevated';
  else band = 'critical';
  return `Health factor ${hf.toFixed(4)} — ${band} buffer. Not currently liquidatable.`;
}

/** Build the full, machine-readable risk report. Pure and deterministic. */
export function analyze(legs: PositionLeg[], meta: AnalyzeMeta): WaterlineReport {
  const shocks =
    meta.shocks && meta.shocks.length
      ? meta.shocks
      : [new Decimal('0.1'), new Decimal('0.2'), new Decimal('0.3')];

  const borrow = totalBorrowUsd(legs);
  const weighted = weightedCollateralUsd(legs);
  const hf = healthFactor(legs);
  const liquidity = weighted.minus(borrow);
  const liquidatable = borrow.gt(ZERO) && weighted.lt(borrow);

  const assets: AssetRisk[] = legs.map((l) => {
    if (l.kind === 'collateral') {
      const liq = liquidationPriceForCollateral(legs, l.symbol);
      const buffer =
        liq && l.priceUsd.gt(ZERO)
          ? l.priceUsd.minus(liq).div(l.priceUsd).mul(100)
          : null;
      return {
        symbol: l.symbol,
        kind: l.kind,
        amount: l.amount.toString(),
        priceUsd: fmtUsd(l.priceUsd),
        collateralFactor: l.collateralFactor.toString(),
        liquidationPriceUsd: liq ? fmtPrice(liq) : null,
        bufferPct: buffer ? buffer.toFixed(2) : null,
        note: !borrow.gt(ZERO)
          ? 'No debt: not liquidatable'
          : liq && liq.lte(ZERO)
            ? 'Safe from this asset alone even at $0'
            : 'Liquidates if price falls to liquidationPriceUsd',
      };
    }
    const liq = liquidationPriceForBorrow(legs, l.symbol);
    const buffer =
      liq && l.priceUsd.gt(ZERO) ? liq.minus(l.priceUsd).div(l.priceUsd).mul(100) : null;
    return {
      symbol: l.symbol,
      kind: l.kind,
      amount: l.amount.toString(),
      priceUsd: fmtUsd(l.priceUsd),
      liquidationPriceUsd: liq ? fmtPrice(liq) : null,
      bufferPct: buffer ? buffer.toFixed(2) : null,
      note: 'Liquidates if this borrowed asset rises to liquidationPriceUsd',
    };
  });

  const stress: StressPoint[] = shocks.map((s) => {
    const shocked = applyCollateralShock(legs, s);
    const w = weightedCollateralUsd(shocked);
    const b = totalBorrowUsd(shocked);
    const h = b.lte(ZERO) ? null : w.div(b);
    const short = b.minus(w);
    return {
      collateralShockPct: s.mul(100).toFixed(1),
      healthFactor: h ? h.toFixed(4) : null,
      shortfallUsd: short.gt(ZERO) ? fmtUsd(short) : '0.00',
      liquidatable: b.gt(ZERO) && w.lt(b),
    };
  });

  return {
    schema: 'waterline.report.v1',
    account: meta.account,
    chainId: meta.chainId,
    protocol: 'venus-core',
    healthFactor: hf ? hf.toFixed(4) : null,
    liquidatable,
    weightedCollateralUsd: fmtUsd(weighted),
    totalBorrowUsd: fmtUsd(borrow),
    liquidityUsd: liquidity.gt(ZERO) ? fmtUsd(liquidity) : '0.00',
    shortfallUsd: liquidity.lt(ZERO) ? fmtUsd(liquidity.abs()) : '0.00',
    assets,
    stress,
    verdict: verdict(hf, liquidatable, liquidity),
    asOf: {
      blockNumber: meta.asOfBlock,
      timestamp: meta.asOfTimestamp,
      iso: meta.asOfTimestamp
        ? new Date(meta.asOfTimestamp * 1000).toISOString()
        : undefined,
    },
    dataSources: meta.dataSources ?? [],
    assumptions: [
      'Venus Core pool uses a single collateral factor per market as the liquidation threshold (Compound-style).',
      'Health factor = Σ(collateral × price × collateralFactor) / Σ(borrow × price).',
      'Stress rows apply a uniform downward shock to all collateral prices; borrow prices are held fixed.',
      'Prices and collateral factors are those read from the protocol at the stated block.',
    ],
    limitations: [
      'Point-in-time snapshot, not a live monitor; values can change within one block.',
      'Only Venus Core-pool markets are covered; isolated pools and other protocols are out of scope.',
      'Does not model the close factor, liquidation incentive, borrow caps, or accruing interest beyond what the read reflects.',
      'The oracle price is trusted as read; a stale or manipulated oracle yields a wrong result (staleness beyond the configured bound is refused).',
    ],
    disclaimer: DISCLAIMER,
  };
}
