import React from 'react';
import { render, screen } from '@testing-library/react-native';
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
    address: 'Keizersgracht 42',
    city: 'Amsterdam',
    thumbnailUrl: null,
  },
  createdAt: '2026-04-07T12:00:00.000Z',
};

describe('ActivityFeedCard', () => {
  it('renders a placeholder when no property thumbnail is available', () => {
    render(<ActivityFeedCard {...baseProps} />);

    expect(screen.getByText('Keizersgracht 42 · Amsterdam')).toBeTruthy();
    expect(screen.queryByTestId('activity-feed-image')).toBeNull();
  });

  it('uses PropertyImageSurface for listing thumbnails', () => {
    render(
      <ActivityFeedCard
        {...baseProps}
        property={{
          ...baseProps.property,
          thumbnailUrl: 'https://cdn.example.com/listing.jpg',
        }}
      />
    );

    expect(screen.getByTestId('activity-feed-image')).toBeTruthy();
  });
});
