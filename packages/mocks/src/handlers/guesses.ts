/**
 * Guess API mock handlers
 */

import { http, HttpResponse } from 'msw';
import { mockGuesses, mockFMV, getMockProperty } from '../data/fixtures';
import { getMockAuthUser } from './auth';
import type { SubmitGuessResponse, PriceGuess, FMV } from '@huishype/shared';

const API_BASE = '/api/v1';

// In-memory store for new guesses during mock session
const sessionGuesses: PriceGuess[] = [];

export const guessHandlers = [
  /**
   * POST /guesses - Submit a new price guess
   */
  http.post(`${API_BASE}/guesses`, async ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));

    if (!authUser) {
      return HttpResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json() as { propertyId: string; guessedPrice: number };
    const { propertyId, guessedPrice } = body;

    // Validate property exists
    const property = getMockProperty(propertyId);
    if (!property) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    // Check if user already has a guess
    const existingGuess =
      mockGuesses.find((g) => g.propertyId === propertyId && g.userId === authUser.id) ||
      sessionGuesses.find((g) => g.propertyId === propertyId && g.userId === authUser.id);

    if (existingGuess) {
      return HttpResponse.json(
        { code: 'ALREADY_GUESSED', message: 'You have already guessed for this property' },
        { status: 400 }
      );
    }

    // Validate price
    if (guessedPrice < 10000 || guessedPrice > 100000000) {
      return HttpResponse.json(
        { code: 'INVALID_PRICE', message: 'Price must be between 10,000 and 100,000,000' },
        { status: 400 }
      );
    }

    // Create new guess
    const newGuess: PriceGuess = {
      id: `guess-${Date.now()}`,
      propertyId,
      userId: authUser.id,
      guessedPrice,
      createdAt: new Date().toISOString(),
      editableAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days
    };

    sessionGuesses.push(newGuess);

    // Calculate consensus alignment
    const allGuesses = [...mockGuesses, ...sessionGuesses].filter(
      (g) => g.propertyId === propertyId
    );
    const median = calculateMedian(allGuesses.map((g) => g.guessedPrice));
    const percentDiff = Math.abs((guessedPrice - median) / median);
    const alignsWithConsensus = percentDiff < 0.15; // Within 15% of median

    // Mock updated FMV
    const updatedFmv: FMV = {
      ...mockFMV,
      value: Math.round(
        allGuesses.reduce((sum, g) => sum + g.guessedPrice, 0) / allGuesses.length
      ),
      guessCount: allGuesses.length,
      calculatedAt: new Date().toISOString(),
    };

    const response: SubmitGuessResponse = {
      guess: newGuess,
      consensus: {
        alignmentPercentage: alignsWithConsensus ? 85 : 35,
        alignsWithTopPredictors: alignsWithConsensus,
        message: alignsWithConsensus
          ? 'Your guess aligns with most predictors!'
          : 'Your guess differs from the consensus - care to share why?',
      },
      updatedFmv,
    };

    return HttpResponse.json(response, { status: 201 });
  }),

  /**
   * PATCH /guesses/:guessId - Update an existing guess
   */
  http.patch(`${API_BASE}/guesses/:guessId`, async ({ params, request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));

    if (!authUser) {
      return HttpResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const { guessId } = params;
    const body = await request.json() as { guessedPrice: number };
    const { guessedPrice } = body;

    // Find the guess
    let guess =
      mockGuesses.find((g) => g.id === guessId) ||
      sessionGuesses.find((g) => g.id === guessId);

    if (!guess) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Guess not found' },
        { status: 404 }
      );
    }

    // Verify ownership
    if (guess.userId !== authUser.id) {
      return HttpResponse.json(
        { code: 'FORBIDDEN', message: 'You can only edit your own guesses' },
        { status: 403 }
      );
    }

    // Check cooldown
    if (new Date(guess.editableAt) > new Date()) {
      return HttpResponse.json(
        {
          code: 'COOLDOWN_NOT_ELAPSED',
          message: `You can edit this guess after ${guess.editableAt}`,
        },
        { status: 400 }
      );
    }

    // Update guess (in real impl would update DB)
    const updatedGuess: PriceGuess = {
      ...guess,
      guessedPrice,
      updatedAt: new Date().toISOString(),
      editableAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    };

    // Verify property exists
    getMockProperty(guess.propertyId);

    const response: SubmitGuessResponse = {
      guess: updatedGuess,
      consensus: {
        alignmentPercentage: 75,
        alignsWithTopPredictors: true,
        message: 'Your updated guess aligns with most predictors!',
      },
      updatedFmv: { ...mockFMV, calculatedAt: new Date().toISOString() },
    };

    return HttpResponse.json(response);
  }),

  /**
   * GET /properties/:propertyId/guesses - Get guesses for a property
   */
  http.get(`${API_BASE}/properties/:propertyId/guesses`, ({ params, request }) => {
    const { propertyId } = params;
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const cursor = url.searchParams.get('cursor');

    const property = getMockProperty(propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Property not found' },
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
];

// Helper function
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
