import React from 'react';
import { render } from '@testing-library/react-native';
import { CommentsList } from '../CommentsList';

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

jest.mock('../Comment', () => ({
  Comment: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>Rendered comment</Text>;
  },
}));

jest.mock('../CommentInput', () => ({
  CommentInput: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>Comment input</Text>;
  },
}));

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

describe('CommentsList', () => {
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
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
      isRefetching: false,
    });
  });

  it('defaults to popular comments and renders Popular before Recent', () => {
    const screen = render(<CommentsList propertyId="property-123" />);

    expect(mockUseComments).toHaveBeenCalledWith('property-123', 'popular');

    const texts = collectText(screen.toJSON());
    expect(texts.indexOf('Popular')).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf('Recent')).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf('Popular')).toBeLessThan(texts.indexOf('Recent'));
  });
});
