// ---------------------------------------------------------------------------
// Address canonicalization utilities
//
// Shared across every data-ingestion boundary (Funda sync, Pararius sync,
// API mutations) to guarantee deterministic matching of Dutch property
// addresses.
// ---------------------------------------------------------------------------

export interface CanonicalAddress {
  street: string;
  houseNumber: number;
  houseNumberAddition: string | null;
  postalCode: string;
  city: string;
}

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
 * Normalize a Dutch postal code.
 *   - Strip ALL whitespace (not just a single space in the middle)
 *   - Uppercase
 *   - Validate the 4-digit + 2-letter pattern
 */
function normalizePostalCode(raw: string): string {
  const stripped = raw.replace(/\s/g, "").toUpperCase();

  if (!/^\d{4}[A-Z]{2}$/.test(stripped)) {
    throw new Error(
      `Invalid Dutch postal code: "${raw}" (normalized: "${stripped}")`,
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
}): CanonicalAddress | null {
  // -- Postal code ----------------------------------------------------------
  if (!input.postalCode) return null;

  let postalCode: string;
  try {
    postalCode = normalizePostalCode(input.postalCode);
  } catch {
    return null;
  }

  // -- House number (with possible composite parsing) -----------------------
  const parsed = parseCompositeHouseNumber(input.houseNumber);

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
    street,
    houseNumber: parsed.num,
    houseNumberAddition,
    postalCode,
    city,
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
 * Dutch convention:
 *   - Single letter additions are concatenated directly: "13A", "105B"
 *   - Everything else (numeric, multi-char) uses a hyphen: "105-1", "13-BIS"
 *   - Empty/null additions return an empty string
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
 * Format: "Street HouseNumber[Addition], PostalCode City"
 *
 * Examples:
 *   { street: "Reehorst", houseNumber: 13, houseNumberAddition: "A",
 *     postalCode: "5658DP", city: "Eindhoven" }
 *   -> "Reehorst 13A, 5658DP Eindhoven"
 *
 *   { street: "De Ruijterkade", houseNumber: 105, houseNumberAddition: "1",
 *     postalCode: "1011AB", city: "Amsterdam" }
 *   -> "De Ruijterkade 105-1, 1011AB Amsterdam"
 *
 *   { street: "Keizersgracht", houseNumber: 100, houseNumberAddition: null,
 *     postalCode: "1015AA", city: "Amsterdam" }
 *   -> "Keizersgracht 100, 1015AA Amsterdam"
 */
export function formatDisplayAddress(addr: CanonicalAddress): string {
  const addition = formatAddition(addr.houseNumberAddition);
  const streetPart = addr.street
    ? `${addr.street} ${addr.houseNumber}${addition}`
    : `${addr.houseNumber}${addition}`;
  const locationPart = [addr.postalCode, addr.city].filter(Boolean).join(" ");
  return `${streetPart}, ${locationPart}`;
}
