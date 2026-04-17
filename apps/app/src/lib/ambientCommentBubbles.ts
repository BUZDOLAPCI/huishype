export interface AmbientCommentCandidateInput {
  propertyId: string;
  coordinate: [number, number];
  address: string | null;
  city: string | null;
  postalCode: string | null;
  countryCode: string | null;
  commentCount: number;
  likeCount: number;
  activityScore: number;
}

export interface AmbientCommentCandidate extends AmbientCommentCandidateInput {
  score: number;
}

export function scoreAmbientCommentCandidate(candidate: AmbientCommentCandidateInput): number {
  return (
    candidate.commentCount * 12 +
    candidate.likeCount * 3 +
    candidate.activityScore
  );
}

export function rankAmbientCommentCandidates(
  candidates: AmbientCommentCandidateInput[],
  maxPoolSize: number,
): AmbientCommentCandidate[] {
  if (maxPoolSize <= 0) {
    return [];
  }

  const strongestByProperty = new Map<string, AmbientCommentCandidate>();

  for (const candidate of candidates) {
    if (!candidate.propertyId || candidate.commentCount <= 0) {
      continue;
    }

    const rankedCandidate: AmbientCommentCandidate = {
      ...candidate,
      score: scoreAmbientCommentCandidate(candidate),
    };
    const currentBest = strongestByProperty.get(candidate.propertyId);

    if (!currentBest || rankedCandidate.score > currentBest.score) {
      strongestByProperty.set(candidate.propertyId, rankedCandidate);
    }
  }

  return [...strongestByProperty.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.commentCount !== left.commentCount) {
        return right.commentCount - left.commentCount;
      }

      return left.propertyId.localeCompare(right.propertyId);
    })
    .slice(0, maxPoolSize);
}

export function getAmbientCommentRotationWindow<T>(
  candidates: T[],
  rotationIndex: number,
  bubbleCount: number,
): T[] {
  if (candidates.length === 0 || bubbleCount <= 0) {
    return [];
  }

  if (candidates.length <= bubbleCount) {
    return candidates;
  }

  const startIndex = ((rotationIndex % candidates.length) + candidates.length) % candidates.length;
  const window: T[] = [];

  for (let index = 0; index < bubbleCount; index += 1) {
    window.push(candidates[(startIndex + index) % candidates.length]!);
  }

  return window;
}
