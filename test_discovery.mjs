import assert from "node:assert/strict";
import test from "node:test";

import cleanExtractWorker from "./worker.js";

async function fetchPath(path, method = "GET") {
  return cleanExtractWorker.fetch(
    new Request(`https://extract.getstringer.app${path}`, { method }),
    {},
    {},
  );
}

test("crawler and agent discovery surfaces describe the public product", async () => {
  const robots = await fetchPath("/robots.txt");
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get("content-type"), /^text\/plain/);
  assert.equal(
    await robots.text(),
    "User-agent: *\nAllow: /\nSitemap: https://extract.getstringer.app/sitemap.xml\n",
  );

  const sitemap = await fetchPath("/sitemap.xml");
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get("content-type"), /^application\/xml/);
  const sitemapBody = await sitemap.text();
  // Assert the actual set, not a count, so a surface cannot appear or vanish silently.
  const sitemapUrls = [...sitemapBody.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(sitemapUrls, [
    "https://extract.getstringer.app/",
    "https://extract.getstringer.app/info",
    "https://extract.getstringer.app/llms.txt",
  ]);

  // Every advertised surface must actually resolve, so the sitemap can never point
  // a crawler at a 404. Paths the reference deliberately does not serve are simply
  // not advertised here: /llms-full.txt is origin-guarded before route lookup on
  // purpose (KNOWLEDGE/buildlog/robots-txt-origin-inconsistency.md), not served.
  for (const advertised of sitemapUrls) {
    const served = await fetchPath(new URL(advertised).pathname);
    assert.equal(served.status, 200, `sitemap advertises ${advertised}`);
  }

  const llms = await fetchPath("/llms.txt");
  assert.equal(llms.status, 200);
  const llmsBody = await llms.text();
  assert.match(llmsBody, /^# CleanExtract/m);
  assert.match(llmsBody, /USD 0\.05 per usable extraction/);
  assert.match(llmsBody, /charged only when it returns usable content/);
  assert.match(llmsBody, /clean_extract_outline/);
  assert.match(llmsBody, /https:\/\/extract\.getstringer\.app\/mcp/);
  assert.doesNotMatch(llmsBody, /\b(?:revenue|traction|customer|self-dealt|David)\b/i);
  // The offer, never the metering: how the allowance is counted is not a selling point,
  // and naming it in discovery copy advertises how to rotate around it.
  assert.doesNotMatch(llmsBody, /source IP/);

  for (const path of ["/robots.txt", "/sitemap.xml", "/llms.txt"]) {
    const head = await fetchPath(path, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  }
});

test("the three well-known discovery paths are served and /server.json stays 404", async () => {
  const served = [
    "/.well-known/agent-card.json",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
  ];
  for (const path of served) {
    const response = await fetchPath(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type"), /^application\/json/, path);
    const body = await response.json();
    assert.equal(typeof body, "object", path);
  }

  for (const path of served) {
    const head = await fetchPath(path, "HEAD");
    assert.equal(head.status, 200, `${path} HEAD`);
    assert.equal(await head.text(), "", `${path} HEAD body`);
  }

  const absent = await fetchPath("/server.json");
  assert.equal(absent.status, 404, "/server.json must stay absent");
});
