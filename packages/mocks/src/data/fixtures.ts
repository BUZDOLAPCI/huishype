/**
 * Mock data fixtures for HuisHype testing
 *
 * These fixtures provide deterministic test data for MSW handlers,
 * unit tests, and development.
 */

import type {
  User,
  UserProfile,
  Property,
  PropertyDetail,
  PropertySummary,
  Listing,
  ListingSummary,
  PriceGuess,
  FMV,
  CommentWithReplies,
  MapProperty,
  PropertyCluster,
} from '@huishype/shared';

// ============================================
// Users
// ============================================

export const mockUsers: User[] = [
  {
    id: 'user-001',
    username: 'jandevries',
    displayName: 'Jan de Vries',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jan',
    karma: 2500,
    karmaRank: 'Expert',
    isPlus: true,
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    id: 'user-002',
    username: 'mariabakker',
    displayName: 'Maria Bakker',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=maria',
    karma: 850,
    karmaRank: 'Trusted',
    isPlus: false,
    createdAt: '2024-03-20T14:15:00Z',
  },
  {
    id: 'user-003',
    username: 'pieterjansen',
    displayName: 'Pieter Jansen',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=pieter',
    karma: 125,
    karmaRank: 'Regular',
    isPlus: false,
    createdAt: '2024-06-01T09:00:00Z',
  },
  {
    id: 'user-004',
    username: 'sophiemeijer',
    displayName: 'Sophie Meijer',
    profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sophie',
    karma: 5200,
    karmaRank: 'Master',
    isPlus: true,
    createdAt: '2023-11-10T16:45:00Z',
  },
  {
    id: 'user-005',
    username: 'newuser',
    displayName: 'New User',
    karma: 0,
    karmaRank: 'Newbie',
    isPlus: false,
    createdAt: '2024-12-01T12:00:00Z',
  },
];

export const mockUserProfiles: UserProfile[] = mockUsers.map((user, index) => ({
  ...user,
  totalGuesses: [45, 23, 8, 112, 0][index],
  resolvedGuesses: [12, 5, 1, 38, 0][index],
  averageAccuracy: [87.5, 72.3, 65.0, 91.2, undefined][index],
  activeAreas: [
    ['Amsterdam', 'Amstelveen'],
    ['Rotterdam', 'Den Haag'],
    ['Utrecht'],
    ['Amsterdam', 'Haarlem', 'Zaandam'],
    [],
  ][index],
  badges: index === 3 ? [
    {
      id: 'badge-001',
      name: 'Early Adopter',
      description: 'Joined during the first month',
      iconUrl: 'https://example.com/badges/early-adopter.svg',
      earnedAt: '2023-11-10T16:45:00Z',
    },
    {
      id: 'badge-002',
      name: 'Top Predictor',
      description: 'Achieved 90% accuracy on 25+ properties',
      iconUrl: 'https://example.com/badges/top-predictor.svg',
      earnedAt: '2024-06-15T10:00:00Z',
    },
  ] : [],
}));

// ============================================
// Properties
// ============================================

export const mockProperties: Property[] = [
  {
    id: 'prop-001',
    bagIdentificatie: '0363010012345678',
    address: 'Prinsengracht 263',
    streetName: 'Prinsengracht',
    houseNumber: '263',
    city: 'Amsterdam',
    postalCode: '1016 GV',
    coordinates: { lat: 52.3752, lon: 4.8840 },
    bouwjaar: 1635,
    oppervlakte: 450,
    wozValue: 2850000,
    wozYear: 2024,
    propertyType: 'house',
  },
  {
    id: 'prop-002',
    bagIdentificatie: '0363010087654321',
    address: 'Herengracht 502',
    streetName: 'Herengracht',
    houseNumber: '502',
    city: 'Amsterdam',
    postalCode: '1017 CB',
    coordinates: { lat: 52.3665, lon: 4.8936 },
    bouwjaar: 1672,
    oppervlakte: 280,
    wozValue: 1950000,
    wozYear: 2024,
    propertyType: 'apartment',
  },
  {
    id: 'prop-003',
    bagIdentificatie: '0599010012345678',
    address: 'Coolsingel 40',
    streetName: 'Coolsingel',
    houseNumber: '40',
    city: 'Rotterdam',
    postalCode: '3011 AD',
    coordinates: { lat: 51.9225, lon: 4.4792 },
    bouwjaar: 2015,
    oppervlakte: 95,
    wozValue: 425000,
    wozYear: 2024,
    propertyType: 'apartment',
  },
  {
    id: 'prop-004',
    bagIdentificatie: '0518010012345678',
    address: 'Lange Voorhout 102',
    streetName: 'Lange Voorhout',
    houseNumber: '102',
    city: 'Den Haag',
    postalCode: '2514 EJ',
    coordinates: { lat: 52.0843, lon: 4.3126 },
    bouwjaar: 1760,
    oppervlakte: 520,
    wozValue: 3200000,
    wozYear: 2024,
    propertyType: 'house',
  },
  {
    id: 'prop-005',
    bagIdentificatie: '0344010012345678',
    address: 'Oudegracht 150',
    streetName: 'Oudegracht',
    houseNumber: '150',
    city: 'Utrecht',
    postalCode: '3511 AZ',
    coordinates: { lat: 52.0907, lon: 5.1214 },
    bouwjaar: 1890,
    oppervlakte: 120,
    wozValue: 585000,
    wozYear: 2024,
    propertyType: 'apartment',
  },
];

