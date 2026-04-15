import { Platform } from 'react-native';
import { buildPropertyMapRoute, type PropertyRouteAddressLike } from './property-route';

const DEFAULT_SHARE_ORIGIN = 'https://huishype.nl';

export interface PropertyShareData extends PropertyRouteAddressLike {
  address: string;
  city: string;
  postalCode?: string | null;
}

export interface PropertySharePayload {
  title: string;
  message: string;
  url: string;
}

export interface PropertyShareLinks {
  x: string;
  facebook: string;
  whatsapp: string;
  email: string;
}

function getWebNavigator(): Navigator | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return null;
  }

  return window.navigator ?? null;
}

function normalizeOrigin(origin?: string | null): string {
  if (origin?.trim()) {
    return origin.trim().replace(/\/+$/, '');
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }

  return DEFAULT_SHARE_ORIGIN;
}

export function formatPropertyShareLabel(property: PropertyShareData): string {
  const address = property.address.trim();
  const compactPostalCode = property.postalCode?.replace(/\s+/g, '').trim() || '';
  const city = property.city.trim();
  const locality = [compactPostalCode, city].filter(Boolean).join(' ');

  if (address && locality) {
    return `${address}, ${locality}`;
  }

  if (address) {
    return address;
  }

  if (locality) {
    return locality;
  }

  return 'this property';
}

export function buildPropertyShareUrl(
  property: PropertyShareData,
  origin?: string | null,
): string {
  try {
    return new URL(buildPropertyMapRoute(property), normalizeOrigin(origin)).toString();
  } catch {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.href) {
      return window.location.href;
    }

    return normalizeOrigin(origin);
  }
}

export function buildPropertySharePayload(
  property: PropertyShareData,
  origin?: string | null,
): PropertySharePayload {
  const title = `${property.address} - HuisHype`;
  const url = buildPropertyShareUrl(property, origin);
  const label = formatPropertyShareLabel(property);

  return {
    title,
    message: `Check out "${label}" on HuisHype: ${url}`,
    url,
  };
}

export function buildPropertyShareLinks(
  property: PropertyShareData,
  origin?: string | null,
): PropertyShareLinks {
  const payload = buildPropertySharePayload(property, origin);
  const sharePrompt = `Check out "${formatPropertyShareLabel(property)}" on HuisHype`;

  return {
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(sharePrompt)}&url=${encodeURIComponent(payload.url)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(payload.url)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(payload.message)}`,
    email: `mailto:?subject=${encodeURIComponent(payload.title)}&body=${encodeURIComponent(payload.message)}`,
  };
}

export function isUnsupportedWebShareError(error: unknown): boolean {
  if (Platform.OS !== 'web' || !(error instanceof Error)) {
    return false;
  }

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();

  return (
    name === 'notsupportederror' ||
    message.includes('share is not supported') ||
    message.includes('not supported in this browser')
  );
}
