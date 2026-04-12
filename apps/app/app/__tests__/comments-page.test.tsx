import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import CommentsPage, { CommentsRouteScreen } from '../comments/[propertyId]';
import {
  buildPropertyMapRoute,
  buildPropertyRoute,
  toInternalAppHref,
} from '@/src/utils/property-route';

const mockUseProperty = jest.fn();
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockDismiss = jest.fn();
const mockDismissTo = jest.fn();
const mockCanGoBack = jest.fn(() => false);
const mockCanDismiss = jest.fn(() => false);
let mockSearchParams: { propertyId: string; returnTo?: string | string[] } = {
  propertyId: 'property-123',
};
const property = {
  id: 'property-123',
  nationalId: null,
  countryCode: 'NL',
  region: 'Noord-Brabant',
  street: 'Teststraat',
  houseNumber: 42,
  houseNumberAddition: null,
  address: 'Teststraat 42',
  city: 'Eindhoven',
  postalCode: '5600 AA',
  geometry: null,
  yearBuilt: 1998,
  floorAreaM2: 112,
  status: 'active',
  officialValuation: 350000,
  activityLevel: 'warm',
  commentCount: 4,
  guessCount: 2,
  viewCount: 10,
  uniqueViewers: 5,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  Stack: {
    Screen: () => null,
  },
  Redirect: ({ href }: { href: string }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>{`redirect:${href}`}</Text>;
  },
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    dismiss: (...args: unknown[]) => mockDismiss(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    canGoBack: () => mockCanGoBack(),
    canDismiss: () => mockCanDismiss(),
    dismissTo: (...args: unknown[]) => mockDismissTo(...args),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/src/hooks/useProperties', () => ({
  useProperty: (...args: unknown[]) => mockUseProperty(...args),
}));

jest.mock('@/src/hooks/useComments', () => ({
  useComments: () => ({
    data: {
      pages: [{ data: [], meta: { total: 0 } }],
    },
    isLoading: true,
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
  useSubmitComment: () => ({
    mutate: jest.fn(),
  }),
  useLikeComment: () => ({
    mutate: jest.fn(),
  }),
}));

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    isAuthenticated: false,
    user: null,
  }),
}));

jest.mock('@/src/components/ui/Icon', () => ({
  Icon: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>icon</Text>;
  },
}));

jest.mock('@/src/components/ui/UserAvatar', () => ({
  UserAvatar: () => null,
}));

jest.mock('@/src/components/ui/ResponsivePanel', () => ({
  ResponsivePanel: ({
    children,
  }: {
    children: React.ReactNode;
  }) => {
    const React = require('react');
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
}));

jest.mock('@/src/components/CommentCell', () => ({
  CommentCell: () => null,
}));

jest.mock('@/src/components/CommentInput', () => ({
  CommentInput: () => null,
}));

jest.mock('@/src/components', () => ({
  AuthModal: () => null,
}));

jest.mock('@/src/components/PropertyImageSurface', () => ({
  PropertyImageSurface: () => null,
}));

jest.mock('@/src/utils/property-image', () => ({
  resolvePropertyImageWithType: () => ({ url: null, type: 'placeholder' }),
}));

jest.mock('@/src/components/Comments/Comment', () => ({
  formatRelativeTime: () => 'just now',
}));

describe('CommentsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = { propertyId: 'property-123' };
    mockCanGoBack.mockReturnValue(false);
    mockCanDismiss.mockReturnValue(false);
    Platform.OS = 'android';
    mockUseProperty.mockReturnValue({
      data: property,
    });
  });

  it('closes to the canonical property route by default even when history exists', () => {
    mockCanGoBack.mockReturnValue(true);
    const screen = render(<CommentsRouteScreen propertyId="property-123" />);

    fireEvent.press(screen.getByTestId('comments-back-button'));

    expect(mockReplace).toHaveBeenCalledWith(
      toInternalAppHref(buildPropertyRoute(property, buildPropertyMapRoute(property))),
    );
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('replaces to an explicit returnTo on native routes', () => {
    mockSearchParams = { propertyId: 'property-123', returnTo: '/feed' };
    mockCanDismiss.mockReturnValue(true);

    const screen = render(
      <CommentsRouteScreen propertyId="property-123" returnTo="/feed" />,
    );

    fireEvent.press(screen.getByTestId('comments-back-button'));

    expect(mockReplace).toHaveBeenCalledWith('/feed');
    expect(mockDismiss).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it('uses an explicit validated returnTo when the route is not dismissable', () => {
    mockSearchParams = { propertyId: 'property-123', returnTo: '/feed' };

    const screen = render(
      <CommentsRouteScreen propertyId="property-123" returnTo="/feed" />,
    );

    fireEvent.press(screen.getByTestId('comments-back-button'));

    expect(mockReplace).toHaveBeenCalledWith('/feed');
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('redirects legacy id routes to the map root', () => {
    render(<CommentsPage />);

    expect(screen.getByText('redirect:/')).toBeTruthy();
    expect(mockUseProperty).not.toHaveBeenCalled();
  });
});
