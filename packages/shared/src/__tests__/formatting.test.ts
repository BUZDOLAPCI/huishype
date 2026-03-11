import { describe, it, expect } from 'vitest';
import {
  formatPrice,
  formatPropertyPrice,
  formatPriceRange,
  formatPercentage,
  formatRelativeTime,
  formatDate,
  formatPostalCode,
  formatAddress,
  formatArea,
  formatNumber,
  formatKarma,
  getKarmaRank,
  truncateText,
} from '../utils/formatting';

// ---------------------------------------------------------------------------
// formatPrice
// ---------------------------------------------------------------------------

describe('formatPrice', () => {
  it('defaults to NL locale + EUR currency', () => {
    const result = formatPrice(450000);
    // nl-NL EUR => "€ 450.000" (Intl adds non-breaking space variants)
    expect(result).toContain('450');
    expect(result).toContain('€');
  });

  it('supports explicit countryCode', () => {
    const result = formatPrice(100000, { countryCode: 'GB' });
    expect(result).toContain('£');
    expect(result).toContain('100');
  });

  it('respects compact notation', () => {
    const result = formatPrice(450000, { compact: true });
    // Compact should produce something like "€ 450K" or "€ 450.000"
    expect(result.length).toBeLessThan(
      formatPrice(450000, { compact: false }).length
    );
  });

  it('respects includeCurrency: false', () => {
    const result = formatPrice(450000, { includeCurrency: false });
    expect(result).not.toContain('€');
  });

  it('explicit locale overrides countryCode', () => {
    const result = formatPrice(100000, { countryCode: 'NL', locale: 'en-US' });
    // en-US formats with commas: "€100,000"
    expect(result).toContain('100');
    expect(result).toContain('€');
  });

  it('explicit currency overrides countryCode', () => {
    const result = formatPrice(100000, { countryCode: 'NL', currency: 'GBP' });
    expect(result).toContain('£');
  });
});

// ---------------------------------------------------------------------------
// formatPropertyPrice
// ---------------------------------------------------------------------------

describe('formatPropertyPrice', () => {
  it('NL: formats EUR', () => {
    const result = formatPropertyPrice(100000, 'NL');
    expect(result).toContain('€');
    expect(result).toContain('100');
  });

  it('GB: formats GBP', () => {
    const result = formatPropertyPrice(100000, 'GB');
    expect(result).toContain('£');
    expect(result).toContain('100');
  });

  it('SE: formats SEK', () => {
    const result = formatPropertyPrice(100000, 'SE');
    // SEK symbol varies by Intl implementation — just check the number is present
    expect(result).toContain('100');
  });

  it('CH: formats CHF', () => {
    const result = formatPropertyPrice(100000, 'CH');
    expect(result).toContain('100');
  });

  it('defaults to NL when no countryCode provided', () => {
    const result = formatPropertyPrice(100000);
    expect(result).toContain('€');
  });

  it('supports compact mode', () => {
    const full = formatPropertyPrice(450000, 'NL');
    const compact = formatPropertyPrice(450000, 'NL', { compact: true });
    expect(compact.length).toBeLessThan(full.length);
  });
});

// ---------------------------------------------------------------------------
// formatPriceRange
// ---------------------------------------------------------------------------

describe('formatPriceRange', () => {
  it('formats a range with NL default', () => {
    const result = formatPriceRange(400000, 500000);
    expect(result).toContain('€');
    expect(result).toContain('-');
  });

  it('accepts countryCode', () => {
    const result = formatPriceRange(400000, 500000, 'GB');
    expect(result).toContain('£');
  });
});

// ---------------------------------------------------------------------------
// formatPercentage
// ---------------------------------------------------------------------------

