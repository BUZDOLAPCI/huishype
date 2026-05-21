import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { UserSearchScreen } from '../UserSearchScreen';
import { useAuthContext } from '@/src/providers/AuthProvider';
import {
  useFollowUser,
  useUnfollowUser,
  useUserSearch,
} from '@/src/hooks/useUserProfile';

const mockUseAuthContext = useAuthContext as jest.MockedFunction<typeof useAuthContext>;
const mockUseUserSearch = useUserSearch as jest.MockedFunction<typeof useUserSearch>;
const mockUseFollowUser = useFollowUser as jest.MockedFunction<typeof useFollowUser>;
const mockUseUnfollowUser = useUnfollowUser as jest.MockedFunction<typeof useUnfollowUser>;
const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
}));

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: jest.fn(),
}));

jest.mock('@/src/hooks/useUserProfile', () => ({
  emitSocialFollowAnalyticsEvent: jest.fn(),
  normalizeUserSearchQuery: jest.requireActual('@/src/hooks/useUserProfile')
    .normalizeUserSearchQuery,
  useFollowUser: jest.fn(),
  useUnfollowUser: jest.fn(),
  useUserSearch: jest.fn(),
}));

jest.mock('@/src/components', () => ({
  AuthModal: ({ visible, message }: { visible: boolean; message: string }) => {
    if (!visible) {
      return null;
    }

    const ReactNative = require('react-native');
    return <ReactNative.Text testID="user-search-auth-modal">{message}</ReactNative.Text>;
  },
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
    disabled,
    testID,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    testID?: string;
  }) => {
    const ReactNative = require('react-native');
    return (
      <ReactNative.Pressable onPress={onPress} disabled={disabled} testID={testID}>
        <ReactNative.Text>{label}</ReactNative.Text>
      </ReactNative.Pressable>
    );
  },
}));

jest.mock('@/src/components/ui/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>{name}</ReactNative.Text>;
  },
}));

jest.mock('@/src/components/ui/UserAvatar', () => ({
  UserAvatar: () => {
    const ReactNative = require('react-native');
    return <ReactNative.Text>UserAvatar</ReactNative.Text>;
  },
}));

const followMutateAsync = jest.fn();
const unfollowMutateAsync = jest.fn();

function seedViewer(user: { id: string } | null = { id: 'viewer-1' }) {
  mockUseAuthContext.mockReturnValue({
    user: user
      ? {
          id: user.id,
          username: 'viewer',
          handle: 'viewer',
          displayName: 'Viewer',
          karma: 0,
          karmaRank: 'Newcomer',
          createdAt: '2026-01-01T00:00:00.000Z',
        }
      : null,
    isAuthenticated: !!user,
    isLoading: false,
    accessToken: user ? 'viewer-token' : null,
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

function seedMutations() {
  mockUseFollowUser.mockReturnValue({
    mutateAsync: followMutateAsync,
    isPending: false,
    variables: undefined,
  } as unknown as ReturnType<typeof useFollowUser>);
  mockUseUnfollowUser.mockReturnValue({
    mutateAsync: unfollowMutateAsync,
    isPending: false,
    variables: undefined,
  } as unknown as ReturnType<typeof useUnfollowUser>);
}

describe('UserSearchScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedViewer();
    seedMutations();
    followMutateAsync.mockResolvedValue({
      relationship: 'following',
      followerCount: 11,
      followingCount: 3,
    });
    unfollowMutateAsync.mockResolvedValue({
      relationship: 'none',
      followerCount: 9,
      followingCount: 2,
    });
    mockUseUserSearch.mockReturnValue({
      data: {
        items: [
          {
            id: 'target-user',
            displayName: 'Target User',
            handle: 'target',
            profilePhotoUrl: null,
            relationship: 'none',
            followerCount: 10,
          },
          {
            id: 'viewer-1',
            displayName: 'Viewer',
            handle: 'viewer',
            profilePhotoUrl: null,
            relationship: 'self',
            followerCount: 2,
          },
        ],
        pagination: { limit: 20, offset: 0, hasMore: false },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useUserSearch>);
  });

  it('renders search results with follow controls and self label', () => {
    const { getByTestId, getByText } = render(<UserSearchScreen />);

    fireEvent.changeText(getByTestId('user-search-input'), '@ta');

    expect(getByText('Target User')).toBeTruthy();
    expect(getByText('@target')).toBeTruthy();
    expect(getByTestId('user-search-follow-target-user')).toBeTruthy();
    expect(getByTestId('user-search-self-viewer-1')).toHaveTextContent('You');
  });

  it('toggles a search result through the existing follow mutation', async () => {
    const { getByTestId, getByText } = render(<UserSearchScreen />);

    fireEvent.changeText(getByTestId('user-search-input'), 'target');
    fireEvent.press(getByTestId('user-search-follow-target-user'));

    await waitFor(() => {
      expect(followMutateAsync).toHaveBeenCalledWith('target-user');
      expect(getByText('Unfollow')).toBeTruthy();
    });
  });

  it('keeps a result button enabled when settled mutation variables are stale', () => {
    mockUseFollowUser.mockReturnValue({
      mutateAsync: followMutateAsync,
      isPending: false,
      variables: 'target-user',
    } as unknown as ReturnType<typeof useFollowUser>);

    const { getByTestId } = render(<UserSearchScreen />);

    fireEvent.changeText(getByTestId('user-search-input'), 'target');

    expect(getByTestId('user-search-follow-target-user')).toHaveProp(
      'disabled',
      false,
    );
  });

  it('opens the auth gate instead of mutating for signed-out follow attempts', async () => {
    seedViewer(null);
    const { getByTestId, findByTestId } = render(<UserSearchScreen />);

    fireEvent.changeText(getByTestId('user-search-input'), 'target');
    fireEvent.press(getByTestId('user-search-follow-target-user'));

    expect(followMutateAsync).not.toHaveBeenCalled();
    expect(await findByTestId('user-search-auth-modal')).toHaveTextContent(
      'Sign in to follow people',
    );
  });

  it('navigates to a public profile from the result identity', () => {
    const { getByLabelText, getByTestId } = render(<UserSearchScreen />);

    fireEvent.changeText(getByTestId('user-search-input'), 'target');
    fireEvent.press(getByLabelText('Target User, @target'));

    expect(mockRouterPush).toHaveBeenCalledWith('/user/target-user');
  });
});
