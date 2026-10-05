import Decimal from 'decimal.js';

export type LegKind = 'collateral' | 'borrow';

/** Where a single value came from, so a buyer can independently verify it. */
export interface Evidence {
  source: string; // human description
  contract?: string; // address read from
  method?: string; // method / field
  chainId: number;
  blockNumber?: number;
  timestamp?: number; // unix seconds
}

/** One leg of a lending position, normalized to human units and USD. */
export interface PositionLeg {
  symbol: string;
  kind: LegKind;
  amount: Decimal; // human units of the underlying asset
  priceUsd: Decimal; // USD price per 1 whole underlying token
  collateralFactor: Decimal; // 0..1; for Venus this is also the liquidation threshold
  decimals: number;
  vToken?: string;
  underlying?: string;
}

export interface AnalyzeMeta {
  account?: string;
  chainId: number;
  asOfBlock?: number;
  asOfTimestamp?: number;
  dataSources?: Evidence[];
  shocks?: Decimal[]; // downward collateral shocks, e.g. [0.1, 0.2, 0.3]
}

export interface AssetRisk {
  symbol: string;
  kind: LegKind;
  amount: string;
  priceUsd: string;
  collateralFactor?: string;
  /** Collateral: the price it must fall to for liquidation. Borrow: the price it must rise to. */
  liquidationPriceUsd: string | null;
  /** % move from current price to the liquidation price. */
  bufferPct: string | null;
  note: string;
}

export interface StressPoint {
  collateralShockPct: string;
  healthFactor: string | null;
  shortfallUsd: string;
  liquidatable: boolean;
}

export interface WaterlineReport {
  schema: 'waterline.report.v1';
  account?: string;
  chainId: number;
  protocol: 'venus-core';
  healthFactor: string | null; // null when there is no debt
  liquidatable: boolean;
  weightedCollateralUsd: string;
  totalBorrowUsd: string;
  liquidityUsd: string;
  shortfallUsd: string;
  assets: AssetRisk[];
  stress: StressPoint[];
  verdict: string;
  asOf: { blockNumber?: number; timestamp?: number; iso?: string };
  dataSources: Evidence[];
  assumptions: string[];
  limitations: string[];
  disclaimer: string;
}
