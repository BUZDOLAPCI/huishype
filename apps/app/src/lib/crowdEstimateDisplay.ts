export type CrowdEstimateConfidence = 'none' | 'low' | 'medium' | 'high';

export interface CrowdEstimateCandidate {
  fmv?: number | null;
  confidence?: CrowdEstimateConfidence | null;
  guessCount?: number | null;
}

export type CrowdEstimateInput = number | CrowdEstimateCandidate | null | undefined;

function isUsablePrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function getCrowdEstimateValue(
  input: CrowdEstimateInput,
  fallbackGuessCount?: number | null
): number | undefined {
  if (input == null) {
    return undefined;
  }

  if (typeof input === 'number') {
    if (!isUsablePrice(input)) {
      return undefined;
    }

    if (fallbackGuessCount != null && fallbackGuessCount <= 0) {
      return undefined;
    }

    return input;
  }

  if (!isUsablePrice(input.fmv)) {
    return undefined;
  }

  const guessCount = input.guessCount ?? fallbackGuessCount ?? 0;
  if (guessCount <= 0 || input.confidence === 'none') {
    return undefined;
  }

  return input.fmv;
}
