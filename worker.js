// HTML extraction and URL safety
function unescapeHtml(str) {
  if (!str) return "";
  return str.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
}
function plainText(html) {
  return unescapeHtml((html || "").replace(/<br\s*[\/]?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function escapeTableCell(value) {
  return plainText(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
function htmlTableToMarkdown(tableHtml) {
  const rows = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(tableHtml)) !== null) {
    const cells = [];
    let hasHeaderCell = false;
    const cellPattern = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
      hasHeaderCell = hasHeaderCell || cellMatch[1].toLowerCase() === "th";
      cells.push(escapeTableCell(cellMatch[2]));
    }
    if (cells.length > 0) rows.push({ cells, hasHeaderCell });
  }
  if (rows.length === 0) return "";
  const columnCount = Math.max(...rows.map((row) => row.cells.length));
  const normalize = (cells) => [...cells, ...Array(columnCount - cells.length).fill("")];
  const firstRowIsHeader = rows[0].hasHeaderCell;
  const header = firstRowIsHeader ? normalize(rows[0].cells) : Array(columnCount).fill("");
  const body = firstRowIsHeader ? rows.slice(1) : rows;
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${Array(columnCount).fill("---").join(" | ")} |`,
    ...body.map((row) => `| ${normalize(row.cells).join(" | ")} |`)
  ];
  return lines.join("\n");
}
function attributeValue(tag, attribute) {
  const match = tag.match(new RegExp(`${attribute}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? unescapeHtml(match[1].trim()) : null;
}
function metaContent(rawHtml, selectors) {
  const tags = rawHtml.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = (attributeValue(tag, "name") || attributeValue(tag, "property") || "").toLowerCase();
    if (selectors.includes(name)) {
      const content = attributeValue(tag, "content");
      if (content) return content;
    }
  }
  return null;
}
function extractHtmlMetadata(rawHtml, sourceUrl = null) {
  const titleMatch = (rawHtml || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const htmlTag = (rawHtml || "").match(/<html\b[^>]*>/i)?.[0] || "";
  const canonicalTag = (rawHtml || "").match(/<link\b[^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/i)?.[0] || (rawHtml || "").match(/<link\b[^>]*href\s*=\s*["'][^"']+["'][^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/i)?.[0] || "";
  const canonicalHref = attributeValue(canonicalTag, "href");
  let canonicalUrl = canonicalHref;
  if (canonicalHref && sourceUrl) {
    try {
      canonicalUrl = new URL(canonicalHref, sourceUrl).toString();
    } catch (error) {
      canonicalUrl = canonicalHref;
    }
  }
  return {
    title: titleMatch ? plainText(titleMatch[1]) : "Extracted Content",
    description: metaContent(rawHtml || "", ["description", "og:description", "twitter:description"]),
    author: metaContent(rawHtml || "", ["author", "article:author"]),
    published_time: metaContent(rawHtml || "", ["article:published_time", "date", "datepublished"]),
    language: attributeValue(htmlTag, "lang"),
    canonical_url: canonicalUrl || sourceUrl || null,
    site_name: metaContent(rawHtml || "", ["og:site_name"])
  };
}
function cleanHtmlToMarkdown(rawHtml, sourceUrl = null) {
  let text = rawHtml || "";
  const metadata = extractHtmlMetadata(text, sourceUrl);
  const tables = [];
  text = text.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (tableHtml) => {
    const placeholder = `CLEANEXTRACT_TABLE_PLACEHOLDER_${tables.length}`;
    tables.push(htmlTableToMarkdown(tableHtml));
    return `

${placeholder}

`;
  });
  const title = metadata.title;
  text = text.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, "");
  text = text.replace(/<(script|style|nav|footer|header|aside|iframe|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n");
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n");
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n");
  text = text.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, "\n\n#### $1\n\n");
  text = text.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, linkText) => {
    const cleanLinkText = linkText.replace(/<[^>]+>/g, "").trim();
    if (!cleanLinkText) return "";
    return `[${cleanLinkText}](${href})`;
  });
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1");
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n\n$1\n\n");
  text = text.replace(/<br\s*[\/]?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = unescapeHtml(text);
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const markdownBody = lines.join("\n\n");
  let finalMarkdown = sourceUrl ? `# ${title}

*Source: [${sourceUrl}](${sourceUrl})*

${markdownBody}` : `# ${title}

${markdownBody}`;
  tables.forEach((table, index) => {
    finalMarkdown = finalMarkdown.replace(`CLEANEXTRACT_TABLE_PLACEHOLDER_${index}`, table);
  });
  const rawBytes = rawHtml.length;
  const cleanBytes = finalMarkdown.length;
  const rawTokens = Math.max(1, Math.floor(rawBytes / 4));
  const cleanTokens = Math.max(1, Math.floor(cleanBytes / 4));
  const tokensSaved = Math.max(0, rawTokens - cleanTokens);
  const compressionRatio = `${Math.max(0, Math.round((1 - cleanBytes / Math.max(1, rawBytes)) * 100))}%`;
  return {
    title,
    markdown: finalMarkdown,
    tokens_saved: tokensSaved,
    compression_ratio: compressionRatio,
    raw_bytes: rawBytes,
    clean_bytes: cleanBytes,
    metadata
  };
}
function isSafePublicUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { safe: false, reason: "Unsupported protocol (only HTTP/HTTPS allowed)" };
    }
    const hostname = parsed.hostname.toLowerCase().trim();
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".lan") || hostname.endsWith(".home") || hostname.endsWith(".arpa") || hostname.endsWith(".corp")) {
      return { safe: false, reason: "Local/internal hostname access is forbidden" };
    }
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = hostname.match(ipv4Regex);
    if (ipMatch) {
      const o1 = parseInt(ipMatch[1], 10);
      const o2 = parseInt(ipMatch[2], 10);
      const o3 = parseInt(ipMatch[3], 10);
      const o4 = parseInt(ipMatch[4], 10);
      if ([o1, o2, o3, o4].some((octet) => octet < 0 || octet > 255)) {
        return { safe: false, reason: "Invalid IPv4 address" };
      }
      if (o1 === 0) return { safe: false, reason: "Access to 0.0.0.0/8 is forbidden" };
      if (o1 === 10) return { safe: false, reason: "Private RFC 1918 IP address forbidden" };
      if (o1 === 100 && o2 >= 64 && o2 <= 127) return { safe: false, reason: "Carrier-grade NAT IP address forbidden" };
      if (o1 === 127) return { safe: false, reason: "Loopback IP address forbidden" };
      if (o1 === 169 && o2 === 254) return { safe: false, reason: "Cloud metadata / link-local IP forbidden" };
      if (o1 === 172 && o2 >= 16 && o2 <= 31) return { safe: false, reason: "Private RFC 1918 IP address forbidden" };
      if (o1 === 192 && o2 === 0 && o3 === 0) return { safe: false, reason: "Reserved IP address forbidden" };
      if (o1 === 192 && o2 === 0 && o3 === 2 || o1 === 198 && o2 === 51 && o3 === 100 || o1 === 203 && o2 === 0 && o3 === 113) {
        return { safe: false, reason: "Test/documentation IP address forbidden" };
      }
      if (o1 === 192 && o2 === 168) return { safe: false, reason: "Private RFC 1918 IP address forbidden" };
      if (o1 >= 224) return { safe: false, reason: "Multicast or reserved IP address forbidden" };
    }
    if (hostname.includes(":")) {
      const hClean = hostname.replace(/^\[|\]$/g, "").toLowerCase();
      if (hClean === "::1" || hClean === "::" || hClean.startsWith("fc") || hClean.startsWith("fd") || hClean.startsWith("fe80") || hClean.startsWith("::ffff:")) {
        return { safe: false, reason: "Private/loopback IPv6 address forbidden" };
      }
    }
    return { safe: true, parsedUrl: parsed.toString() };
  } catch (e) {
    return { safe: false, reason: `Malformed URL: ${e.message}` };
  }
}
var REDIRECT_STATUSES = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
var ResponseSizeLimitError = class extends Error {
  constructor(maxResponseBytes) {
    super(`Upstream response exceeded ${maxResponseBytes}-byte limit`);
    this.name = "ResponseSizeLimitError";
    this.maxResponseBytes = maxResponseBytes;
  }
};
function responseWithByteLimit(response, maxResponseBytes) {
  const declaredBytes = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxResponseBytes) {
    response.body?.cancel().catch(() => {
    });
    throw new ResponseSizeLimitError(maxResponseBytes);
  }
  if (!response.body) return response;
  const reader = response.body.getReader();
  let receivedBytes = 0;
  const limitedBody = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        receivedBytes += value.byteLength;
        if (receivedBytes > maxResponseBytes) {
          const error = new ResponseSizeLimitError(maxResponseBytes);
          await reader.cancel(error).catch(() => {
          });
          controller.error(error);
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
  return new Response(limitedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}
async function safeFetch(urlString, init = {}, { maxRedirects = 5, maxResponseBytes } = {}) {
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
    throw new TypeError("maxRedirects must be a non-negative integer");
  }
  if (maxResponseBytes !== void 0 && (!Number.isInteger(maxResponseBytes) || maxResponseBytes <= 0)) {
    throw new TypeError("maxResponseBytes must be a positive integer");
  }
  let currentUrl = urlString;
  for (let hop = 0; ; hop += 1) {
    const safety = isSafePublicUrl(currentUrl);
    if (!safety.safe) {
      throw new Error(`SSRF blocked: ${safety.reason}`);
    }
    const response = await fetch(safety.parsedUrl, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) {
      return maxResponseBytes === void 0 ? response : responseWithByteLimit(response, maxResponseBytes);
    }
    const location = response.headers.get("Location");
    if (!location) {
      return response;
    }
    if (hop >= maxRedirects) {
      throw new Error(`Redirect limit exceeded (${maxRedirects})`);
    }
    await response.body?.cancel();
    currentUrl = new URL(location, safety.parsedUrl).toString();
  }
}

