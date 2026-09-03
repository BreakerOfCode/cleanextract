import assert from "node:assert/strict";
import test from "node:test";

import cleanExtractWorker, {
  BASE_NETWORK,
  cleanHtmlToMarkdown,
  makePaymentRequirements,
  safeFetch,
} from "./worker.js";

const MCP_ACCEPT = "application/json, text/event-stream";

function mcpRequest(body, headers = {}) {
  return new Request("https://extract.getstringer.app/mcp", {
    method: "POST",
    headers: {
      Accept: MCP_ACCEPT,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function restRequest(body, headers = {}) {
  return new Request("https://extract.getstringer.app/v1/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function base64Json(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function validPaymentPayload() {
  const accepted = makePaymentRequirements(0.05);
  return {
    x402Version: 2,
    accepted,
    payload: {
      signature: `0x${"2".repeat(130)}`,
      authorization: {
        from: `0x${"3".repeat(40)}`,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"4".repeat(64)}`,
      },
    },
  };
}

test("HTML extraction preserves tables and source metadata", () => {
  const html = `
    <html lang="en"><head>
      <title>Example</title>
      <meta name="description" content="Example description">
      <link rel="canonical" href="/canonical">
    </head><body>
      <table><tr><th>Name</th><th>Value</th></tr>
      <tr><td>alpha</td><td>1</td></tr></table>
    </body></html>`;

  const result = cleanHtmlToMarkdown(html, "https://example.com/source");
  assert.match(result.markdown, /\| Name \| Value \|/);
  assert.match(result.markdown, /\| alpha \| 1 \|/);
  assert.equal(result.metadata.description, "Example description");
  assert.equal(result.metadata.canonical_url, "https://example.com/canonical");
});

test("MCP initialize and tools/list expose one Streamable HTTP tool", async () => {
  const initialize = await cleanExtractWorker.fetch(mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  }), {}, {});
  assert.equal(initialize.status, 200);
  const initialized = await initialize.json();
  assert.equal(initialized.result.serverInfo.name, "cleanextract");
  assert.equal(initialized.result.protocolVersion, "2025-11-25");

  const list = await cleanExtractWorker.fetch(mcpRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  }), {}, {});
  const listed = await list.json();
  assert.deepEqual(listed.result.tools.map(({ name }) => name), ["clean_extract"]);
});

test("MCP rejects an unsupported browser origin", async () => {
  const response = await cleanExtractWorker.fetch(mcpRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "initialize",
    params: {},
  }, { Origin: "https://attacker.example" }), {}, {});
  assert.equal(response.status, 403);
});

test("REST validates input before asking for payment", async () => {
  const response = await cleanExtractWorker.fetch(restRequest({ query: "https://example.com" }), {}, {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /url_or_html/);
});

test("unpaid REST calls receive an x402 v2 Base USDC challenge", async () => {
  const response = await cleanExtractWorker.fetch(restRequest({
    url_or_html: "<h1>Hello</h1>",
  }), {}, {});
  assert.equal(response.status, 402);
  const challenge = JSON.parse(
    Buffer.from(response.headers.get("payment-required"), "base64").toString("utf8"),
  );
  assert.equal(challenge.x402Version, 2);
  assert.equal(challenge.accepts[0].network, BASE_NETWORK);
  assert.equal(challenge.accepts[0].amount, "50000");
});

test("legacy transaction-hash proofs are rejected", async () => {
  const response = await cleanExtractWorker.fetch(restRequest({
    url_or_html: "<h1>Hello</h1>",
  }, { "X-402-Payment-Proof": `0x${"0".repeat(64)}` }), {}, {});
  assert.equal(response.status, 402);
  assert.match((await response.json()).error, /Legacy transaction-hash proofs are not accepted/);
});

test("public redirects to loopback are blocked before the second fetch", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), redirect: init?.redirect });
    return new Response(null, {
      status: 302,
      headers: { Location: "http://127.0.0.1/admin" },
    });
  };

  try {
    await assert.rejects(
      safeFetch("https://public.example/start"),
      /SSRF blocked: Loopback IP address forbidden/,
    );
    assert.deepEqual(calls, [{ url: "https://public.example/start", redirect: "manual" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("valid x402 authorization is verified, settled, and receipted", async () => {
  const paymentPayload = validPaymentPayload();
  const transaction = `0x${"5".repeat(64)}`;
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).endsWith("/verify")) {
      return Response.json({ isValid: true, payer: paymentPayload.payload.authorization.from });
    }
    return Response.json({
      success: true,
      transaction,
      network: BASE_NETWORK,
      payer: paymentPayload.payload.authorization.from,
    });
  };

  try {
    const response = await cleanExtractWorker.fetch(restRequest({
      url_or_html: "<h1>Paid</h1><p>Result</p>",
    }, { "PAYMENT-SIGNATURE": base64Json(paymentPayload) }), {
      X402_FACILITATOR_URL: "https://facilitator.example",
    }, {});

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/verify$/);
    assert.match(calls[1].url, /\/settle$/);
    const receipt = JSON.parse(
      Buffer.from(response.headers.get("payment-response"), "base64").toString("utf8"),
    );
    assert.equal(receipt.success, true);
    assert.equal(receipt.transaction, transaction);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
