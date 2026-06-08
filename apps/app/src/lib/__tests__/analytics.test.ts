import { Platform } from 'react-native';

const originalPlatform = Platform.OS;
const originalGa4MeasurementId = process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID;

function loadAnalyticsModule() {
  jest.resetModules();
  const reactNative = require('react-native') as typeof import('react-native');
  Object.defineProperty(reactNative.Platform, 'OS', {
    configurable: true,
    value: 'web',
  });
  return require('../analytics') as typeof import('../analytics');
}

describe('analytics', () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '';
    delete (globalThis as { dataLayer?: unknown[] }).dataLayer;
    delete (globalThis as { gtag?: unknown }).gtag;
    delete (globalThis as Record<string, unknown>)['ga-disable-G-TEST123'];
    process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID = 'G-TEST123';
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'web',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatform,
    });

    if (originalGa4MeasurementId === undefined) {
      delete process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID;
    } else {
      process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID = originalGa4MeasurementId;
    }
  });

  it('returns unknown when no consent choice is saved', async () => {
    const { getAnalyticsConsent } = loadAnalyticsModule();

    await expect(getAnalyticsConsent()).resolves.toBe('unknown');
  });

  it('persists accepted and declined consent choices', async () => {
    const {
      ANALYTICS_CONSENT_STORAGE_KEY,
      getAnalyticsConsent,
      setAnalyticsConsent,
    } = loadAnalyticsModule();

    await expect(setAnalyticsConsent(true)).resolves.toBe('granted');
    expect(localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe('granted');
    await expect(getAnalyticsConsent()).resolves.toBe('granted');

    await expect(setAnalyticsConsent(false)).resolves.toBe('denied');
    expect(localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe('denied');
    await expect(getAnalyticsConsent()).resolves.toBe('denied');
  });

  it('does not inject the GA4 script before consent', () => {
    const { trackAnalyticsEvent } = loadAnalyticsModule();

    trackAnalyticsEvent('follow_created', { surface: 'user_search' });

    expect(document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]')).toHaveLength(
      0,
    );
  });

  it('injects the GA4 script once after consent is granted', async () => {
    const { setAnalyticsConsent, trackAnalyticsEvent } = loadAnalyticsModule();

    await setAnalyticsConsent(true);
    trackAnalyticsEvent('follow_created', { surface: 'user_search' });
    trackAnalyticsEvent('unfollow', { surface: 'user_search' });

    const scripts = document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.getAttribute('src')).toBe(
      'https://www.googletagmanager.com/gtag/js?id=G-TEST123'
    );
  });

  it('sends the current screen view after consent is accepted', async () => {
    const { setAnalyticsConsent, trackScreenView } = loadAnalyticsModule();

    trackScreenView('/settings', {
      q: 'raw address search',
      tab: 'legal',
    });

    expect(
      ((globalThis as { dataLayer?: unknown[] }).dataLayer ?? []).some(
        (entry) => Array.isArray(entry) && entry[1] === 'page_view',
      ),
    ).toBe(false);

    await setAnalyticsConsent(true);

    expect((globalThis as { dataLayer?: unknown[] }).dataLayer).toContainEqual([
      'event',
      'page_view',
      {
        page_path: '/settings',
        tab: 'legal',
      },
    ]);
  });

  it('does nothing when the GA4 measurement ID is missing', async () => {
    delete process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID;
    const { setAnalyticsConsent, trackAnalyticsEvent } = loadAnalyticsModule();

    await setAnalyticsConsent(true);
    trackAnalyticsEvent('follow_created', { surface: 'user_search' });

    expect(document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]')).toHaveLength(
      0,
    );
  });

  it('fails closed when storage cannot persist an accepted choice', async () => {
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const { setAnalyticsConsent, trackAnalyticsEvent } = loadAnalyticsModule();

    await expect(setAnalyticsConsent(true)).resolves.toBe('unknown');
    trackAnalyticsEvent('follow_created', { surface: 'user_search' });

    expect(setItemSpy).toHaveBeenCalled();
    expect(document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]')).toHaveLength(
      0,
    );
  });
});