export const mockPropertyDetails: PropertyDetail[] = mockProperties.map(
  (prop, index) => ({
    ...prop,
    activeListing:
      index < 3
        ? {
            id: `listing-${prop.id}`,
            sourceUrl: `https://www.funda.nl/koop/amsterdam/huis-${prop.id}`,
            sourceName: 'funda' as const,
            askingPrice: [2950000, 2100000, 475000][index],
            thumbnailUrl: `https://cloud.funda.nl/valentina_media/182/123/thumb_${index}.jpg`,
            addedAt: '2024-11-15T10:00:00Z',
            userSubmitted: index === 2,
          }
        : undefined,
    fmv:
      index < 4
        ? {
            value: [2780000, 1850000, 440000, 3100000][index],
            confidence: (['high', 'medium', 'low', 'high'] as const)[index],
            guessCount: [42, 18, 6, 35][index],
            distribution: {
              min: [2500000, 1600000, 380000, 2800000][index],
              max: [3200000, 2200000, 520000, 3500000][index],
              median: [2780000, 1850000, 445000, 3100000][index],
              p25: [2650000, 1750000, 410000, 2950000][index],
              p75: [2900000, 1950000, 480000, 3250000][index],
            },
            vsAskingPrice:
              index < 3
                ? {
                    difference: [-170000, -250000, -35000][index],
                    percentageDifference: [-5.8, -11.9, -7.4][index],
                  }
                : undefined,
          }
        : undefined,
    activity: {
      viewCount: [1250, 890, 320, 2100, 45][index],
      uniqueViewerCount: [780, 520, 210, 1400, 32][index],
      commentCount: [28, 15, 4, 45, 0][index],
      guessCount: [42, 18, 6, 35, 0][index],
      saveCount: [156, 89, 23, 234, 2][index],
      likeCount: [312, 178, 45, 456, 5][index],
      trend: (['rising', 'stable', 'falling', 'rising', 'stable'] as const)[
        index
      ],
      lastActivityAt: [
        '2024-12-20T14:30:00Z',
        '2024-12-19T09:15:00Z',
        '2024-12-15T16:45:00Z',
        '2024-12-20T16:00:00Z',
        '2024-12-10T11:00:00Z',
      ][index],
    },
    photoUrl: `https://cloud.funda.nl/valentina_media/182/123/main_${index}.jpg`,
    photoSource: (['listing', 'listing', 'user', 'streetview', 'streetview'] as const)[index],
    photos: [
      {
        id: `photo-${prop.id}-1`,
        url: `https://cloud.funda.nl/valentina_media/182/123/main_${index}.jpg`,
        source: 'listing' as const,
        createdAt: '2024-11-15T10:00:00Z',
      },
    ],
  })
);

export const mockPropertySummaries: PropertySummary[] = mockPropertyDetails.map(
  (prop) => ({
    id: prop.id,
    address: prop.address,
    city: prop.city,
    postalCode: prop.postalCode,
    coordinates: prop.coordinates,
    photoUrl: prop.photoUrl,
    askingPrice: prop.activeListing?.askingPrice,
    fmvValue: prop.fmv?.value,
    activityLevel: (
      prop.activity.trend === 'rising'
        ? 'hot'
        : prop.activity.trend === 'falling'
          ? 'cold'
          : 'warm'
    ) as 'cold' | 'warm' | 'hot',
  })
);

// ============================================
// Listings
// ============================================

