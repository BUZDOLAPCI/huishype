import { describe, it, expect } from '@jest/globals';
import { isAllowedListingUrl } from '../../routes/listings.js';

describe('isAllowedListingUrl', () => {
  // Allowed URLs
  it.each([
    'https://www.funda.nl/koop/amsterdam/huis-12345/',
    'https://funda.nl/koop/amsterdam/huis-12345/',
    'https://www.pararius.nl/huurwoningen/amsterdam/apartment-12345/',
    'https://pararius.nl/huurwoningen/amsterdam/',
    'https://www.pararius.com/apartment-for-rent/amsterdam/12345/',
    'https://cloud.funda.nl/something',
  ])('should allow %s', (url) => {
    expect(isAllowedListingUrl(url)).toBe(true);
  });

  // Blocked URLs: wrong protocol
  it.each([
    'http://www.funda.nl/koop/amsterdam/',
    'http://funda.nl/koop/amsterdam/',
    'ftp://funda.nl/file',
  ])('should block non-HTTPS URL: %s', (url) => {
    expect(isAllowedListingUrl(url)).toBe(false);
  });

  // Blocked URLs: wrong domain
  it.each([
    'https://evil.com/funda.nl',
    'https://notfunda.nl/koop/',
    'https://funda.nl.evil.com/koop/',
    'https://example.com',
    'https://google.com',
  ])('should block non-whitelisted domain: %s', (url) => {
    expect(isAllowedListingUrl(url)).toBe(false);
  });

  // Blocked URLs: private IPs / SSRF attempts
  it.each([
    'https://127.0.0.1/',
    'https://localhost/',
    'https://10.0.0.1/',
    'https://192.168.1.1/',
    'https://169.254.169.254/',  // AWS metadata
    'https://[::1]/',
  ])('should block IP/localhost URL: %s', (url) => {
    expect(isAllowedListingUrl(url)).toBe(false);
  });

  // Blocked: invalid URLs
  it.each([
    '',
    'not-a-url',
    'javascript:alert(1)',
  ])('should block invalid URL: %s', (url) => {
    expect(isAllowedListingUrl(url)).toBe(false);
  });
});
