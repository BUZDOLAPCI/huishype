import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { FlatList } from 'react-native';

import { OwnFollowListScreen } from '../OwnFollowListScreen';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { useFollowers, useFollowing } from '@/src/hooks/useUserProfile';

const fetchFollowersNextPage = jest.fn();
const fetchFollowingNextPage = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
  },
}));

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('@/src/hooks/useUserProfile', () => ({
  useFollowers: jest.fn(),
  useFollowing: jest.fn(),
}));

jest.mock('@/src/components', () => ({
  AuthModal: () => null,
}));

jest.mock('@/src/components/navigation/ScreenHeader', () => ({
  ScreenHeader: ({ title }: { title: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>{title}</ReactNative.Text>;
  },
}));

jest.mock('@/src/components/ui/Button', () => ({
  Button: ({
    label,
    onPress,
    testID,
  }: {
    label: string;
    onPress: () => void;
    testID?: string;
  }) => {
    const ReactNative = require('react-native');
    return (
      <ReactNative.Pressable onPress={onPress} testID={testID}>
        <ReactNative.Text>{label}</ReactNative.Text>
      </ReactNative.Pressable>
    );
  },
}));

jest.mock('@/src/components/ui/UserAvatar', () => ({
  UserAvatar: ({ displayName }: { displayName: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>{displayName}</ReactNative.Text>;
  },
}));

const mockUseAuthContext = useAuthContext as jest.MockedFunction<typeof useAuthContext>;
const mockUseFollowers = useFollowers as jest.MockedFunction<typeof useFollowers>;
const mockUseFollowing = useFollowing as jest.MockedFunction<typeof useFollowing>;
const getRouterPush = () =>
  (jest.requireMock('expo-router') as { router: { push: jest.Mock } }).router.push;

function makeFollowItem(id: string, displayName = `User ${id}`) {
  return {
    id,
    displayName,
    handle: `user-${id}`,
    profilePhotoUrl: null,
    followedAt: '2026-04-19T10:00:00.000Z',
    relationship: 'following' as const,
  };
}

function seedSignedInState() {
  mockUseAuthContext.mockReturnValue({
    user: {
      id: 'viewer-1',
      username: 'viewer-1',
      displayName: 'Viewer',
      karma: 10,
      karmaRank: 'Contributor',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    isAuthenticated: true,
    isLoading: false,
    accessToken: 'viewer-token',
    authError: null,
    signInWithGoogle: jest.fn(),
    signInWithMockToken: jest.fn(),
    requestEmailLink: jest.fn(),
    verifyEmailToken: jest.fn(),
    signOut: jest.fn(),
    refreshAuth: jest.fn(),
    getAccessToken: jest.fn(),
  });
}

describe('OwnFollowListScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedSignedInState();

    mockUseFollowers.mockReturnValue({
      data: {
        pages: [
          {
            items: [makeFollowItem('follower-1')],
            pagination: { limit: 20, offset: 0, hasMore: false },
          },
        ],
      },
      isLoading: false,
      isError: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: fetchFollowersNextPage,
    } as unknown as ReturnType<typeof useFollowers>);

    mockUseFollowing.mockReturnValue({
      data: {
        pages: [
          {
            items: [makeFollowItem('followed-1', 'Newest Followed')],
            pagination: { limit: 20, offset: 0, hasMore: true },
          },
          {
            items: [makeFollowItem('followed-2', 'Older Followed')],
            pagination: { limit: 20, offset: 20, hasMore: false },
          },
        ],
      },
      isLoading: false,
      isError: false,
      isFetchingNextPage: false,
      hasNextPage: true,
      fetchNextPage: fetchFollowingNextPage,
    } as unknown as ReturnType<typeof useFollowing>);
  });

  it('renders every loaded following page without truncating after the first page', () => {
    const { getByTestId } = render(
      <OwnFollowListScreen kind="following" title="Following" />
    );

    expect(getByTestId('follow-list-item-followed-1')).toBeTruthy();
    expect(getByTestId('follow-list-item-followed-2')).toBeTruthy();
  });

  it('requests the next following page when the list reaches the end', () => {
    const { UNSAFE_getByType } = render(
      <OwnFollowListScreen kind="following" title="Following" />
    );

    fireEvent(UNSAFE_getByType(FlatList), 'onEndReached');

    expect(fetchFollowingNextPage).toHaveBeenCalledTimes(1);
  });

  it('navigates to the tapped user profile', () => {
    const { getByTestId } = render(
      <OwnFollowListScreen kind="followers" title="Followers" />
    );

    fireEvent.press(getByTestId('follow-list-item-follower-1'));

    expect(getRouterPush()).toHaveBeenCalledWith('/user/follower-1');
  });

  it('shows the self-only auth gate when no viewer is signed in', () => {
    mockUseAuthContext.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      accessToken: null,
      authError: null,
      signInWithGoogle: jest.fn(),
      signInWithMockToken: jest.fn(),
      requestEmailLink: jest.fn(),
      verifyEmailToken: jest.fn(),
      signOut: jest.fn(),
      refreshAuth: jest.fn(),
      getAccessToken: jest.fn(),
    });

    const { getByText, queryByTestId } = render(
      <OwnFollowListScreen kind="following" title="Following" />
    );

    expect(getByText('Sign in to see your following')).toBeTruthy();
    expect(queryByTestId('follow-list-following')).toBeNull();
  });
});