export const mockListings: Listing[] = mockPropertyDetails
  .filter((p) => p.activeListing)
  .map((prop) => ({
    id: prop.activeListing!.id,
    propertyId: prop.id,
    sourceUrl: prop.activeListing!.sourceUrl,
    sourceName: prop.activeListing!.sourceName,
    askingPrice: prop.activeListing!.askingPrice,
    priceHistory: [],
    status: 'active' as const,
    thumbnailUrl: prop.activeListing!.thumbnailUrl,
    title: `${prop.propertyType === 'apartment' ? 'Appartement' : 'Woonhuis'} te koop: ${prop.address}`,
    discoveredAt: prop.activeListing!.addedAt,
    lastVerifiedAt: prop.activeListing!.addedAt,
    userSubmitted: prop.activeListing!.userSubmitted,
  }));

export const mockListingSummaries: ListingSummary[] = mockListings.map(
  (listing) => {
    const prop = mockPropertyDetails.find((p) => p.id === listing.propertyId)!;
    return {
      id: listing.id,
      propertyId: listing.propertyId,
      address: prop.address,
      city: prop.city,
      postalCode: prop.postalCode,
      askingPrice: listing.askingPrice,
      thumbnailUrl: listing.thumbnailUrl,
      sourceName: listing.sourceName,
      sourceUrl: listing.sourceUrl,
      status: listing.status,
      fmvValue: prop.fmv?.value,
      fmvDifference: prop.fmv?.vsAskingPrice?.difference,
      commentCount: prop.activity.commentCount,
      guessCount: prop.activity.guessCount,
      likeCount: prop.activity.likeCount,
      activityLevel: prop.activity.trend === 'rising' ? 'hot' : 'warm',
    };
  }
);

// ============================================
// Guesses
// ============================================

export const mockGuesses: PriceGuess[] = [
  {
    id: 'guess-001',
    propertyId: 'prop-001',
    userId: 'user-001',
    guessedPrice: 2850000,
    createdAt: '2024-12-01T10:30:00Z',
    editableAt: '2024-12-06T10:30:00Z',
  },
  {
    id: 'guess-002',
    propertyId: 'prop-001',
    userId: 'user-002',
    guessedPrice: 2700000,
    createdAt: '2024-12-02T14:15:00Z',
    editableAt: '2024-12-07T14:15:00Z',
  },
  {
    id: 'guess-003',
    propertyId: 'prop-002',
    userId: 'user-001',
    guessedPrice: 1800000,
    createdAt: '2024-12-05T09:00:00Z',
    editableAt: '2024-12-10T09:00:00Z',
  },
  {
    id: 'guess-004',
    propertyId: 'prop-003',
    userId: 'user-003',
    guessedPrice: 450000,
    createdAt: '2024-12-10T16:45:00Z',
    editableAt: '2024-12-15T16:45:00Z',
  },
];

export const mockFMV: FMV = {
  value: 2780000,
  confidence: 'high',
  guessCount: 42,
  distribution: {
    min: 2500000,
    max: 3200000,
    median: 2780000,
    mean: 2790000,
    p10: 2550000,
    p25: 2650000,
    p75: 2900000,
    p90: 3100000,
    stdDev: 150000,
  },
  calculatedAt: '2024-12-20T12:00:00Z',
};

// ============================================
// Comments
// ============================================

