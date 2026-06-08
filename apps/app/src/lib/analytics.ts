import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type AnalyticsConsent = 'granted' | 'denied' | 'unknown';
export type AnalyticsProperties = Record<string, unknown>;

export interface HuisHypeAnalyticsEvent {
  name: string;
  properties: AnalyticsProperties;
  timestamp: string;
}

interface AnalyticsGlobal {
  __HUISHYPE_ANALYTICS_EVENTS__?: HuisHypeAnalyticsEvent[];
  __HUISHYPE_ANALYTICS_LISTENER__?: (event: HuisHypeAnalyticsEvent) => void;
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

type ScreenView = {
  path: string;
  params?: AnalyticsProperties;
};

type GtagWindow = typeof globalThis &
  AnalyticsGlobal & {
    document?: Document;
    location?: Location;
    CustomEvent?: typeof CustomEvent;
    dispatchEvent?: (event: Event) => boolean;
  };

export const ANALYTICS_CONSENT_STORAGE_KEY = 'huishype_analytics_consent';

const GA4_SCRIPT_ID = 'huishype-ga4-script';
const SENSITIVE_KEY_PARTS = [
  'address',
  'auth',
  'comment',
  'email',
  'house_number',
  'listing_url',
  'raw',
  'returnto',
  'search',
  'token',
  'url',
  'userid',
];
const SENSITIVE_KEY_NAMES = new Set(['q', 'query']);

let consentState: AnalyticsConsent | null = null;
let initializedMeasurementId: string | null = null;
let latestScreenView: ScreenView | null = null;

export function getGa4MeasurementId(): string {
  return (process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID ?? '').trim();
}

export function isGa4AnalyticsConfigured(): boolean {
  return getGa4MeasurementId().length > 0;
}

export async function getAnalyticsConsent(): Promise<AnalyticsConsent> {
  const storedConsent = await readStoredConsent();
  consentState = storedConsent;
  applyConsentToGa4(storedConsent);
  return storedConsent;
}

export async function setAnalyticsConsent(granted: boolean): Promise<AnalyticsConsent> {
  const stored = await writeStoredConsent(granted ? 'granted' : 'denied');
  const nextConsent: AnalyticsConsent = stored ? (granted ? 'granted' : 'denied') : granted ? 'unknown' : 'denied';

  consentState = nextConsent;
  applyConsentToGa4(nextConsent);

  if (nextConsent === 'granted') {
    ensureGa4Ready();
    flushLatestScreenView();
  }

  return nextConsent;
}

export function trackAnalyticsEvent(
  name: string,
  properties: AnalyticsProperties = {},
): HuisHypeAnalyticsEvent {
  const event = emitLocalAnalyticsEvent(name, properties);
  sendGa4Event(name, properties);
  return event;
}

export function trackScreenView(path: string, params: AnalyticsProperties = {}): HuisHypeAnalyticsEvent {
  latestScreenView = { path, params };

  const event = emitLocalAnalyticsEvent('screen_view', {
    path,
    ...sanitizeAnalyticsProperties(params),
  });

  if (canSendGa4()) {
    sendGa4PageView(path, params);
  }

  return event;
}

export function emitLocalAnalyticsEvent(
  name: string,
  properties: AnalyticsProperties = {},
): HuisHypeAnalyticsEvent {
  const event: HuisHypeAnalyticsEvent = {
    name,
    properties,
    timestamp: new Date().toISOString(),
  };
  const analyticsGlobal = globalThis as GtagWindow;

  analyticsGlobal.__HUISHYPE_ANALYTICS_LISTENER__?.(event);
  analyticsGlobal.__HUISHYPE_ANALYTICS_EVENTS__?.push(event);

  if (
    typeof analyticsGlobal.dispatchEvent === 'function' &&
    typeof analyticsGlobal.CustomEvent === 'function'
  ) {
    analyticsGlobal.dispatchEvent(
      new analyticsGlobal.CustomEvent('huishype:analytics', {
        detail: event,
      }),
    );
  }

  return event;
}

function canSendGa4(): boolean {
  return Platform.OS === 'web' && consentState === 'granted' && isGa4AnalyticsConfigured();
}

function sendGa4Event(name: string, properties: AnalyticsProperties): void {
  if (!canSendGa4() || !ensureGa4Ready()) {
    return;
  }

  const gtag = (globalThis as GtagWindow).gtag;
  if (typeof gtag !== 'function') {
    return;
  }

  gtag('event', name, sanitizeAnalyticsProperties(properties));
}

function sendGa4PageView(path: string, params: AnalyticsProperties = {}): void {
  if (!canSendGa4() || !ensureGa4Ready()) {
    return;
  }

  const gtag = (globalThis as GtagWindow).gtag;
  if (typeof gtag !== 'function') {
    return;
  }

  gtag('event', 'page_view', {
    page_path: normalizePagePath(path),
    ...sanitizeAnalyticsProperties(params),
  });
}

function flushLatestScreenView(): void {
  if (!latestScreenView) {
    return;
  }

  sendGa4PageView(latestScreenView.path, latestScreenView.params);
}

function ensureGa4Ready(): boolean {
  const measurementId = getGa4MeasurementId();
  if (Platform.OS !== 'web' || !measurementId) {
    return false;
  }

  const analyticsGlobal = globalThis as GtagWindow;
  const documentRef = analyticsGlobal.document;
  if (!documentRef?.head) {
    return false;
  }

  analyticsGlobal.dataLayer = analyticsGlobal.dataLayer ?? [];
  analyticsGlobal.gtag =
    analyticsGlobal.gtag ??
    function gtagShim(...args: unknown[]) {
      analyticsGlobal.dataLayer?.push(args);
    };

  if (!documentRef.getElementById(GA4_SCRIPT_ID)) {
    const script = documentRef.createElement('script');
    script.id = GA4_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.setAttribute('data-huishype-ga4', measurementId);
    documentRef.head.appendChild(script);
  }

  if (initializedMeasurementId !== measurementId) {
    initializedMeasurementId = measurementId;
    analyticsGlobal.gtag('consent', 'default', {
      analytics_storage: 'granted',
      ad_personalization: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
    });
    analyticsGlobal.gtag('js', new Date());
    analyticsGlobal.gtag('config', measurementId, {
      send_page_view: false,
    });
  }

  (analyticsGlobal as GtagWindow & Record<string, unknown>)[`ga-disable-${measurementId}`] = false;
  return true;
}

function applyConsentToGa4(consent: AnalyticsConsent): void {
  const measurementId = getGa4MeasurementId();
  const analyticsGlobal = globalThis as GtagWindow;

  if (measurementId) {
    (analyticsGlobal as GtagWindow & Record<string, unknown>)[`ga-disable-${measurementId}`] =
      consent !== 'granted';
  }

  if (typeof analyticsGlobal.gtag !== 'function') {
    return;
  }

  analyticsGlobal.gtag('consent', 'update', {
    analytics_storage: consent === 'granted' ? 'granted' : 'denied',
    ad_personalization: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
  });
}

function normalizePagePath(path: string): string {
  const normalized = path.trim();
  if (!normalized) {
    return '/';
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function sanitizeAnalyticsProperties(properties: AnalyticsProperties): AnalyticsProperties {
  const sanitized: AnalyticsProperties = {};

  for (const [key, value] of Object.entries(properties)) {
    if (isSensitiveKey(key)) {
      continue;
    }

    const sanitizedKey = sanitizeAnalyticsKey(key);
    if (!sanitizedKey) {
      continue;
    }

    const sanitizedValue = sanitizeAnalyticsValue(value);
    if (sanitizedValue === undefined) {
      continue;
    }

    sanitized[sanitizedKey] = sanitizedValue;
  }

  return sanitized;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[\s_-]+/g, '').toLowerCase();
  if (SENSITIVE_KEY_NAMES.has(normalized)) {
    return true;
  }

  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part.replace(/_/g, '')));
}

function sanitizeAnalyticsKey(key: string): string | null {
  const cleaned = key
    .trim()
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!cleaned) {
    return null;
  }

  const prefixed = /^[A-Za-z]/.test(cleaned) ? cleaned : `p_${cleaned}`;
  return prefixed.slice(0, 40);
}

function sanitizeAnalyticsValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string') {
    return value.slice(0, 100);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return undefined;
}

async function readStoredConsent(): Promise<AnalyticsConsent> {
  try {
    const stored =
      Platform.OS === 'web'
        ? getWebStorage()?.getItem(ANALYTICS_CONSENT_STORAGE_KEY)
        : await SecureStore.getItemAsync(ANALYTICS_CONSENT_STORAGE_KEY);

    return stored === 'granted' || stored === 'denied' ? stored : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function writeStoredConsent(consent: Exclude<AnalyticsConsent, 'unknown'>): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      const storage = getWebStorage();
      if (!storage) {
        return false;
      }
      storage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, consent);
      return true;
    }

    await SecureStore.setItemAsync(ANALYTICS_CONSENT_STORAGE_KEY, consent);
    return true;
  } catch {
    return false;
  }
}

function getWebStorage(): Storage | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  return localStorage;
}
