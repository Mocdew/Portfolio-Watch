import { z } from 'zod';

const hexAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'must be a 20-byte 0x-prefixed hex address');
const hexKey = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'must be a 32-byte 0x-prefixed hex private key');

const schema = z.object({
  // Service
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_URL: z.string().url().optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  RPC_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  // Trust X-Forwarded-* headers. Enable ONLY when running behind a trusted
  // reverse proxy / platform router (so per-IP rate limiting uses the real
  // client IP). Off by default so a directly-exposed instance can't be spoofed.
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // Analysis chain (BSC mainnet, 56)
  ANALYSIS_CHAIN_ID: z.coerce.number().int().default(56),
  BSC_RPC_URL: z.string().url().default('https://bsc-dataseed.bnbchain.org'),
  VENUS_COMPTROLLER_ADDRESS: hexAddress.optional(),
  PRICE_MAX_STALENESS_SEC: z.coerce.number().int().positive().default(1800),

  // Identity + payment (BSC testnet, 97). Optional at boot; required to negotiate.
  IDENTITY_CHAIN_ID: z.coerce.number().int().default(97),
  AGENT_ADDRESS: hexAddress.optional(),
  AGENT_PRIVATE_KEY: hexKey.optional(),
  PAYMENT_TOKEN_ADDRESS: hexAddress.optional(),
  PAYMENT_TOKEN_DECIMALS: z.coerce.number().int().nonnegative().default(18),
  PAYMENT_TOKEN_SYMBOL: z.string().optional(),
  QUOTE_PRICE: z.string().default('1'),
  QUOTE_VERIFYING_CONTRACT: hexAddress.optional(),
  QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
});

export type Config = z.infer<typeof schema> & {
  /** True only when every input needed to sign a payable quote is present. */
  signingReady: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  const signingReady = Boolean(
    parsed.AGENT_PRIVATE_KEY &&
      parsed.AGENT_ADDRESS &&
      parsed.PAYMENT_TOKEN_ADDRESS &&
      parsed.QUOTE_VERIFYING_CONTRACT,
  );
  return { ...parsed, signingReady };
}

let cached: Config | null = null;

export function getConfig(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

/** For tests: reset the memoized config. */
export function resetConfigForTests(): void {
  cached = null;
}
