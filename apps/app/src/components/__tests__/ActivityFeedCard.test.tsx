import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ActivityFeedCard } from '../ActivityFeedCard';
import { useLikeComment } from '@/src/hooks/useComments';
import { usePropertyLike } from '@/src/hooks/usePropertyLike';
import { usePropertySave } from '@/src/hooks/usePropertySave';
import { useAuthContext } from '@/src/providers/AuthProvider';

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
  },
}));

jest.mock('@/src/hooks/useComments', () => ({
  useLikeComment: jest.fn(),
}));

jest.mock('@/src/hooks/usePropertyLike', () => ({
  usePropertyLike: jest.fn(),
}));

jest.mock('@/src/hooks/usePropertySave', () => ({
  usePropertySave: jest.fn(),
}));

jest.mock('@/src/providers/AuthProvider', () => ({
  useAuthContext: jest.fn(),
}));

const mockUseLikeComment = useLikeComment as jest.MockedFunction<typeof useLikeComment>;
const mockUsePropertyLike = usePropertyLike as jest.MockedFunction<typeof usePropertyLike>;
const mockUsePropertySave = usePropertySave as jest.MockedFunction<typeof usePropertySave>;
const mockUseAuthContext = useAuthContext as jest.MockedFunction<typeof useAuthContext>;

const toggleLike = jest.fn();
const toggleSave = jest.fn();
const mutateCommentLike = jest.fn();

const baseProps = {
  property: {
    id: 'property-1',
    address: 'Keizersgracht 42, 1015 CZ Amsterdam',
    streetName: 'Keizersgracht',
    houseNumber: 42,
    houseNumberAddition: null,
    city: 'Amsterdam',
    postalCode: '1015 CZ',
    countryCode: 'NL',
    geometry: null,
    thumbnailUrl: null,
    askingPrice: 625000,
    officialValuation: 540000,
    floorAreaM2: 92,
    yearBuilt: 1912,
    marketState: 'for-sale',
    isLiked: false,
    isSaved: false,
  },
  lastActivityAt: '2026-04-07T12:00:00.000Z',
  recentActors: [
    {
      id: 'user-1',
      displayName: 'Ada Lovelace',
      handle: 'ada',
      profilePhotoUrl: null,
    },
    {
      id: 'user-2',
      displayName: 'Grace Hopper',
      handle: 'grace',
      profilePhotoUrl: null,
    },
  ],
  preview: {
    kind: 'comment' as const,
    commentId: 'comment-1',
    createdAt: '2026-04-07T11:50:00.000Z',
    actor: {
      id: 'user-1',
      displayName: 'Ada Lovelace',
      handle: 'ada',
      profilePhotoUrl: null,
    },
    contentPreview: 'This facade is surprisingly clean.',
    isLiked: false,
    likeCount: 2,
  },
  counts: {
    likeCount: 3,
    commentCount: 2,
    guessCount: 1,
  },
};

