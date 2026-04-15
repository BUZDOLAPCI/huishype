import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import CanonicalAddressRouteScreen from '@/src/screens/CanonicalAddressRouteScreen';

const mockReplace = jest.fn();
const mockReplacePassiveBrowserPath = jest.fn();
const mockRegisterEntry = jest.fn<void, [unknown]>();
const mockEnqueueSynthesisPlan = jest.fn<void, [unknown]>();
const mockIsSynthesisPendingFor = jest.fn<boolean, [string]>(() => false);
let mockPathname = '/eindhoven/5600aa/routelaan/12';
let mockParams: { returnTo?: string | string[] } = {};
let mockRootNavigationState: { routes: Array<{ key: string; name: string }> } | undefined;
const mockUseResolvedMapRoute = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  usePathname: () => mockPathname,
  useRootNavigationState: () => mockRootNavigationState,
  Stack: {
    Screen: () => null,
  },
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
  },
}));

jest.mock('@/src/lib/useResolvedMapRoute', () => ({
  useResolvedMapRoute: (...args: unknown[]) => mockUseResolvedMapRoute(...args),
}));

jest.mock('@/src/lib/webMapUrlSync', () => ({
  replacePassiveBrowserPath: (...args: unknown[]) =>
    mockReplacePassiveBrowserPath(...args),
}));

jest.mock('@/src/detail-surfaces/DetailSurfaceHostContext', () => ({
  useRegisterDetailSurfaceEntry: (entry: unknown) => mockRegisterEntry(entry),
  useDetailSurfaceSynthesis: () => ({
    enqueueSynthesisPlan: (plan: unknown) => mockEnqueueSynthesisPlan(plan),
    isSynthesisPendingFor: (href: string) => mockIsSynthesisPendingFor(href),
  }),
}));

describe('canonical route entry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
    mockParams = {};
    mockPathname = '/eindhoven/5600aa/routelaan/12';
    mockRootNavigationState = undefined;
  });

  it('registers a synthesized property stack and enqueues direct-entry synthesis', () => {
    mockUseResolvedMapRoute.mockReturnValue({
      pathname: mockPathname,
      isLoading: false,
      resolvedRoute: {
        kind: 'property',
        canonicalPath: mockPathname,
        property: { id: 'property-1' },
        routeInput: {
          city: 'Eindhoven',
          postalCode: '5600 AA',
          streetName: 'Routelaan',
          houseNumber: '12',
          countryCode: 'NL',
        },
      },
    });

    render(<CanonicalAddressRouteScreen />);

    expect(mockRegisterEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        routeKind: 'property',
        propertyId: 'property-1',
        baseHref: '/',
        propertyHref:
          '/eindhoven/5600aa/routelaan/12?returnTo=%2F',
        hasPresentingRoute: false,
      }),
    );
    expect(mockEnqueueSynthesisPlan).toHaveBeenCalledWith({
      baseHref: '/',
      propertyHref:
        '/eindhoven/5600aa/routelaan/12?returnTo=%2F',
      finalHref:
        '/eindhoven/5600aa/routelaan/12?returnTo=%2F',
    });
  });

  it('keeps an explicit returnTo override for comments routes', () => {
    mockParams = { returnTo: '/feed' };
    mockPathname = '/eindhoven/5600aa/routelaan/12/comments';
    mockRootNavigationState = {
      routes: [
        { key: 'base', name: '(tabs)' },
        { key: 'detail', name: '[...address]' },
      ],
    };
    mockUseResolvedMapRoute.mockReturnValue({
      pathname: mockPathname,
      isLoading: false,
      resolvedRoute: {
        kind: 'comments',
        canonicalPath: mockPathname,
        property: { id: 'property-2' },
        routeInput: {
          city: 'Eindhoven',
          postalCode: '5600 AA',
          streetName: 'Routelaan',
          houseNumber: '12',
          countryCode: 'NL',
        },
      },
    });

    render(<CanonicalAddressRouteScreen />);

    expect(mockRegisterEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        routeKind: 'comments',
        propertyId: 'property-2',
        baseHref: '/feed',
        propertyHref:
          '/eindhoven/5600aa/routelaan/12?returnTo=%2Ffeed',
        commentsHref:
          '/eindhoven/5600aa/routelaan/12/comments?returnTo=%2Feindhoven%2F5600aa%2Froutelaan%2F12%3FreturnTo%3D%252Ffeed',
        hasPresentingRoute: true,
      }),
    );
    expect(mockEnqueueSynthesisPlan).not.toHaveBeenCalled();
  });

  it('treats an explicit map returnTo as an in-app presenting route even before stack depth updates', () => {
    mockParams = { returnTo: '/map/eindhoven/5600aa/routelaan/12' };
    mockPathname = '/eindhoven/5600aa/routelaan/12';
    mockRootNavigationState = undefined;
    mockUseResolvedMapRoute.mockReturnValue({
      pathname: mockPathname,
      isLoading: false,
      resolvedRoute: {
        kind: 'property',
        canonicalPath: mockPathname,
        property: { id: 'property-3' },
        routeInput: {
          city: 'Eindhoven',
          postalCode: '5600 AA',
          streetName: 'Routelaan',
          houseNumber: '12',
          countryCode: 'NL',
        },
      },
    });

    render(<CanonicalAddressRouteScreen />);

    expect(mockRegisterEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        baseHref: '/map/eindhoven/5600aa/routelaan/12',
        hasPresentingRoute: true,
      }),
    );
    expect(mockEnqueueSynthesisPlan).not.toHaveBeenCalled();
  });

  it('collapses invalid direct-entry routes to root', async () => {
    mockUseResolvedMapRoute.mockReturnValue({
      pathname: mockPathname,
      isLoading: false,
      resolvedRoute: {
        kind: 'invalid',
        canonicalPath: '/',
        reason: 'property-not-found',
      },
    });

    render(<CanonicalAddressRouteScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/');
    });
  });

  it('collapses invalid web direct-entry routes through browser history without router replace', async () => {
    Platform.OS = 'web';
    mockUseResolvedMapRoute.mockReturnValue({
      pathname: mockPathname,
      isLoading: false,
      resolvedRoute: {
        kind: 'invalid',
        canonicalPath: '/',
        reason: 'property-not-found',
      },
    });

    render(<CanonicalAddressRouteScreen />);

    await waitFor(() => {
      expect(mockReplacePassiveBrowserPath).toHaveBeenCalledWith('/');
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
