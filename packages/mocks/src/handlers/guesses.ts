/**
 * Guess API mock handlers
 *
 * Paths match the live Fastify routes (no /api/v1 prefix).
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { mockGuesses, mockFMV, getMockProperty, getMockUser } from '../data/fixtures.js';
import { getMockAuthUser } from './auth.js';
import type { PriceGuess, FMV } from '@huishype/shared';

// In-memory store for new guesses during mock session
const sessionGuesses: PriceGuess[] = [];

type MockPropertyFmvResponse = {
  fmv: number | null;
  confidence: 'none' | 'low' | 'medium' | 'high';
  guessCount: number;
  distribution: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    min: number;
    max: number;
  } | null;
  officialValuation: number | null;
  askingPrice: number | null;
  divergence: number | null;
};

type MockPriceGuessStart = {
  price: number;
  source:
    | 'official_valuation_adjusted'
    | 'local_comparable_price_per_m2'
    | 'official_valuation'
    | 'country_default';
  confidence: 'weak' | 'usable';
  sampleSize: number;
};

export const guessHandlers = [
  /**
   * GET /properties/:id/guesses - Get guesses for a property
   */
  http.get('*/properties/:propertyId/guesses', ({ params, request }) => {
    const { propertyId } = params;
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    const property = getMockProperty(propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    let guesses = [...mockGuesses, ...sessionGuesses]
      .filter((g) => g.propertyId === propertyId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = guesses.length;
    const offset = (page - 1) * limit;
    guesses = guesses.slice(offset, offset + limit);
    const activeListingAskingPrice = getActiveSaleAskingPrice(property);
    const priceGuessStart =
      activeListingAskingPrice == null ? getPriceGuessStart(property, total) : undefined;

    return HttpResponse.json({
      data: guesses.map((guess) => {
        const user = getMockUser(guess.userId);

        return {
          id: guess.id,
          propertyId: guess.propertyId,
          userId: guess.userId,
          guessedPrice: guess.guessedPrice,
          createdAt: guess.createdAt,
          updatedAt: guess.updatedAt ?? guess.createdAt,
          isMemeGuess: false,
          user: {
            id: user?.id ?? guess.userId,
            username: user?.username ?? user?.handle ?? 'unknown',
            displayName: user?.displayName ?? null,
            karma: user?.karma ?? 0,
            karmaRank: getKarmaRankSummary(user?.karmaRank),
          },
        };
      }),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      fmv: toPropertyFmvResponse(property),
      activeListingAskingPrice,
      ...(priceGuessStart ? { priceGuessStart } : {}),
    });
  }),

  /**
   * POST /properties/:id/guesses - Submit a new price guess
   */
  http.post('*/properties/:propertyId/guesses', async ({ params, request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));

    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const { propertyId } = params;
    const body = await request.json() as { guessedPrice: number };
    const { guessedPrice } = body;

    const property = getMockProperty(propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    // Check if user already has a guess
    const existingGuess =
      mockGuesses.find((g) => g.propertyId === propertyId && g.userId === authUser.id) ||
      sessionGuesses.find((g) => g.propertyId === propertyId && g.userId === authUser.id);

    if (existingGuess) {
      return HttpResponse.json(
        { error: 'ALREADY_GUESSED', message: 'You have already guessed for this property' },
        { status: 400 }
      );
    }

    if (guessedPrice < 10000 || guessedPrice > 100000000) {
      return HttpResponse.json(
        { error: 'INVALID_PRICE', message: 'Price must be between 10,000 and 100,000,000' },
        { status: 400 }
      );
    }

    const newGuess: PriceGuess = {
      id: `guess-${Date.now()}`,
      propertyId: propertyId as string,
      userId: authUser.id,
      guessedPrice,
      createdAt: new Date().toISOString(),
      editableAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    };

    sessionGuesses.push(newGuess);

    const allGuesses = [...mockGuesses, ...sessionGuesses].filter(
      (g) => g.propertyId === propertyId
    );
    const median = calculateMedian(allGuesses.map((g) => g.guessedPrice));
    const percentDiff = Math.abs((guessedPrice - median) / median);
    const alignsWithConsensus = percentDiff < 0.15;

    const updatedFmv: FMV = {
      ...mockFMV,
      value: Math.round(
        allGuesses.reduce((sum, g) => sum + g.guessedPrice, 0) / allGuesses.length
      ),
      guessCount: allGuesses.length,
      calculatedAt: new Date().toISOString(),
    };

    return HttpResponse.json({
      guess: newGuess,
      consensus: {
        alignmentPercentage: alignsWithConsensus ? 85 : 35,
        alignsWithTopPredictors: alignsWithConsensus,
        message: alignsWithConsensus
          ? 'Your guess aligns with most predictors!'
          : 'Your guess differs from the consensus - care to share why?',
      },
      updatedFmv,
    }, { status: 201 });
  }),
];

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function toPropertyFmvResponse(
  property: NonNullable<ReturnType<typeof getMockProperty>>
): MockPropertyFmvResponse {
  const fmv = property.fmv;

  if (!fmv) {
    return {
      fmv: null,
      confidence: 'none',
      guessCount: 0,
      distribution: null,
      officialValuation: property.officialValuation ?? null,
      askingPrice: property.activeListing?.askingPrice ?? null,
      divergence: null,
    };
  }

  return {
    fmv: fmv.value,
    confidence: fmv.confidence,
    guessCount: fmv.guessCount,
    distribution: {
      p10: fmv.distribution.min,
      p25: fmv.distribution.p25,
      p50: fmv.distribution.median,
      p75: fmv.distribution.p75,
      p90: fmv.distribution.max,
      min: fmv.distribution.min,
      max: fmv.distribution.max,
    },
    officialValuation: property.officialValuation ?? null,
    askingPrice: property.activeListing?.askingPrice ?? null,
    divergence: fmv.vsAskingPrice?.difference ?? null,
  };
}

function getActiveSaleAskingPrice(
  property: NonNullable<ReturnType<typeof getMockProperty>>
): number | null {
  const listing = property.activeListing;
  if (!listing) {
    return null;
  }

  const sourceUrl = listing.sourceUrl.toLowerCase();
  const isRentListing = sourceUrl.includes('/huur/') || listing.sourceName === 'pararius';
  return isRentListing ? null : listing.askingPrice;
}

function getPriceGuessStart(
  property: NonNullable<ReturnType<typeof getMockProperty>>,
  sampleSize: number
): MockPriceGuessStart | undefined {
  const price = property.officialValuation ?? null;
  if (price == null) {
    return undefined;
  }

  return {
    price,
    source: 'official_valuation',
    confidence: sampleSize >= 3 ? 'usable' : 'weak',
    sampleSize,
  };
}

function getKarmaRankSummary(rank?: string): { title: string; level: number } {
  const levels: Record<string, number> = {
    Newcomer: 1,
    Contributor: 2,
    'Rising Star': 3,
    'Local Expert': 4,
    Expert: 5,
    'Local Legend': 6,
    Master: 7,
  };

  const title = rank ?? 'Newcomer';
  return {
    title,
    level: levels[title] ?? 1,
  };
}
