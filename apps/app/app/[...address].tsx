/**
 * Catch-All Address Route — Resolver/Redirect
 *
 * Resolves hierarchical URL addresses to the canonical /property/[id] route.
 *
 * URL structure: /{city}/{zipcode}/{street}/{housenumber}
 * Example: /eindhoven/5651hp/deflectiespoelstraat/16
 *
 * When a full property address is provided (all 4 segments), this route:
 * 1. Geocodes the address via the Photon backend
 * 2. Resolves the geocoded result to a local property via /properties/resolve
 * 3. Redirects to /property/[id] if found
 * 4. Shows a not-found screen otherwise
 *
 * Partial URLs (city-only, city+postcode) render lightweight city/postcode
 * surfaces instead of navigating away during initial app boot.
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View, Pressable, StyleSheet } from 'react-native';
import {
  useLocalSearchParams,
  Stack,
  router,
  useRootNavigationState,
} from 'expo-router';

import { Icon } from '@/src/components/ui/Icon';
import { resolveProperty } from '@/src/utils/api';
import { apiGeocoder } from '@/src/services/api-geocoder';
import { splitHouseNumber } from '@/src/services/address-resolver';

interface AddressUrlParams {
  city?: string;
  zipcode?: string;
  street?: string;
  housenumber?: string;
}

type AddressSurface = 'city' | 'postcode' | 'property' | 'invalid';

/**
 * Parse the catch-all address segments into structured params
 */
function parseAddressSegments(segments: string | string[]): AddressUrlParams {
  const parts = Array.isArray(segments) ? segments : [segments];

  return {
    city: parts[0] || undefined,
    zipcode: parts[1] || undefined,
    street: parts[2] || undefined,
    housenumber: parts[3] || undefined,
  };
}

/**
 * Build a free text query from URL parameters for geocoding
 */
function buildSearchQuery(params: AddressUrlParams): string {
  const parts: string[] = [];

  if (params.zipcode && params.housenumber) {
    parts.push(params.zipcode.toUpperCase());
    parts.push(params.housenumber);
  } else if (params.city && params.street && params.housenumber) {
    parts.push(params.street.replace(/-/g, ' '));
    parts.push(params.housenumber);
    parts.push(params.city);
  }

  return parts.join(' ');
}

/**
 * Determines whether the URL has enough segments for a property resolution.
 */
function isPropertyAddress(params: AddressUrlParams): boolean {
  return !!(params.city && params.zipcode && params.street && params.housenumber);
}

function getAddressSurface(params: AddressUrlParams): AddressSurface {
  if (isPropertyAddress(params)) {
    return 'property';
  }

  if (params.city && params.zipcode) {
    return 'postcode';
  }

  if (params.city) {
    return 'city';
  }

  return 'invalid';
}

function formatZipcode(zipcode: string | undefined): string {
  return zipcode?.toUpperCase() ?? '';
}

