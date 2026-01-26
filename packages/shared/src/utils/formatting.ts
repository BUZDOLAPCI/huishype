/**
 * Shared formatting utilities for HuisHype
 * Used by both frontend and backend for consistent display
 */

/**
 * Format a price in euros
 * @param price - Price in euros (whole number)
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
    /** Locale for formatting */
    locale?: string;
  } = {}
): string {
  const { compact = false, includeCurrency = true, locale = 'nl-NL' } = options;

  const formatter = new Intl.NumberFormat(locale, {
    style: includeCurrency ? 'currency' : 'decimal',
    currency: 'EUR',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0,
  });

  return formatter.format(price);
}

/**
 * Format a price range
 * @param min - Minimum price
 * @param max - Maximum price
 * @returns Formatted range string (e.g., "€ 400.000 - € 500.000")
 */
export function formatPriceRange(min: number, max: number): string {
  return `${formatPrice(min)} - ${formatPrice(max)}`;
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

/**
 * Format a date relative to now (e.g., "2 hours ago", "yesterday")
 * @param date - Date to format (string or Date)
 * @param locale - Locale for formatting
 * @returns Relative time string
 */
export function formatRelativeTime(
  date: string | Date,
  locale: string = 'nl-NL'
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
    /** Locale */
    locale?: string;
  } = {}
): string {
  const { includeTime = false, style = 'medium', locale = 'nl-NL' } = options;
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  const dateStyle =
    style === 'short' ? 'short' : style === 'long' ? 'long' : 'medium';

  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle,
    timeStyle: includeTime ? 'short' : undefined,
  });

  return formatter.format(dateObj);
}

/**
 * Format a Dutch postal code (ensure proper spacing)
 * @param postalCode - Postal code (with or without space)
 * @returns Formatted postal code (e.g., "1234 AB")
 */
export function formatPostalCode(postalCode: string): string {
  // Remove any existing spaces and convert to uppercase
  const cleaned = postalCode.replace(/\s/g, '').toUpperCase();

  // Insert space between numbers and letters
  if (cleaned.length === 6) {
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4)}`;
  }

  return cleaned;
}

/**
 * Format a full Dutch address
 * @param parts - Address parts
 * @returns Formatted address string
 */
export function formatAddress(parts: {
  streetName: string;
  houseNumber: string;
  houseNumberAddition?: string;
  postalCode?: string;
  city?: string;
}): string {
  const { streetName, houseNumber, houseNumberAddition, postalCode, city } =
    parts;

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

/**
 * Format area in square meters
 * @param sqm - Area in square meters
 * @returns Formatted string (e.g., "120 m²")
 */
export function formatArea(sqm: number): string {
  return `${sqm.toLocaleString('nl-NL')} m²`;
}

/**
 * Format a number with thousands separators
 * @param value - Number to format
 * @param locale - Locale for formatting
 * @returns Formatted number string
 */
export function formatNumber(value: number, locale: string = 'nl-NL'): string {
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
  return karma.toLocaleString('nl-NL');
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
