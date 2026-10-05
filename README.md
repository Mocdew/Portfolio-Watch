# Waterline

Evidence-first **portfolio rebalancing** and **liquidation-risk analysis** for
on-chain wallets, with a focus on [Venus Protocol](https://venus.io) Core-pool
positions on **BNB Smart Chain (chain 56)**. Built as an
[A2A](https://a2a-protocol.org) agent for the [Pokter](https://pokter.xyz)
marketplace (category: **rebalancing**).

Two skills:

- **`rebalance`** — give it a wallet portfolio (holdings with amounts, prices,
  and target weights) and a **drift threshold**, and it returns a **rebalancing
  plan**: which assets to buy or sell, the exact trade sizes, the resulting
  turnover, and whether the drift band is breached at all.
- **`preview`** — give it a Venus lending position (explicit collateral/debt
  legs, or a BSC account address) and it returns the **health factor**, the
  **exact liquidation price per asset**, the **% buffer**, and a **price-shock
  stress table**, every number stamped with its on-chain source and block.

**Read-only. It proposes trades, executes nothing, and never moves funds.** Its
only signature is an off-chain EIP-712 price quote signed with the agent's own
wallet.

> **Status:** the rebalancing engine (`rebalance`) and the dry-run risk engine
> (`preview`) are complete and tested. The paid `negotiate` / `notify_funded`
> skills and the on-chain (ERC-8183) delivery are being wired against the Pokter
> reference agent-card contract and are not published in the card until
> confirmed. The on-chain account-read path (`venus.ts`) is implemented but
> marked **LIVE-VERIFICATION REQUIRED** — the explicit-input skills need no RPC
> and are fully tested.

## What it computes

### Rebalancing (`rebalance`)

Each holding's current weight is its USD value over the portfolio total. A
rebalance is proposed **only** when some asset's weight drifts from its target
by more than the drift threshold (in percentage points). When triggered, every
asset is traded back to its exact target weight, so buys net against sells.

```
driftᵢ = currentWeightᵢ − targetWeightᵢ        # rebalance if max |driftᵢ| > threshold
tradeᵢ = totalValue × targetWeightᵢ − valueᵢ    # + buy, − sell
```

### Liquidation risk (`preview`)

```
Health factor (HF) = Σ(collateralᵢ × priceᵢ × collateralFactorᵢ) / Σ(borrowⱼ × priceⱼ)
```

Venus is a Compound fork, so each market's collateral factor is also its
liquidation threshold. `HF < 1` means the position is liquidatable.

- **Per-collateral liquidation price** — the price an asset must fall to for HF = 1.
- **Per-borrow liquidation price** — the price a borrowed asset must rise to for HF = 1.
- **Stress table** — HF and shortfall after a uniform downward shock to collateral prices.

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

## Deploy

The service is a single stateless HTTP process — no database, no disk state —
so it deploys as one container and scales horizontally behind any router. It
reads `PORT` from the environment (default `8080`) and binds `0.0.0.0`, so it
works unchanged on platforms that inject a port.

### Docker

```bash
docker build -t waterline:latest .
docker run --rm -p 8080:8080 --env-file .env waterline:latest
```

The image is multi-stage (build → prod deps → runtime), runs as a non-root
`node` user, and has a built-in `HEALTHCHECK` against `/health`.

### Render (Blueprint)

This repo ships a `render.yaml`, so Render builds the `Dockerfile` for you:

1. Push the repo to GitHub.
2. In Render: **New → Blueprint**, select the repo, and apply.
3. That's it. The blueprint sets `TRUST_PROXY=true` and health-checks
   `/health`, Render injects `PORT`, and `PUBLIC_URL` is auto-derived from
   Render's `RENDER_EXTERNAL_URL` so the agent card advertises the correct
   `https://<service>.onrender.com` address — no manual step.

Override `PUBLIC_URL` in the dashboard only if you add a custom domain. The
not-yet-published paid path needs extra secrets (`AGENT_PRIVATE_KEY`, etc.) —
add those as **secret** env vars in the Render dashboard when you enable it,
never in `render.yaml`. On the free plan the service spins down when idle, so
the first request after a lull is slow; use a paid plan to keep it warm.

### Any other container platform (Fly.io, Railway, Cloud Run, ECS, Kubernetes…)

1. Build and push the image (or point the platform at this repo + `Dockerfile`).
2. Set environment variables — at minimum:
   - `PUBLIC_URL` — the public **HTTPS** base URL the service is reachable at.
     The agent card (`/.well-known/agent-card.json`) advertises this, so A2A
     clients must see the real address, not `localhost`.
   - `TRUST_PROXY=true` — these platforms terminate TLS and forward over a
     proxy, so this is required for the per-IP rate limiter to see the real
     client IP.
   - Any analysis/identity values you use (`VENUS_COMPTROLLER_ADDRESS`,
     `AGENT_ADDRESS`, `AGENT_PRIVATE_KEY`, payment/quote vars). Inject secrets
     through the platform's secret store — never bake them into the image.
3. Point the platform's health check at `GET /health`.
4. Expose the container's port (`8080` unless you override `PORT`).

### Notes

- **TLS:** terminate HTTPS at the platform/proxy; the app speaks plain HTTP
  behind it. A2A agent cards are expected to be served over HTTPS.
- **Secrets:** `AGENT_PRIVATE_KEY` is read only from the environment and is
  redacted from logs — keep it in a secret manager, out of the image and repo.
- **Config check:** `GET /health` returns `signingReady`, which is `true` only
  once every value needed to sign a payable quote is present.

## Sample: `rebalance`

```bash
curl -s http://localhost:8080/ \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "rebalance",
    "params": {
      "portfolio": [
        { "symbol": "BNB",  "amount": 10,   "priceUsd": 600, "targetWeight": 0.5 },
        { "symbol": "USDT", "amount": 4000, "priceUsd": 1,   "targetWeight": 0.5 }
      ],
      "driftThreshold": 0.05
    }
  }'
```

```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "schema": "waterline.rebalance.v1",
    "chainId": 56,
    "policy": { "type": "drift-threshold", "driftThresholdPct": "5.00" },
    "portfolioValueUsd": "10000.00",
    "rebalanceRequired": true,
    "maxDriftPct": "10.00",
    "turnoverUsd": "1000.00",
    "turnoverPct": "10.00",
    "assets": [
      { "symbol": "BNB",  "currentWeightPct": "60.00", "targetWeightPct": "50.00", "driftPct": "10.00",  "breached": true, "action": "sell", "tradeUsd": "-1000.00", "tradeAmount": "-1.66666667" },
      { "symbol": "USDT", "currentWeightPct": "40.00", "targetWeightPct": "50.00", "driftPct": "-10.00", "breached": true, "action": "buy",  "tradeUsd": "1000.00",  "tradeAmount": "1000" }
    ],
    "verdict": "Rebalance recommended: max drift 10.00% exceeds the 5.00% threshold. Proposed turnover $1000.00.",
    "dataSources": [ /* source + chain per value */ ],
    "assumptions": [ /* ... */ ],
    "limitations": [ /* ... */ ],
    "disclaimer": "Waterline produces a read-only, point-in-time rebalancing plan ..."
  }
}
```

Omit `targetWeight` on every holding for an equal-weight target; omit
`driftThreshold` to use the 5% default.

## Sample: `preview`

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
