import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ActivityFeedCard } from '../ActivityFeedCard';

const baseProps = {
  id: 'activity-1',
  eventType: 'comment' as const,
  actor: {
    id: 'user-1',
    displayName: 'Ada Lovelace',
    handle: 'ada',
    profilePhotoUrl: null,
  },
  property: {
    id: 'property-1',
    address: 'Keizersgracht 42, 1015 CZ Amsterdam',
    city: 'Amsterdam',
    thumbnailUrl: null,
  },
  createdAt: '2026-04-07T12:00:00.000Z',
};

describe('ActivityFeedCard', () => {
  it('renders a placeholder when no property thumbnail is available', () => {
    render(<ActivityFeedCard {...baseProps} />);

    expect(screen.getByText('Keizersgracht 42, 1015 CZ Amsterdam')).toBeTruthy();
    expect(screen.queryByText('Keizersgracht 42, 1015 CZ Amsterdam · Amsterdam')).toBeNull();
    expect(screen.queryByTestId('activity-feed-image')).toBeNull();
  });

  it('uses PropertyImageSurface for listing thumbnails', () => {
    render(
      <ActivityFeedCard
        {...baseProps}
        property={{
          ...baseProps.property,
          thumbnailUrl: 'https://cdn.huishype.nl/listing.jpg',
        }}
      />
    );

    expect(screen.getByTestId('activity-feed-image')).toBeTruthy();
  });

  it('splits property and actor press targets', () => {
    const onPropertyPress = jest.fn();
    const onActorPress = jest.fn();

    render(
      <ActivityFeedCard
        {...baseProps}
        onPropertyPress={onPropertyPress}
        onActorPress={onActorPress}
      />
    );

    fireEvent.press(screen.getByTestId('activity-feed-property-button'));
    expect(onPropertyPress).toHaveBeenCalledTimes(1);
    expect(onActorPress).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('activity-feed-actor-button'));
    expect(onActorPress).toHaveBeenCalledTimes(1);
  });
});
