/**
 * Guess API mock handlers
 *
 * Paths match the live Fastify routes (no /api/v1 prefix).
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { mockGuesses, mockFMV, getMockProperty } from '../data/fixtures.js';
import { getMockAuthUser } from './auth.js';
import type { PriceGuess, FMV } from '@huishype/shared';

// In-memory store for new guesses during mock session
const sessionGuesses: PriceGuess[] = [];

export const guessHandlers = [
  /**
   * GET /properties/:id/guesses - Get guesses for a property
   */
  http.get('*/properties/:propertyId/guesses', ({ params, request }) => {
    const { propertyId } = params;
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const cursor = url.searchParams.get('cursor');

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

    // Handle cursor pagination
    if (cursor) {
      const cursorIndex = guesses.findIndex((g) => g.id === cursor);
      if (cursorIndex !== -1) {
        guesses = guesses.slice(cursorIndex + 1);
      }
    }

    const hasMore = guesses.length > limit;
    guesses = guesses.slice(0, limit);

    return HttpResponse.json({
      data: guesses,
      cursor: hasMore ? guesses[guesses.length - 1]?.id : undefined,
      hasMore,
      fmv: property.fmv || mockFMV,
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
