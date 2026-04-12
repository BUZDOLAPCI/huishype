import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { useResolvedMapRoute } from '../useResolvedMapRoute';
import { resolveMapRoute } from '../mapRoute';

let mockPathname = '/eindhoven/5651ha/beeldbuisring/2';

jest.mock('expo-router', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('../mapRoute', () => ({
  ...jest.requireActual('../mapRoute'),
  resolveMapRoute: jest.fn(),
}));

const mockResolveMapRoute = resolveMapRoute as jest.MockedFunction<typeof resolveMapRoute>;

function RouteStateProbe() {
  const state = useResolvedMapRoute();

  return (
    <>
      <Text>{state.pathname}</Text>
      <Text>{String(state.isLoading)}</Text>
      <Text>{state.resolvedRoute?.kind ?? 'null'}</Text>
    </>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

describe('useResolvedMapRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = '/eindhoven/5651ha/beeldbuisring/2';
  });

  it('does not expose a stale resolved route after the pathname changes', async () => {
    mockResolveMapRoute.mockResolvedValueOnce({
      kind: 'property',
      canonicalPath: '/eindhoven/5651ha/beeldbuisring/2',
      property: {
        id: 'property-1',
        address: 'Beeldbuisring 2',
        city: 'Eindhoven',
        postalCode: '5651HA',
        countryCode: 'NL',
        coordinates: { lon: 5.45, lat: 51.43 },
        hasListing: true,
        officialValuation: 500000,
      },
      resolvedAddress: {
        bagId: 'property-1',
        formattedAddress: 'Beeldbuisring 2',
        lat: 51.43,
        lon: 5.45,
        details: {
          city: 'Eindhoven',
          zip: '5651HA',
          street: 'Beeldbuisring',
          number: '2',
          houseNumber: '2',
          houseNumberAddition: null,
          countryCode: 'NL',
        },
      },
      routeInput: {
        city: 'Eindhoven',
        postalCode: '5651HA',
        streetName: 'Beeldbuisring',
        houseNumber: '2',
        houseNumberAddition: null,
        countryCode: 'NL',
      },
    });

    const nextRoute = deferred<Awaited<ReturnType<typeof resolveMapRoute>>>();
    mockResolveMapRoute.mockReturnValueOnce(nextRoute.promise);

    const rendered = render(<RouteStateProbe />);

    await waitFor(() => {
      expect(screen.getByText('property')).toBeTruthy();
    });

    mockPathname = '/map/eindhoven/5651ha/beeldbuisring/2';
    rendered.rerender(<RouteStateProbe />);

    expect(screen.getByText('/map/eindhoven/5651ha/beeldbuisring/2')).toBeTruthy();
    expect(screen.getByText('true')).toBeTruthy();
    expect(screen.getByText('null')).toBeTruthy();

    nextRoute.resolve({
      kind: 'preview',
      canonicalPath: '/map/eindhoven/5651ha/beeldbuisring/2',
      property: {
        id: 'property-1',
        address: 'Beeldbuisring 2',
        city: 'Eindhoven',
        postalCode: '5651HA',
        countryCode: 'NL',
        coordinates: { lon: 5.45, lat: 51.43 },
        hasListing: true,
        officialValuation: 500000,
      },
      resolvedAddress: {
        bagId: 'property-1',
        formattedAddress: 'Beeldbuisring 2',
        lat: 51.43,
        lon: 5.45,
        details: {
          city: 'Eindhoven',
          zip: '5651HA',
          street: 'Beeldbuisring',
          number: '2',
          houseNumber: '2',
          houseNumberAddition: null,
          countryCode: 'NL',
        },
      },
      routeInput: {
        city: 'Eindhoven',
        postalCode: '5651HA',
        streetName: 'Beeldbuisring',
        houseNumber: '2',
        houseNumberAddition: null,
        countryCode: 'NL',
      },
    });

    await waitFor(() => {
      expect(screen.getByText('preview')).toBeTruthy();
    });
  });
});
