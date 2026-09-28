# CleanExtract recipes

The hosted REST and MCP surfaces give three usable extraction calls free, total, with no signup or claim header. The allowance does not reset. Later usable extractions cost USD 0.05 through x402 v2 USDC on Base.

The outline is free. An extraction call is charged only when it returns usable content. Named failures are `upstream_timeout` (504), `upstream_http_error` (502), `bot_challenge`, `js_shell`, `empty_extraction`, and `sections_not_found` (422). Every named failure includes `status`, `reason`, and `charged: false`. A structured-data recovery names `fallback_used` as `json_ld`, `next_data`, or `nuxt_data`.

## Outline first, then fetch two sections

```bash
curl -s https://extract.getstringer.app/v1/outline \
  -H 'Content-Type: application/json' \
  --data '{"url_or_html":"https://example.com/article"}'
```

The Worker returns `status: "ok"`, `title`, `total_bytes`, a SHA-256 `fingerprint`, and `sections` containing `id`, `level`, `heading`, and `bytes`. A scratch `worker.fetch` run on 2026-09-25 returned section ids `s1` through `s4` and a `fingerprint` of `4c9b2b715ad98da587de167c9b82f1f36837134728eb55be2d058a009a85c597` for its HTML fixture. An unrecoverable app shell returned HTTP `422` with `{"status":"js_shell","reason":"The page returned an app shell that needs JavaScript to render; CleanExtract does not run JavaScript.","charged":false}`. A recoverable Next.js shell returned an outline with `fallback_used: "next_data"`.

Use two ids from the outline against the same page:

```bash
curl -s https://extract.getstringer.app/v1/execute \
  -H 'Content-Type: application/json' \
  --data '{"url_or_html":"https://example.com/article","sections":["s2","s3"]}'
```

A successful response includes `status: "success"`, `clean_markdown`, `fingerprint`, `sections_returned`, and `sections_missing`. When the scratch call supplied `max_output_bytes: 200`, the Worker returned `sections_returned: ["s2"]`, `sections_missing: []`, and `output_bounds.sections_dropped: ["s3"]`. No section body was cut midway. Compare fingerprints if the page may have changed between calls.

## Use the free REST allowance

```bash
curl -i https://extract.getstringer.app/v1/execute \
  -H 'Content-Type: application/json' \
  --data '{"url_or_html":"https://example.com"}'
```

The first three usable extraction calls return HTTP `200`. `X-Stringer-Free-Remaining` reports how many calls remain. The next extraction call returns HTTP `402` with a base64-encoded x402 v2 challenge in `PAYMENT-REQUIRED`. After a payer signs the accepted requirement, repeat the request with the signed payload:

```bash
curl -i https://extract.getstringer.app/v1/execute \
  -H 'Content-Type: application/json' \
  -H 'PAYMENT-SIGNATURE: <base64-x402-v2-payload>' \
  --data '{"url_or_html":"<h1>Hello</h1><p>World</p>"}'
```

A settled response is HTTP `200` and includes `PAYMENT-RESPONSE`.

## Inspect the MCP server

```bash
curl -i https://extract.getstringer.app/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

The MCP tool is `clean_extract`. Its required argument is `url_or_html`. The first three REST or MCP tool calls share one free allowance. Later `tools/call` requests use the same `PAYMENT-SIGNATURE` header and x402 flow as REST.

## Python client

```python
from client_sdk import CleanExtractClient, PaymentRequired

client = CleanExtractClient()
try:
    result = client.execute("https://example.com")
except PaymentRequired as payment:
    challenge = payment.challenge
    # Sign challenge["accepts"][0] with an x402 v2-compatible payer.
```

## TypeScript client

```typescript
import { CleanExtractClient } from "./client_sdk";

const client = new CleanExtractClient();
const challenge = await client.execute({ urlOrHtml: "https://example.com" });
if (challenge.status === 402) {
  // Decode challenge.paymentRequired, sign the accepted requirement, then retry.
}
```
