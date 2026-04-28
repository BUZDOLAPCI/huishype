// ---------------------------------------------------------------------------
// Address canonicalization utilities
//
// Shared across every data-ingestion boundary (Funda sync, Pararius sync,
// API mutations) to guarantee deterministic matching of property addresses.
// ---------------------------------------------------------------------------

import {
  getCountryConfig,
  type CountryCode,
} from '@huishype/shared';

export interface CanonicalAddress {
  street: string;
  houseNumber: number;
  houseNumberAddition: string | null;
  postalCode: string;
  city: string;
}

export type CanonicalizeAddressFailureReason =
  | 'missing_postal_code'
  | 'invalid_postal_code'
  | 'invalid_house_number';

export type CanonicalizeAddressResult =
  | { canonical: CanonicalAddress; failureReason: null }
  | { canonical: null; failureReason: CanonicalizeAddressFailureReason };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Collapse multiple whitespace characters into a single space and trim the
 * edges.  Returns an empty string when the input is nullish or blank.
 */
function collapseWhitespace(value: string | undefined | null): string {
  if (value == null) return "";
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Normalize a house-number addition:
 *   - trim surrounding whitespace
 *   - uppercase
 *   - convert empty / whitespace-only strings to null
 */
function normalizeAddition(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toUpperCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * Parse a (possibly composite) house-number value into a numeric part and an
 * optional addition string.
 *
 * Accepted patterns:
 *   "13"      -> { num: 13, addition: null  }
 *   "13A"     -> { num: 13, addition: "A"   }
 *   "13a"     -> { num: 13, addition: "A"   }
 *   "13-bis"  -> { num: 13, addition: "BIS" }
 *   "13 -bis" -> { num: 13, addition: "BIS" }
 *   "13 a"    -> { num: 13, addition: "A"   }
 *   13        -> { num: 13, addition: null  }
 *
 * Leading/trailing whitespace on the input is tolerated.
 *
 * Throws when the value does not start with at least one digit.
 */
function parseCompositeHouseNumber(raw: string | number): {
  num: number;
  addition: string | null;
} {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) {
      throw new Error(
        `Invalid house number: expected a positive integer, got ${raw}`,
      );
    }
    return { num: raw, addition: null };
  }

  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new Error("Invalid house number: received empty string");
  }

  // Match leading digits, then everything else.
  const match = trimmed.match(/^(\d+)\s*[-/]?\s*(.*)$/);
  if (!match) {
    throw new Error(
      `Invalid house number: "${trimmed}" does not start with a digit`,
    );
  }

  const num = parseInt(match[1], 10);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(
      `Invalid house number: parsed "${match[1]}" is not a valid positive integer`,
    );
  }

  const additionRaw = match[2];
  const addition = normalizeAddition(additionRaw);

  return { num, addition };
}

/**
 * Normalize and validate a postal code using the country-config registry.
 *
 *   - Strips whitespace, uppercases
 *   - Validates against the country's postalCodeRegex
 *   - Returns the country-specific normalized form
 *
 * Throws when the postal code doesn't match the country's format.
 */
