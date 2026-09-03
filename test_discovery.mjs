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
  assert.equal((sitemapBody.match(/<url>/g) || []).length, 3);
  assert.match(sitemapBody, /https:\/\/extract\.getstringer\.app\/llms\.txt/);

  const llms = await fetchPath("/llms.txt");
  assert.equal(llms.status, 200);
  const llmsBody = await llms.text();
  assert.match(llmsBody, /^# CleanExtract/m);
  assert.match(llmsBody, /USD 0\.05 per successful extraction/);
  assert.match(llmsBody, /https:\/\/extract\.getstringer\.app\/mcp/);
  assert.doesNotMatch(llmsBody, /\b(?:revenue|traction|customer|self-dealt|David)\b/i);

  for (const path of ["/robots.txt", "/sitemap.xml", "/llms.txt"]) {
    const head = await fetchPath(path, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  }
});
