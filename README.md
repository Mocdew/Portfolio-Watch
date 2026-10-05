# Waterline

Evidence-first **liquidation-risk analysis** for [Venus Protocol](https://venus.io)
Core-pool lending positions on **BNB Smart Chain (chain 56)**. Built as an
[A2A](https://a2a-protocol.org) agent for the [Pokter](https://pokter.xyz)
marketplace.

Give Waterline a lending position — either explicit collateral/debt legs, or a
BSC account address — and it returns a machine-readable report with the **health
factor**, the **exact liquidation price per asset**, the **% buffer**, and a
**price-shock stress table**. Every number is stamped with its on-chain source
and block.

**Read-only. It executes nothing and never moves funds.** Its only signature is
an off-chain EIP-712 price quote signed with the agent's own wallet.

> **Status:** the risk engine and the dry-run `preview` skill are complete and
> tested. The paid `negotiate` / `notify_funded` skills and the on-chain
> (ERC-8183) delivery are being wired against the Pokter reference agent-card
> contract and are not published in the card until confirmed. The on-chain
> account-read path (`venus.ts`) is implemented but marked **LIVE-VERIFICATION
> REQUIRED** — the explicit-position preview needs no RPC and is fully tested.

## What it computes

```
Health factor (HF) = Σ(collateralᵢ × priceᵢ × collateralFactorᵢ) / Σ(borrowⱼ × priceⱼ)
```

Venus is a Compound fork, so each market's collateral factor is also its
liquidation threshold. `HF < 1` means the position is liquidatable.

- **Per-collateral liquidation price** — the price an asset must fall to for HF = 1.
- **Per-borrow liquidation price** — the price a borrowed asset must rise to for HF = 1.
- **Stress table** — HF and shortfall after a uniform downward shock to collateral prices.

## Setup

```bash
npm install
cp .env.example .env   # fill in values; never commit a real key
```

## Run locally

```bash
npm run dev            # watch mode (tsx)
# or
npm run build && npm start
```

- Health check: `GET http://localhost:8080/health`
- Agent card: `GET http://localhost:8080/.well-known/agent-card.json`
- Task endpoint: `POST http://localhost:8080/` (JSON-RPC 2.0)

## Sample request / response

```bash
curl -s http://localhost:8080/ \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "preview",
    "params": {
      "position": [
        { "symbol": "BNB",  "kind": "collateral", "amount": 10,   "priceUsd": 600, "collateralFactor": 0.8 },
        { "symbol": "USDT", "kind": "borrow",     "amount": 2000, "priceUsd": 1 }
      ],
      "shocks": [0.1, 0.2, 0.3]
    }
  }'
```

```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "schema": "waterline.report.v1",
    "chainId": 56,
    "protocol": "venus-core",
    "healthFactor": "2.4000",
    "liquidatable": false,
    "weightedCollateralUsd": "4800.00",
    "totalBorrowUsd": "2000.00",
    "assets": [
      { "symbol": "BNB", "kind": "collateral", "liquidationPriceUsd": "250", "bufferPct": "58.33", "note": "Liquidates if price falls to liquidationPriceUsd" },
      { "symbol": "USDT", "kind": "borrow", "liquidationPriceUsd": "2.4", "bufferPct": "140.00" }
    ],
    "stress": [
      { "collateralShockPct": "10.0", "healthFactor": "2.1600", "liquidatable": false },
      { "collateralShockPct": "20.0", "healthFactor": "1.9200", "liquidatable": false },
      { "collateralShockPct": "30.0", "healthFactor": "1.6800", "liquidatable": false }
    ],
    "verdict": "Health factor 2.4000 — comfortable buffer. Not currently liquidatable.",
    "dataSources": [ /* source + block + timestamp per value */ ],
    "assumptions": [ /* ... */ ],
    "limitations": [ /* ... */ ],
    "disclaimer": "Waterline is a read-only, point-in-time risk estimate ..."
  }
}
```

To analyze a live account instead of an explicit position, set
`VENUS_COMPTROLLER_ADDRESS` (verified against docs.venus.io) and call with
`{ "account": "0x..." }`.

## Tests

```bash
npm test          # vitest: engine math, oracle scaling, validation, server
npm run typecheck
```

## Security posture

- Default **read-only**: only `eth_call` reads; never sends a transaction.
- The agent never holds a buyer's key. Its only signing is off-chain EIP-712 over
  its own price quote with `AGENT_PRIVATE_KEY`, which is **never printed, logged,
  or stored**. Logs redact it.
- Secrets live only in environment variables; `.env.example` has placeholders.
- Contract addresses are configured and must be verified — none are invented.
- Input validation, per-IP rate limits, request timeouts, and deterministic
  error codes on every path.

## Chains

- **Identity:** ERC-8004 registration on **BNB Smart Chain Testnet (chain 97)**.
- **Payment/escrow:** settles on **chain 97** in a test token (no real value);
  the EIP-712 quote is priced in that token and its signing domain is bound to
  `chainId: 97`.
- **Analysis subject:** Venus positions on **BNB Smart Chain mainnet (chain 56)**.

## License

MIT
