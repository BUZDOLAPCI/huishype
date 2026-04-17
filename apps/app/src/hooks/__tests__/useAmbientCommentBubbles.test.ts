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

  it('hydrates a grouped node from its member properties and keeps the node anchor', async () => {
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
});
