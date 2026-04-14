/**
 * HuisHype API Client
 *
 * Thin typed request helpers built on the generated OpenAPI paths.
 * Browser callers rely on HTTP-only cookies (`credentials: 'include'`).
 * Explicit bearer-token flows are opt-in through `/auth/token/*`.
 */

import createClient from 'openapi-fetch';
import type {
  CreateCommentRequest,
  EmailAuthRequestResponse,
  GetCommentsRequest,
  GetFeedRequest,
  GetSavedPropertiesRequest,
  UpdateGuessRequest,
  UpdateUserProfileRequest,
} from '@huishype/shared';
import type { paths } from '../generated/api.js';

export interface ApiClientOptions {
  /** Base URL for the API (for example http://localhost:3100). */
  baseUrl: string;
  /** Optional bearer token for explicit non-browser token flows. */
  accessToken?: string;
  /** Custom fetch implementation, primarily for tests. */
  fetch?: typeof globalThis.fetch;
  /** Callback when the API returns 401. */
  onAuthError?: () => void;
}

export class ApiError extends Error {
  public code: string;
  public status: number;
  public details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string = 'UNKNOWN_ERROR',
    status: number = 500,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type ApiErrorEnvelope = {
  error?: string;
  message?: string;
  details?: Record<string, unknown>;
};

type OpenApiResult<T> = Promise<{
  data?: T;
  error?: ApiErrorEnvelope;
  response: Response;
}>;

type BrowserLoginResponse =
  paths['/auth/google']['post']['responses'][200]['content']['application/json'];
type BrowserRefreshResponse =
  paths['/auth/refresh']['post']['responses'][200]['content']['application/json'];
type TokenLoginResponse =
  paths['/auth/token/google']['post']['responses'][200]['content']['application/json'];
type TokenRefreshResponse =
  paths['/auth/token/refresh']['post']['responses'][200]['content']['application/json'];
type AuthSessionResponse =
  paths['/auth/session']['get']['responses'][200]['content']['application/json'];
type AuthMeResponse =
  paths['/auth/me']['get']['responses'][200]['content']['application/json'];

export class HuisHypeApiClient {
  private readonly client: ReturnType<typeof createClient<paths>>;
  private accessToken?: string;
  private readonly onAuthError?: () => void;

