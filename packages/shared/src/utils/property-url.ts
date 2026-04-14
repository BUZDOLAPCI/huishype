import {
  isValidCountryCode,
  type CountryCode,
} from '../config/country-config.js';
import { normalizePostalCode } from './validation.js';

const DEFAULT_COUNTRY_CODE: CountryCode = 'NL';
const INTERNAL_BASE_URL = 'https://huishype.invalid';
const MAX_RETURN_TO_DEPTH = 4;
const LEGACY_RETURN_TO_PATH_PREFIXES = ['/property', '/comments', '/guesses'];
const SAFE_RETURN_TO_STATIC_PREFIXES = new Set([
  'feed',
  'saved',
  'profile',
  'notifications',
  'leaderboard',
  'auth',
  'user',
  'showcase',
]);
const LEGACY_RETURN_TO_PREFIXES = new Set(['property', 'comments', 'guesses']);
const CAMERA_PATH_REGEX =
  /^\/?@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)z$/;
export const CANONICAL_LATIN_REPLACEMENTS: Record<string, string> = {
  ß: 'ss',
  Æ: 'AE',
  æ: 'ae',
  Ø: 'O',
  ø: 'o',
  Œ: 'OE',
  œ: 'oe',
  Ł: 'L',
  ł: 'l',
  Đ: 'D',
  đ: 'd',
  Þ: 'TH',
  þ: 'th',
};

export interface CanonicalMapCamera {
  lat: number;
  lng: number;
  zoom: number;
}

export interface CanonicalCountryPrefixResolution {
  countryCode: CountryCode;
  remainingSegments: string[];
  hasExplicitPrefix: boolean;
  isCanonical: boolean;
}

export interface CanonicalMapAreaInput {
  city: string;
  countryCode?: CountryCode | string | null;
}

export interface CanonicalPostcodeMapInput extends CanonicalMapAreaInput {
  postalCode: string;
}

export interface CanonicalPropertyRouteInput extends CanonicalPostcodeMapInput {
  streetName: string;
  houseNumber: string | number;
  houseNumberAddition?: string | null;
}

function normalizeCanonicalCountryCode(
  countryCode?: CountryCode | string | null,
): CountryCode {
  if (!countryCode) {
    return DEFAULT_COUNTRY_CODE;
  }

  const normalized = countryCode.trim().toUpperCase();
  if (!isValidCountryCode(normalized)) {
    throw new Error(`Invalid country code: ${countryCode}`);
  }

  return normalized;
}

function transliterate(value: string): string {
  return Array.from(value, (char) => CANONICAL_LATIN_REPLACEMENTS[char] ?? char).join('');
}