// MCP transport and CORS
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, PAYMENT-SIGNATURE, X-402-Payment-Proof, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
    "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE, WWW-Authenticate, X-402-Payment-Required, X-402-Price-USD, X-402-Network, X-402-Receiver-Address, X-402-Token-Contract, MCP-Protocol-Version"
  };
}
function validateMcpOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:"
      && parsed.hostname.toLowerCase() === "extract.getstringer.app";
  } catch (e) {
    return false;
  }
}
function forbiddenOriginResponse() {
  return new Response(JSON.stringify({ error: "Forbidden Origin" }), {
    status: 403,
    headers: {
      "Content-Type": "application/json",
      "Vary": "Origin"
    }
  });
}
function mcpJson(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
      ...extraHeaders
    }
  });
}
function mcpError(id, code, message, status = 400, data = null) {
  const error = { code, message };
  if (data !== null) {
    error.data = data;
  }
  return mcpJson({ jsonrpc: "2.0", id: id ?? null, error }, status);
}

// x402 v2 payment verification and settlement
var RECEIVER_ADDRESS = "0xAA2a4F7092d05E8e801fcF2711a5146702CCF9a1";
var USDC_CONTRACT_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
var BASE_NETWORK = "eip155:8453";
function encodeBase64Json(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function decodeBase64Json(value) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error("PAYMENT-SIGNATURE must contain base64-encoded JSON");
  }
}
function atomicUnits(priceUsd) {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error("Payment price must be a positive finite number");
  }
  return String(Math.round(priceUsd * 1e6));
}
function makePaymentRequirements(priceUsd) {
  return {
    scheme: "exact",
    network: BASE_NETWORK,
    amount: atomicUnits(priceUsd),
    asset: USDC_CONTRACT_ADDRESS,
    payTo: RECEIVER_ADDRESS,
    maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" }
  };
}
function sameAddress(left, right) {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}
function validateV2Payload(paymentPayload, requirements) {
  if (!paymentPayload || paymentPayload.x402Version !== 2) return "Unsupported x402 version";
  if (!paymentPayload.payload || typeof paymentPayload.payload !== "object") return "Missing x402 payment payload";
  const accepted = paymentPayload.accepted;
  if (!accepted || typeof accepted !== "object") return "Missing accepted payment requirements";
  if (accepted.scheme !== requirements.scheme) return "Payment scheme mismatch";
  if (accepted.network !== requirements.network) return "Payment network mismatch";
  if (String(accepted.amount) !== requirements.amount) return "Payment amount mismatch";
  if (!sameAddress(accepted.asset, requirements.asset)) return "Payment asset mismatch";
  if (!sameAddress(accepted.payTo, requirements.payTo)) return "Payment recipient mismatch";
  const authorization = paymentPayload.payload.authorization;
  if (!authorization || typeof authorization !== "object") return "Missing EIP-3009 authorization";
  if (!sameAddress(authorization.to, requirements.payTo)) return "Authorization recipient mismatch";
  if (String(authorization.value) !== requirements.amount) return "Authorization amount mismatch";
  if (!/^0x[a-fA-F0-9]{64}$/.test(authorization.nonce || "")) return "Malformed EIP-3009 nonce";
  if (!/^0x[a-fA-F0-9]{130}$/.test(paymentPayload.payload.signature || "")) return "Malformed EIP-712 signature";
  return null;
}
function facilitatorConfig(env) {
  const rawUrl = env?.X402_FACILITATOR_URL;
  if (!rawUrl) return { error: "Base mainnet x402 facilitator is not configured" };
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return { error: "x402 facilitator URL must use HTTPS" };
    return { url: parsed.toString().replace(/\/$/, "") };
  } catch (error) {
    return { error: "x402 facilitator URL is invalid" };
  }
}
async function callFacilitator(operation, body, env) {
  const config = facilitatorConfig(env);
  if (config.error) return { ok: false, error: config.error };
  const headers = { "Content-Type": "application/json" };
  if (env?.X402_FACILITATOR_AUTHORIZATION) {
    headers.Authorization = env.X402_FACILITATOR_AUTHORIZATION;
  }
  try {
    const response = await fetch(`${config.url}/${operation}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, error: `x402 facilitator ${operation} failed with HTTP ${response.status}` };
    }
    if (!result || typeof result !== "object") {
      return { ok: false, error: `x402 facilitator ${operation} returned invalid JSON` };
    }
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: `x402 facilitator ${operation} request failed` };
  }
}
async function isRedeemed(key, env) {
  if (!env?.PROCESSED_PROOFS) return false;
  try {
    return Boolean(await env.PROCESSED_PROOFS.get(key));
  } catch (error) {
    console.error(JSON.stringify({
      message: "processed proof lookup failed",
      error: error instanceof Error ? error.message : String(error)
    }));
    return false;
  }
}
async function recordRedemption(key, receipt, env) {
  if (!env?.PROCESSED_PROOFS) return;
  try {
    await env.PROCESSED_PROOFS.put(key, JSON.stringify(receipt), { expirationTtl: 86400 * 30 });
  } catch (error) {
    console.error(JSON.stringify({
      message: "processed proof write failed",
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
async function verifyV2Payment(signatureHeader, env, requiredPriceUsd) {
  let paymentPayload;
  try {
    paymentPayload = decodeBase64Json(signatureHeader);
  } catch (error) {
    return { valid: false, rail: null, error: error.message };
  }
  const requirements = makePaymentRequirements(requiredPriceUsd);
  const payloadError = validateV2Payload(paymentPayload, requirements);
  if (payloadError) return { valid: false, rail: null, error: payloadError };
  const nonceKey = `x402:${paymentPayload.payload.authorization.nonce.toLowerCase()}`;
  if (await isRedeemed(nonceKey, env)) {
    return { valid: false, rail: null, error: "Payment authorization already redeemed" };
  }
  const facilitatorBody = { x402Version: 2, paymentPayload, paymentRequirements: requirements };
  const verification = await callFacilitator("verify", facilitatorBody, env);
  if (!verification.ok) return { valid: false, rail: null, error: verification.error };
  if (verification.result.isValid !== true) {
    return {
      valid: false,
      rail: null,
      error: `Payment authorization rejected: ${verification.result.invalidReason || "invalid"}`
    };
  }
  return {
    valid: true,
    rail: "x402",
    payer: verification.result.payer || paymentPayload.payload.authorization.from || null,
    pending_settlement: { facilitatorBody, nonceKey }
  };
}
async function verifyPayment(proofHeader, env, requiredPriceUsd = 0.05) {
  if (proofHeader && /^0x[a-fA-F0-9]{64}$/.test(proofHeader)) {
    return {
      valid: false,
      rail: null,
      error: "Legacy transaction-hash proofs are not accepted; use an x402 v2 PAYMENT-SIGNATURE"
    };
  }
  if (proofHeader) return verifyV2Payment(proofHeader, env, requiredPriceUsd);
  return { valid: false, rail: null, error: "Missing payment authorization" };
}
async function settlePayment(paymentVerdict, env) {
  if (!paymentVerdict?.valid) return paymentVerdict;
  if (!paymentVerdict.pending_settlement) return paymentVerdict;
  const { facilitatorBody, nonceKey } = paymentVerdict.pending_settlement;
  if (await isRedeemed(nonceKey, env)) {
    return { valid: false, rail: null, error: "Payment authorization already redeemed" };
  }
  const settlementCall = await callFacilitator("settle", facilitatorBody, env);
  if (!settlementCall.ok) return { valid: false, rail: null, error: settlementCall.error };
  const settlement = settlementCall.result;
  if (settlement.success !== true) {
    return { valid: false, rail: null, error: `Payment settlement failed: ${settlement.errorReason || "unknown"}` };
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(settlement.transaction || "")) {
    return { valid: false, rail: null, error: "Facilitator returned no valid settlement transaction" };
  }
  if (settlement.network !== BASE_NETWORK) {
    return { valid: false, rail: null, error: "Facilitator settled on the wrong network" };
  }
  const receipt = {
    success: true,
    transaction: settlement.transaction.toLowerCase(),
    network: settlement.network,
    payer: settlement.payer || paymentVerdict.payer || null,
    amount: facilitatorBody.paymentRequirements.amount
  };
  await recordRedemption(nonceKey, { ...receipt, redeemed_at: (/* @__PURE__ */ new Date()).toISOString() }, env);
  return { valid: true, rail: "x402", tx_hash: receipt.transaction, settlement: receipt };
}
function paymentResponseHeader(paymentVerdict) {
  return paymentVerdict?.settlement ? encodeBase64Json(paymentVerdict.settlement) : null;
}
function make402Response(serviceName, priceUsd, errorDetail = null, challengePrefix = "inv", resourceUrl = null) {
  const challengeToken = `${challengePrefix}_${crypto.randomUUID()}`;
  const requirements = makePaymentRequirements(priceUsd);
  const paymentRequired = {
    x402Version: 2,
    error: errorDetail || "PAYMENT-SIGNATURE header is required",
    resource: {
      url: resourceUrl || "https://extract.getstringer.app",
      description: `${serviceName} paid request`,
      mimeType: "application/json",
      serviceName
    },
    accepts: [requirements],
    extensions: {}
  };
  return new Response(JSON.stringify({
    ...paymentRequired,
    error_code: "PAYMENT_REQUIRED",
    challenge: challengeToken,
    price_usd: priceUsd
  }), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
      "PAYMENT-REQUIRED": encodeBase64Json(paymentRequired),
      "WWW-Authenticate": `x402 realm="${serviceName}", token="${challengeToken}", amount="${priceUsd.toFixed(4)}", currency="USDC", network="${BASE_NETWORK}", receiver="${RECEIVER_ADDRESS}"`,
      "X-402-Payment-Required": "true",
      "X-402-Price-USD": priceUsd.toFixed(4),
      "X-402-Network": BASE_NETWORK,
      "X-402-Receiver-Address": RECEIVER_ADDRESS,
      "X-402-Token-Contract": USDC_CONTRACT_ADDRESS
    }
  });
}

// CleanExtract Worker routes
var PRICE_USD = 0.05;
var MAX_FETCHED_BODY_BYTES = 1048576;
// The hosted service grants three lifetime calls per source IP. Keep the public
// reference implementation on the same contract: no signup, claim header, or reset.
var FREE_CALL_LIMIT = 3;
var ORIGIN_PROTECTED_DISCOVERY_PATHS = new Set([
  "/robots.txt",
  "/sitemap.xml",
  "/llms-full.txt"
]);
var ROBOTS_TEXT = `User-agent: *
Allow: /
Sitemap: https://extract.getstringer.app/sitemap.xml
`;
var SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://extract.getstringer.app/</loc></url>
  <url><loc>https://extract.getstringer.app/info</loc></url>
  <url><loc>https://extract.getstringer.app/llms.txt</loc></url>
</urlset>
`;
var LLMS_TEXT = `# CleanExtract

> Token-efficient HTML-to-Markdown extraction for AI agents.

- Free allowance: the first 3 calls per source IP are free, total; no header or signup is needed and it does not reset
- Paid price after the allowance: USD 0.05 per successful extraction
- MCP transport: https://extract.getstringer.app/mcp
- MCP protocol: Streamable HTTP
- Tool: clean_extract
- REST endpoint: https://extract.getstringer.app/v1/execute
- Payment: x402 v2 USDC on Base mainnet (eip155:8453)

Unpaid callers with a source IP receive up to 3 free calls without a claim header. After that allowance is exhausted, or when the caller cannot be identified, the service returns an x402 challenge.
`;
function discoveryResponse(body, contentType, method) {
  return new Response(method === "HEAD" ? null : body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300"
    }
  });
}
function paymentProof(request) {
  return request.headers.get("PAYMENT-SIGNATURE") || request.headers.get("X-402-Payment-Proof");
}
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function claimFreeCall(request, env, transport) {
  const callerIp = request.headers.get("CF-Connecting-IP")?.trim();
  if (!callerIp || !env?.FREE_TIER_LIMITER) return { allowed: false, exhausted: false };
  const callerHash = await sha256Hex(callerIp.toLowerCase());
  try {
    const stub = env.FREE_TIER_LIMITER.getByName(callerHash);
    const response = await stub.fetch("https://free-tier.internal/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caller_hash: callerHash, transport })
    });
    if (!response.ok) return { allowed: false, exhausted: false };
    const claim = await response.json();
    if (claim.allowed) return { ...claim, callerHash, stub };
    return { allowed: false, exhausted: true, remaining: 0, reset_at: claim.reset_at ?? null };
  } catch (error) {
    console.error(JSON.stringify({
      event_type: "free_tier_error",
      operation: "claim",
      error: error instanceof Error ? error.message : String(error)
    }));
    return { allowed: false, exhausted: false };
  }
}
async function authorizeCall(request, env, transport) {
  const proof = paymentProof(request);
  if (proof) {
    const paymentVerdict = await verifyPayment(proof, env);
    return paymentVerdict.valid ? { allowed: true, accessTier: "paid", paymentVerdict } : { allowed: false, paymentVerdict };
  }
  return { allowed: true, accessTier: "free_pending", transport };
}
async function activateFreeAllowance(request, env, authorization) {
  if (authorization.accessTier !== "free_pending") return authorization;
  const freeClaim = await claimFreeCall(request, env, authorization.transport);
  if (freeClaim.allowed) return { allowed: true, accessTier: "free", freeClaim };
  return {
    allowed: false,
    freeDenial: freeClaim,
    paymentVerdict: await verifyPayment(null, env)
  };
}
function makeFreeDenied402(authorization, transport) {
  const serviceName = transport === "mcp" ? "CleanExtract MCP" : "CleanExtract";
  const resourceUrl = transport === "mcp" ? "https://extract.getstringer.app/mcp" : "https://extract.getstringer.app/v1/execute";
  if (!authorization.freeDenial?.exhausted) {
    return make402Response(serviceName, PRICE_USD, authorization.paymentVerdict.error, "inv_cleanextract", resourceUrl);
  }
  const response = make402Response(
    serviceName,
    PRICE_USD,
    `Free allowance exhausted: ${FREE_CALL_LIMIT} free calls per source IP, total. The allowance does not reset. Pay the challenge below to continue.`,
    "inv_cleanextract",
    resourceUrl
  );
  response.headers.set("X-Stringer-Free-Remaining", "0");
  return response;
}
async function fetchPublicHtml(target) {
  try {
    const response = await safeFetch(target, {
      headers: { "User-Agent": "CleanExtract/1.0" }
    }, { maxResponseBytes: MAX_FETCHED_BODY_BYTES });
    if (!response.ok) {
      return { ok: false, error: `Upstream returned HTTP ${response.status}` };
    }
    return { ok: true, rawHtml: await response.text() };
  } catch (error) {
    if (error instanceof ResponseSizeLimitError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Upstream fetch failed" };
  }
}
function restError(message, status) {
  return new Response(
    JSON.stringify({ error: status === 400 ? "Bad Request" : "Bad Gateway", message }),
    {
      status,
      headers: { "Content-Type": "application/json", ...corsHeaders() }
    }
  );
}
async function finalizePaidResponse(response, paymentVerdict, env, serviceName, resourceUrl) {
  if (!response.ok) return response;
  const settlement = await settlePayment(paymentVerdict, env);
  if (!settlement.valid) {
    return make402Response(serviceName, PRICE_USD, settlement.error, "inv_cleanextract", resourceUrl);
  }
  const settlementHeader = paymentResponseHeader(settlement);
  if (settlementHeader) response.headers.set("PAYMENT-RESPONSE", settlementHeader);
  return response;
}
async function finalizeFreeResponse(response, freeClaim, transport, resourceUrl) {
  const receipt = {
    receipt_id: freeClaim.receipt_id,
    access_tier: "free",
    transport,
    caller_hash: freeClaim.callerHash,
    status: response.status,
    outcome: response.ok ? "success" : "rejected",
    recorded_at: (/* @__PURE__ */ new Date()).toISOString(),
    resource_url: resourceUrl
  };
  try {
    await freeClaim.stub.fetch("https://free-tier.internal/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(receipt)
    });
  } catch (error) {
    console.error(JSON.stringify({
      event_type: "free_tier_error",
      operation: "finalize",
      receipt_id: receipt.receipt_id,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
  response.headers.set("X-Stringer-Access-Tier", "free");
  response.headers.set("X-Stringer-Receipt-ID", freeClaim.receipt_id);
  response.headers.set("X-Stringer-Free-Remaining", String(freeClaim.remaining));
  return response;
}
async function finalizeAuthorizedResponse(response, authorization, env, serviceName, resourceUrl, transport) {
  if (authorization.accessTier === "free") {
    return finalizeFreeResponse(response, authorization.freeClaim, transport, resourceUrl);
  }
  return finalizePaidResponse(response, authorization.paymentVerdict, env, serviceName, resourceUrl);
}
function mcpToolDefinition() {
  return {
    name: "clean_extract",
    description: "Extract clean, token-dense markdown from a public URL or raw HTML string.",
    inputSchema: {
      type: "object",
      properties: {
        url_or_html: {
          type: "string",
          description: "The public URL or raw HTML string to convert into markdown."
        }
      },
      required: ["url_or_html"]
    }
  };
}
async function callMcpTool(id, params) {
  if (params?.name !== "clean_extract") {
    return mcpError(id, -32601, `Tool not found: ${params?.name || "unknown"}`, 404);
  }
  const target = params?.arguments?.url_or_html;
  if (typeof target !== "string" || target.length === 0) {
    return mcpError(id, -32602, "url_or_html must be a non-empty string", 400);
  }
  let rawHtml = target;
  let sourceUrl = null;
  if (target.startsWith("http://") || target.startsWith("https://")) {
    const safety = isSafePublicUrl(target);
    if (!safety.safe) {
      return mcpError(id, -32602, `SSRF blocked: ${safety.reason}`, 400);
    }
    sourceUrl = safety.parsedUrl;
    const fetchResult = await fetchPublicHtml(sourceUrl);
    if (!fetchResult.ok) {
      return mcpError(id, -32e3, fetchResult.error, 502);
    }
    rawHtml = fetchResult.rawHtml;
  }
  const extracted = cleanHtmlToMarkdown(rawHtml, sourceUrl);
  return mcpJson({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: extracted.markdown }],
      structuredContent: {
        title: extracted.title,
        markdown: extracted.markdown,
        tokens_saved: extracted.tokens_saved,
        compression_ratio: extracted.compression_ratio,
        raw_bytes: extracted.raw_bytes,
        clean_bytes: extracted.clean_bytes,
        metadata: extracted.metadata
      }
    }
  });
}
async function handleStreamableHttp(request, env) {
  if (!validateMcpOrigin(request)) {
    return mcpError(null, -32e3, "Forbidden Origin", 403);
  }
  const accept = request.headers.get("Accept") || "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    return mcpError(null, -32e3, "Accept must include application/json and text/event-stream", 406);
  }
  let rpcReq;
  try {
    rpcReq = await request.json();
  } catch (e) {
    return mcpError(null, -32700, "Parse error", 400);
  }
  if (!rpcReq || rpcReq.jsonrpc !== "2.0" || typeof rpcReq.method !== "string") {
    return mcpError(rpcReq?.id, -32600, "Invalid Request", 400);
  }
  const { id, method, params } = rpcReq;
  if (id === void 0 || id === null) {
    return new Response(null, { status: 202, headers: corsHeaders() });
  }
  if (method === "initialize") {
    return mcpJson({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "cleanextract", version: "0.3.0" }
      }
    }, 200, { "MCP-Protocol-Version": "2025-11-25" });
  }
  if (method === "ping") {
    return mcpJson({ jsonrpc: "2.0", id, result: {} });
  }
  if (method === "tools/list") {
    return mcpJson({ jsonrpc: "2.0", id, result: { tools: [mcpToolDefinition()] } });
  }
  if (method === "tools/call") {
    let authorization = await authorizeCall(request, env, "mcp");
    if (!authorization.allowed) {
      return make402Response("CleanExtract MCP", PRICE_USD, authorization.paymentVerdict.error, "inv_cleanextract", request.url);
    }
    if (params?.name !== "clean_extract") {
      return mcpError(id, -32601, `Tool not found: ${params?.name || "unknown"}`, 404);
    }
    if (typeof params?.arguments?.url_or_html !== "string" || params.arguments.url_or_html.length === 0) {
      return mcpError(id, -32602, "url_or_html must be a non-empty string", 400);
    }
    authorization = await activateFreeAllowance(request, env, authorization);
    if (!authorization.allowed) return makeFreeDenied402(authorization, "mcp");
    const toolResponse = await callMcpTool(id, params);
    return finalizeAuthorizedResponse(toolResponse, authorization, env, "CleanExtract MCP", request.url, "mcp");
  }
  return mcpError(id, -32601, `Method not found: ${method}`, 404);
}
var worker_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originProtected = ORIGIN_PROTECTED_DISCOVERY_PATHS.has(url.pathname)
      || request.method === "OPTIONS" && url.pathname.startsWith("/mcp");
    if (originProtected && !validateMcpOrigin(request)) {
      return forbiddenOriginResponse();
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/robots.txt") {
      return discoveryResponse(ROBOTS_TEXT, "text/plain; charset=utf-8", request.method);
    }
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/sitemap.xml") {
      return discoveryResponse(SITEMAP_XML, "application/xml; charset=utf-8", request.method);
    }
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/llms.txt") {
      return discoveryResponse(LLMS_TEXT, "text/plain; charset=utf-8", request.method);
    }
    if (url.pathname === "/" || url.pathname === "/info") {
      return new Response(
        JSON.stringify({
          service: "CleanExtract",
          subdomain: "extract.getstringer.app",
          tagline: "Token-efficient markdown & structured data extraction API for LLM context windows",
          monetization: "x402 on Base",
          price_usd: PRICE_USD,
          free_allowance: {
            calls: FREE_CALL_LIMIT,
            scope: "lifetime",
            resets: false,
            key: "CF-Connecting-IP",
            opt_in_required: false
          },
          x402_receiver: RECEIVER_ADDRESS,
          status: "operational",
          mcp_endpoints: {
            streamable_http: "/mcp"
          },
          rails: ["x402"]
        }),
        {
          headers: { "Content-Type": "application/json", ...corsHeaders() }
        }
      );
    }
    if (url.pathname === "/mcp" && request.method === "POST") {
      return handleStreamableHttp(request, env);
    }
    if (url.pathname === "/mcp" && (request.method === "GET" || request.method === "DELETE")) {
      return new Response(null, {
        status: 405,
        headers: { "Allow": "POST, OPTIONS", ...corsHeaders() }
      });
    }
    if (url.pathname === "/v1/execute" && request.method === "POST") {
      let authorization = await authorizeCall(request, env, "rest");
      if (!authorization.allowed) {
        return make402Response("CleanExtract", PRICE_USD, authorization.paymentVerdict.error, "inv_cleanextract", request.url);
      }
      let body;
      try {
        body = await request.json();
      } catch (error) {
        return restError("Request body must be valid JSON", 400);
      }
      const target = body?.url_or_html;
      if (typeof target !== "string" || target.length === 0) {
        return restError("url_or_html must be a non-empty string", 400);
      }
      authorization = await activateFreeAllowance(request, env, authorization);
      if (!authorization.allowed) return makeFreeDenied402(authorization, "rest");
      let rawHtml = target;
      let sourceUrl = null;
      if (target.startsWith("http://") || target.startsWith("https://")) {
        const safety = isSafePublicUrl(target);
        if (!safety.safe) {
          return restError(`SSRF Blocked: ${safety.reason}`, 400);
        }
        sourceUrl = safety.parsedUrl;
        const fetchResult = await fetchPublicHtml(sourceUrl);
        if (!fetchResult.ok) {
          return restError(fetchResult.error, 502);
        }
        rawHtml = fetchResult.rawHtml;
      }
      const extracted = cleanHtmlToMarkdown(rawHtml, sourceUrl);
      const extractionResponse = new Response(
        JSON.stringify({
          status: "success",
          service: "CleanExtract",
          target,
          clean_markdown: extracted.markdown,
          provenance: {
            title: extracted.title,
            metadata: extracted.metadata,
            tokens_saved: extracted.tokens_saved,
            compression_ratio: extracted.compression_ratio,
            settlement_rail: authorization.accessTier === "paid" ? authorization.paymentVerdict.rail : null,
            payment_verified: authorization.accessTier === "paid",
            processed_at: (/* @__PURE__ */ new Date()).toISOString()
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() }
        }
      );
      return finalizeAuthorizedResponse(extractionResponse, authorization, env, "CleanExtract", request.url, "rest");
    }
    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders() }
    });
  }
};
class FreeTierLimiter {
  constructor(state, env) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      this.state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS free_call_receipts (
          receipt_id TEXT PRIMARY KEY,
          caller_hash TEXT NOT NULL,
          transport TEXT NOT NULL CHECK (transport IN ('mcp', 'rest')),
          claimed_at INTEGER NOT NULL,
          completed_at TEXT,
          http_status INTEGER,
          outcome TEXT NOT NULL DEFAULT 'started'
        );
      `);
    });
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405 });
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
    }
    if (url.pathname === "/claim") {
      if (!/^[a-f0-9]{64}$/.test(body?.caller_hash || "") || !["mcp", "rest"].includes(body?.transport)) {
        return new Response(JSON.stringify({ error: "Invalid claim" }), { status: 400 });
      }
      return this.state.storage.transactionSync(() => {
        const used = this.state.storage.sql.exec("SELECT COUNT(*) AS count FROM free_call_receipts").one().count;
        if (used >= FREE_CALL_LIMIT) {
          return Response.json({ allowed: false, remaining: 0, reset_at: null });
        }
        const receiptId = crypto.randomUUID();
        this.state.storage.sql.exec(
          "INSERT INTO free_call_receipts (receipt_id, caller_hash, transport, claimed_at) VALUES (?, ?, ?, ?)",
          receiptId,
          body.caller_hash,
          body.transport,
          Date.now()
        );
        return Response.json({ allowed: true, receipt_id: receiptId, remaining: FREE_CALL_LIMIT - used - 1 });
      });
    }
    if (url.pathname === "/finalize") {
      if (!/^[0-9a-f-]{36}$/i.test(body?.receipt_id || "")) {
        return new Response(JSON.stringify({ error: "Invalid receipt" }), { status: 400 });
      }
      this.state.storage.sql.exec(
        "UPDATE free_call_receipts SET completed_at = ?, http_status = ?, outcome = ? WHERE receipt_id = ?",
        body.recorded_at,
        Number(body.status),
        body.outcome,
        body.receipt_id
      );
      return Response.json({ stored: true });
    }
    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404 });
  }
}
export {
  BASE_NETWORK,
  FREE_CALL_LIMIT,
  FreeTierLimiter,
  cleanHtmlToMarkdown,
  make402Response,
  makePaymentRequirements,
  safeFetch,
  worker_default as default
};