describe('ActivityFeedCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: true,
      user: { id: 'viewer-1' },
    } as ReturnType<typeof useAuthContext>);
    mockUsePropertyLike.mockReturnValue({
      isLiked: false,
      likeCount: 3,
      toggleLike,
      isLoading: false,
    });
    mockUsePropertySave.mockReturnValue({
      isSaved: false,
      toggleSave,
      isLoading: false,
    });
    mockUseLikeComment.mockReturnValue({
      mutate: mutateCommentLike,
      isPending: false,
    } as unknown as ReturnType<typeof useLikeComment>);
  });

  it('renders a social header, comment body, property attachment, and action row', () => {
    render(<ActivityFeedCard {...baseProps} />);

    expect(screen.getByTestId('property-activity-facepile')).toBeTruthy();
    expect(screen.getByText('Ada Lovelace and Grace Hopper')).toBeTruthy();
    expect(screen.getByText('This facade is surprisingly clean.')).toBeTruthy();
    expect(screen.getByText('Keizersgracht 42')).toBeTruthy();
    expect(screen.queryByText('Keizersgracht 42, 1015 CZ Amsterdam')).toBeNull();
    expect(screen.getByText('Amsterdam · 1015 CZ')).toBeTruthy();
    expect(screen.getByTestId('property-activity-market-state')).toBeTruthy();
    expect(screen.getByTestId('property-activity-price')).toBeTruthy();
    expect(screen.getByText('92 m² · Built 1912')).toBeTruthy();
    expect(screen.getByTestId('property-activity-engagement-summary')).toBeTruthy();
    expect(screen.getByTestId('property-activity-action-row')).toBeTruthy();
  });

  it('uses listing thumbnails when available', () => {
    render(
      <ActivityFeedCard
        {...baseProps}
        property={{
          ...baseProps.property,
          thumbnailUrl: 'https://cdn.huishype.nl/listing.jpg',
        }}
      />,
    );

    expect(screen.getByTestId('property-activity-image')).toBeTruthy();
  });

  it('falls back to aerial imagery when the property has geometry but no listing thumbnail', () => {
    render(
      <ActivityFeedCard
        {...baseProps}
        property={{
          ...baseProps.property,
          geometry: {
            type: 'Point',
            coordinates: [4.8936, 52.3665],
          },
        }}
      />,
    );

    expect(screen.getByTestId('property-activity-image')).toBeTruthy();
    expect(screen.getByTestId('property-activity-image-marker')).toBeTruthy();
  });

  it('omits missing attachment facts instead of rendering placeholders', () => {
    render(
      <ActivityFeedCard
        {...baseProps}
        property={{
          ...baseProps.property,
          askingPrice: null,
          officialValuation: null,
          floorAreaM2: null,
          yearBuilt: null,
          marketState: null,
        }}
      />,
    );

    expect(screen.queryByTestId('property-activity-market-state')).toBeNull();
    expect(screen.queryByTestId('property-activity-price')).toBeNull();
    expect(screen.queryByTestId('property-activity-facts')).toBeNull();
  });

  it('renders summary preview bodies', () => {
    render(
      <ActivityFeedCard
        {...baseProps}
        preview={{
          kind: 'summary',
          eventType: 'property_like',
          createdAt: '2026-04-07T11:50:00.000Z',
          actor: baseProps.recentActors[0],
          summary: 'Ada Lovelace liked this property',
        }}
      />,
    );

    expect(screen.getByTestId('property-activity-summary')).toBeTruthy();
    expect(screen.getByText('Ada Lovelace liked this property')).toBeTruthy();
    expect(screen.queryByTestId('property-activity-comment-preview')).toBeNull();
  });

  it('uses the card and property attachment as property press targets', () => {
    const onPress = jest.fn();

    render(<ActivityFeedCard {...baseProps} onPress={onPress} />);

    fireEvent.press(screen.getByTestId('property-activity-card'));
    fireEvent.press(screen.getByTestId('property-activity-attachment'));

    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('navigates to actor profiles and stops property propagation', () => {
    const onPress = jest.fn();
    const stopPropagation = jest.fn();

    render(<ActivityFeedCard {...baseProps} onPress={onPress} />);

    fireEvent.press(screen.getByTestId('property-activity-primary-actor-link'), {
      stopPropagation,
    });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/user/@ada');
    expect(onPress).not.toHaveBeenCalled();
  });

  it('navigates to the comments route from the bottom action and stops propagation', () => {
    const onPress = jest.fn();
    const stopPropagation = jest.fn();

    render(<ActivityFeedCard {...baseProps} onPress={onPress} />);

    fireEvent.press(screen.getByTestId('property-activity-comment-button'), {
      stopPropagation,
    });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(
      '/amsterdam/1015cz/keizersgracht/42/comments?returnTo=%2Ffeed',
    );
    expect(onPress).not.toHaveBeenCalled();
  });

  it('toggles property like and save actions without opening the property', () => {
    const onPress = jest.fn();
    const stopPropagation = jest.fn();

    render(<ActivityFeedCard {...baseProps} onPress={onPress} />);

    fireEvent.press(screen.getByTestId('property-activity-like-button'), {
      stopPropagation,
    });
    fireEvent.press(screen.getByTestId('property-activity-save-button'), {
      stopPropagation,
    });

    expect(toggleLike).toHaveBeenCalledTimes(1);
    expect(toggleSave).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('likes the inline preview comment without opening the property', () => {
    const onPress = jest.fn();
    const stopPropagation = jest.fn();

    render(<ActivityFeedCard {...baseProps} onPress={onPress} />);

    fireEvent.press(screen.getByTestId('property-activity-comment-like-button'), {
      stopPropagation,
    });

    expect(mutateCommentLike).toHaveBeenCalledWith({
      commentId: 'comment-1',
      isCurrentlyLiked: false,
    });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('auth-gates inline comment likes when signed out', () => {
    const onAuthRequired = jest.fn();
    mockUseAuthContext.mockReturnValue({
      isAuthenticated: false,
      user: null,
    } as ReturnType<typeof useAuthContext>);

    render(<ActivityFeedCard {...baseProps} onAuthRequired={onAuthRequired} />);

    fireEvent.press(screen.getByTestId('property-activity-comment-like-button'), {
      stopPropagation: jest.fn(),
    });

    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(mutateCommentLike).not.toHaveBeenCalled();
  });

  it('passes feed initial state into property like and save hooks', () => {
    render(
      <ActivityFeedCard
        {...baseProps}
        property={{
          ...baseProps.property,
          isLiked: true,
          isSaved: true,
          likeCount: 8,
        }}
      />,
    );

    expect(mockUsePropertyLike).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: 'property-1',
        initialIsLiked: true,
        initialLikeCount: 8,
      }),
    );
    expect(mockUsePropertySave).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: 'property-1',
        initialIsSaved: true,
      }),
    );
  });

  it('renders the actor row as non-interactive when there are no actors', () => {
    render(<ActivityFeedCard {...baseProps} recentActors={[]} />);

    expect(screen.queryByTestId('property-activity-primary-actor-link')).toBeNull();
    expect(screen.getByText('Recent activity')).toBeTruthy();
  });
});
