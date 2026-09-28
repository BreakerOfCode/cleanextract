import { structuredText, SHELL_CONTENT_FLOOR_BYTES } from "./fallback.js";

export const FETCH_TIMEOUT_MS = 20_000;
export { SHELL_CONTENT_FLOOR_BYTES } from "./fallback.js";

export const CHALLENGE_MARKERS = Object.freeze([
  /just a moment\.\.\./i,
  /attention required!\s*\|\s*cloudflare/i,
  /challenge-platform/i,
  /datadome.{0,80}captcha|captcha.{0,80}datadome/i,
  /perimeterx.{0,80}captcha|captcha.{0,80}perimeterx|px-captcha/i,
]);

export const OUTCOME_STATUSES = Object.freeze([
  "ok", "upstream_timeout", "upstream_http_error", "bot_challenge",
  "js_shell", "empty_extraction", "sections_not_found",
]);

const SHELL_MARKERS = [
  /<div\b[^>]*\bid=["'](?:root|__next|app)["'][^>]*>\s*<\/div>/i,
  /__NEXT_DATA__/i,
  /window\.__NUXT__/i,
  /<noscript\b[^>]*>[^<]*\b(?:enable|requires?|need)\b[^<]*javascript/i,
];

export function classifyOutcome({ fetchResult = null, rawHtml = "", extracted = null, quality = null, selectedSections = null }) {
  const body = typeof rawHtml === "string" ? rawHtml : "";
  if (fetchResult?.timeout) {
    return { status: "upstream_timeout", charged: false, reason: "The page did not answer within the fetch timeout; retry later." };
  }
  if (fetchResult?.headers?.get?.("cf-mitigated")?.toLowerCase() === "challenge"
      || CHALLENGE_MARKERS.some((marker) => marker.test(body))) {
    return { status: "bot_challenge", charged: false, reason: "The page returned a bot challenge; CleanExtract cannot pass that challenge." };
  }
  if (fetchResult && !fetchResult.ok) {
    return { status: "upstream_http_error", charged: false, reason: fetchResult.status
      ? `Upstream returned HTTP ${fetchResult.status}; retry when the page is available.`
      : `${fetchResult.error || "Upstream fetch failed"}; retry when the page is available.` };
  }
  const contentBytes = quality?.extracted_content_bytes ?? new TextEncoder().encode(extracted?.markdown ?? "").length;
  if (contentBytes < SHELL_CONTENT_FLOOR_BYTES && SHELL_MARKERS.some((marker) => marker.test(body))) {
    const fallback = structuredText(body);
    if (fallback) return { status: "ok", charged: true, reason: "The page supplied usable structured article text.", fallback };
    return { status: "js_shell", charged: false, reason: "The page returned an app shell that needs JavaScript to render; CleanExtract does not run JavaScript." };
  }
  if (quality?.content_ratio_band === "zero" || contentBytes === 0) {
    const fallback = structuredText(body);
    if (fallback) return { status: "ok", charged: true, reason: "The page supplied usable structured article text.", fallback };
    return { status: "empty_extraction", charged: false, reason: "The page produced no source-authored content; try another page or provide rendered HTML." };
  }
  if (selectedSections && selectedSections.sections_returned.length === 0) {
    return { status: "sections_not_found", charged: false, reason: "None of the requested section ids exists on this page; request ids from a fresh outline." };
  }
  return { status: "ok", charged: true, reason: "The page produced source-authored content." };
}
