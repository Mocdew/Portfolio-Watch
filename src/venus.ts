import Decimal from 'decimal.js';
import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { getConfig } from './config';
import { AppError } from './errors';
import type { Evidence, PositionLeg } from './engine/types';

// ---------------------------------------------------------------------------
// LIVE-VERIFICATION REQUIRED.
// The ABIs and the oracle price scaling below follow the Venus (Compound-fork)
// convention, but they MUST be validated against the live deployment before any
// on-chain output is trusted. Until verified, prefer the explicit-position
// preview path, which needs no RPC and is covered by unit tests.
// ---------------------------------------------------------------------------

const COMPTROLLER_ABI = [
  {
    name: 'getAssetsIn',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    name: 'markets',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'vToken', type: 'address' }],
    outputs: [
      { name: 'isListed', type: 'bool' },
      { name: 'collateralFactorMantissa', type: 'uint256' },
      { name: 'isVenus', type: 'bool' },
    ],
  },
  {
    name: 'oracle',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const VTOKEN_ABI = [
  {
    name: 'getAccountSnapshot',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      { name: 'error', type: 'uint256' },
      { name: 'vTokenBalance', type: 'uint256' },
      { name: 'borrowBalance', type: 'uint256' },
      { name: 'exchangeRateMantissa', type: 'uint256' },
    ],
  },
  {
    name: 'underlying',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

const ORACLE_ABI = [
  {
    name: 'getUnderlyingPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'vToken', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const ERC20_ABI = [
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

/**
 * Venus/Compound oracle prices are scaled to 1e(36 - underlyingDecimals), so
 * humanPriceUsd = raw / 10^(36 - underlyingDecimals).
 * PURE + unit-tested. (The on-chain read path that feeds it is not yet verified.)
 */
export function normalizeVenusPrice(raw: bigint, underlyingDecimals: number): Decimal {
  const scale = new Decimal(10).pow(36 - underlyingDecimals);
  return new Decimal(raw.toString()).div(scale);
}

function client(): PublicClient {
  const cfg = getConfig();
  return createPublicClient({
    transport: http(cfg.BSC_RPC_URL, { timeout: cfg.RPC_TIMEOUT_MS }),
  });
}

export interface AccountReadResult {
  legs: PositionLeg[];
  asOfBlock: number;
  asOfTimestamp: number;
  dataSources: Evidence[];
}

/**
 * Read a Venus account's position on chain and normalize it into engine legs.
 * Throws NOT_CONFIGURED when no Comptroller is configured. LIVE-VERIFICATION
 * REQUIRED before trusting the result.
 */
export async function readAccountPosition(
  account: string,
  chainId: number,
): Promise<AccountReadResult> {
  const cfg = getConfig();
  if (!cfg.VENUS_COMPTROLLER_ADDRESS) {
    throw new AppError(
      'NOT_CONFIGURED',
      'On-chain account reads are disabled: set VENUS_COMPTROLLER_ADDRESS (verified against docs.venus.io). Use the explicit `position` preview instead.',
    );
  }
  const c = client();
  const comptroller = cfg.VENUS_COMPTROLLER_ADDRESS as Address;

  let block;
  let assetsIn: readonly Address[];
  let oracleAddr: Address;
  try {
    block = await c.getBlock();
    [assetsIn, oracleAddr] = await Promise.all([
      c.readContract({
        address: comptroller,
        abi: COMPTROLLER_ABI,
        functionName: 'getAssetsIn',
        args: [account as Address],
      }),
      c.readContract({
        address: comptroller,
        abi: COMPTROLLER_ABI,
        functionName: 'oracle',
      }),
    ]);
  } catch (e) {
    throw new AppError('UPSTREAM_RPC', `BSC RPC read failed: ${(e as Error).message}`);
  }

  const dataSources: Evidence[] = [
    {
      source: 'Venus Comptroller',
      contract: comptroller,
      method: 'getAssetsIn / oracle',
      chainId,
      blockNumber: Number(block.number),
      timestamp: Number(block.timestamp),
    },
  ];

  const legs: PositionLeg[] = [];
  for (const vToken of assetsIn) {
    const [snapshot, marketInfo, rawPrice] = await Promise.all([
      c.readContract({
        address: vToken,
        abi: VTOKEN_ABI,
        functionName: 'getAccountSnapshot',
        args: [account as Address],
      }),
      c.readContract({
        address: comptroller,
        abi: COMPTROLLER_ABI,
        functionName: 'markets',
        args: [vToken],
      }),
      c.readContract({
        address: oracleAddr,
        abi: ORACLE_ABI,
        functionName: 'getUnderlyingPrice',
        args: [vToken],
      }),
    ]);

    const [, vTokenBalance, borrowBalance, exchangeRateMantissa] = snapshot;
    const [, collateralFactorMantissa] = marketInfo;

    // Resolve underlying metadata (vBNB-style markets have no underlying()).
    let underlying: Address | undefined;
    let decimals = 18;
    let symbol = 'UNKNOWN';
    try {
      underlying = await c.readContract({
        address: vToken,
        abi: VTOKEN_ABI,
        functionName: 'underlying',
      });
      [decimals, symbol] = await Promise.all([
        c.readContract({ address: underlying, abi: ERC20_ABI, functionName: 'decimals' }),
        c.readContract({ address: underlying, abi: ERC20_ABI, functionName: 'symbol' }),
      ]);
    } catch {
      // Native-gas market (e.g. vBNB): treat as 18-decimal BNB.
      decimals = 18;
      symbol = (await c
        .readContract({ address: vToken, abi: VTOKEN_ABI, functionName: 'symbol' })
        .catch(() => 'BNB')) as string;
      symbol = symbol.replace(/^v/i, '') || 'BNB';
    }

    const priceUsd = normalizeVenusPrice(rawPrice, decimals);
    const factor = new Decimal(collateralFactorMantissa.toString()).div(
      new Decimal(10).pow(18),
    );
    const decScale = new Decimal(10).pow(decimals);

    const supplyUnderlying = new Decimal(vTokenBalance.toString())
      .mul(new Decimal(exchangeRateMantissa.toString()))
      .div(new Decimal(10).pow(18))
      .div(decScale);
    const borrowUnderlying = new Decimal(borrowBalance.toString()).div(decScale);

    if (supplyUnderlying.gt(0)) {
      legs.push({
        symbol,
        kind: 'collateral',
        amount: supplyUnderlying,
        priceUsd,
        collateralFactor: factor,
        decimals,
        vToken,
        underlying,
      });
    }
    if (borrowUnderlying.gt(0)) {
      legs.push({
        symbol,
        kind: 'borrow',
        amount: borrowUnderlying,
        priceUsd,
        collateralFactor: new Decimal(0),
        decimals,
        vToken,
        underlying,
      });
    }

    dataSources.push({
      source: `Venus market ${symbol}`,
      contract: vToken,
      method: 'getAccountSnapshot / markets / oracle.getUnderlyingPrice',
      chainId,
      blockNumber: Number(block.number),
      timestamp: Number(block.timestamp),
    });
  }

  // Freshness guard: refuse obviously stale block data.
  const ageSec = Math.floor(Date.now() / 1000) - Number(block.timestamp);
  if (ageSec > cfg.PRICE_MAX_STALENESS_SEC) {
    throw new AppError(
      'STALE_DATA',
      `Latest block is ${ageSec}s old (> ${cfg.PRICE_MAX_STALENESS_SEC}s). Refusing to report on stale data.`,
    );
  }

  return {
    legs,
    asOfBlock: Number(block.number),
    asOfTimestamp: Number(block.timestamp),
    dataSources,
  };
}
