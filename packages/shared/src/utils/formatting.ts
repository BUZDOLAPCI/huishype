/**
 * Shared formatting utilities for HuisHype
 * Used by both frontend and backend for consistent display
 */

import { getCountryConfig, isValidCountryCode, type CountryCode } from '../config/country-config.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Resolve locale and currency from an optional country code. */
function resolveLocaleAndCurrency(countryCode?: CountryCode): {
  locale: string | undefined;
  currency: string | undefined;
} {
  if (!countryCode) return { locale: undefined, currency: undefined };
  const cfg = getCountryConfig(countryCode);
  return { locale: cfg.locale, currency: cfg.currency };
}

// ---------------------------------------------------------------------------
// Price formatting
// ---------------------------------------------------------------------------

/**
 * Format a price with full control over locale/currency.
 * @param price - Price in local currency (whole number)
 * @param options - Formatting options
 * @returns Formatted price string (e.g., "€ 450.000" or "€ 450K")
 */
export function formatPrice(
  price: number,
  options: {
    /** Use compact notation (e.g., 450K instead of 450.000) */
    compact?: boolean;
    /** Include currency symbol */
    includeCurrency?: boolean;
    /** Locale for formatting (overrides countryCode) */
    locale?: string;
    /** Country code — resolves locale and currency from config */
    countryCode?: CountryCode;
    /** ISO 4217 currency code (overrides countryCode) */
    currency?: string;
  } = {}
): string {
  const {
    compact = false,
    includeCurrency = true,
    countryCode = 'NL',
  } = options;

  const resolved = resolveLocaleAndCurrency(countryCode);
  const locale = options.locale ?? resolved.locale;
  const currency = options.currency ?? resolved.currency ?? 'EUR';

  const formatter = new Intl.NumberFormat(locale, {
    style: includeCurrency ? 'currency' : 'decimal',
    currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0,
  });

  return formatter.format(price);
}

/**
 * Convenience: format a property price using country config.
 * @param price - Price in local currency
 * @param countryCode - Country code (defaults to 'NL')
 * @param options - Extra formatting options
 */
export function formatPropertyPrice(
  price: number,
  countryCode: CountryCode = 'NL',
  options: { compact?: boolean } = {}
): string {
  return formatPrice(price, {
    countryCode,
    compact: options.compact,
    includeCurrency: true,
  });
}

/**
 * Format a price range
 * @param min - Minimum price
 * @param max - Maximum price
 * @param countryCode - Country code (defaults to 'NL')
 * @returns Formatted range string (e.g., "€ 400.000 - € 500.000")
 */
export function formatPriceRange(
  min: number,
  max: number,
  countryCode: CountryCode = 'NL'
): string {
  return `${formatPrice(min, { countryCode })} - ${formatPrice(max, { countryCode })}`;
}

/**
 * Format a percentage
 * @param value - Decimal value (e.g., 0.15 for 15%)
 * @param options - Formatting options
 * @returns Formatted percentage string
 */
export function formatPercentage(
  value: number,
  options: {
    /** Show sign for positive values */
    showSign?: boolean;
    /** Number of decimal places */
    decimals?: number;
  } = {}
): string {
  const { showSign = false, decimals = 1 } = options;

  const percentage = value * 100;
  const formatted = percentage.toFixed(decimals);

  if (showSign && percentage > 0) {
    return `+${formatted}%`;
  }

  return `${formatted}%`;
}

// ---------------------------------------------------------------------------
// Date / time formatting (non-property — uses device locale by default)
// ---------------------------------------------------------------------------

/**
 * Format a date relative to now (e.g., "2 hours ago", "yesterday")
 * @param date - Date to format (string or Date)
 * @param locale - Locale for formatting (undefined = device locale)
 * @returns Relative time string
 */
export function formatRelativeTime(
  date: string | Date,
  locale?: string
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (diffSeconds < 60) {
    return rtf.format(-diffSeconds, 'second');
  } else if (diffMinutes < 60) {
    return rtf.format(-diffMinutes, 'minute');
  } else if (diffHours < 24) {
    return rtf.format(-diffHours, 'hour');
  } else if (diffDays < 7) {
    return rtf.format(-diffDays, 'day');
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return rtf.format(-weeks, 'week');
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return rtf.format(-months, 'month');
  } else {
    const years = Math.floor(diffDays / 365);
    return rtf.format(-years, 'year');
  }
}

/**
 * Format a date for display
 * @param date - Date to format
 * @param options - Formatting options
 * @returns Formatted date string
 */
