import React from 'react';
import { render } from '@testing-library/react-native';
import { CommentsSection } from '../CommentsSection';
import type { PropertyDetailsData } from '../types';

const mockUseComments = jest.fn();
const mockUseAuthContext = jest.fn();

jest.mock('../../../hooks/useComments', () => ({
  useComments: (...args: unknown[]) => mockUseComments(...args),
  useSubmitComment: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
  useLikeComment: () => ({
    mutate: jest.fn(),
  }),
}));

jest.mock('../../../providers/AuthProvider', () => ({
  useAuthContext: () => mockUseAuthContext(),
}));

jest.mock('../SectionCard', () => ({
  SectionCard: ({ children }: { children: React.ReactNode }) => {
    const React = require('react');
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
}));

jest.mock('../../Comments', () => ({
  Comment: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>Rendered comment</Text>;
  },
  CommentInput: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>Comment input</Text>;
  },
}));

jest.mock('../../ReportModal', () => ({
  ReportModal: () => null,
}));

const property: PropertyDetailsData = {
  id: 'property-123',
  nationalId: null,
  countryCode: 'NL',
  address: 'Teststraat 42',
  city: 'Eindhoven',
  postalCode: '5600 AA',
  geometry: null,
  yearBuilt: 1998,
  floorAreaM2: 112,
  status: 'active',
  officialValuation: 350000,
  askingPrice: 365000,
  marketState: 'for-sale',
  activityLevel: 'warm',
  commentCount: 2,
  guessCount: 0,
  viewCount: 0,
  likeCount: 0,
  isLiked: false,
  isSaved: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

function collectText(node: unknown): string[] {
  if (node === null || typeof node !== 'object') {
    return [];
  }

  const children = (node as { children?: unknown[] }).children ?? [];
  return children.flatMap((child) => {
    if (typeof child === 'string') {
      return [child];
    }

    return collectText(child);
  });
}

describe('CommentsSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuthContext.mockReturnValue({ isAuthenticated: false });
    mockUseComments.mockReturnValue({
      data: {
        pages: [
          {
            data: [],
            meta: { total: 2 },
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });
  });

  it('defaults to popular comments and renders Popular before Recent', () => {
    const screen = render(<CommentsSection property={property} />);

    expect(mockUseComments).toHaveBeenCalledWith('property-123', 'popular');

    const texts = collectText(screen.toJSON());
    expect(texts.indexOf('Popular')).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf('Recent')).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf('Popular')).toBeLessThan(texts.indexOf('Recent'));
  });
});
