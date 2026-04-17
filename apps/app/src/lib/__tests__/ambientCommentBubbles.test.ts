import {
  getAmbientCommentRotationWindow,
  rankAmbientCommentCandidates,
  scoreAmbientCommentCandidate,
} from '../ambientCommentBubbles';

describe('scoreAmbientCommentCandidate', () => {
  it('prioritizes comments first, then likes, then activity', () => {
    expect(scoreAmbientCommentCandidate({
      propertyId: 'property-1',
      coordinate: [5.4, 51.4],
      address: 'Teststraat 1',
      city: 'Eindhoven',
      postalCode: '5611AA',
      countryCode: 'NL',
      commentCount: 2,
      likeCount: 5,
      activityScore: 9,
    })).toBe(48);
  });
});

describe('rankAmbientCommentCandidates', () => {
  it('keeps only the strongest entry per property and sorts by score', () => {
    const ranked = rankAmbientCommentCandidates([
      {
        propertyId: 'property-2',
        coordinate: [5.41, 51.45],
        address: 'Kanaalstraat 4',
        city: 'Eindhoven',
        postalCode: '5611AB',
        countryCode: 'NL',
        commentCount: 3,
        likeCount: 1,
        activityScore: 8,
      },
      {
        propertyId: 'property-1',
        coordinate: [5.4, 51.44],
        address: 'Teststraat 1',
        city: 'Eindhoven',
        postalCode: '5611AA',
        countryCode: 'NL',
        commentCount: 5,
        likeCount: 2,
        activityScore: 6,
      },
      {
        propertyId: 'property-1',
        coordinate: [5.4, 51.44],
        address: 'Teststraat 1',
        city: 'Eindhoven',
        postalCode: '5611AA',
        countryCode: 'NL',
        commentCount: 1,
        likeCount: 9,
        activityScore: 20,
      },
      {
        propertyId: 'property-3',
        coordinate: [5.42, 51.43],
        address: 'Lichtstraat 8',
        city: 'Eindhoven',
        postalCode: '5611AC',
        countryCode: 'NL',
        commentCount: 0,
        likeCount: 10,
        activityScore: 30,
      },
    ], 5);

    expect(ranked).toHaveLength(2);
    expect(ranked.map((candidate) => candidate.propertyId)).toEqual([
      'property-1',
      'property-2',
    ]);
    expect(ranked[0]).toMatchObject({
      propertyId: 'property-1',
      commentCount: 5,
    });
  });

  it('respects the requested pool size', () => {
    const ranked = rankAmbientCommentCandidates([
      {
        propertyId: 'property-1',
        coordinate: [5.4, 51.44],
        address: 'A',
        city: 'Eindhoven',
        postalCode: null,
        countryCode: 'NL',
        commentCount: 5,
        likeCount: 2,
        activityScore: 6,
      },
      {
        propertyId: 'property-2',
        coordinate: [5.41, 51.45],
        address: 'B',
        city: 'Eindhoven',
        postalCode: null,
        countryCode: 'NL',
        commentCount: 4,
        likeCount: 2,
        activityScore: 6,
      },
      {
        propertyId: 'property-3',
        coordinate: [5.42, 51.46],
        address: 'C',
        city: 'Eindhoven',
        postalCode: null,
        countryCode: 'NL',
        commentCount: 3,
        likeCount: 2,
        activityScore: 6,
      },
    ], 2);

    expect(ranked.map((candidate) => candidate.propertyId)).toEqual([
      'property-1',
      'property-2',
    ]);
  });
});

describe('getAmbientCommentRotationWindow', () => {
  it('returns a wrapped window across the ranked pool', () => {
    const window = getAmbientCommentRotationWindow(['a', 'b', 'c', 'd'], 3, 2);
    expect(window).toEqual(['d', 'a']);
  });

  it('returns all candidates when the pool is smaller than the requested bubble count', () => {
    expect(getAmbientCommentRotationWindow(['a'], 5, 2)).toEqual(['a']);
  });
});