export function normalizeComparableText(value: string | null | undefined): string {
  return transliterate(value ?? '')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/['’`]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugifySegment(value: string, label: string): string {
  const slug = normalizeComparableText(value)
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-');

  if (!slug) {
    throw new Error(`Cannot build canonical ${label} slug from empty input`);
  }

  return slug;
}

function joinPathSegments(...segments: Array<string | null | undefined>): string {
  const filtered = segments.filter((segment): segment is string => Boolean(segment));
  return filtered.length === 0 ? '/' : `/${filtered.join('/')}`;
}

function stripPostcodeSeparators(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function formatFixedNumber(value: number, decimals: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return normalized
    .toFixed(decimals)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

function decodePathname(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function isAllowedInternalReturnToPath(pathname: string): boolean {
  if (pathname === '/') {
    return true;
  }

  if (parseCanonicalCameraPath(pathname) !== null) {
    return true;
  }

  const decodedPathname = decodePathname(pathname);
  if (!decodedPathname) {
    return false;
  }

  const segments = decodedPathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return true;
  }

  const firstSegment = segments[0]!.toLowerCase();
  if (LEGACY_RETURN_TO_PREFIXES.has(firstSegment)) {
    return false;
  }

  if (SAFE_RETURN_TO_STATIC_PREFIXES.has(firstSegment)) {
    return true;
  }

  if (firstSegment === 'map') {
    const resolution = resolveCanonicalCountryPrefix(segments.slice(1));
    return resolution.isCanonical && resolution.remainingSegments.length === 4;
  }

  const resolution = resolveCanonicalCountryPrefix(segments);
  if (!resolution.isCanonical) {
    return false;
  }

  switch (resolution.remainingSegments.length) {
    case 1:
    case 2:
    case 4:
      return true;
    case 5: {
      const leaf = resolution.remainingSegments[4]?.toLowerCase();
      return leaf === 'comments' || leaf === 'guesses';
    }
    default:
      return false;
  }
}

function normalizeInternalReturnToAtDepth(
  value: string | string[] | null | undefined,
  depth: number,
): string | null {
  if (typeof value !== 'string' || depth > MAX_RETURN_TO_DEPTH) {
    return null;
  }

  const trimmed = value.trim();
  if (
    !trimmed ||
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    trimmed.includes('/./') ||
    trimmed.includes('/../') ||
    trimmed.endsWith('/.') ||
    trimmed.endsWith('/..')
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed, INTERNAL_BASE_URL);
  } catch {
    return null;
  }

  if (url.origin !== INTERNAL_BASE_URL || url.hash) {
    return null;
  }

  const decodedPathname = decodePathname(url.pathname);
  if (!decodedPathname) {
    return null;
  }

  if (LEGACY_RETURN_TO_PATH_PREFIXES.some((prefix) => decodedPathname === prefix || decodedPathname.startsWith(`${prefix}/`))) {
    return null;
  }

  if (
    !url.pathname.startsWith('/') ||
    decodedPathname.includes('\\') ||
    decodedPathname.includes('//') ||
    decodedPathname.includes('/./') ||
    decodedPathname.includes('/../') ||
    decodedPathname.endsWith('/.') ||
    decodedPathname.endsWith('/..')
  ) {
    return null;
  }

  if (!isAllowedInternalReturnToPath(url.pathname)) {
    return null;
  }

  const searchParams = [...url.searchParams.entries()];
  if (searchParams.length === 0) {
    return url.pathname;
  }

  if (searchParams.length !== 1 || searchParams[0]?.[0] !== 'returnTo') {
    return null;
  }

  const nestedReturnTo = normalizeInternalReturnToAtDepth(searchParams[0][1], depth + 1);
  if (!nestedReturnTo) {
    return null;
  }

  return `${url.pathname}?returnTo=${encodeURIComponent(nestedReturnTo)}`;
}

function buildCanonicalAddressSegments(
  input: CanonicalPropertyRouteInput,
): [string | null, string, string, string, string] {
  const countryCode = normalizeCanonicalCountryCode(input.countryCode);

  return [
    getCanonicalCountryPrefixSegment(countryCode),
    buildCanonicalCitySlug(input.city),
    buildCanonicalPostcodeSlug(input.postalCode, countryCode),
    buildCanonicalStreetSlug(input.streetName),
    buildCanonicalHouseSegment(input.houseNumber, input.houseNumberAddition),
  ];
}

export function getCanonicalCountryPrefixSegment(
  countryCode?: CountryCode | string | null,
): string | null {
  const normalizedCountryCode = normalizeCanonicalCountryCode(countryCode);
  return normalizedCountryCode === DEFAULT_COUNTRY_CODE
    ? null
    : normalizedCountryCode.toLowerCase();
}

export function getCanonicalCountryPrefix(
  countryCode?: CountryCode | string | null,
): string {
  const segment = getCanonicalCountryPrefixSegment(countryCode);
  return segment ? `/${segment}` : '';
}

export function resolveCanonicalCountryPrefix(
  segments: readonly string[],
): CanonicalCountryPrefixResolution {
  const normalizedSegments = segments
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const firstSegment = normalizedSegments[0]?.toLowerCase();

  if (firstSegment && /^[a-z]{2}$/.test(firstSegment)) {
    const candidate = firstSegment.toUpperCase();
    if (isValidCountryCode(candidate)) {
      const countryCode = candidate as CountryCode;
      return {
        countryCode,
        remainingSegments: normalizedSegments.slice(1),
        hasExplicitPrefix: true,
        isCanonical: countryCode !== DEFAULT_COUNTRY_CODE,
      };
    }
  }

  return {
    countryCode: DEFAULT_COUNTRY_CODE,
    remainingSegments: normalizedSegments.slice(),
    hasExplicitPrefix: false,
    isCanonical: true,
  };
}

export function buildCanonicalCitySlug(city: string): string {
  return slugifySegment(city, 'city');
}

export function buildCanonicalStreetSlug(streetName: string): string {
  return slugifySegment(streetName, 'street');
}

export function buildCanonicalPostcodeSlug(
  postalCode: string,
  countryCode?: CountryCode | string | null,
): string {
  const normalizedCountryCode = normalizeCanonicalCountryCode(countryCode);
  const slug = stripPostcodeSeparators(
    normalizePostalCode(postalCode, normalizedCountryCode),
  );

  if (!slug) {
    throw new Error('Cannot build canonical postcode slug from empty input');
  }

  return slug;
}

export function buildCanonicalHouseSegment(
  houseNumber: string | number,
  houseNumberAddition?: string | null,
): string {
  const houseNumberSlug = slugifySegment(String(houseNumber), 'house number');
  const houseAdditionSlug = houseNumberAddition
    ? slugifySegment(houseNumberAddition, 'house number addition')
    : null;

  return houseAdditionSlug
    ? `${houseNumberSlug}-${houseAdditionSlug}`
    : houseNumberSlug;
}

export function serializeCanonicalCameraPath(camera: CanonicalMapCamera): string {
  if (
    !Number.isFinite(camera.lat) ||
    !Number.isFinite(camera.lng) ||
    !Number.isFinite(camera.zoom) ||
    camera.lat < -90 ||
    camera.lat > 90 ||
    camera.lng < -180 ||
    camera.lng > 180 ||
    camera.zoom < 0
  ) {
    throw new Error('Invalid canonical camera coordinates');
  }

  const lat = formatFixedNumber(camera.lat, 7);
  const lng = formatFixedNumber(camera.lng, 7);
  const zoom = formatFixedNumber(camera.zoom, 2);

  return `/@${lat},${lng},${zoom}z`;
}

export function parseCanonicalCameraPath(path: string): CanonicalMapCamera | null {
  const match = path.trim().match(CAMERA_PATH_REGEX);
  if (!match) {
    return null;
  }

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  const zoom = Number(match[3]);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(zoom) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180 ||
    zoom < 0
  ) {
    return null;
  }

  return { lat, lng, zoom };
}

export function buildCanonicalCityMapPath(
  input: CanonicalMapAreaInput,
): string {
  return joinPathSegments(
    getCanonicalCountryPrefixSegment(input.countryCode),
    buildCanonicalCitySlug(input.city),
  );
}

export function buildCanonicalPostcodeMapPath(
  input: CanonicalPostcodeMapInput,
): string {
  const countryCode = normalizeCanonicalCountryCode(input.countryCode);
  return joinPathSegments(
    getCanonicalCountryPrefixSegment(countryCode),
    buildCanonicalCitySlug(input.city),
    buildCanonicalPostcodeSlug(input.postalCode, countryCode),
  );
}

export function buildCanonicalPropertyPath(
  input: CanonicalPropertyRouteInput,
): string {
  return joinPathSegments(...buildCanonicalAddressSegments(input));
}

export function buildCanonicalMapPreviewPath(
  input: CanonicalPropertyRouteInput,
): string {
  return joinPathSegments('map', ...buildCanonicalAddressSegments(input));
}

export function buildCanonicalCommentsPath(
  input: CanonicalPropertyRouteInput,
): string {
  return joinPathSegments(...buildCanonicalAddressSegments(input), 'comments');
}

export function buildCanonicalGuessesPath(
  input: CanonicalPropertyRouteInput,
): string {
  return joinPathSegments(...buildCanonicalAddressSegments(input), 'guesses');
}

export function normalizeInternalReturnTo(
  value: string | string[] | null | undefined,
): string | null {
  return normalizeInternalReturnToAtDepth(value, 0);
}

export function appendInternalReturnTo(
  path: string,
  returnTo: string | string[] | null | undefined,
): string {
  const normalizedReturnTo = normalizeInternalReturnTo(returnTo);
  if (!normalizedReturnTo) {
    return path;
  }

  const url = new URL(path, INTERNAL_BASE_URL);
  url.searchParams.set('returnTo', normalizedReturnTo);

  const query = url.searchParams.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}
