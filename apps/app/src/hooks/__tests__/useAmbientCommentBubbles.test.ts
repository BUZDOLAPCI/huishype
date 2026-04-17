import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useAmbientCommentBubbles } from '../useAmbientCommentBubbles';
import { apiFetch, fetchBatchProperties } from '../../utils/api';

jest.mock('../../utils/api', () => {
  const actual = jest.requireActual('../../utils/api');
  return {
    ...actual,
    apiFetch: jest.fn(),
    fetchBatchProperties: jest.fn(),
  };
});

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockFetchBatchProperties = fetchBatchProperties as jest.MockedFunction<typeof fetchBatchProperties>;

describe('useAmbientCommentBubbles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hydrates a grouped node from its member properties and keeps the node anchor', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(180_000);

    mockFetchBatchProperties.mockResolvedValue([
      {
        id: 'member-a',
        nationalId: null,
        countryCode: 'NL',
        address: 'Kanaalstraat 1',
        city: 'Eindhoven',
        postalCode: '5611AA',
        geometry: { type: 'Point', coordinates: [5.49, 51.441] },
        yearBuilt: 1930,
        floorAreaM2: 88,
        status: 'active',
        officialValuation: 420000,
        hasListing: true,
        askingPrice: 440000,
        likeCount: 0,
        commentCount: 0,
        guessCount: 0,
        activityScore: 10,
        aerialImageUrl: null,
        thumbnailUrl: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'member-b',
        nationalId: null,
        countryCode: 'NL',
        address: 'Kanaalstraat 3',
        city: 'Eindhoven',
        postalCode: '5611AB',
        geometry: { type: 'Point', coordinates: [5.491, 51.442] },
        yearBuilt: 1931,
        floorAreaM2: 92,
        status: 'active',
        officialValuation: 460000,
        hasListing: true,
        askingPrice: 470000,
        likeCount: 4,
        commentCount: 2,
        guessCount: 1,
        activityScore: 22,
        aerialImageUrl: null,
        thumbnailUrl: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    mockApiFetch.mockImplementation(async (path: string) => {
      if (path.includes('/properties/member-a/comments')) {
        return { data: [] };
      }

      if (path.includes('/properties/member-b/comments') && path.includes('sort=popular')) {
        return {
          data: [
            {
              id: 'comment-2',
              content: 'Would go 50k under ask',
              likeCount: 5,
              user: {
                username: 'robin',
                displayName: 'Robin',
                profilePhotoUrl: null,
              },
            },
          ],
        };
      }

      if (path.includes('/properties/member-b/comments') && path.includes('sort=recent')) {
        return {
          data: [
            {
              id: 'comment-3',
              content: 'Kitchen is actually nicer inside',
              likeCount: 1,
              user: {
                username: 'sam',
                displayName: 'Sam',
                profilePhotoUrl: null,
              },
            },
          ],
        };
      }

      return { data: [] };
    });

    const { result } = renderHook(() =>
      useAmbientCommentBubbles({
        enabled: true,
        maxVisibleBubbles: 2,
        toGroupProperty: (property) => ({
          id: property.id,
          address: property.address,
          city: property.city,
          coordinate: property.geometry?.coordinates,
          postalCode: property.postalCode,
          countryCode: property.countryCode,
          officialValuation: property.officialValuation,
          askingPrice: property.askingPrice,
          activityScore: property.activityScore,
          likeCount: property.likeCount,
          commentCount: property.commentCount,
          guessCount: property.guessCount,
        }),
      }),
    );

    await act(async () => {
      await result.current.refreshBubbles([
        {
          nodeKey: 'cluster:primary:5.48:51.44',
          property: {
            id: 'primary',
            address: '',
            city: '',
          },
          coordinate: [5.48, 51.44],
          screenPoint: [120, 180],
          commentCount: 3,
          likeCount: 4,
          activityScore: 22,
          hasListing: true,
          nodeClass: 'active',
          candidatePropertyIds: ['member-a', 'member-b'],
        },
      ]);
    });

    await waitFor(() => {
      expect(result.current.bubbles).toHaveLength(1);
    });

    expect(mockFetchBatchProperties).toHaveBeenCalledWith(['member-a', 'member-b']);
    expect(result.current.bubbles[0]).toMatchObject({
      nodeKey: 'cluster:primary:5.48:51.44',
      coordinate: [5.48, 51.44],
      property: {
        id: 'member-b',
        address: 'Kanaalstraat 3',
        city: 'Eindhoven',
        coordinate: [5.491, 51.442],
      },
      preview: {
        text: 'Would go 50k under ask',
        likeCount: 5,
        authorName: 'Robin',
      },
    });
  });

  it('skips nearby candidates on initial hydration and picks the next far-enough bubble', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(180_000);

    mockApiFetch.mockImplementation(async (path: string) => {
      const propertyId = path.match(/\/properties\/([^/]+)\/comments/)?.[1];

      return {
        data: propertyId ? [{
          id: `comment-${propertyId}`,
          content: `Comment from ${propertyId}`,
          likeCount: 1,
          user: {
            username: propertyId,
            displayName: propertyId?.toUpperCase() ?? null,
            profilePhotoUrl: null,
          },
        }] : [],
      };
    });

    const { result } = renderHook(() =>
      useAmbientCommentBubbles({
        enabled: true,
        maxVisibleBubbles: 3,
        toGroupProperty: (property) => ({
          id: property.id,
          address: property.address,
          city: property.city,
          coordinate: property.geometry?.coordinates,
          postalCode: property.postalCode,
          countryCode: property.countryCode,
          officialValuation: property.officialValuation,
          askingPrice: property.askingPrice,
          activityScore: property.activityScore,
          likeCount: property.likeCount,
          commentCount: property.commentCount,
          guessCount: property.guessCount,
        }),
      }),
    );

    await act(async () => {
      await result.current.refreshBubbles([
        {
          nodeKey: 'node-a',
          property: { id: 'a', address: 'A', city: 'Eindhoven' },
          coordinate: [5.4, 51.44],
          screenPoint: [100, 120],
          commentCount: 5,
          likeCount: 1,
          activityScore: 10,
          hasListing: true,
          nodeClass: 'active',
          candidatePropertyIds: [],
        },
        {
          nodeKey: 'node-b',
          property: { id: 'b', address: 'B', city: 'Eindhoven' },
          coordinate: [5.401, 51.441],
          screenPoint: [160, 130],
          commentCount: 4,
          likeCount: 1,
          activityScore: 9,
          hasListing: true,
          nodeClass: 'active',
          candidatePropertyIds: [],
        },
        {
          nodeKey: 'node-c',
          property: { id: 'c', address: 'C', city: 'Eindhoven' },
          coordinate: [5.42, 51.46],
          screenPoint: [600, 130],
          commentCount: 3,
          likeCount: 1,
          activityScore: 8,
          hasListing: true,
          nodeClass: 'active',
          candidatePropertyIds: [],
        },
      ], {
        minimumVisibleCount: 2,
        placementContext: {
          viewportSize: { width: 800, height: 600 },
        },
      });
    });

    expect(result.current.bubbles.map((bubble) => bubble.property.id)).toEqual(['a', 'c']);
  });

  it('adds ambient bubbles one at a time and evicts the oldest once the max is reached', async () => {
    jest.useFakeTimers();
    jest.spyOn(Date, 'now').mockReturnValue(180_000);

    mockApiFetch.mockImplementation(async (path: string) => {
      const propertyId = path.match(/\/properties\/([^/]+)\/comments/)?.[1];

      return {
        data: propertyId ? [{
          id: `comment-${propertyId}`,
          content: `Comment from ${propertyId}`,
          likeCount: 1,
          user: {
            username: propertyId,
            displayName: propertyId?.toUpperCase() ?? null,
            profilePhotoUrl: null,
          },
        }] : [],
      };
    });

    const { result } = renderHook(() =>
      useAmbientCommentBubbles({
        enabled: true,
        maxVisibleBubbles: 2,
        toGroupProperty: (property) => ({
          id: property.id,
          address: property.address,
          city: property.city,
          coordinate: property.geometry?.coordinates,
          postalCode: property.postalCode,
          countryCode: property.countryCode,
          officialValuation: property.officialValuation,
          askingPrice: property.askingPrice,
          activityScore: property.activityScore,
          likeCount: property.likeCount,
          commentCount: property.commentCount,
          guessCount: property.guessCount,
        }),
      }),
    );

    await act(async () => {
      await result.current.refreshBubbles([
        {
          nodeKey: 'node-a',
          property: { id: 'a', address: 'A', city: 'Eindhoven' },
          coordinate: [5.4, 51.44],
          screenPoint: [120, 180],
          commentCount: 5,
          likeCount: 1,
          activityScore: 10,
          hasListing: true,
          nodeClass: 'active',
          candidatePropertyIds: [],
        },
        {
          nodeKey: 'node-b',
          property: { id: 'b', address: 'B', city: 'Eindhoven' },
          coordinate: [5.41, 51.45],
          screenPoint: [140, 190],
          commentCount: 4,
          likeCount: 1,
          activityScore: 9,
          hasListing: true,
          nodeClass: 'active',
          candidatePropertyIds: [],
        },
        {
          nodeKey: 'node-c',
          property: { id: 'c', address: 'C', city: 'Eindhoven' },
          coordinate: [5.42, 51.46],
          screenPoint: [160, 200],
          commentCount: 3,
          likeCount: 1,
          activityScore: 8,
          hasListing: true,
          nodeClass: 'active',
          candidatePropertyIds: [],
        },
      ]);
    });

    expect(result.current.bubbles.map((bubble) => bubble.property.id)).toEqual(['a']);

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current.bubbles.map((bubble) => bubble.property.id)).toEqual(['a', 'b']);

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current.bubbles.map((bubble) => bubble.property.id)).toEqual(['b', 'c']);
  });

  it('preserves the current rotation step when refreshing with preserveRotation', async () => {
    jest.useFakeTimers();
    jest.spyOn(Date, 'now').mockReturnValue(180_000);

    mockApiFetch.mockImplementation(async (path: string) => {
      const propertyId = path.match(/\/properties\/([^/]+)\/comments/)?.[1];

      return {
        data: propertyId ? [{
          id: `comment-${propertyId}`,
          content: `Comment from ${propertyId}`,
          likeCount: 1,
          user: {
            username: propertyId,
            displayName: propertyId?.toUpperCase() ?? null,
            profilePhotoUrl: null,
          },
        }] : [],
      };
    });

    const visibleNodes = [
      {
        nodeKey: 'node-a',
        property: { id: 'a', address: 'A', city: 'Eindhoven' },
        coordinate: [5.4, 51.44] as [number, number],
        screenPoint: [120, 180] as [number, number],
        commentCount: 5,
        likeCount: 1,
        activityScore: 10,
        hasListing: true,
        nodeClass: 'active' as const,
        candidatePropertyIds: [],
      },
      {
        nodeKey: 'node-b',
        property: { id: 'b', address: 'B', city: 'Eindhoven' },
        coordinate: [5.41, 51.45] as [number, number],
        screenPoint: [140, 190] as [number, number],
        commentCount: 4,
        likeCount: 1,
        activityScore: 9,
        hasListing: true,
        nodeClass: 'active' as const,
        candidatePropertyIds: [],
      },
      {
        nodeKey: 'node-c',
        property: { id: 'c', address: 'C', city: 'Eindhoven' },
        coordinate: [5.42, 51.46] as [number, number],
        screenPoint: [160, 200] as [number, number],
        commentCount: 3,
        likeCount: 1,
        activityScore: 8,
        hasListing: true,
        nodeClass: 'active' as const,
        candidatePropertyIds: [],
      },
    ];

    const { result } = renderHook(() =>
      useAmbientCommentBubbles({
        enabled: true,
        maxVisibleBubbles: 2,
        toGroupProperty: (property) => ({
          id: property.id,
          address: property.address,
          city: property.city,
          coordinate: property.geometry?.coordinates,
          postalCode: property.postalCode,
          countryCode: property.countryCode,
          officialValuation: property.officialValuation,
          askingPrice: property.askingPrice,
          activityScore: property.activityScore,
          likeCount: property.likeCount,
          commentCount: property.commentCount,
          guessCount: property.guessCount,
        }),
      }),
    );

    await act(async () => {
      await result.current.refreshBubbles(visibleNodes);
    });

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current.bubbles.map((bubble) => bubble.property.id)).toEqual(['a', 'b']);

    await act(async () => {
      await result.current.refreshBubbles(visibleNodes, { preserveRotation: true });
    });

    expect(result.current.bubbles.map((bubble) => bubble.property.id)).toEqual(['a', 'b']);

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current.bubbles.map((bubble) => bubble.property.id)).toEqual(['b', 'c']);
  });

  it('tops up visible bubbles on append refresh without dropping older bubbles', async () => {
    jest.useFakeTimers();
    jest.spyOn(Date, 'now').mockReturnValue(180_000);

    mockApiFetch.mockImplementation(async (path: string) => {
      const propertyId = path.match(/\/properties\/([^/]+)\/comments/)?.[1];

      return {
        data: propertyId ? [{
          id: `comment-${propertyId}`,
          content: `Comment from ${propertyId}`,
          likeCount: 1,
          user: {
            username: propertyId,
            displayName: propertyId?.toUpperCase() ?? null,
            profilePhotoUrl: null,
          },
        }] : [],
      };
    });

    const { result } = renderHook(() =>
      useAmbientCommentBubbles({
        enabled: true,
        maxVisibleBubbles: 2,
        toGroupProperty: (property) => ({
          id: property.id,
          address: property.address,
          city: property.city,
          coordinate: property.geometry?.coordinates,
          postalCode: property.postalCode,
          countryCode: property.countryCode,
          officialValuation: property.officialValuation,
          askingPrice: property.askingPrice,
          activityScore: property.activityScore,
          likeCount: property.likeCount,
          commentCount: property.commentCount,
          guessCount: property.guessCount,
        }),
      }),
    );

    await act(async () => {
      await result.current.refreshBubbles([
        {
          nodeKey: 'node-a',
          property: { id: 'a', address: 'A', city: 'Eindhoven' },
          coordinate: [5.4, 51.44],
          screenPoint: [120, 180],
          commentCount: 5,
          likeCount: 1,
          activityScore: 10,
          hasListing: true,
          nodeClass: 'active',
          candidatePropertyIds: [],
        },
        {
          nodeKey: 'node-b',
          property: { id: 'b', address: 'B', city: 'Eindhoven' },
          coordinate: [5.41, 51.45],
          screenPoint: [140, 190],
          commentCount: 4,
          likeCount: 1,
          activityScore: 9,
          hasListing: true,
          nodeClass: 'active',
          candidatePropertyIds: [],
        },
      ]);
    });

    expect(result.current.bubbles.map((bubble) => bubble.property.id)).toEqual(['a']);

    await act(async () => {
      await result.current.refreshBubbles([], {
        appendToExisting: true,
        minimumVisibleCount: 2,
        preserveRotation: true,
      });
    });

    expect(result.current.bubbles.map((bubble) => bubble.property.id)).toEqual(['a', 'b']);

    await act(async () => {
      await result.current.refreshBubbles([
        {
          nodeKey: 'node-c',
          property: { id: 'c', address: 'C', city: 'Eindhoven' },
          coordinate: [5.42, 51.46],
          screenPoint: [160, 200],
          commentCount: 3,
          likeCount: 1,
          activityScore: 8,
          hasListing: true,
          nodeClass: 'active',
          candidatePropertyIds: [],
        },
      ], {
        appendToExisting: true,
        minimumVisibleCount: 2,
        preserveRotation: true,
      });
    });

    expect(result.current.bubbles.map((bubble) => bubble.property.id)).toEqual(['a', 'b']);
  });

  it('skips appended bubbles that are too close to existing bubbles or each other', async () => {
    jest.useFakeTimers();
    jest.spyOn(Date, 'now').mockReturnValue(180_000);

    mockApiFetch.mockImplementation(async (path: string) => {
      const propertyId = path.match(/\/properties\/([^/]+)\/comments/)?.[1];

      return {
        data: propertyId ? [{
          id: `comment-${propertyId}`,
          content: `Comment from ${propertyId}`,
          likeCount: 1,
          user: {
            username: propertyId,
            displayName: propertyId?.toUpperCase() ?? null,
            profilePhotoUrl: null,
          },
        }] : [],
      };
    });

    const { result } = renderHook(() =>
      useAmbientCommentBubbles({
        enabled: true,
        maxVisibleBubbles: 3,
        toGroupProperty: (property) => ({
          id: property.id,
          address: property.address,
          city: property.city,
          coordinate: property.geometry?.coordinates,
          postalCode: property.postalCode,
          countryCode: property.countryCode,
          officialValuation: property.officialValuation,
          askingPrice: property.askingPrice,
          activityScore: property.activityScore,
          likeCount: property.likeCount,
          commentCount: property.commentCount,
          guessCount: property.guessCount,
        }),
      }),
    );

    await act(async () => {
      await result.current.refreshBubbles([
        {
          nodeKey: 'node-a',
          property: { id: 'a', address: 'A', city: 'Eindhoven' },
          coordinate: [5.4, 51.44],
          screenPoint: [100, 120],
          commentCount: 5,
          likeCount: 1,
          activityScore: 10,
          hasListing: true,
          nodeClass: 'active',
          candidatePropertyIds: [],
        },
      ], {
        placementContext: {
          viewportSize: { width: 800, height: 600 },
        },
      });
    });

    expect(result.current.bubbles.map((bubble) => bubble.property.id)).toEqual(['a']);

    await act(async () => {
      await result.current.refreshBubbles([
        {
          nodeKey: 'node-a',
          property: { id: 'a', address: 'A', city: 'Eindhoven' },
          coordinate: [5.4, 51.44],
          screenPoint: [100, 120],
          commentCount: 5,
          likeCount: 1,
          activityScore: 10,
          hasListing: true,
          nodeClass: 'active',
          candidatePropertyIds: [],
        },
        {
          nodeKey: 'node-b',
          property: { id: 'b', address: 'B', city: 'Eindhoven' },
          coordinate: [5.401, 51.441],
          screenPoint: [160, 130],
          commentCount: 4,
          likeCount: 1,
          activityScore: 9,
          hasListing: true,
          nodeClass: 'active',
          candidatePropertyIds: [],
        },
        {
          nodeKey: 'node-c',
          property: { id: 'c', address: 'C', city: 'Eindhoven' },
          coordinate: [5.42, 51.46],
          screenPoint: [600, 130],
          commentCount: 3,
          likeCount: 1,
          activityScore: 8,
          hasListing: true,
          nodeClass: 'active',
          candidatePropertyIds: [],
        },
        {
          nodeKey: 'node-d',
          property: { id: 'd', address: 'D', city: 'Eindhoven' },
          coordinate: [5.421, 51.461],
          screenPoint: [660, 140],
          commentCount: 2,
          likeCount: 1,
          activityScore: 7,
          hasListing: true,
          nodeClass: 'active',
          candidatePropertyIds: [],
        },
      ], {
        appendToExisting: true,
        minimumVisibleCount: 3,
        preserveRotation: true,
        placementContext: {
          viewportSize: { width: 800, height: 600 },
        },
      });
    });

    expect(result.current.bubbles.map((bubble) => bubble.property.id)).toEqual(['a', 'c']);
  });

  it('evicts the oldest hydrated bubbles when append refresh overflows the pool', async () => {
    jest.useFakeTimers();
    jest.spyOn(Date, 'now').mockReturnValue(180_000);

    mockApiFetch.mockImplementation(async (path: string) => {
      const propertyId = path.match(/\/properties\/([^/]+)\/comments/)?.[1];

      return {
        data: propertyId ? [{
          id: `comment-${propertyId}`,
          content: `Comment from ${propertyId}`,
          likeCount: 1,
          user: {
            username: propertyId,
            displayName: propertyId?.toUpperCase() ?? null,
            profilePhotoUrl: null,
          },
        }] : [],
      };
    });

    const { result } = renderHook(() =>
      useAmbientCommentBubbles({
        enabled: true,
        maxVisibleBubbles: 5,
        toGroupProperty: (property) => ({
          id: property.id,
          address: property.address,
          city: property.city,
          coordinate: property.geometry?.coordinates,
          postalCode: property.postalCode,
          countryCode: property.countryCode,
          officialValuation: property.officialValuation,
          askingPrice: property.askingPrice,
          activityScore: property.activityScore,
          likeCount: property.likeCount,
          commentCount: property.commentCount,
          guessCount: property.guessCount,
        }),
      }),
    );

    const buildNode = (id: string, commentCount: number, x: number) => ({
      nodeKey: `node-${id}`,
      property: { id, address: id.toUpperCase(), city: 'Eindhoven' },
      coordinate: [x, 51.44] as [number, number],
      screenPoint: [120, 180] as [number, number],
      commentCount,
      likeCount: 1,
      activityScore: 10 - commentCount,
      hasListing: true,
      nodeClass: 'active' as const,
      candidatePropertyIds: [],
    });

    await act(async () => {
      await result.current.refreshBubbles([
        buildNode('a', 5, 5.4),
        buildNode('b', 4, 5.41),
        buildNode('c', 3, 5.42),
        buildNode('d', 2, 5.43),
        buildNode('e', 1, 5.44),
      ]);
    });

    await act(async () => {
      await result.current.refreshBubbles([], {
        appendToExisting: true,
        minimumVisibleCount: 5,
        preserveRotation: true,
      });
    });

    expect(result.current.bubbles.map((bubble) => bubble.property.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);

    await act(async () => {
      await result.current.refreshBubbles([
        buildNode('f', 6, 5.45),
      ], {
        appendToExisting: true,
        minimumVisibleCount: 5,
        preserveRotation: true,
      });
    });

    expect(result.current.bubbles.map((bubble) => bubble.property.id)).toEqual([
      'b',
      'c',
      'd',
      'e',
      'f',
    ]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });
});
