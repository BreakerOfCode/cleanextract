# CleanExtract

CleanExtract gives agents a free page outline, then extracts a full page or selected sections as Markdown. The repository contains a dependency-free Cloudflare Worker, a Streamable HTTP MCP transport, REST endpoints, tests, and small Python and TypeScript clients.

## Hosted endpoints

- MCP: `https://extract.getstringer.app/mcp`
- REST: `https://extract.getstringer.app/v1/execute`
- Free outline: `https://extract.getstringer.app/v1/outline`
- Buy card credits: `https://extract.getstringer.app/buy`
- MCP tools: `clean_extract` and `clean_extract_outline`
- Discovery: `/.well-known/agent-card.json`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`

The outline is free and spends no allowance. The first three usable extraction calls are free, total. They require no signup or claim header, and the allowance does not reset. After those calls, both extraction surfaces charge USD 0.05 only when they return usable content through x402 v2 USDC on Base (`eip155:8453`). On the hosted service, a card buyer can instead buy 200 credits for USD 10 at `https://extract.getstringer.app/buy`. A usable extraction spends 1 credit, and the bundle is spendable across Stringer services. An unpaid call after the allowance is exhausted returns HTTP `402` with the accepted payment requirement in `PAYMENT-REQUIRED`. An unusable result is not charged and names `upstream_timeout`, `upstream_http_error`, `bot_challenge`, `js_shell`, `empty_extraction`, or `sections_not_found`. A recovered article names `fallback_used` as `json_ld`, `next_data`, or `nuxt_data`. CleanExtract does not run JavaScript. A settled call returns HTTP `200` with a receipt in `PAYMENT-RESPONSE`. `/server.json` is deliberately not served.

Hosted contract verified 2026-09-05: the header-free REST request below returned HTTP `200`, `X-Stringer-Access-Tier: free`, and `X-Stringer-Free-Remaining: 2`. The legacy `X-Stringer-Free-Allowance: claim` header is accepted for compatibility but is not required.

## Install and run locally

The reference implementation charges through x402 only; card credits are a feature of the hosted service at `extract.getstringer.app`.

Requirements: Node.js 20 or newer and Wrangler 4.

```bash
git clone https://github.com/BreakerOfCode/cleanextract.git
cd cleanextract
npx wrangler dev
```

The committed `X402_FACILITATOR_URL` is public configuration. If the selected facilitator requires credentials, store them as a Worker secret. Do not commit the value:

```bash
npx wrangler secret put X402_FACILITATOR_AUTHORIZATION
```

`FREE_TIER_LIMITER` is the included SQLite-backed Durable Object binding. It records up to three claims per caller, keyed by an HMAC of the Cloudflare-provided address rather than the address itself. Set that key before deploying, or the free tier stays closed and every call falls through to the x402 challenge:

```bash
npx wrangler secret put FREE_TIER_HASH_KEY
```

Rotating the key discards the existing mapping, which grants every caller a fresh allowance and makes stored fingerprints inert.

`PROCESSED_PROOFS` is an optional KV binding used as defense in depth for redeemed nonces. EIP-3009 settlement remains the authoritative replay defense.

## Test

```bash
node --test test_discovery.mjs test_cleanextract_worker.mjs
python3 -m py_compile client_sdk.py
```

## REST

Request:

```bash
curl -i https://extract.getstringer.app/v1/execute \
  -H 'Content-Type: application/json' \
  --data '{"url_or_html":"https://example.com"}'
```

Raw HTML is also accepted through `url_or_html`. See `openapi.json` and `RECIPES.md` for the response and payment flow.

The first three usable extraction requests return HTTP `200` with `X-Stringer-Access-Tier: free` and `X-Stringer-Free-Remaining`. The next one returns the x402 challenge. Use `POST /v1/outline` first to see section ids, byte sizes, and a fingerprint without page text. Pass `sections` to `/v1/execute` to fetch selected sections. A byte ceiling drops whole trailing sections and reports `output_bounds.sections_dropped`. The allowance is metered per network address using `CF-Connecting-IP`, which Cloudflare supplies; callers do not set a claim header.

## MCP

Use Streamable HTTP at `https://extract.getstringer.app/mcp`. Clients must send both `application/json` and `text/event-stream` in `Accept`. The server implements `initialize`, `ping`, `tools/list`, and `tools/call` for `clean_extract` and `clean_extract_outline`.

## Deployment

Review `wrangler.toml`, configure any secret and KV bindings in the destination Cloudflare account, and run `npx wrangler deploy`. The repository config intentionally contains no account ID or custom-domain route.

## License

MIT. See `LICENSE`.
