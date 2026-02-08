// ---------------------------------------------------------------------------
// Address matcher — soft verification of OG titles
//
// Compares the OG title fetched from a listing URL against the property
// address on file.  Used as a "sanity check" warning rather than a hard
// blocker — a mismatch means the link *might* point to a different property.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AddressMatchResult {
  match: boolean;
  warning: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a string for fuzzy comparison: strip diacritics (e.g. e-acute ->
 * e) and lowercase.
 */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Check whether `haystack` contains the house number as a standalone number
 * (i.e. "13" matches in "Reehorst 13, Eindhoven" but not in "Reehorst 130").
 *
 * We use a word-boundary approach: the number must be preceded and followed by
 * a non-digit (or start/end of string).
 */
function containsHouseNumber(haystack: string, houseNumber: number): boolean {
  const pattern = new RegExp(`(?<![0-9])${houseNumber}(?![0-9])`);
  return pattern.test(haystack);
}

/**
 * Check whether `haystack` contains the street name (partial match).
 *
 * Both sides are normalized before comparison so diacritics and case are
 * ignored.
 */
function containsStreet(haystack: string, street: string): boolean {
  if (street.trim() === "") return false;
  return normalize(haystack).includes(normalize(street));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare an OG title against a known property address.
 *
 * Returns a match result with an optional human-readable warning.
 *
 * - Both street AND house number found -> match, no warning
 * - Only one found                     -> no match, soft warning
 * - Neither found                      -> no match, stronger warning
 * - ogTitle null/empty                 -> no match, informational warning
 */
export function checkAddressMatch(
  ogTitle: string | null,
  property: { street: string; houseNumber: number; city: string },
): AddressMatchResult {
  if (!ogTitle || ogTitle.trim() === "") {
    return { match: false, warning: "Could not extract title from URL" };
  }

  const hasStreet = containsStreet(ogTitle, property.street);
  const hasNumber = containsHouseNumber(ogTitle, property.houseNumber);

  if (hasStreet && hasNumber) {
    return { match: true, warning: null };
  }

  if (hasStreet || hasNumber) {
    return {
      match: false,
      warning: "This listing may be for a different address",
    };
  }

  return {
    match: false,
    warning: "This listing appears to be for a different address",
  };
}
