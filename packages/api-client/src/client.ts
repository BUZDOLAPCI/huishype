/**
 * HuisHype API Client
 *
 * A typed wrapper for the HuisHype API.
 * Paths are derived from the OpenAPI spec exported from the live Fastify server.
 * The generated types in ../generated/api.ts are the contract reference.
 *
 * The app can use this client directly or its own fetch utilities —
 * the generated types are the source of truth, not this wrapper.
 */

import type {
  AuthMeResponse,
  AuthLoginResponse,
  AuthRefreshResponse,
  EmailAuthRequestResponse,
  SubmitGuessResponse,
  UpdateGuessRequest,
  GetCommentsRequest,
  GetCommentsResponse,
  CreateCommentRequest,
  CreateCommentResponse,
  GetFeedRequest,
  GetGroupedPropertyActivityRequest,
  GetGroupedPropertyActivityResponse,
  GetFollowingNearbyPropertyRequest,
  GetFollowingPropertyTilesRequest,
  GetSavedPropertiesRequest,
  PropertyResolveRequest,
  PropertyResolveResponse,
  UpdateUserProfileRequest,
  UpdateUserProfileResponse,
  GetFeedResponse,
  GetAdminReportResponse,
  GetAdminReportsResponse,
  RegisterPushTokenRequest,
  PatchAdminReportRequest,
  PatchAdminReportResponse,
  ReportCommentRequest,
  ReportCommentResponse,
  ReportPropertyRequest,
  ReportPropertyResponse,
  SearchUsersRequest,
} from '@huishype/shared';
import type { paths } from '../generated/api.js';

type PublicUserProfileResponse =
  paths['/users/{id}/profile']['get']['responses'][200]['content']['application/json'];
type MyUserProfileResponse =
  paths['/users/me']['get']['responses'][200]['content']['application/json'];
type UserSearchQuery = NonNullable<paths['/users/search']['get']['parameters']['query']>;
type UserSearchGeneratedResponse =
  paths['/users/search']['get']['responses'][200]['content']['application/json'];
type FollowListQuery = NonNullable<paths['/users/me/followers']['get']['parameters']['query']>;
type FollowListResponse =
  paths['/users/me/followers']['get']['responses'][200]['content']['application/json'];
type FollowActionResponse =
  paths['/users/{id}/follow']['put']['responses'][200]['content']['application/json'];
type ActivityQuery = NonNullable<paths['/activity']['get']['parameters']['query']>;
type ActivityResponse = paths['/activity']['get']['responses'][200]['content']['application/json'];
type GroupedPropertyActivityQuery =
  NonNullable<paths['/activity/properties']['get']['parameters']['query']>;
type GroupedPropertyActivityResponseFromOpenApi =
  paths['/activity/properties']['get']['responses'][200]['content']['application/json'];
type MyActivityQuery = NonNullable<paths['/users/me/activity']['get']['parameters']['query']>;
type MyActivityResponse =
  paths['/users/me/activity']['get']['responses'][200]['content']['application/json'];
type NotificationsQuery = NonNullable<paths['/notifications']['get']['parameters']['query']>;
type NotificationsResponse =
  paths['/notifications']['get']['responses'][200]['content']['application/json'];
type UnreadNotificationsResponse =
  paths['/notifications/unread-count']['get']['responses'][200]['content']['application/json'];
type MarkAllNotificationsReadResponse =
  paths['/notifications/read-all']['put']['responses'][200]['content']['application/json'];
type MarkNotificationReadResponse =
  paths['/notifications/{id}/read']['put']['responses'][200]['content']['application/json'];
type TrackViewResponse =
  paths['/properties/{id}/view']['post']['responses'][200]['content']['application/json'];
type ResolvePropertyQuery = paths['/properties/resolve']['get']['parameters']['query'];
type PropertyResponse =
  paths['/properties/{id}']['get']['responses'][200]['content']['application/json'];