  constructor(options: ApiClientOptions) {
    this.client = createClient<paths>({
      baseUrl: options.baseUrl.replace(/\/$/, ''),
      credentials: 'include',
      fetch: options.fetch,
    });
    this.accessToken = options.accessToken;
    this.onAuthError = options.onAuthError;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  clearAccessToken(): void {
    this.accessToken = undefined;
  }

  clearTokens(): void {
    this.clearAccessToken();
  }

  private authHeaders(headers?: HeadersInit): HeadersInit | undefined {
    const merged = new Headers(headers);

    if (this.accessToken) {
      merged.set('Authorization', `Bearer ${this.accessToken}`);
    }

    return Array.from(merged.keys()).length > 0 ? merged : undefined;
  }

  private async unwrap<T>(request: OpenApiResult<T>): Promise<T> {
    const { data, error, response } = await request;

    if (error) {
      if (response.status === 401) {
        this.onAuthError?.();
      }

      throw new ApiError(
        error.message || `Request failed with status ${response.status}`,
        error.error || 'REQUEST_FAILED',
        response.status,
        error.details,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return data as T;
  }

  async loginGoogle(idToken: string): Promise<BrowserLoginResponse> {
    return this.unwrap(
      this.client.POST('/auth/google', {
        body: { idToken },
      }),
    );
  }

  async loginGoogleWithTokens(idToken: string): Promise<TokenLoginResponse> {
    return this.unwrap(
      this.client.POST('/auth/token/google', {
        body: { idToken },
      }),
    );
  }

  async loginApple(idToken: string): Promise<BrowserLoginResponse> {
    return this.unwrap(
      this.client.POST('/auth/apple', {
        body: { idToken },
      }),
    );
  }

  async loginAppleWithTokens(idToken: string): Promise<TokenLoginResponse> {
    return this.unwrap(
      this.client.POST('/auth/token/apple', {
        body: { idToken },
      }),
    );
  }

  async requestEmailMagicLink(email: string): Promise<EmailAuthRequestResponse> {
    return this.unwrap(
      this.client.POST('/auth/email/request', {
        body: { email },
      }),
    );
  }

  async verifyEmailToken(token: string): Promise<BrowserLoginResponse> {
    return this.unwrap(
      this.client.POST('/auth/email/verify', {
        body: { token },
      }),
    );
  }

  async verifyEmailTokenWithTokens(token: string): Promise<TokenLoginResponse> {
    return this.unwrap(
      this.client.POST('/auth/token/email/verify', {
        body: { token },
      }),
    );
  }

  async refreshSession(): Promise<BrowserRefreshResponse> {
    return this.unwrap(this.client.POST('/auth/refresh'));
  }

  async refreshAccessToken(): Promise<BrowserRefreshResponse> {
    return this.refreshSession();
  }

  async refreshTokenSession(refreshToken: string): Promise<TokenRefreshResponse> {
    return this.unwrap(
      this.client.POST('/auth/token/refresh', {
        body: { refreshToken },
      }),
    );
  }

  async logout(): Promise<void> {
    await this.unwrap(this.client.POST('/auth/logout'));
    this.clearAccessToken();
  }

  async logoutTokenSession(refreshToken?: string): Promise<void> {
    await this.unwrap(
      this.client.POST('/auth/token/logout', {
        body: refreshToken ? { refreshToken } : {},
      }),
    );
    this.clearAccessToken();
  }

  async getAuthSession(): Promise<AuthSessionResponse> {
    return this.unwrap(
      this.client.GET('/auth/session', {
        headers: this.authHeaders(),
      }),
    );
  }

  async getAuthMe(): Promise<AuthMeResponse> {
    return this.unwrap(
      this.client.GET('/auth/me', {
        headers: this.authHeaders(),
      }),
    );
  }

  async getProfile() {
    return this.unwrap(
      this.client.GET('/users/me', {
        headers: this.authHeaders(),
      }),
    );
  }

  async updateProfile(request: UpdateUserProfileRequest) {
    return this.unwrap(
      this.client.PUT('/users/me/profile', {
        body: request,
        headers: this.authHeaders(),
      }),
    );
  }

  async getUser(userId: string) {
    return this.unwrap(
      this.client.GET('/users/{id}/profile', {
        params: {
          path: { id: userId },
        },
      }),
    );
  }

  async resolveProperty(
    postalCode: string,
    houseNumber: string,
    houseNumberAddition?: string,
    countryCode?: string,
    street?: string,
    city?: string,
  ) {
    const query = {
      postalCode,
      houseNumber: Number.parseInt(houseNumber, 10),
      ...(houseNumberAddition ? { houseNumberAddition } : {}),
      ...(countryCode ? { countryCode } : {}),
      ...(street ? { street } : {}),
      ...(city ? { city } : {}),
    };

    return this.unwrap(
      this.client.GET('/properties/resolve', {
        params: {
          query,
        },
      }),
    );
  }

  async getProperty(propertyId: string) {
    return this.unwrap(
      this.client.GET('/properties/{id}', {
        params: {
          path: { id: propertyId },
        },
      }),
    );
  }

  async submitGuess(request: { propertyId: string; guessedPrice: number }) {
    return this.unwrap(
      this.client.POST('/properties/{id}/guesses', {
        params: {
          path: { id: request.propertyId },
        },
        body: { guessedPrice: request.guessedPrice },
        headers: this.authHeaders(),
      }),
    );
  }

  async updateGuess(propertyId: string, _guessId: string, request: UpdateGuessRequest) {
    return this.unwrap(
      this.client.POST('/properties/{id}/guesses', {
        params: {
          path: { id: propertyId },
        },
        body: request,
        headers: this.authHeaders(),
      }),
    );
  }

  async getComments(request: GetCommentsRequest) {
    const { propertyId, sort, cursor, limit } = request;

    return this.unwrap(
      this.client.GET('/properties/{id}/comments', {
        params: {
          path: { id: propertyId },
          query: { sort: sort as 'popular' | 'recent' | undefined, cursor, limit },
        },
      }),
    );
  }

  async createComment(request: CreateCommentRequest) {
    const { propertyId, ...body } = request;

    return this.unwrap(
      this.client.POST('/properties/{id}/comments', {
        params: {
          path: { id: propertyId },
        },
        body,
        headers: this.authHeaders(),
      }),
    );
  }

  async toggleCommentLike(commentId: string): Promise<{ isLiked: boolean; likeCount: number }> {
    const response = await this.unwrap(
      this.client.POST('/comments/{id}/like', {
        params: {
          path: { id: commentId },
        },
        headers: this.authHeaders(),
      }),
    );

    return {
      isLiked: response.liked,
      likeCount: response.likeCount,
    };
  }

  async getFeed(params: GetFeedRequest) {
    return this.unwrap(
      this.client.GET('/feed', {
        params: {
          query: {
            filter: params.filter,
            page: params.page,
            limit: params.limit,
            lat: params.lat,
            lon: params.lon,
            country: params.country,
          },
        },
      }),
    );
  }

  async getSavedProperties(request: GetSavedPropertiesRequest) {
    return this.unwrap(
      this.client.GET('/saved-properties', {
        params: {
          query: {
            limit: request.limit,
            offset: request.offset,
          },
        },
        headers: this.authHeaders(),
      }),
    );
  }

  async likeProperty(propertyId: string): Promise<void> {
    await this.unwrap(
      this.client.POST('/properties/{id}/like', {
        params: {
          path: { id: propertyId },
        },
        headers: this.authHeaders(),
      }),
    );
  }

  async unlikeProperty(propertyId: string): Promise<void> {
    await this.unwrap(
      this.client.DELETE('/properties/{id}/like', {
        params: {
          path: { id: propertyId },
        },
        headers: this.authHeaders(),
      }),
    );
  }

  async saveProperty(propertyId: string): Promise<void> {
    await this.unwrap(
      this.client.POST('/properties/{id}/save', {
        params: {
          path: { id: propertyId },
        },
        headers: this.authHeaders(),
      }),
    );
  }

  async unsaveProperty(propertyId: string): Promise<void> {
    await this.unwrap(
      this.client.DELETE('/properties/{id}/save', {
        params: {
          path: { id: propertyId },
        },
        headers: this.authHeaders(),
      }),
    );
  }

  async trackView(propertyId: string): Promise<void> {
    await this.unwrap(
      this.client.POST('/properties/{id}/view', {
        params: {
          path: { id: propertyId },
        },
      }),
    );
  }
}

export function createApiClient(options: ApiClientOptions): HuisHypeApiClient {
  return new HuisHypeApiClient(options);
}
