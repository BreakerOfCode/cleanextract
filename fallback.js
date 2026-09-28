function unescapeHtml(str) {
  if (!str) return "";
  return str.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
}

export const SHELL_CONTENT_FLOOR_BYTES = 280;

const ARTICLE_TYPES = new Set(["Article", "NewsArticle", "BlogPosting", "Report", "WebPage"]);
const encoder = new TextEncoder();

function plainText(value) {
  if (typeof value !== "string") return "";
  return unescapeHtml(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function usable(source, paragraphs) {
  const markdown = paragraphs.filter(Boolean).join("\n\n");
  return encoder.encode(markdown).length >= SHELL_CONTENT_FLOOR_BYTES
    ? { source, markdown } : null;
}

function scripts(rawHtml) {
  return rawHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
}

function attribute(attributes, name) {
  return attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] ?? "";
}

function articleParagraphs(value, output) {
  if (Array.isArray(value)) {
    for (const item of value) articleParagraphs(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  if (types.some((type) => ARTICLE_TYPES.has(type))) {
    const heading = plainText(value.headline);
    const body = plainText(value.articleBody) || plainText(value.text) || plainText(value.description);
    if (heading) output.push(`# ${heading}`);
    if (body) output.push(body);
  }
  if (value["@graph"]) articleParagraphs(value["@graph"], output);
}

function longStrings(value, output, seen) {
  if (typeof value === "string") {
    const paragraph = plainText(value);
    if (paragraph.length >= 80 && !/^https?:\/\//i.test(paragraph) && !seen.has(paragraph)) {
      seen.add(paragraph);
      output.push(paragraph);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) longStrings(item, output, seen);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) longStrings(item, output, seen);
  }
}

export function structuredText(rawHtml) {
  if (typeof rawHtml !== "string" || !rawHtml) return null;
  const blocks = [...scripts(rawHtml)];
  const articles = [];
  for (const [, attributes, body] of blocks) {
    if (attribute(attributes, "type").toLowerCase() !== "application/ld+json") continue;
    try { articleParagraphs(JSON.parse(body), articles); } catch { /* Skip malformed data. */ }
  }
  const jsonLd = usable("json_ld", articles);
  if (jsonLd) return jsonLd;

  for (const [, attributes, body] of blocks) {
    if (attribute(attributes, "id") !== "__NEXT_DATA__") continue;
    try {
      const paragraphs = [];
      longStrings(JSON.parse(body)?.props?.pageProps, paragraphs, new Set());
      const next = usable("next_data", paragraphs);
      if (next) return next;
    } catch { /* Skip malformed data. */ }
  }

  for (const [, , body] of blocks) {
    const assignment = /^\s*window\.__NUXT__\s*=\s*([\s\S]*?)\s*;?\s*$/.exec(body);
    if (!assignment) continue;
    try {
      const paragraphs = [];
      longStrings(JSON.parse(assignment[1]), paragraphs, new Set());
      const nuxt = usable("nuxt_data", paragraphs);
      if (nuxt) return nuxt;
    } catch { /* A JavaScript object literal is not JSON. */ }
  }
  return null;
}
