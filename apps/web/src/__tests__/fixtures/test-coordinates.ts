import { getCountryConfig, type CountryCode } from '@huishype/shared/config';

/** Default test country */
export const TEST_COUNTRY: CountryCode = 'NL';

/** Test coordinates (Eindhoven city center — from NL country config) */
export const TEST_CENTER = getCountryConfig(TEST_COUNTRY).defaultCenter;
export const TEST_ZOOM = getCountryConfig(TEST_COUNTRY).defaultZoom;

/** Convenience destructure of TEST_CENTER */
export const [TEST_LNG, TEST_LAT] = TEST_CENTER;

/**
 * The Beeldbuisring 41 property UUID is discovered at runtime by
 * seed-test-fixture.ts (looks up by postal_code + house_number).
 * There is no static UUID — the ID depends on the BAG seed.
 */
// export const TEST_PROPERTY_ID = '<discovered at runtime by seed-test-fixture.ts>';

/** Test address fixture (Beeldbuisring 41, Eindhoven) */
export const TEST_ADDRESS = {
  street: 'Beeldbuisring',
  houseNumber: '41',
  postalCode: '5658 GG',
  city: 'Eindhoven',
  countryCode: 'NL' as const,
};

/** Per-country test fixtures for multi-country tests */
export const TEST_FIXTURES = {
  NL: {
    center: TEST_CENTER,
    address: TEST_ADDRESS,
    postalCode: '5658 GG',
    zoom: TEST_ZOOM,
  },
  DE: {
    center: [13.405, 52.52] as [number, number],
    address: {
      street: 'Unter den Linden',
      houseNumber: '77',
      postalCode: '10117',
      city: 'Berlin',
      countryCode: 'DE' as const,
    },
    postalCode: '10117',
    zoom: 13,
  },
  GB: {
    center: [-0.1276, 51.5074] as [number, number],
    address: {
      street: 'Whitehall',
      houseNumber: '70',
      postalCode: 'SW1A 2AS',
      city: 'London',
      countryCode: 'GB' as const,
    },
    postalCode: 'SW1A 2AS',
    zoom: 13,
  },
};
