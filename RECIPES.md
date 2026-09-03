# CleanExtract recipes

The hosted REST and MCP surfaces charge USD 0.05 per successful extraction through x402 v2 USDC on Base.

## Inspect the REST payment challenge

```bash
curl -i https://extract.getstringer.app/v1/execute \
  -H 'Content-Type: application/json' \
  --data '{"url_or_html":"https://example.com"}'
```

The HTTP `402` response carries a base64-encoded x402 v2 challenge in `PAYMENT-REQUIRED`. After a payer signs the accepted requirement, repeat the request with the signed payload:

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

The MCP tool is `clean_extract`. Its required argument is `url_or_html`. A `tools/call` request uses the same `PAYMENT-SIGNATURE` header and x402 flow as REST.

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