export const mockComments: CommentWithReplies[] = [
  {
    id: 'comment-001',
    propertyId: 'prop-001',
    userId: 'user-001',
    user: {
      id: 'user-001',
      username: 'jandevries',
      displayName: 'Jan de Vries',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jan',
      karma: 2500,
      karmaRank: 'Expert',
    },
    content:
      'Prachtige locatie aan de gracht! De vraagprijs is wel aan de hoge kant voor de huidige markt.',
    likes: 24,
    isLikedByCurrentUser: false,
    createdAt: '2024-12-18T10:30:00Z',
    isEdited: false,
    replyCount: 2,
    replies: [
      {
        id: 'comment-001-r1',
        propertyId: 'prop-001',
        userId: 'user-002',
        user: {
          id: 'user-002',
          username: 'mariabakker',
          displayName: 'Maria Bakker',
          profilePhotoUrl:
            'https://api.dicebear.com/7.x/avataaars/svg?seed=maria',
          karma: 850,
          karmaRank: 'Trusted',
        },
        parentId: 'comment-001',
        mentionedUser: { id: 'user-001', username: 'jandevries' },
        content:
          'Eens! Maar de historische waarde van dit pand is wel uniek. Anne Frank museum is naast de deur.',
        likes: 8,
        isLikedByCurrentUser: true,
        createdAt: '2024-12-18T11:45:00Z',
        isEdited: false,
      },
      {
        id: 'comment-001-r2',
        propertyId: 'prop-001',
        userId: 'user-004',
        user: {
          id: 'user-004',
          username: 'sophiemeijer',
          displayName: 'Sophie Meijer',
          profilePhotoUrl:
            'https://api.dicebear.com/7.x/avataaars/svg?seed=sophie',
          karma: 5200,
          karmaRank: 'Master',
        },
        parentId: 'comment-001',
        mentionedUser: { id: 'user-002', username: 'mariabakker' },
        content: 'Klopt, maar toeristen overlast is wel een minpunt daar.',
        likes: 5,
        createdAt: '2024-12-18T14:20:00Z',
        isEdited: false,
      },
    ],
  },
  {
    id: 'comment-002',
    propertyId: 'prop-001',
    userId: 'user-003',
    user: {
      id: 'user-003',
      username: 'pieterjansen',
      displayName: 'Pieter Jansen',
      profilePhotoUrl:
        'https://api.dicebear.com/7.x/avataaars/svg?seed=pieter',
      karma: 125,
      karmaRank: 'Regular',
    },
    content:
      'Zou het pand ook voor verhuur geschikt zijn? Lijkt me een goede investering.',
    likes: 3,
    createdAt: '2024-12-19T09:15:00Z',
    isEdited: false,
    replyCount: 0,
    replies: [],
  },
  {
    id: 'comment-003',
    propertyId: 'prop-001',
    userId: 'user-004',
    user: {
      id: 'user-004',
      username: 'sophiemeijer',
      displayName: 'Sophie Meijer',
      profilePhotoUrl:
        'https://api.dicebear.com/7.x/avataaars/svg?seed=sophie',
      karma: 5200,
      karmaRank: 'Master',
    },
    content:
      'Let op: de kelderverdieping heeft vocht problemen volgens de buurt WhatsApp.',
    likes: 45,
    isLikedByCurrentUser: false,
    createdAt: '2024-12-20T08:00:00Z',
    isEdited: true,
    editedAt: '2024-12-20T08:15:00Z',
    replyCount: 0,
    replies: [],
  },
];

// ============================================
// Map Data
// ============================================

export const mockMapProperties: MapProperty[] = mockProperties.map(
  (prop, index) => ({
    id: prop.id,
    coordinates: prop.coordinates,
    isGhost: index >= 3, // Last two are ghost nodes
    activityLevel: (['hot', 'warm', 'cold', 'cold', 'cold'] as const)[index],
    showPhotoPreview: index < 2, // Only first two show photos
    photoUrl: index < 2 ? `https://cloud.funda.nl/valentina_media/182/123/thumb_${index}.jpg` : undefined,
    askingPrice: [2950000, 2100000, 475000, undefined, undefined][index],
    fmvValue: [2780000, 1850000, 440000, 3100000, undefined][index],
  })
);

export const mockPropertyClusters: PropertyCluster[] = [
  {
    id: 'cluster-amsterdam',
    coordinates: { lat: 52.3676, lon: 4.9041 },
    count: 1250,
    averageActivityLevel: 'hot',
    bounds: {
      north: 52.4308,
      south: 52.3005,
      east: 4.9886,
      west: 4.7288,
    },
  },
  {
    id: 'cluster-rotterdam',
    coordinates: { lat: 51.9225, lon: 4.4792 },
    count: 890,
    averageActivityLevel: 'warm',
    bounds: {
      north: 51.9750,
      south: 51.8700,
      east: 4.5500,
      west: 4.4000,
    },
  },
  {
    id: 'cluster-denhaag',
    coordinates: { lat: 52.0705, lon: 4.3007 },
    count: 720,
    averageActivityLevel: 'warm',
    bounds: {
      north: 52.1200,
      south: 52.0200,
      east: 4.4000,
      west: 4.2000,
    },
  },
];

// ============================================
// Helper Functions
// ============================================

export function getMockUser(id: string): User | undefined {
  return mockUsers.find((u) => u.id === id);
}

export function getMockProperty(id: string): PropertyDetail | undefined {
  return mockPropertyDetails.find((p) => p.id === id);
}

export function getMockComments(propertyId: string): CommentWithReplies[] {
  return mockComments.filter((c) => c.propertyId === propertyId);
}

export function getMockGuesses(propertyId: string): PriceGuess[] {
  return mockGuesses.filter((g) => g.propertyId === propertyId);
}
