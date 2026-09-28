import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.js";

const url = "https://fixture.example/article";
const page = `<html><head><title>Trail</title></head><body><article>
<h1>Trail</h1><p>The northern path passes the old bridge and runs along the lake. The public trail is marked at each crossing and has a map at the start.</p>
<h2>Route</h2><p>The route crosses the meadow and turns toward the southern lookout. Each branch has a sign and a distance marker for walkers.</p>
<h2>Supplies</h2><p>Carry water and a map. The final shop is beside the station, and the path has no other shops before the lookout.</p>
</article></body></html>`;

function env() {
  let used = 0;
  return { FREE_TIER_HASH_KEY: "reference-test-key", FREE_TIER_LIMITER: { getByName() { return { async fetch(target, init) {
    const path = new URL(target).pathname;
    if (path === "/claim") {
      if (used >= 3) return Response.json({ allowed: false, remaining: 0 });
      used += 1;
      return Response.json({ allowed: true, receipt_id: crypto.randomUUID(), remaining: 3 - used });
    }
    if (path === "/finalize") {
      if (JSON.parse(init.body).outcome === "not_charged") used -= 1;
      return Response.json({ stored: true });
    }
    return Response.json({}, { status: 404 });
  } }; } }, get used() { return used; } };
}

function request(path, body) {
  return new Request(`https://extract.getstringer.app${path}`, { method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.150" }, body: JSON.stringify(body) });
}

async function withPage(html, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (target) => {
    assert.equal(target, url);
    return new Response(html, { status: 200 });
  };
  try { return await fn(); } finally { globalThis.fetch = original; }
}

test("public reference outline and sections match the hosted response shape", async () => {
  const e = env();
  await withPage(page, async () => {
    const outlineResponse = await worker.fetch(request("/v1/outline", { url_or_html: url }), e);
    assert.equal(outlineResponse.status, 200);
    const outline = await outlineResponse.json();
    assert.equal(outline.status, "ok");
    assert.ok(outline.sections.length >= 3);
    assert.equal(e.used, 0);
    const ids = outline.sections.filter((s) => ["Route", "Supplies"].includes(s.heading)).map((s) => s.id);
    const response = await worker.fetch(request("/v1/execute", { url_or_html: url, sections: ids }), e);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.sections_returned, ids);
    assert.deepEqual(body.sections_missing, []);
    assert.equal(body.fingerprint, outline.fingerprint);
    assert.match(body.clean_markdown, /southern lookout/);
    assert.doesNotMatch(body.clean_markdown, /old bridge/);
    assert.equal(e.used, 1);
  });
});

test("public reference names an empty app shell and restores the free call", async () => {
  const e = env();
  await withPage('<html><title>Empty</title><div id="app"></div><noscript>Enable JavaScript</noscript></html>', async () => {
    const response = await worker.fetch(request("/v1/execute", { url_or_html: url }), e);
    assert.equal(response.status, 422);
    assert.equal(response.headers.get("X-Stringer-Free-Remaining"), "3");
    assert.deepEqual((({ status, charged }) => ({ status, charged }))(await response.json()), { status: "js_shell", charged: false });
    assert.equal(e.used, 0);
  });
});

test("public reference recovers article text from Next.js data", async () => {
  const article = "Volunteers recorded each reading along the river and checked the wetland stations after rain. ".repeat(5);
  const html = `<html><head><title>River Archive</title></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { article } } })}</script></body></html>`;
  await withPage(html, async () => {
    const response = await worker.fetch(request("/v1/outline", { url_or_html: url }), env());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.fallback_used, "next_data");
    assert.ok(body.sections.length > 0);
  });
});
