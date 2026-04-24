export class OfficialValuationUnsupportedError extends Error {
  readonly code = 'unsupported' as const;
}

export class OfficialValuationNotFoundError extends Error {
  readonly code = 'not_found' as const;
}

export class OfficialValuationTemporarySourceError extends Error {
  readonly code = 'temporary_source_error' as const;
}

export class OfficialValuationRateLimitError extends Error {
  readonly code = 'rate_limited' as const;

  constructor(message: string, readonly retryAt?: Date) {
    super(message);
  }
}
