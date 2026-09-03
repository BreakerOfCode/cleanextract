# CleanExtract

CleanExtract converts public HTML or a public URL into token-dense Markdown for AI agents. The repository contains a dependency-free Cloudflare Worker, a Streamable HTTP MCP transport, a REST endpoint, tests, and small Python and TypeScript clients.

## Hosted endpoints

- MCP: `https://extract.getstringer.app/mcp`
- REST: `https://extract.getstringer.app/v1/execute`
- MCP tool: `clean_extract`

Both paid surfaces charge USD 0.05 per successful extraction through x402 v2 USDC on Base (`eip155:8453`). An unpaid call returns HTTP `402` with the accepted payment requirement in `PAYMENT-REQUIRED`. A settled call returns HTTP `200` with a settlement receipt in `PAYMENT-RESPONSE`.

## Install and run locally

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

## MCP

Use Streamable HTTP at `https://extract.getstringer.app/mcp`. Clients must send both `application/json` and `text/event-stream` in `Accept`. The server implements `initialize`, `ping`, `tools/list`, and `tools/call` for `clean_extract`.

## Deployment

Review `wrangler.toml`, configure any secret and KV bindings in the destination Cloudflare account, and run `npx wrangler deploy`. The repository config intentionally contains no account ID or custom-domain route.

## License

MIT. See `LICENSE`.
