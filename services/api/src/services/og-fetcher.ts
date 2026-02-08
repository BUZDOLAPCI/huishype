// ---------------------------------------------------------------------------
// OG metadata fetcher with SSRF protection
//
// Fetches OpenGraph metadata from user-supplied URLs.  Only whitelisted
// domains (funda.nl, pararius.nl and their subdomains) are allowed over
// HTTPS.  Resolved IPs are validated against private ranges before any
// request is made.
// ---------------------------------------------------------------------------

import dns from "node:dns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OgMetadata {
  ogTitle: string | null;
  ogImage: string | null;
  ogDescription: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_ROOT_DOMAINS = ["funda.nl", "pararius.nl"] as const;

const FETCH_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1_048_576; // 1 MB

const USER_AGENT = "HuisHype/1.0 (+https://huishype.nl)";

const EMPTY_OG: OgMetadata = {
  ogTitle: null,
  ogImage: null,
  ogDescription: null,
};

// ---------------------------------------------------------------------------
// In-memory OG cache (LRU-style with TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: OgMetadata;
  expiresAt: number;
}

const ogCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 100;

function normalizeUrlForCache(url: string): string {
  try {
    const parsed = new URL(url);
    // Strip query params and fragments for cache key
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

function getCachedOg(url: string): OgMetadata | null {
  const key = normalizeUrlForCache(url);
  const entry = ogCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    ogCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedOg(url: string, data: OgMetadata): void {
  const key = normalizeUrlForCache(url);
  // Simple size limit: if at max, delete oldest entry
  if (ogCache.size >= CACHE_MAX_SIZE && !ogCache.has(key)) {
    const firstKey = ogCache.keys().next().value;
    if (firstKey) ogCache.delete(firstKey);
  }
  ogCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

/**
 * Return true when `hostname` equals one of the allowed root domains *or* is
 * a subdomain of one (e.g. `www.funda.nl`, `cloud.funda.nl`).
 */
function matchesWhitelist(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return ALLOWED_ROOT_DOMAINS.some(
    (root) => lower === root || lower.endsWith(`.${root}`),
  );
}

/**
 * Check whether a URL points to one of the whitelisted domains over HTTPS.
 */
export function isWhitelistedDomain(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return matchesWhitelist(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Detect the source marketplace from a listing URL.
 */
export function detectSourceName(url: string): "funda" | "pararius" | "other" {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === "funda.nl" || hostname.endsWith(".funda.nl"))
      return "funda";
    if (hostname === "pararius.nl" || hostname.endsWith(".pararius.nl"))
      return "pararius";
    return "other";
  } catch {
    return "other";
  }
}

// ---------------------------------------------------------------------------
// IP validation (SSRF protection)
// ---------------------------------------------------------------------------

/**
 * Return true when the IP address belongs to a private, loopback, or
 * link-local range that should never be contacted.
 */
function isPrivateIp(ip: string): boolean {
  // IPv6 loopback
  if (ip === "::1") return true;

  // IPv4-mapped IPv6 — strip prefix and check the IPv4 part.
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const v4 = v4Mapped ? v4Mapped[1] : ip;

  const parts = v4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) {
    // Not a recognisable IPv4 address — treat IPv6 (other than ::1 already
    // handled above) conservatively: block fd00::/8 (ULA) and fe80::/10
    // (link-local).
    const lower = ip.toLowerCase();
    if (lower.startsWith("fd") || lower.startsWith("fe80")) return true;
    // Allow other IPv6 addresses (e.g. public 2xxx).
    return false;
  }

  const [a, b] = parts;

  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8
  if (a === 0) return true;

  return false;
}

/**
 * Resolve `hostname` via DNS and reject any private/loopback result.
 * Throws on failure so the caller can abort the request.
 */
async function assertPublicIp(hostname: string): Promise<void> {
  const { address } = await dns.promises.lookup(hostname);
  if (isPrivateIp(address)) {
    throw new Error(
      `DNS resolved ${hostname} to private IP ${address} — request blocked`,
    );
  }
}

// ---------------------------------------------------------------------------
// HTML meta-tag extraction
// ---------------------------------------------------------------------------

function extractMetaContent(html: string, property: string): string | null {
  // Match both property="og:title" and name="og:title" patterns, with
  // content appearing before or after the property attribute.
  const regex = new RegExp(
    `<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']` +
      `|<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
    "i",
  );
  const match = html.match(regex);
  return match?.[1] ?? match?.[2] ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch OpenGraph metadata from `url`.
 *
 * Returns `{ ogTitle: null, ogImage: null, ogDescription: null }` when the
 * URL is not whitelisted, the DNS check fails, or any network error occurs.
 * This function never throws.
 */
export async function fetchOgMetadata(url: string): Promise<OgMetadata> {
  try {
    // Check cache first
    const cached = getCachedOg(url);
    if (cached) return cached;

    // 1. Protocol + domain whitelist -------------------------------------------
    const parsed = new URL(url);

    if (parsed.protocol !== "https:") return EMPTY_OG;
    if (!matchesWhitelist(parsed.hostname)) return EMPTY_OG;

    // 2. DNS-level SSRF check --------------------------------------------------
    await assertPublicIp(parsed.hostname);

    // 3. Fetch with timeout + size limit ---------------------------------------
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
      });
    } finally {
      clearTimeout(timeout);
    }

    // After redirects, verify the final URL is still whitelisted.
    if (response.redirected && response.url) {
      const finalHostname = new URL(response.url).hostname;
      if (!matchesWhitelist(finalHostname)) return EMPTY_OG;
    }

    if (!response.ok) return EMPTY_OG;

    // 4. Read body with size cap -----------------------------------------------
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      return EMPTY_OG;
    }

    const reader = response.body?.getReader();
    if (!reader) return EMPTY_OG;

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        reader.cancel().catch(() => {});
        return EMPTY_OG;
      }
      chunks.push(value);
    }

    const decoder = new TextDecoder();
    const html = chunks.map((c) => decoder.decode(c, { stream: true })).join("") +
      decoder.decode();

    // 5. Extract OG tags -------------------------------------------------------
    const result = {
      ogTitle: extractMetaContent(html, "og:title"),
      ogImage: extractMetaContent(html, "og:image"),
      ogDescription: extractMetaContent(html, "og:description"),
    };
    setCachedOg(url, result);
    return result;
  } catch {
    // Network errors, DNS failures, aborts, parse errors — all swallowed.
    return EMPTY_OG;
  }
}
