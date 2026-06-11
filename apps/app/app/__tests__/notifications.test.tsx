import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import NotificationsScreen from '../notifications';
import {
  useMarkAllRead,
  useMarkNotificationRead,
  useNotifications,
} from '@/src/hooks/useNotifications';

const mockMarkOneRead = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    push: jest.fn(),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/src/components/ui/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>{name}</ReactNative.Text>;
  },
}));

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    user: {
      id: 'viewer-1',
      handle: 'viewer',
      displayName: 'Viewer',
    },
  }),
}));

jest.mock('@/src/hooks/useProperties', () => ({
  fetchPropertyById: jest.fn(),
}));

jest.mock('@/src/hooks/useNotifications', () => ({
  useNotifications: jest.fn(),
  useMarkAllRead: jest.fn(),
  useMarkNotificationRead: jest.fn(),
}));

const mockUseNotifications = useNotifications as jest.MockedFunction<typeof useNotifications>;
const mockUseMarkAllRead = useMarkAllRead as jest.MockedFunction<typeof useMarkAllRead>;
const mockUseMarkNotificationRead = useMarkNotificationRead as jest.MockedFunction<
  typeof useMarkNotificationRead
>;
const getMockRouterPush = () =>
  (jest.requireMock('expo-router') as { router: { push: jest.Mock } }).router.push;

describe('NotificationsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNotifications.mockReturnValue({
      data: {
        pages: [
          {
            items: [
              {
                id: 'a0000000-0000-4000-a000-000000000101',
                eventType: 'new_follower',
                propertyId: null,
                commentId: null,
                guessId: null,
                reactionId: null,
                payload: {},
                readAt: null,
                createdAt: new Date().toISOString(),
                actor: {
                  id: 'a0000000-0000-4000-a000-000000000102',
                  displayName: 'Sophie Meijer',
                  handle: 'sophiemeijer',
                  profilePhotoUrl: null,
                },
              },
            ],
            pagination: {
              total: 1,
              limit: 20,
              offset: 0,
              hasMore: false,
            },
          },
        ],
      },
      isLoading: false,
      refetch: jest.fn(),
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    } as unknown as ReturnType<typeof useNotifications>);
    mockUseMarkAllRead.mockReturnValue({
      mutate: jest.fn(),
    } as unknown as ReturnType<typeof useMarkAllRead>);
    mockUseMarkNotificationRead.mockReturnValue({
      mutate: mockMarkOneRead,
    } as unknown as ReturnType<typeof useMarkNotificationRead>);
  });

  it('navigates actor-only notifications to the canonical handle profile route', () => {
    const { getByTestId } = render(<NotificationsScreen />);

    fireEvent.press(getByTestId('notification-a0000000-0000-4000-a000-000000000101'));

    expect(mockMarkOneRead).toHaveBeenCalledWith('a0000000-0000-4000-a000-000000000101');
    expect(getMockRouterPush()).toHaveBeenCalledWith('/user/@sophiemeijer');
  });
});
