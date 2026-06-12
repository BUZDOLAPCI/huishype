import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { ActivityFeedCard } from '../ActivityFeedCard';

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
  },
}));

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
  });

  it('renders a placeholder when no property thumbnail is available', () => {
    render(<ActivityFeedCard {...baseProps} />);

    expect(screen.getByText('Keizersgracht 42, 1015 CZ Amsterdam')).toBeTruthy();
    expect(screen.queryByTestId('property-activity-image')).toBeNull();
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

  it('renders grouped actor facepile, preview fallback, and stat chips', () => {
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

    expect(screen.getByTestId('property-activity-facepile')).toBeTruthy();
    expect(screen.getByText('Ada Lovelace and Grace Hopper')).toBeTruthy();
    expect(screen.getByText('Latest activity')).toBeTruthy();
    expect(screen.getByText('Ada Lovelace liked this property')).toBeTruthy();
    expect(screen.getByTestId('property-activity-stats-likes')).toBeTruthy();
    expect(screen.getByTestId('property-activity-stats-comments')).toBeTruthy();
    expect(screen.getByTestId('property-activity-stats-guesses')).toBeTruthy();
  });

  it('uses the card as the primary property press target', () => {
    const onPress = jest.fn();

    render(<ActivityFeedCard {...baseProps} onPress={onPress} />);

    fireEvent.press(screen.getByTestId('property-activity-card'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('navigates to the primary actor profile from the actor row', () => {
    render(<ActivityFeedCard {...baseProps} onPress={jest.fn()} />);

    fireEvent.press(screen.getByTestId('property-activity-primary-actor-link'));

    expect(router.push).toHaveBeenCalledWith('/user/@ada');
  });

  it('does not call the property press handler when the actor row is pressed', () => {
    const onPress = jest.fn();
    const stopPropagation = jest.fn();

    render(<ActivityFeedCard {...baseProps} onPress={onPress} />);

    fireEvent.press(screen.getByTestId('property-activity-primary-actor-link'), {
      stopPropagation,
    });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders the actor row as non-interactive when there are no actors', () => {
    render(<ActivityFeedCard {...baseProps} recentActors={[]} />);

    expect(screen.queryByTestId('property-activity-primary-actor-link')).toBeNull();
    expect(screen.getByText('Recent activity')).toBeTruthy();
  });
});
