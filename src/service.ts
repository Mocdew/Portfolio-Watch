import Decimal from 'decimal.js';
import { analyze } from './engine/waterline';
import type { PositionLeg, WaterlineReport } from './engine/types';
import { AppError } from './errors';
import { readAccountPosition } from './venus';

export interface ExplicitLeg {
  symbol: string;
  kind: 'collateral' | 'borrow';
  amount: string | number;
  priceUsd: string | number;
  collateralFactor?: string | number;
  decimals?: number;
  vToken?: string;
  underlying?: string;
}

export interface PreviewInput {
  account?: string;
  chainId?: number;
  position?: ExplicitLeg[];
  shocks?: number[];
}

function toDec(v: string | number | undefined, label: string): Decimal {
  if (v === undefined || v === null || (v as unknown) === '')
    throw new AppError('INVALID_INPUT', `${label} is required`);
  try {
    const d = new Decimal(v);
    if (!d.isFinite()) throw new Error('non-finite');
    return d;
  } catch {
    throw new AppError('INVALID_INPUT', `${label} is not a valid number`);
  }
}

/** Analyze an explicit, caller-supplied position. No RPC, fully deterministic. */
export function analyzeExplicit(input: PreviewInput): WaterlineReport {
  if (!input.position || input.position.length === 0)
    throw new AppError(
      'INVALID_INPUT',
      'Provide a non-empty `position` array of legs (or an `account` to read on-chain).',
    );
  if (input.position.length > 50)
    throw new AppError('INVALID_INPUT', '`position` is limited to 50 legs.');

  const legs: PositionLeg[] = input.position.map((l, i) => {
    if (!l || typeof l.symbol !== 'string' || l.symbol.length === 0)
      throw new AppError('INVALID_INPUT', `position[${i}].symbol is required`);
    if (l.kind !== 'collateral' && l.kind !== 'borrow')
      throw new AppError(
        'INVALID_INPUT',
        `position[${i}].kind must be 'collateral' or 'borrow'`,
      );
    const amount = toDec(l.amount, `position[${i}].amount`);
    const priceUsd = toDec(l.priceUsd, `position[${i}].priceUsd`);
    const cf =
      l.kind === 'collateral'
        ? toDec(l.collateralFactor ?? 0, `position[${i}].collateralFactor`)
        : new Decimal(0);
    if (amount.lt(0) || priceUsd.lt(0))
      throw new AppError(
        'INVALID_INPUT',
        `position[${i}] amount and priceUsd must be non-negative`,
      );
    if (l.kind === 'collateral' && (cf.lt(0) || cf.gt(1)))
      throw new AppError(
        'INVALID_INPUT',
        `position[${i}].collateralFactor must be between 0 and 1`,
      );
    return {
      symbol: l.symbol,
      kind: l.kind,
      amount,
      priceUsd,
      collateralFactor: cf,
      decimals: l.decimals ?? 18,
      vToken: l.vToken,
      underlying: l.underlying,
    };
  });

  const shocks = normalizeShocks(input.shocks);
  const chainId = input.chainId ?? 56;
  return analyze(legs, {
    account: input.account,
    chainId,
    shocks,
    dataSources: [
      { source: 'caller-supplied position (dry-run / preview)', chainId },
    ],
  });
}

/** Analyze a live Venus account by address (requires configured + verified RPC). */
export async function analyzeAccount(
  account: string,
  chainId: number,
  shocks?: number[],
): Promise<WaterlineReport> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(account))
    throw new AppError('INVALID_INPUT', '`account` must be a 20-byte 0x address');
  const read = await readAccountPosition(account, chainId);
  return analyze(read.legs, {
    account,
    chainId,
    asOfBlock: read.asOfBlock,
    asOfTimestamp: read.asOfTimestamp,
    dataSources: read.dataSources,
    shocks: normalizeShocks(shocks),
  });
}

function normalizeShocks(shocks?: number[]): Decimal[] {
  const src = shocks && shocks.length ? shocks : [0.1, 0.2, 0.3];
  return src.map((s, i) => {
    const d = new Decimal(s);
    if (!d.isFinite() || d.lt(0) || d.gt(1))
      throw new AppError(
        'INVALID_INPUT',
        `shocks[${i}] must be a fraction between 0 and 1 (e.g. 0.2 for -20%)`,
      );
    return d;
  });
}

/** Dispatch for the `preview` skill: explicit position OR on-chain account read. */
export async function previewRequest(input: PreviewInput): Promise<WaterlineReport> {
  if (input.position && input.position.length) return analyzeExplicit(input);
  if (input.account) return analyzeAccount(input.account, input.chainId ?? 56, input.shocks);
  throw new AppError(
    'INVALID_INPUT',
    'Provide either `position` (explicit legs) or `account` (on-chain read).',
  );
}
