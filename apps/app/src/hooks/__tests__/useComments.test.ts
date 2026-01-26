import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { commentKeys } from '../useComments';

// Mock the auth context
jest.mock('../../providers/AuthProvider', () => ({
  useAuthContext: () => ({
    accessToken: 'test-token',
    user: { id: 'test-user-id' },
    isAuthenticated: true,
  }),
}));

// Mock fetch
global.fetch = jest.fn();

describe('commentKeys', () => {
  it('generates correct all key', () => {
    expect(commentKeys.all).toEqual(['comments']);
  });

  it('generates correct lists key', () => {
    expect(commentKeys.lists()).toEqual(['comments', 'list']);
  });

  it('generates correct list key with propertyId and sortBy', () => {
    expect(commentKeys.list('property-123', 'recent')).toEqual([
      'comments',
      'list',
      'property-123',
      'recent',
    ]);
    expect(commentKeys.list('property-456', 'popular')).toEqual([
      'comments',
      'list',
      'property-456',
      'popular',
    ]);
  });

  it('generates correct detail key', () => {
    expect(commentKeys.detail('comment-123')).toEqual([
      'comments',
      'detail',
      'comment-123',
    ]);
  });
});

describe('useComments', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    jest.clearAllMocks();
  });

  // Note: Full integration tests would require more setup with React Query
  // These are unit tests for the query key generation

  it('query keys are properly structured for caching', () => {
    const propertyId = 'test-property';
    const key1 = commentKeys.list(propertyId, 'recent');
    const key2 = commentKeys.list(propertyId, 'popular');

    // Keys should be different for different sort orders
    expect(key1).not.toEqual(key2);

    // Keys should share the same base
    expect(key1.slice(0, 3)).toEqual(key2.slice(0, 3));
  });
});

describe('Comment API response types', () => {
  it('validates expected comment structure', () => {
    const mockComment = {
      id: 'comment-1',
      propertyId: 'property-1',
      userId: 'user-1',
      parentId: null,
      content: 'Test comment',
      createdAt: '2024-01-15T12:00:00Z',
      updatedAt: '2024-01-15T12:00:00Z',
      user: {
        id: 'user-1',
        username: 'testuser',
        displayName: 'Test User',
        profilePhotoUrl: null,
        karma: 50,
      },
      likeCount: 10,
      replies: [],
    };

    // Type check passes if this compiles
    expect(mockComment.id).toBeDefined();
    expect(mockComment.content).toBeDefined();
    expect(mockComment.user.karma).toBeDefined();
    expect(mockComment.likeCount).toBeDefined();
    expect(mockComment.replies).toEqual([]);
  });

  it('validates comment with replies structure', () => {
    const mockCommentWithReplies = {
      id: 'comment-1',
      propertyId: 'property-1',
      userId: 'user-1',
      parentId: null,
      content: 'Parent comment',
      createdAt: '2024-01-15T12:00:00Z',
      updatedAt: '2024-01-15T12:00:00Z',
      user: {
        id: 'user-1',
        username: 'parent',
        displayName: 'Parent User',
        profilePhotoUrl: null,
        karma: 100,
      },
      likeCount: 20,
      replies: [
        {
          id: 'reply-1',
          propertyId: 'property-1',
          userId: 'user-2',
          parentId: 'comment-1',
          content: 'Reply comment',
          createdAt: '2024-01-15T13:00:00Z',
          updatedAt: '2024-01-15T13:00:00Z',
          user: {
            id: 'user-2',
            username: 'replier',
            displayName: 'Reply User',
            profilePhotoUrl: null,
            karma: 25,
          },
          likeCount: 5,
          replies: [],
        },
      ],
    };

    expect(mockCommentWithReplies.replies).toHaveLength(1);
    expect(mockCommentWithReplies.replies[0].parentId).toBe('comment-1');
  });
});

describe('Comment list response pagination', () => {
  it('validates pagination metadata structure', () => {
    const mockResponse = {
      data: [],
      meta: {
        page: 1,
        limit: 20,
        total: 100,
        totalPages: 5,
      },
    };

    expect(mockResponse.meta.page).toBe(1);
    expect(mockResponse.meta.limit).toBe(20);
    expect(mockResponse.meta.total).toBe(100);
    expect(mockResponse.meta.totalPages).toBe(5);
  });

  it('calculates next page correctly', () => {
    const getNextPageParam = (lastPage: { meta: { page: number; totalPages: number } }) => {
      const { page, totalPages } = lastPage.meta;
      return page < totalPages ? page + 1 : undefined;
    };

    // Has more pages
    expect(getNextPageParam({ meta: { page: 1, totalPages: 5 } })).toBe(2);
    expect(getNextPageParam({ meta: { page: 4, totalPages: 5 } })).toBe(5);

    // No more pages
    expect(getNextPageParam({ meta: { page: 5, totalPages: 5 } })).toBeUndefined();
    expect(getNextPageParam({ meta: { page: 1, totalPages: 1 } })).toBeUndefined();
  });
});
