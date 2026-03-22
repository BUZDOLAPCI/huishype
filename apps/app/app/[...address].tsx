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
 * Partial URLs (city-only, city+postcode) redirect to the map tab since
 * city/postcode browsing is not a supported surface.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';

import { Icon } from '@/src/components/ui/Icon';
import { resolveProperty } from '@/src/utils/api';
import { apiGeocoder } from '@/src/services/api-geocoder';

interface AddressUrlParams {
  city?: string;
  zipcode?: string;
  street?: string;
  housenumber?: string;
}

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

/**
 * Main Address Route — resolves addresses and redirects to canonical routes.
 */
export default function AddressScreen() {
  const params = useLocalSearchParams<{ address: string | string[] }>();
  const addressParams = parseAddressSegments(params.address || []);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Partial URLs (city-only, city+postcode) — redirect to map.
    // City/postcode browsing is not a supported product surface.
    if (!isPropertyAddress(addressParams)) {
      router.replace('/');
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
        const houseNumber = geocoded.houseNumber;

        if (!postalCode || !houseNumber) {
          setError('Address not found in our database');
          return;
        }

        // Step 2: Resolve to local property
        const property = await resolveProperty(postalCode, houseNumber);
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
  }, [addressParams.city, addressParams.zipcode, addressParams.street, addressParams.housenumber]);

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