type NearbyPropertyQuery = NonNullable<paths['/properties/nearby']['get']['parameters']['query']>;
type NearbyPropertyResponse =
  paths['/properties/nearby']['get']['responses'][200]['content']['application/json'];
type SavedPropertiesQuery =
  NonNullable<paths['/saved-properties']['get']['parameters']['query']>;
type SavedPropertiesResponse =
  paths['/saved-properties']['get']['responses'][200]['content']['application/json'];
type FollowingPropertyTilesResponse =
  paths['/tiles/following/properties.json']['get']['responses'][200]['content']['application/json'];
type FollowingNearbyPropertyResponse =
  paths['/properties/following-nearby']['get']['responses'][200]['content']['application/json'];
type ContactRequest =
  paths['/contact']['post']['requestBody']['content']['application/json'];
type ContactResponse =
  paths['/contact']['post']['responses'][200]['content']['application/json'];
type AdminReportsQuery =
  NonNullable<paths['/admin/reports/properties']['get']['parameters']['query']>;

/**
 * API client configuration options
 */
export interface ApiClientOptions {
  /** Base URL for the API (e.g. http://localhost:3100) */
  baseUrl: string;
  /** Access token for authenticated requests */
  accessToken?: string;
  /** Callback to resolve an anonymous session id for session-identified writes */
  sessionIdResolver?: () => Promise<string | null>;
  /** Callback to refresh the access token */
  onTokenRefresh?: (newToken: string) => void;
  /** Callback when authentication fails */
  onAuthError?: () => void;
}

/**
 * API Error class for handling API errors
 */
export class ApiError extends Error {
  public code: string;
  public status: number;
  public details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string = 'UNKNOWN_ERROR',
    status: number = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Type-safe API client for HuisHype.
 *
 * All paths below match the live Fastify routes (no /api/v1 prefix).
 * See services/api/openapi.json for the canonical path list.
 */
export class HuisHypeApiClient {
  private baseUrl: string;
  private accessToken?: string;
  private refreshToken?: string;
  private sessionIdResolver?: () => Promise<string | null>;
  private onTokenRefresh?: (newToken: string) => void;
  private onAuthError?: () => void;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.accessToken = options.accessToken;
    this.sessionIdResolver = options.sessionIdResolver;
    this.onTokenRefresh = options.onTokenRefresh;
    this.onAuthError = options.onAuthError;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  setRefreshToken(token: string): void {
    this.refreshToken = token;
  }