function formatCityName(city: string | undefined): string {
  if (!city) return '';

  return city
    .split(/([\s-])/)
    .map((part) => {
      if (part === ' ' || part === '-') {
        return part;
      }

      if (!part) {
        return part;
      }

      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
}

function PartialAddressScreen({
  surface,
  params,
}: {
  surface: Exclude<AddressSurface, 'property' | 'invalid'>;
  params: AddressUrlParams;
}) {
  const cityName = formatCityName(params.city);
  const title = surface === 'postcode' ? formatZipcode(params.zipcode) : cityName;
  const subtitle =
    surface === 'postcode'
      ? `Browse homes around ${formatZipcode(params.zipcode)} ${cityName}`.trim()
      : `Browse homes and local activity across ${cityName || 'this city'}`;
  const detail =
    surface === 'postcode'
      ? 'Open the map to explore listings and property activity in this postcode.'
      : 'Open the map to explore listings and property activity across this city.';
  const buttonLabel =
    surface === 'postcode' ? 'Browse Postcode Map' : 'Browse City Map';

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <Icon name="HouseLine" size={64} color="#E8E0D4" />
        <Text style={styles.title} testID={`address-${surface}-title`}>
          {title}
        </Text>
        <Text style={styles.message} testID={`address-${surface}-message`}>
          {subtitle}
        </Text>
        <Text style={styles.detail} testID={`address-${surface}-detail`}>
          {detail}
        </Text>
        <Pressable
          onPress={() => router.replace('/')}
          style={styles.button}
          testID={`address-${surface}-go-to-map`}
        >
          <Text style={styles.buttonText}>{buttonLabel}</Text>
        </Pressable>
      </View>
    </>
  );
}

/**
 * Main Address Route — resolves addresses and redirects to canonical routes.
 */
export default function AddressScreen() {
  const params = useLocalSearchParams<{ address: string | string[] }>();
  const addressParams = useMemo(
    () => parseAddressSegments(params.address || []),
    [params.address]
  );
  const rootNavigationState = useRootNavigationState();
  const addressSurface = getAddressSurface(addressParams);
  const [error, setError] = useState<string | null>(null);

  const navigationReady = Boolean(rootNavigationState?.key);

  useEffect(() => {
    if (!navigationReady || addressSurface !== 'property') {
      return;
    }

    // Full property address — resolve and redirect
    let cancelled = false;

    async function resolve() {
      try {
        // Step 1: Geocode the address
        const query = buildSearchQuery(addressParams);
        if (!query) {
          if (!cancelled) setError('Invalid address');
          return;
        }

        const results = await apiGeocoder.search(query, { limit: 1 });
        if (cancelled) return;

        if (results.length === 0) {
          setError('Address not found');
          return;
        }

        const geocoded = results[0];
        const postalCode = geocoded.postalCode;
        const houseNumberParts = splitHouseNumber(geocoded.houseNumber);
        const houseNumber = houseNumberParts.houseNumber;

        if (!postalCode || !houseNumber) {
          setError('Address not found in our database');
          return;
        }

        // Step 2: Resolve to local property
        const property = await resolveProperty({
          postalCode,
          houseNumber,
          houseNumberAddition: houseNumberParts.houseNumberAddition,
          countryCode: geocoded.countryCode,
          street: geocoded.street,
          city: geocoded.city,
        });
        if (cancelled) return;

        if (property) {
          // Redirect to canonical property route
          router.replace(`/property/${property.id}`);
        } else {
          setError('Property not found in our database');
        }
      } catch {
        if (!cancelled) {
          setError('Failed to resolve address');
        }
      }
    }

    resolve();

    return () => {
      cancelled = true;
    };
  }, [
    addressParams,
    addressSurface,
    navigationReady,
  ]);

  if (addressSurface === 'city' || addressSurface === 'postcode') {
    return <PartialAddressScreen surface={addressSurface} params={addressParams} />;
  }

  if (addressSurface === 'invalid') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.container}>
          <Icon name="HouseLine" size={64} color="#E8E0D4" />
          <Text style={styles.title}>Address not found</Text>
          <Text style={styles.message}>This URL does not contain a valid address.</Text>
          <Pressable
            onPress={() => router.replace('/')}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Go to Map</Text>
          </Pressable>
        </View>
      </>
    );
  }

  if (!navigationReady) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.container}>
          <ActivityIndicator size="large" color="#F5A623" />
          <Text style={styles.loadingText}>Resolving address...</Text>
        </View>
      </>
    );
  }

  // Error state — address could not be resolved
  if (error) {
    const addressString = [
      addressParams.city,
      addressParams.zipcode,
      addressParams.street,
      addressParams.housenumber,
    ]
      .filter(Boolean)
      .join(' / ');

    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.container}>
          <Icon name="HouseLine" size={64} color="#E8E0D4" />
          <Text style={styles.title}>Address not found</Text>
          <Text style={styles.message}>
            We couldn't find a property matching:{'\n'}
            <Text style={styles.address}>{addressString}</Text>
          </Text>
          <Pressable
            onPress={() => router.replace('/')}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Go to Map</Text>
          </Pressable>
        </View>
      </>
    );
  }

  // Loading state — resolving address
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#F5A623" />
        <Text style={styles.loadingText}>Resolving address...</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFBF5',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    color: '#2D2926',
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
  },
  message: {
    color: '#9C958A',
    textAlign: 'center',
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
  },
  address: {
    fontWeight: '500',
    color: '#6B6560',
  },
  detail: {
    color: '#9C958A',
    marginTop: 4,
    fontSize: 13,
    textAlign: 'center',
  },
  button: {
    marginTop: 24,
    backgroundColor: '#F5A623',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
  loadingText: {
    color: '#9C958A',
    marginTop: 16,
    fontSize: 15,
  },
});
