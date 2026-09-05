import assert from "node:assert/strict";
import test from "node:test";

import cleanExtractWorker, {
  BASE_NETWORK,
  FreeTierLimiter,
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

function freeTierEnvironment(initialUsed = 0) {
  const claimsByCaller = new Map();
  const finalized = [];
  return {
    finalized,
    FREE_TIER_LIMITER: {
      getByName(callerHash) {
        if (!claimsByCaller.has(callerHash)) claimsByCaller.set(callerHash, initialUsed);
        return {
          async fetch(url, init) {
            const pathname = new URL(url).pathname;
            const body = JSON.parse(init.body);
            if (pathname === "/claim") {
              const used = claimsByCaller.get(callerHash);
              if (used >= 3) {
                return Response.json({ allowed: false, remaining: 0, reset_at: null });
              }
              claimsByCaller.set(callerHash, used + 1);
              return Response.json({
                allowed: true,
                receipt_id: crypto.randomUUID(),
                remaining: 3 - used - 1,
              });
            }
            if (pathname === "/finalize") {
              finalized.push(body);
              return Response.json({ stored: true });
            }
            return Response.json({ error: "Not Found" }, { status: 404 });
          },
        };
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

test("discovery paths reject an unsupported browser origin before route handling", async () => {
  for (const route of ["/robots.txt", "/sitemap.xml", "/llms-full.txt"]) {
    const response = await cleanExtractWorker.fetch(new Request(
      `https://extract.getstringer.app${route}`,
      { headers: { Origin: "https://attacker.example" } },
    ), {}, {});

    assert.equal(response.status, 403, route);
    assert.equal(response.headers.get("access-control-allow-origin"), null, route);
    assert.equal(response.headers.get("vary"), "Origin", route);
    assert.deepEqual(await response.json(), { error: "Forbidden Origin" }, route);
  }
});

test("REST validates input before asking for payment", async () => {
  const response = await cleanExtractWorker.fetch(restRequest({ query: "https://example.com" }), {}, {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /url_or_html/);
});

test("first free REST call succeeds without a claim header or signup", async () => {
  const env = freeTierEnvironment();
  const response = await cleanExtractWorker.fetch(restRequest({
    url_or_html: "<h1>Free</h1><p>Result</p>",
  }, { "CF-Connecting-IP": "198.51.100.10" }), env, {});

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Stringer-Access-Tier"), "free");
  assert.equal(response.headers.get("X-Stringer-Free-Remaining"), "2");
  assert.equal(response.headers.get("PAYMENT-RESPONSE"), null);
  const result = await response.json();
  assert.equal(result.provenance.payment_verified, false);
  assert.equal(result.provenance.settlement_rail, null);
  assert.equal(env.finalized.length, 1);
});

test("first free MCP tool call succeeds without a claim header or signup", async () => {
  const env = freeTierEnvironment();
  const response = await cleanExtractWorker.fetch(mcpRequest({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "clean_extract",
      arguments: { url_or_html: "<h1>Free MCP</h1>" },
    },
  }, { "CF-Connecting-IP": "198.51.100.11" }), env, {});

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Stringer-Access-Tier"), "free");
  assert.equal(response.headers.get("X-Stringer-Free-Remaining"), "2");
  const result = await response.json();
  assert.match(result.result.content[0].text, /Free MCP/);
});

test("the fourth unpaid call receives the exhausted-allowance x402 challenge", async () => {
  const env = freeTierEnvironment();
  const headers = { "CF-Connecting-IP": "198.51.100.12" };
  for (const remaining of ["2", "1", "0"]) {
    const response = await cleanExtractWorker.fetch(restRequest({
      url_or_html: "<p>Free allowance</p>",
    }, headers), env, {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-Stringer-Free-Remaining"), remaining);
  }

  const response = await cleanExtractWorker.fetch(restRequest({
    url_or_html: "<p>Paid next</p>",
  }, headers), env, {});
  assert.equal(response.status, 402);
  assert.equal(response.headers.get("X-Stringer-Free-Remaining"), "0");
  const challenge = await response.json();
  assert.match(challenge.error, /Free allowance exhausted: 3 free calls per source IP, total/);
  assert.match(challenge.error, /allowance does not reset/);
  assert.equal(challenge.accepts[0].amount, "50000");
});

test("FreeTierLimiter persists at most three claims in a caller Durable Object", async () => {
  const rows = [];
  const state = {
    blockConcurrencyWhile(callback) {
      return callback();
    },
    storage: {
      transactionSync(callback) {
        return callback();
      },
      sql: {
        exec(statement, ...values) {
          if (statement.includes("CREATE TABLE")) return {};
          if (statement.startsWith("SELECT COUNT")) {
            return { one: () => ({ count: rows.length }) };
          }
          if (statement.startsWith("INSERT INTO")) {
            rows.push(values);
            return {};
          }
          if (statement.startsWith("UPDATE")) return {};
          throw new Error(`Unexpected SQL in test: ${statement}`);
        },
      },
    },
  };
  const limiter = new FreeTierLimiter(state, {});
  const claim = () => limiter.fetch(new Request("https://free-tier.internal/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caller_hash: "a".repeat(64), transport: "rest" }),
  }));

  for (const remaining of [2, 1, 0]) {
    const response = await claim();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      allowed: true,
      receipt_id: rows.at(-1)[0],
      remaining,
    });
  }
  const exhausted = await claim();
  assert.deepEqual(await exhausted.json(), { allowed: false, remaining: 0, reset_at: null });
  assert.equal(rows.length, 3);
});

test("unpaid REST calls without an identifiable source receive an x402 v2 Base USDC challenge", async () => {
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