describe('formatPercentage', () => {
  it('formats basic percentage', () => {
    expect(formatPercentage(0.15)).toBe('15.0%');
  });

  it('shows sign for positive values', () => {
    expect(formatPercentage(0.15, { showSign: true })).toBe('+15.0%');
  });

  it('does not show sign for negative values', () => {
    expect(formatPercentage(-0.05, { showSign: true })).toBe('-5.0%');
  });

  it('respects decimals option', () => {
    expect(formatPercentage(0.1234, { decimals: 2 })).toBe('12.34%');
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime (non-property — device locale)
// ---------------------------------------------------------------------------

describe('formatRelativeTime', () => {
  it('formats without explicit locale (device default)', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const result = formatRelativeTime(fiveMinutesAgo);
    // Should produce something like "5 minutes ago" in whatever the test env locale is
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('accepts explicit locale', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const result = formatRelativeTime(fiveMinutesAgo, 'en-US');
    expect(result).toContain('5');
    expect(result.toLowerCase()).toContain('minute');
  });

  it('accepts a Date string', () => {
    const dateStr = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(dateStr);
    expect(result).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// formatDate (non-property — device locale)
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('formats without explicit locale', () => {
    const result = formatDate('2025-06-15');
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('accepts explicit locale', () => {
    const result = formatDate('2025-06-15', { locale: 'en-US' });
    expect(result).toContain('2025');
  });
});

// ---------------------------------------------------------------------------
// formatPostalCode
// ---------------------------------------------------------------------------

describe('formatPostalCode', () => {
  it('NL default: "1234AB" → "1234 AB"', () => {
    expect(formatPostalCode('1234AB')).toBe('1234 AB');
  });

  it('NL via countryCode: "1234AB" → "1234 AB"', () => {
    expect(formatPostalCode('1234AB', 'NL')).toBe('1234 AB');
  });

  it('GB via countryCode: "SW1A1AA" → "SW1A 1AA"', () => {
    expect(formatPostalCode('SW1A1AA', 'GB')).toBe('SW1A 1AA');
  });

  it('SE via countryCode: "11120" → "111 20"', () => {
    expect(formatPostalCode('11120', 'SE')).toBe('111 20');
  });
});

// ---------------------------------------------------------------------------
// formatAddress
// ---------------------------------------------------------------------------

describe('formatAddress', () => {
  it('Dutch default (no countryCode)', () => {
    const result = formatAddress({
      streetName: 'Kalverstraat',
      houseNumber: '1',
      houseNumberAddition: 'A',
      postalCode: '1012NX',
      city: 'Amsterdam',
    });
    expect(result).toBe('Kalverstraat 1A, 1012 NX Amsterdam');
  });

  it('Dutch via countryCode', () => {
    const result = formatAddress({
      streetName: 'Kalverstraat',
      houseNumber: '1',
      postalCode: '1012 NX',
      city: 'Amsterdam',
      countryCode: 'NL',
    });
    expect(result).toBe('Kalverstraat 1, 1012 NX Amsterdam');
  });

  it('GB via countryCode: "13A High Street, London, SW1A 1AA"', () => {
    const result = formatAddress({
      streetName: 'High Street',
      houseNumber: '13',
      houseNumberAddition: 'A',
      postalCode: 'SW1A 1AA',
      city: 'London',
      countryCode: 'GB',
    });
    expect(result).toBe('13A High Street, London, SW1A 1AA');
  });

  it('DE via countryCode: "Hauptstraße 13A, 10115 Berlin"', () => {
    const result = formatAddress({
      streetName: 'Hauptstraße',
      houseNumber: '13',
      houseNumberAddition: 'A',
      postalCode: '10115',
      city: 'Berlin',
      countryCode: 'DE',
    });
    expect(result).toBe('Hauptstraße 13A, 10115 Berlin');
  });

  it('FR via countryCode: "13A Rue de Rivoli, 75001 Paris"', () => {
    const result = formatAddress({
      streetName: 'Rue de Rivoli',
      houseNumber: '13',
      houseNumberAddition: 'A',
      postalCode: '75001',
      city: 'Paris',
      countryCode: 'FR',
    });
    expect(result).toBe('13A Rue de Rivoli, 75001 Paris');
  });

  it('IT via countryCode: "Via Roma, 13, 00100 Roma"', () => {
    const result = formatAddress({
      streetName: 'Via Roma',
      houseNumber: '13',
      postalCode: '00100',
      city: 'Roma',
      countryCode: 'IT',
    });
    expect(result).toBe('Via Roma, 13, 00100 Roma');
  });

  it('ES via countryCode: "Calle Gran Via, 1, 28013 Madrid"', () => {
    const result = formatAddress({
      streetName: 'Calle Gran Via',
      houseNumber: '1',
      postalCode: '28013',
      city: 'Madrid',
      countryCode: 'ES',
    });
    expect(result).toBe('Calle Gran Via, 1, 28013 Madrid');
  });
});

// ---------------------------------------------------------------------------
// formatArea
// ---------------------------------------------------------------------------

describe('formatArea', () => {
  it('formats with device locale by default', () => {
    const result = formatArea(120);
    expect(result).toContain('120');
    expect(result).toContain('m²');
  });

  it('accepts explicit locale', () => {
    const result = formatArea(1200, 'nl-NL');
    expect(result).toContain('1.200');
    expect(result).toContain('m²');
  });
});

// ---------------------------------------------------------------------------
// formatNumber
// ---------------------------------------------------------------------------

describe('formatNumber', () => {
  it('formats with device locale by default', () => {
    const result = formatNumber(1234567);
    expect(result).toBeTruthy();
  });

  it('accepts explicit locale', () => {
    const result = formatNumber(1234567, 'en-US');
    expect(result).toBe('1,234,567');
  });
});

// ---------------------------------------------------------------------------
// formatKarma (non-property — device locale)
// ---------------------------------------------------------------------------

describe('formatKarma', () => {
  it('formats small karma normally', () => {
    const result = formatKarma(500);
    expect(result).toContain('500');
  });

  it('formats large karma in K notation', () => {
    expect(formatKarma(15000)).toBe('15.0K');
  });
});

// ---------------------------------------------------------------------------
// getKarmaRank
// ---------------------------------------------------------------------------

describe('getKarmaRank', () => {
  it('returns Newbie for < 50', () => expect(getKarmaRank(0)).toBe('Newbie'));
  it('returns Regular for >= 50', () => expect(getKarmaRank(50)).toBe('Regular'));
  it('returns Trusted for >= 250', () => expect(getKarmaRank(250)).toBe('Trusted'));
  it('returns Expert for >= 1000', () => expect(getKarmaRank(1000)).toBe('Expert'));
  it('returns Master for >= 5000', () => expect(getKarmaRank(5000)).toBe('Master'));
  it('returns Legend for >= 10000', () => expect(getKarmaRank(10000)).toBe('Legend'));
});

// ---------------------------------------------------------------------------
// truncateText
// ---------------------------------------------------------------------------

describe('truncateText', () => {
  it('does not truncate short text', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  it('truncates long text with ellipsis', () => {
    expect(truncateText('hello world', 8)).toBe('hello...');
  });
});