function normalizePostalCode(raw: string, countryCode: CountryCode = 'NL'): string {
  const cfg = getCountryConfig(countryCode);
  const stripped = raw.replace(/\s/g, '').toUpperCase();

  if (!cfg.postalCodeRegex.test(stripped)) {
    throw new Error(
      `Invalid ${cfg.name} postal code: "${raw}" (normalized: "${stripped}")`,
    );
  }

  return stripped;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Canonicalize a raw address object into a deterministic form suitable for
 * database storage and deduplication.
 *
 * Returns `null` when the input is invalid (empty/malformed postal code,
 * non-numeric house number, etc.) instead of throwing.
 */
export function canonicalizeAddress(input: {
  street?: string;
  houseNumber: string | number;
  houseNumberAddition?: string | null;
  postalCode: string;
  city?: string;
  countryCode?: CountryCode;
}): CanonicalAddress | null {
  return canonicalizeAddressWithDiagnostics(input).canonical;
}

export function canonicalizeAddressWithDiagnostics(input: {
  street?: string;
  houseNumber: string | number;
  houseNumberAddition?: string | null;
  postalCode: string;
  city?: string;
  countryCode?: CountryCode;
}): CanonicalizeAddressResult {
  // -- Postal code ----------------------------------------------------------
  if (!input.postalCode) {
    return { canonical: null, failureReason: 'missing_postal_code' };
  }

  let postalCode: string;
  try {
    postalCode = normalizePostalCode(input.postalCode, input.countryCode ?? 'NL');
  } catch {
    return { canonical: null, failureReason: 'invalid_postal_code' };
  }

  // -- House number (with possible composite parsing) -----------------------
  let parsed: { num: number; addition: string | null };
  try {
    parsed = parseCompositeHouseNumber(input.houseNumber);
  } catch {
    return { canonical: null, failureReason: 'invalid_house_number' };
  }

  // If the caller *also* provided an explicit addition, it takes precedence
  // over anything extracted from a composite house-number string -- unless it
  // is empty/null, in which case we fall back to whatever was parsed.
  const explicitAddition = normalizeAddition(input.houseNumberAddition);
  const houseNumberAddition = explicitAddition ?? parsed.addition;

  // -- Street ---------------------------------------------------------------
  const street = collapseWhitespace(input.street);

  // -- City -----------------------------------------------------------------
  const city = collapseWhitespace(input.city);

  return {
    canonical: {
      street,
      houseNumber: parsed.num,
      houseNumberAddition,
      postalCode,
      city,
    },
    failureReason: null,
  };
}

/**
 * Strip query parameters, fragments, and trailing slashes from a URL.
 *
 * Used for listing deduplication -- two URLs that differ only in tracking
 * params or anchors should be treated as the same listing.
 *
 * Examples:
 *   "https://funda.nl/koop/amsterdam/huis-123/?utm_source=foo"
 *     -> "https://funda.nl/koop/amsterdam/huis-123"
 *   "https://funda.nl/koop/amsterdam/huis-123/#details"
 *     -> "https://funda.nl/koop/amsterdam/huis-123"
 *   "https://funda.nl/koop/amsterdam/huis-123/"
 *     -> "https://funda.nl/koop/amsterdam/huis-123"
 */
export function normalizeSourceUrl(url: string): string {
  // Use the URL constructor for reliable parsing.  If the input is not a
  // valid absolute URL we fall back to basic string manipulation so we don't
  // throw on relative paths or malformed values.
  try {
    const parsed = new URL(url);
    // Reconstruct without search params or hash
    const clean = `${parsed.origin}${parsed.pathname}`;
    // Strip trailing slash(es), but keep a bare "/" for the root path.
    return clean.replace(/\/+$/, "") || parsed.origin;
  } catch {
    // Fallback for non-absolute URLs: strip ?... and #... then trailing slash.
    return url
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  }
}

/**
 * Format a house-number addition with the correct Dutch separator.
 *
 * **NL-specific** — Dutch convention:
 *   - Single letter additions are concatenated directly: "13A", "105B"
 *   - Everything else (numeric, multi-char) uses a hyphen: "105-1", "13-BIS"
 *   - Empty/null additions return an empty string
 *
 * Other countries typically just concatenate the addition directly
 * (handled by the country config's addressFormatter).
 */
export function formatAddition(addition: string | null | undefined): string {
  if (!addition) return "";
  // Single uppercase letter → no separator (e.g. "A" → "A")
  if (/^[A-Z]$/.test(addition)) return addition;
  // Everything else → hyphen separator (e.g. "1" → "-1", "BIS" → "-BIS")
  return `-${addition}`;
}

/**
 * Produce a human-readable one-line address string.
 *
 * When `countryCode` is provided, delegates to the country config's
 * `addressFormatter`. Falls back to NL-specific Dutch formatting.
 *
 * Examples (NL default):
 *   { street: "Reehorst", houseNumber: 13, houseNumberAddition: "A",
 *     postalCode: "5658DP", city: "Eindhoven" }
 *   -> "Reehorst 13A, 5658DP Eindhoven"
 *
 *   { street: "De Ruijterkade", houseNumber: 105, houseNumberAddition: "1",
 *     postalCode: "1011AB", city: "Amsterdam" }
 *   -> "De Ruijterkade 105-1, 1011AB Amsterdam"
 */
export function formatDisplayAddress(
  addr: CanonicalAddress,
  countryCode?: CountryCode,
): string {
  const code = countryCode ?? 'NL';

  // For non-NL countries, delegate to the country config formatter
  // which handles addition concatenation per that country's convention.
  if (code !== 'NL') {
    return getCountryConfig(code).addressFormatter({
      street: addr.street,
      houseNumber: String(addr.houseNumber),
      houseNumberAddition: addr.houseNumberAddition ?? undefined,
      postalCode: addr.postalCode,
      city: addr.city,
      countryCode: code,
    });
  }

  // NL-specific: use formatAddition for Dutch separator convention
  const addition = formatAddition(addr.houseNumberAddition);
  const streetPart = addr.street
    ? `${addr.street} ${addr.houseNumber}${addition}`
    : `${addr.houseNumber}${addition}`;
  const locationPart = [addr.postalCode, addr.city].filter(Boolean).join(" ");
  return `${streetPart}, ${locationPart}`;
}