export function formatDate(
  date: string | Date,
  options: {
    /** Include time */
    includeTime?: boolean;
    /** Format style */
    style?: 'short' | 'medium' | 'long';
    /** Locale (undefined = device locale) */
    locale?: string;
  } = {}
): string {
  const { includeTime = false, style = 'medium', locale } = options;
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  const dateStyle =
    style === 'short' ? 'short' : style === 'long' ? 'long' : 'medium';

  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle,
    timeStyle: includeTime ? 'short' : undefined,
  });

  return formatter.format(dateObj);
}

// ---------------------------------------------------------------------------
// Address / postal code formatting
// ---------------------------------------------------------------------------

/**
 * Format a postal code. When a countryCode is provided, delegates to the
 * country config's normalizer. Falls back to Dutch formatting.
 */
export function formatPostalCode(
  postalCode: string,
  countryCode?: CountryCode
): string {
  if (countryCode) {
    return getCountryConfig(countryCode).postalCodeNormalize(postalCode);
  }
  // Legacy Dutch default
  const cleaned = postalCode.replace(/\s/g, '').toUpperCase();
  if (cleaned.length === 6) {
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4)}`;
  }
  return cleaned;
}

/**
 * Format a full address. When a countryCode is provided, delegates to the
 * country config's addressFormatter. Falls back to Dutch formatting.
 */
export function formatAddress(parts: {
  streetName: string;
  houseNumber: string;
  houseNumberAddition?: string;
  postalCode?: string;
  city?: string;
  countryCode?: CountryCode;
}): string {
  const { streetName, houseNumber, houseNumberAddition, postalCode, city, countryCode } = parts;

  if (countryCode) {
    return getCountryConfig(countryCode).addressFormatter({
      street: streetName,
      houseNumber,
      houseNumberAddition,
      postalCode: postalCode ?? '',
      city: city ?? '',
      countryCode,
    });
  }

  // Legacy Dutch default
  let address = `${streetName} ${houseNumber}`;

  if (houseNumberAddition) {
    address += houseNumberAddition;
  }

  if (postalCode || city) {
    address += ', ';
    if (postalCode) {
      address += formatPostalCode(postalCode);
      if (city) {
        address += ' ';
      }
    }
    if (city) {
      address += city;
    }
  }

  return address;
}

// ---------------------------------------------------------------------------
// Valuation label
// ---------------------------------------------------------------------------

/**
 * Get the country-specific label for the official property valuation.
 * @param countryCode - Country code (defaults to 'NL')
 * @returns Label string (e.g. "WOZ Value" for NL, "Official Valuation" for others)
 */
export function getValuationLabel(countryCode?: string): string {
  if (countryCode && isValidCountryCode(countryCode)) {
    return getCountryConfig(countryCode).valuationLabel;
  }
  return 'Official Valuation';
}

// ---------------------------------------------------------------------------
// Number formatting (non-property — uses device locale by default)
// ---------------------------------------------------------------------------

/**
 * Format area in square meters
 * @param sqm - Area in square meters
 * @param locale - Locale (undefined = device locale)
 * @returns Formatted string (e.g., "120 m²")
 */
export function formatArea(sqm: number, locale?: string): string {
  return `${sqm.toLocaleString(locale)} m²`;
}

/**
 * Format a number with thousands separators
 * @param value - Number to format
 * @param locale - Locale for formatting (undefined = device locale)
 * @returns Formatted number string
 */
export function formatNumber(value: number, locale?: string): string {
  return value.toLocaleString(locale);
}

/**
 * Format karma score with rank
 * @param karma - Karma points
 * @returns Formatted karma string
 */
export function formatKarma(karma: number): string {
  if (karma >= 10000) {
    return `${(karma / 1000).toFixed(1)}K`;
  }
  return karma.toLocaleString();
}

/**
 * Get karma rank title based on score
 * @param karma - Karma points
 * @returns Rank title
 */
export function getKarmaRank(
  karma: number
): 'Newbie' | 'Regular' | 'Trusted' | 'Expert' | 'Master' | 'Legend' {
  if (karma >= 10000) return 'Legend';
  if (karma >= 5000) return 'Master';
  if (karma >= 1000) return 'Expert';
  if (karma >= 250) return 'Trusted';
  if (karma >= 50) return 'Regular';
  return 'Newbie';
}

/**
 * Truncate text with ellipsis
 * @param text - Text to truncate
 * @param maxLength - Maximum length
 * @returns Truncated text
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}
