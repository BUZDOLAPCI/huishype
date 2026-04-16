import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { QuickActions } from '../QuickActions';

var mockSharedQuickActions = jest.fn();

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return {
    ...actual,
    Share: {
      share: jest.fn().mockResolvedValue({ action: 'sharedAction' }),
    },
  };
});

jest.mock('../../QuickActions', () => ({
  QuickActions: (props: {
    onShare?: () => void;
    onLike?: () => void;
    onComment?: () => void;
    onGuess?: () => void;
    onSave?: () => void;
  }) => {
    const React = require('react');
    const { Pressable, Text, View } = require('react-native');
    mockSharedQuickActions(props);
    return React.createElement(
      View,
      null,
      React.createElement(
        Pressable,
        { onPress: props.onShare, testID: 'shared-quick-actions-share' },
        React.createElement(Text, null, 'Share'),
      ),
      React.createElement(
        Pressable,
        { onPress: props.onLike, testID: 'shared-quick-actions-like' },
        React.createElement(Text, null, 'Like'),
      ),
    );
  },
}));

jest.mock('../SectionCard', () => ({
  SectionCard: ({ children }: { children: React.ReactNode }) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, null, children);
  },
}));

jest.mock('../SharePropertyModal', () => ({
  SharePropertyModal: ({ visible }: { visible: boolean }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return visible ? React.createElement(Text, { testID: 'share-property-modal' }, 'Share modal') : null;
  },
}));

jest.mock('../../../utils/property-share', () => ({
  buildPropertySharePayload: jest.fn(() => ({
    title: 'Beeldbuisring 41 - HuisHype',
    message: 'Check out "Beeldbuisring 41, 5651HA Eindhoven" on HuisHype: http://localhost:8081/map/eindhoven/5651ha/beeldbuisring/41',
    url: 'http://localhost:8081/map/eindhoven/5651ha/beeldbuisring/41',
  })),
  isUnsupportedWebShareError: jest.fn(),
}));

const { isUnsupportedWebShareError } = jest.requireMock('../../../utils/property-share') as {
  isUnsupportedWebShareError: jest.Mock;
};
const { Share } = require('react-native') as {
  Share: { share: jest.Mock };
};

const property = {
  id: 'property-1',
  nationalId: null,
  address: 'Beeldbuisring 41',
  city: 'Eindhoven',
  postalCode: '5651 HA',
  countryCode: 'NL',
  streetName: 'Beeldbuisring',
  houseNumber: 41,
  geometry: null,
  yearBuilt: 1990,
  floorAreaM2: 140,
  status: 'active' as const,
  officialValuation: 450000,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  activityLevel: 'warm' as const,
  commentCount: 4,
  guessCount: 2,
  viewCount: 10,
  likeCount: 3,
  isLiked: false,
  isSaved: false,
};

describe('PropertyBottomSheet QuickActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isUnsupportedWebShareError.mockReturnValue(false);
  });

  it('forwards property metrics and callbacks into the shared full action row', () => {
    const onSave = jest.fn();
    const onLike = jest.fn();
    const onComment = jest.fn();
    const onGuess = jest.fn();

    render(
      <QuickActions
        property={property}
        onSave={onSave}
        onLike={onLike}
        onComment={onComment}
        onGuess={onGuess}
      />
    );

    expect(mockSharedQuickActions).toHaveBeenCalledWith(
      expect.objectContaining({
        isLiked: property.isLiked,
        isSaved: property.isSaved,
        likeCount: property.likeCount,
        commentCount: property.commentCount,
        guessCount: property.guessCount,
        onSave,
        onLike,
        onComment,
        onGuess,
        variant: 'full',
      })
    );
  });

  it('opens the fallback modal when the share attempt reports unsupported', async () => {
    Share.share.mockRejectedValueOnce(new Error('Share is not supported in this browser'));
    isUnsupportedWebShareError.mockReturnValue(true);

    render(<QuickActions property={property} />);

    fireEvent.press(screen.getByTestId('shared-quick-actions-share'));

    await waitFor(() => {
      expect(screen.getByTestId('share-property-modal')).toBeTruthy();
    });
    expect(Share.share).toHaveBeenCalledTimes(1);
  });

  it('uses the native share sheet and emits the share callback when supported', async () => {
    const onShare = jest.fn();

    render(<QuickActions property={property} onShare={onShare} />);

    fireEvent.press(screen.getByTestId('shared-quick-actions-share'));

    await waitFor(() => {
      expect(Share.share).toHaveBeenCalledWith({
        title: 'Beeldbuisring 41 - HuisHype',
        message: 'Check out "Beeldbuisring 41, 5651HA Eindhoven" on HuisHype: http://localhost:8081/map/eindhoven/5651ha/beeldbuisring/41',
        url: 'http://localhost:8081/map/eindhoven/5651ha/beeldbuisring/41',
      });
      expect(onShare).toHaveBeenCalledTimes(1);
    });
  });
});