  clearTokens(): void {
    this.accessToken = undefined;
    this.refreshToken = undefined;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
      requiresAuth?: boolean;
      includeSessionId?: boolean;
    }
  ): Promise<T> {
    const { body, query, requiresAuth = false, includeSessionId = false } = options || {};

    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams();
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined) {
          params.append(key, String(value));
        }
      });
      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    } else if (requiresAuth) {
      throw new ApiError('Authentication required', 'UNAUTHORIZED', 401);
    }

    if (includeSessionId && this.sessionIdResolver) {
      const sessionId = await this.sessionIdResolver();
      if (sessionId) {
        headers['x-session-id'] = sessionId;
      }
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let errorData: { error?: string; message?: string; details?: Record<string, unknown> } = {};
      try {
        const jsonError = (await response.json()) as {
          error?: string;
          message?: string;
          details?: Record<string, unknown>;
        };
        errorData = jsonError;
      } catch {
        // Ignore JSON parse errors
      }

      if (response.status === 401) {
        this.onAuthError?.();
      }

      throw new ApiError(
        errorData.message || `Request failed with status ${response.status}`,
        errorData.error || 'REQUEST_FAILED',
        response.status,
        errorData.details
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  // ============================================
  // Auth Endpoints  (paths: /auth/google, /auth/email/request, /auth/email/verify, /auth/refresh, /auth/logout, /auth/me)
  // ============================================

  async loginGoogle(idToken: string): Promise<AuthLoginResponse> {
    const data = await this.request<AuthLoginResponse>('POST', '/auth/google', {
      body: { idToken },
    });
    if (data?.session) {
      this.setAccessToken(data.session.accessToken);
      this.setRefreshToken(data.session.refreshToken);
    }
    return data;
  }

  async requestEmailMagicLink(email: string): Promise<EmailAuthRequestResponse> {
    return this.request<EmailAuthRequestResponse>('POST', '/auth/email/request', {
      body: { email },
    });
  }

  async verifyEmailToken(token: string): Promise<AuthLoginResponse> {
    const data = await this.request<AuthLoginResponse>('POST', '/auth/email/verify', {
      body: { token },
    });
    if (data?.session) {
      this.setAccessToken(data.session.accessToken);
      this.setRefreshToken(data.session.refreshToken);
    }
    return data;
  }

  async refreshAccessToken(): Promise<AuthRefreshResponse> {
    if (!this.refreshToken) {
      throw new ApiError('No refresh token available', 'NO_REFRESH_TOKEN', 401);
    }
    const data = await this.request<AuthRefreshResponse>('POST', '/auth/refresh', {
      body: { refreshToken: this.refreshToken },
    });
    if (data?.accessToken) {
      this.setAccessToken(data.accessToken);
      this.onTokenRefresh?.(data.accessToken);
    }
    return data;
  }

  async logout(): Promise<void> {
    await this.request<void>('POST', '/auth/logout', {
      body: { refreshToken: this.refreshToken },
    });
    this.clearTokens();
  }

  async getAuthMe(): Promise<AuthMeResponse> {
    return this.request<AuthMeResponse>('GET', '/auth/me', {
      requiresAuth: true,
    });
  }

  // ============================================
  // Contact Endpoint  (path: /contact)
  // ============================================

  async submitContact(request: ContactRequest): Promise<ContactResponse> {
    return this.request<ContactResponse>('POST', '/contact', {
      body: request,
    });
  }

  // ============================================
  // User Endpoints  (paths: /users/search, /users/me, /users/me/profile, /users/:id/profile, /users/me/guesses, /users/me/followers, /users/me/following, /users/:id/follow)
  // ============================================

  async searchUsers(request: SearchUsersRequest): Promise<UserSearchGeneratedResponse> {
    const query: UserSearchQuery = {
      q: request.q,
      limit: request.limit,
      offset: request.offset,
    };

    return this.request<UserSearchGeneratedResponse>('GET', '/users/search', {
      query: {
        q: query.q,
        limit: query.limit,
        offset: query.offset,
      },
    });
  }

  async getProfile(): Promise<MyUserProfileResponse> {
    return this.request<MyUserProfileResponse>('GET', '/users/me', {
      requiresAuth: true,
    });
  }

  async updateProfile(request: UpdateUserProfileRequest): Promise<UpdateUserProfileResponse> {
    return this.request<UpdateUserProfileResponse>('PUT', '/users/me/profile', {
      body: request,
      requiresAuth: true,
    });
  }

  async getUser(userId: string): Promise<PublicUserProfileResponse> {
    return this.request<PublicUserProfileResponse>('GET', `/users/${userId}/profile`);
  }

  async getFollowers(params: FollowListQuery = {}): Promise<FollowListResponse> {
    return this.request<FollowListResponse>('GET', '/users/me/followers', {
      query: { limit: params.limit, offset: params.offset },
      requiresAuth: true,
    });
  }

  async getFollowing(params: FollowListQuery = {}): Promise<FollowListResponse> {
    return this.request<FollowListResponse>('GET', '/users/me/following', {
      query: { limit: params.limit, offset: params.offset },
      requiresAuth: true,
    });
  }

  async followUser(userId: string): Promise<FollowActionResponse> {
    return this.request<FollowActionResponse>('PUT', `/users/${userId}/follow`, {
      requiresAuth: true,
    });
  }

  async unfollowUser(userId: string): Promise<FollowActionResponse> {
    return this.request<FollowActionResponse>('DELETE', `/users/${userId}/follow`, {
      requiresAuth: true,
    });
  }

  // ============================================
  // Property Endpoints  (paths: /properties, /properties/resolve, /properties/nearby, /properties/batch, /properties/:id)
  // ============================================

  async resolveProperty(request: PropertyResolveRequest): Promise<PropertyResolveResponse> {
    const query: ResolvePropertyQuery = {
      postalCode: request.postalCode,
      houseNumber: request.houseNumber,
      ...(request.houseNumberAddition ? { houseNumberAddition: request.houseNumberAddition } : {}),
      ...(request.countryCode ? { countryCode: request.countryCode } : {}),
      ...(request.street ? { street: request.street } : {}),
      ...(request.city ? { city: request.city } : {}),
    };

    const serializedQuery: Record<string, string | number | boolean | undefined> = {
      postalCode: query.postalCode,
      houseNumber: query.houseNumber,
      houseNumberAddition: query.houseNumberAddition,
      countryCode: query.countryCode,
      street: query.street,
      city: query.city,
    };

    return this.request<PropertyResolveResponse>('GET', '/properties/resolve', {
      query: serializedQuery,
    });
  }

  async getProperty(propertyId: string): Promise<PropertyResponse> {
    return this.request<PropertyResponse>('GET', `/properties/${propertyId}`);
  }

  async reportProperty(
    propertyId: string,
    request: ReportPropertyRequest
  ): Promise<ReportPropertyResponse> {
    return this.request<ReportPropertyResponse>('POST', `/properties/${propertyId}/report`, {
      body: request,
    });
  }

  async getNearbyProperty(request: NearbyPropertyQuery): Promise<NearbyPropertyResponse> {
    const marketState =
      Array.isArray(request.marketState) ? request.marketState.join(',') : request.marketState;

    return this.request<NearbyPropertyResponse>('GET', '/properties/nearby', {
      query: {
        lon: request.lon,
        lat: request.lat,
        zoom: request.zoom,
        pyramidVersionId: request.pyramidVersionId,
        pyramidNodeId: request.pyramidNodeId,
        salePriceFrom: request.salePriceFrom ?? undefined,
        salePriceTo: request.salePriceTo ?? undefined,
        rentPriceFrom: request.rentPriceFrom ?? undefined,
        rentPriceTo: request.rentPriceTo ?? undefined,
        marketState,
        activity: request.activity,
      },
    });
  }

  async getFollowingPropertyTiles(
    request: GetFollowingPropertyTilesRequest
  ): Promise<FollowingPropertyTilesResponse> {
    const marketState =
      Array.isArray(request.marketState) ? request.marketState.join(',') : request.marketState;

    return this.request<FollowingPropertyTilesResponse>('GET', '/tiles/following/properties.json', {
      query: {
        salePriceFrom: request.salePriceFrom ?? undefined,
        salePriceTo: request.salePriceTo ?? undefined,
        rentPriceFrom: request.rentPriceFrom ?? undefined,
        rentPriceTo: request.rentPriceTo ?? undefined,
        marketState,
        activity: request.activity,
      },
      requiresAuth: true,
    });
  }

  async getFollowingNearbyProperty(
    request: GetFollowingNearbyPropertyRequest
  ): Promise<FollowingNearbyPropertyResponse> {
    const marketState =
      Array.isArray(request.marketState) ? request.marketState.join(',') : request.marketState;

    return this.request<FollowingNearbyPropertyResponse>('GET', '/properties/following-nearby', {
      query: {
        lon: request.lon,
        lat: request.lat,
        zoom: request.zoom,
        salePriceFrom: request.salePriceFrom ?? undefined,
        salePriceTo: request.salePriceTo ?? undefined,
        rentPriceFrom: request.rentPriceFrom ?? undefined,
        rentPriceTo: request.rentPriceTo ?? undefined,
        marketState,
        activity: request.activity,
      },
      requiresAuth: true,
    });
  }

  // ============================================
  // Guess Endpoints  (paths: /properties/:id/guesses)
  // ============================================

  async submitGuess(request: {
    propertyId: string;
    guessedPrice: number;
  }): Promise<SubmitGuessResponse> {
    return this.request<SubmitGuessResponse>('POST', `/properties/${request.propertyId}/guesses`, {
      body: { guessedPrice: request.guessedPrice },
      requiresAuth: true,
    });
  }

  async updateGuess(
    propertyId: string,
    _guessId: string,
    request: UpdateGuessRequest
  ): Promise<SubmitGuessResponse> {
    // The API uses POST /properties/:id/guesses for both create and update
    return this.request<SubmitGuessResponse>('POST', `/properties/${propertyId}/guesses`, {
      body: request,
      requiresAuth: true,
    });
  }

  // ============================================
  // Comment Endpoints  (paths: /properties/:id/comments, /comments/:id/like)
  // ============================================

  async getComments(request: GetCommentsRequest): Promise<GetCommentsResponse> {
    const { propertyId, sort, cursor, limit } = request;
    return this.request<GetCommentsResponse>('GET', `/properties/${propertyId}/comments`, {
      query: { sort, cursor, limit },
    });
  }

  async createComment(request: CreateCommentRequest): Promise<CreateCommentResponse> {
    const { propertyId, ...body } = request;
    return this.request<CreateCommentResponse>('POST', `/properties/${propertyId}/comments`, {
      body,
      requiresAuth: true,
    });
  }

  async toggleCommentLike(commentId: string): Promise<{ isLiked: boolean; likeCount: number }> {
    return this.request<{ isLiked: boolean; likeCount: number }>(
      'POST',
      `/comments/${commentId}/like`,
      { requiresAuth: true }
    );
  }

  async reportComment(
    commentId: string,
    request: ReportCommentRequest
  ): Promise<ReportCommentResponse> {
    return this.request<ReportCommentResponse>('POST', `/comments/${commentId}/report`, {
      body: request,
    });
  }

  // ============================================
  // Admin Report Endpoints  (paths: /admin/reports/*)
  // ============================================

  async getAdminPropertyReports(params: AdminReportsQuery = {}): Promise<GetAdminReportsResponse> {
    return this.request<GetAdminReportsResponse>('GET', '/admin/reports/properties', {
      query: {
        status: params.status,
        limit: params.limit,
        offset: params.offset,
      },
      requiresAuth: true,
    });
  }

  async getAdminCommentReports(params: AdminReportsQuery = {}): Promise<GetAdminReportsResponse> {
    return this.request<GetAdminReportsResponse>('GET', '/admin/reports/comments', {
      query: {
        status: params.status,
        limit: params.limit,
        offset: params.offset,
      },
      requiresAuth: true,
    });
  }

  async getAdminReport(reportId: string): Promise<GetAdminReportResponse> {
    return this.request<GetAdminReportResponse>('GET', `/admin/reports/${reportId}`, {
      requiresAuth: true,
    });
  }

  async patchAdminReport(
    reportId: string,
    request: PatchAdminReportRequest
  ): Promise<PatchAdminReportResponse> {
    return this.request<PatchAdminReportResponse>('PATCH', `/admin/reports/${reportId}`, {
      body: request,
      requiresAuth: true,
    });
  }

  // ============================================
  // Feed Endpoint  (path: /feed)
  // ============================================

  async getFeed(params: GetFeedRequest): Promise<GetFeedResponse> {
    return this.request<GetFeedResponse>('GET', '/feed', {
      query: {
        filter: params.filter,
        page: params.page,
        limit: params.limit,
        lat: params.lat,
        lon: params.lon,
        country: params.country,
      },
    });
  }

  // ============================================
  // Saved Properties Endpoints  (paths: /properties/:id/save, /saved-properties)
  // ============================================

  async getSavedProperties(
    request: GetSavedPropertiesRequest = {}
  ): Promise<SavedPropertiesResponse> {
    const query = {
      limit: request.limit,
      offset: request.offset,
    } satisfies SavedPropertiesQuery;

    return this.request<SavedPropertiesResponse>('GET', '/saved-properties', {
      query,
      requiresAuth: true,
    });
  }

  // ============================================
  // Activity Endpoints  (paths: /activity, /users/me/activity)
  // ============================================

  async getActivity(params: ActivityQuery = {}): Promise<ActivityResponse> {
    return this.request<ActivityResponse>('GET', '/activity', {
      query: {
        scope: params.scope,
        limit: params.limit,
        offset: params.offset,
      },
    });
  }

  async getGroupedPropertyActivity(
    params: GetGroupedPropertyActivityRequest = {},
  ): Promise<GetGroupedPropertyActivityResponse> {
    const query = {
      scope: params.scope,
      limit: params.limit,
      offset: params.offset,
    } satisfies GroupedPropertyActivityQuery;

    return this.request<GroupedPropertyActivityResponseFromOpenApi>('GET', '/activity/properties', {
      query,
      requiresAuth: params.scope === 'following',
    });
  }

  async getMyActivity(params: MyActivityQuery = {}): Promise<MyActivityResponse> {
    return this.request<MyActivityResponse>('GET', '/users/me/activity', {
      query: { limit: params.limit, offset: params.offset },
      requiresAuth: true,
    });
  }

  // ============================================
  // Notification Endpoints  (paths: /notifications, /notifications/unread-count, /notifications/read-all, /notifications/:id/read, /push-tokens)
  // ============================================

  async getNotifications(params: NotificationsQuery = {}): Promise<NotificationsResponse> {
    return this.request<NotificationsResponse>('GET', '/notifications', {
      query: { limit: params.limit, offset: params.offset },
      requiresAuth: true,
    });
  }

  async getUnreadNotificationCount(): Promise<UnreadNotificationsResponse> {
    return this.request<UnreadNotificationsResponse>('GET', '/notifications/unread-count', {
      requiresAuth: true,
    });
  }

  async markAllNotificationsRead(): Promise<MarkAllNotificationsReadResponse> {
    return this.request<MarkAllNotificationsReadResponse>('PUT', '/notifications/read-all', {
      requiresAuth: true,
    });
  }

  async markNotificationRead(notificationId: string): Promise<MarkNotificationReadResponse> {
    return this.request<MarkNotificationReadResponse>(
      'PUT',
      `/notifications/${notificationId}/read`,
      {
        requiresAuth: true,
      }
    );
  }

  async registerPushToken(request: RegisterPushTokenRequest): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('POST', '/push-tokens', {
      body: request,
      requiresAuth: true,
    });
  }

  // ============================================
  // Like / Save Endpoints  (paths: /properties/:id/like, /properties/:id/save)
  // ============================================

  async likeProperty(propertyId: string): Promise<void> {
    return this.request<void>('POST', `/properties/${propertyId}/like`, {
      requiresAuth: true,
    });
  }

  async unlikeProperty(propertyId: string): Promise<void> {
    return this.request<void>('DELETE', `/properties/${propertyId}/like`, {
      requiresAuth: true,
    });
  }

  async saveProperty(propertyId: string): Promise<void> {
    return this.request<void>('POST', `/properties/${propertyId}/save`, {
      requiresAuth: true,
    });
  }

  async unsaveProperty(propertyId: string): Promise<void> {
    return this.request<void>('DELETE', `/properties/${propertyId}/save`, {
      requiresAuth: true,
    });
  }

  // ============================================
  // View Endpoint  (path: /properties/:id/view)
  // ============================================

  async trackView(propertyId: string): Promise<TrackViewResponse> {
    return this.request<TrackViewResponse>('POST', `/properties/${propertyId}/view`, {
      body: {},
      includeSessionId: true,
    });
  }
}

/**
 * Create a new API client instance
 */
export function createApiClient(options: ApiClientOptions): HuisHypeApiClient {
  return new HuisHypeApiClient(options);
}
