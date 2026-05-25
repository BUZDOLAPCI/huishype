export type OfficialValuationSourceErrorMetadata = {
  observedStatus?: number;
  observedHeaders?: Record<string, string | null>;
};

export class OfficialValuationUnsupportedError extends Error {
  readonly code = 'unsupported' as const;
}

export class OfficialValuationNotFoundError extends Error {
  readonly code = 'not_found' as const;

  constructor(message: string, readonly metadata: OfficialValuationSourceErrorMetadata = {}) {
    super(message);
  }
}

export class OfficialValuationTemporarySourceError extends Error {
  readonly code = 'temporary_source_error' as const;

  constructor(
    message: string,
    readonly metadata: OfficialValuationSourceErrorMetadata = {},
    readonly retryAt?: Date,
  ) {
    super(message);
  }
}

export class OfficialValuationRateLimitError extends Error {
  readonly code = 'rate_limited' as const;

  constructor(
    message: string,
    readonly retryAt?: Date,
    readonly metadata: OfficialValuationSourceErrorMetadata = {},
  ) {
    super(message);
  }
}
