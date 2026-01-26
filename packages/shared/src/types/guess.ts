/**
 * Price guess and FMV types for HuisHype
 */

import type { UserSummary } from './user';

/**
 * Price guess submitted by a user
 */
export interface PriceGuess {
  id: string;
  /** Reference to the property */
  propertyId: string;
  /** Reference to the user who made the guess */
  userId: string;
  /** The guessed price in euros */
  guessedPrice: number;
  /** When this guess was created */
  createdAt: string;
  /** When this guess was last updated (if edited) */
  updatedAt?: string;
  /** When this guess can next be edited (5-day cooldown) */
  editableAt: string;
}

/**
 * Price guess with user details for display
 */
export interface PriceGuessWithUser extends PriceGuess {
  user: UserSummary;
}

/**
 * Guess result after property is sold
 */
export interface GuessResult {
  guessId: string;
  propertyId: string;
  userId: string;
  guessedPrice: number;
  actualPrice: number;
  /** Absolute difference */
  difference: number;
  /** Percentage difference */
  percentageDifference: number;
  /** Karma points earned/lost */
  karmaChange: number;
  /** Whether this guess was considered accurate */
  wasAccurate: boolean;
  resolvedAt: string;
}

/**
 * FMV (Fair Market Value) calculation
 */
export interface FMV {
  /** Weighted crowd-estimated value */
  value: number;
  /** Confidence level */
  confidence: 'low' | 'medium' | 'high';
  /** Number of guesses included in calculation */
  guessCount: number;
  /** Distribution statistics */
  distribution: FMVDistribution;
  /** Last recalculated timestamp */
  calculatedAt: string;
}

/**
 * FMV distribution statistics
 */
export interface FMVDistribution {
  min: number;
  max: number;
  median: number;
  mean: number;
  /** 10th percentile */
  p10: number;
  /** 25th percentile */
  p25: number;
  /** 75th percentile */
  p75: number;
  /** 90th percentile */
  p90: number;
  /** Standard deviation */
  stdDev: number;
}

/**
 * Consensus alignment feedback (shown immediately after guess)
 */
export interface ConsensusAlignment {
  /** Percentage of guessers who agree with this range */
  alignmentPercentage: number;
  /** Whether this guess aligns with top predictors */
  alignsWithTopPredictors: boolean;
  /** Message to display */
  message: string;
}

/**
 * Submit guess request
 */
export interface SubmitGuessRequest {
  propertyId: string;
  guessedPrice: number;
}

/**
 * Submit guess response
 */
export interface SubmitGuessResponse {
  guess: PriceGuess;
  /** Immediate consensus feedback */
  consensus: ConsensusAlignment;
  /** Updated FMV after this guess */
  updatedFmv: FMV;
}

/**
 * Update guess request
 */
export interface UpdateGuessRequest {
  guessedPrice: number;
}

/**
 * Guess validation error
 */
export type GuessValidationError =
  | 'COOLDOWN_NOT_ELAPSED'
  | 'ALREADY_GUESSED'
  | 'PRICE_TOO_LOW'
  | 'PRICE_TOO_HIGH'
  | 'PROPERTY_NOT_FOUND'
  | 'UNAUTHORIZED';

/**
 * User's guess history
 */
export interface UserGuessHistory {
  /** All guesses by the user */
  guesses: PriceGuessWithProperty[];
  /** Total guesses */
  totalCount: number;
  /** Resolved guesses count */
  resolvedCount: number;
  /** Average accuracy of resolved guesses */
  averageAccuracy?: number;
}

/**
 * Price guess with property details
 */
export interface PriceGuessWithProperty extends PriceGuess {
  property: {
    id: string;
    address: string;
    city: string;
    photoUrl?: string;
    askingPrice?: number;
    salePrice?: number;
    soldAt?: string;
  };
  /** Result if property was sold */
  result?: GuessResult;
}
