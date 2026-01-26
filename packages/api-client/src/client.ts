/**
 * HuisHype API Client
 *
 * A typed wrapper for the HuisHype API.
 * When the OpenAPI spec is available, this will use openapi-fetch for type-safe calls.
 * For now, it provides a typed fetch wrapper.
 */

import type {
  AuthLoginRequest,
  AuthLoginResponse,
  AuthRefreshRequest,
  AuthRefreshResponse,
  GetPropertyResponse,
  SearchPropertiesRequest,
  SearchPropertiesResponse,
  GetMapPropertiesRequest,
  GetMapPropertiesResponse,
  SubmitListingRequest,
  SubmitListingResponse,
  GetListingsRequest,
  GetListingsResponse,
  SubmitGuessRequest,
  SubmitGuessResponse,
  UpdateGuessRequest,
  GetCommentsRequest,
  GetCommentsResponse,
  CreateCommentRequest,
  CreateCommentResponse,
  ToggleReactionRequest,
  ToggleReactionResponse,
  GetFeedRequest,
  GetFeedResponse,
  GetSavedPropertiesRequest,
  GetSavedPropertiesResponse,
  GetUserProfileResponse,
  UpdateUserProfileRequest,
  UpdateUserProfileResponse,
} from '@huishype/shared';

/**
 * API client configuration options
 */
export interface ApiClientOptions {
  /** Base URL for the API */
  baseUrl: string;
  /** Access token for authenticated requests */
  accessToken?: string;
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
 * Type-safe API client for HuisHype
 */
export class HuisHypeApiClient {
  private baseUrl: string;
  private accessToken?: string;
  private refreshToken?: string;
  private onTokenRefresh?: (newToken: string) => void;
  private onAuthError?: () => void;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.accessToken = options.accessToken;
    this.onTokenRefresh = options.onTokenRefresh;
    this.onAuthError = options.onAuthError;
  }

  /**
   * Set the access token for authenticated requests
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  /**
   * Set the refresh token
   */
  setRefreshToken(token: string): void {
    this.refreshToken = token;
  }

  /**
   * Clear authentication tokens
   */
  clearTokens(): void {
    this.accessToken = undefined;
    this.refreshToken = undefined;
  }

  /**
   * Make an authenticated API request
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
      requiresAuth?: boolean;
    }
  ): Promise<T> {
    const { body, query, requiresAuth = false } = options || {};

    // Build URL with query params
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

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    } else if (requiresAuth) {
      throw new ApiError('Authentication required', 'UNAUTHORIZED', 401);
    }

    // Make request
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Handle response
    if (!response.ok) {
      let errorData: { code?: string; message?: string; details?: Record<string, unknown> } = {};
      try {
        const jsonError = await response.json() as { code?: string; message?: string; details?: Record<string, unknown> };
        errorData = jsonError;
      } catch {
        // Ignore JSON parse errors
      }

      if (response.status === 401) {
        this.onAuthError?.();
      }

      throw new ApiError(
        errorData.message || `Request failed with status ${response.status}`,
        errorData.code || 'REQUEST_FAILED',
        response.status,
        errorData.details
      );
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  // ============================================
  // Auth Endpoints
  // ============================================

  /**
   * Login with OAuth provider
   */
  async login(request: AuthLoginRequest): Promise<AuthLoginResponse> {
    const data = await this.request<AuthLoginResponse>('POST', '/api/v1/auth/login', {
      body: request,
    });

    // Store tokens
    if (data?.session) {
      this.setAccessToken(data.session.accessToken);
      this.setRefreshToken(data.session.refreshToken);
    }

    return data;
  }

  /**
   * Refresh the access token
   */
  async refreshAccessToken(): Promise<AuthRefreshResponse> {
    if (!this.refreshToken) {
      throw new ApiError('No refresh token available', 'NO_REFRESH_TOKEN', 401);
    }

    const data = await this.request<AuthRefreshResponse>('POST', '/api/v1/auth/refresh', {
      body: { refreshToken: this.refreshToken } as AuthRefreshRequest,
    });

    if (data?.accessToken) {
      this.setAccessToken(data.accessToken);
      this.onTokenRefresh?.(data.accessToken);
    }

    return data;
  }

  /**
   * Logout
   */
  async logout(): Promise<void> {
    await this.request<void>('POST', '/api/v1/auth/logout', {
      body: { refreshToken: this.refreshToken },
    });
    this.clearTokens();
  }

  // ============================================
  // User Endpoints
  // ============================================

  /**
   * Get current user profile
   */
  async getProfile(): Promise<GetUserProfileResponse> {
    return this.request<GetUserProfileResponse>('GET', '/api/v1/users/me', {
      requiresAuth: true,
    });
  }

  /**
   * Update user profile
   */
  async updateProfile(request: UpdateUserProfileRequest): Promise<UpdateUserProfileResponse> {
    return this.request<UpdateUserProfileResponse>('PATCH', '/api/v1/users/me', {
      body: request,
      requiresAuth: true,
    });
  }

  /**
   * Get user by ID
   */
  async getUser(userId: string): Promise<GetUserProfileResponse> {
    return this.request<GetUserProfileResponse>('GET', `/api/v1/users/${userId}`);
  }

  // ============================================
  // Property Endpoints
  // ============================================

  /**
   * Get property details
   */
  async getProperty(propertyId: string): Promise<GetPropertyResponse> {
    return this.request<GetPropertyResponse>('GET', `/api/v1/properties/${propertyId}`);
  }

  /**
   * Search properties
   */
  async searchProperties(request: SearchPropertiesRequest): Promise<SearchPropertiesResponse> {
    return this.request<SearchPropertiesResponse>('GET', '/api/v1/properties/search', {
      query: {
        query: request.query,
        city: request.city,
        postalCode: request.postalCode,
        limit: request.limit,
      },
    });
  }

  /**
   * Get properties for map display
   */
  async getMapProperties(request: GetMapPropertiesRequest): Promise<GetMapPropertiesResponse> {
    return this.request<GetMapPropertiesResponse>('POST', '/api/v1/properties/map', {
      body: request,
    });
  }

  // ============================================
  // Listing Endpoints
  // ============================================

  /**
   * Submit a new listing URL
   */
  async submitListing(request: SubmitListingRequest): Promise<SubmitListingResponse> {
    return this.request<SubmitListingResponse>('POST', '/api/v1/listings', {
      body: request,
      requiresAuth: true,
    });
  }

  /**
   * Get listings feed
   */
  async getListings(request: GetListingsRequest): Promise<GetListingsResponse> {
    return this.request<GetListingsResponse>('GET', '/api/v1/listings', {
      query: {
        page: request.page,
        pageSize: request.pageSize,
        sort: request.sort,
        city: request.city,
        minPrice: request.minPrice,
        maxPrice: request.maxPrice,
      },
    });
  }

  // ============================================
  // Guess Endpoints
  // ============================================

  /**
   * Submit a price guess
   */
  async submitGuess(request: SubmitGuessRequest): Promise<SubmitGuessResponse> {
    return this.request<SubmitGuessResponse>('POST', '/api/v1/guesses', {
      body: request,
      requiresAuth: true,
    });
  }

  /**
   * Update an existing guess
   */
  async updateGuess(guessId: string, request: UpdateGuessRequest): Promise<SubmitGuessResponse> {
    return this.request<SubmitGuessResponse>('PATCH', `/api/v1/guesses/${guessId}`, {
      body: request,
      requiresAuth: true,
    });
  }

  /**
   * Get user's guess for a property
   */
  async getMyGuess(propertyId: string): Promise<SubmitGuessResponse | null> {
    try {
      return await this.request<SubmitGuessResponse>(
        'GET',
        `/api/v1/properties/${propertyId}/my-guess`,
        { requiresAuth: true }
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NOT_FOUND') {
        return null;
      }
      throw error;
    }
  }

  // ============================================
  // Comment Endpoints
  // ============================================

  /**
   * Get comments for a property
   */
  async getComments(request: GetCommentsRequest): Promise<GetCommentsResponse> {
    const { propertyId, sort, cursor, limit } = request;
    return this.request<GetCommentsResponse>(
      'GET',
      `/api/v1/properties/${propertyId}/comments`,
      { query: { sort, cursor, limit } }
    );
  }

  /**
   * Create a comment
   */
  async createComment(request: CreateCommentRequest): Promise<CreateCommentResponse> {
    const { propertyId, ...body } = request;
    return this.request<CreateCommentResponse>(
      'POST',
      `/api/v1/properties/${propertyId}/comments`,
      { body, requiresAuth: true }
    );
  }

  /**
   * Delete a comment
   */
  async deleteComment(commentId: string): Promise<void> {
    return this.request<void>('DELETE', `/api/v1/comments/${commentId}`, {
      requiresAuth: true,
    });
  }

  /**
   * Like/unlike a comment
   */
  async toggleCommentLike(commentId: string): Promise<{ isLiked: boolean; likeCount: number }> {
    return this.request<{ isLiked: boolean; likeCount: number }>(
      'POST',
      `/api/v1/comments/${commentId}/like`,
      { requiresAuth: true }
    );
  }

  // ============================================
  // Reaction Endpoints
  // ============================================

  /**
   * Toggle a reaction on a property (like/save)
   */
  async toggleReaction(request: ToggleReactionRequest): Promise<ToggleReactionResponse> {
    const { propertyId, type } = request;
    return this.request<ToggleReactionResponse>(
      'POST',
      `/api/v1/properties/${propertyId}/reactions/${type}`,
      { requiresAuth: true }
    );
  }

  // ============================================
  // Feed Endpoints
  // ============================================

  /**
   * Get feed
   */
  async getFeed(request: GetFeedRequest): Promise<GetFeedResponse> {
    const { type, page, pageSize, city } = request;
    return this.request<GetFeedResponse>('GET', `/api/v1/feed/${type}`, {
      query: { page, pageSize, city },
    });
  }

  // ============================================
  // Saved Properties Endpoints
  // ============================================

  /**
   * Get saved properties
   */
  async getSavedProperties(request: GetSavedPropertiesRequest): Promise<GetSavedPropertiesResponse> {
    return this.request<GetSavedPropertiesResponse>('GET', '/api/v1/users/me/saved', {
      query: {
        page: request.page,
        pageSize: request.pageSize,
      },
      requiresAuth: true,
    });
  }
}

/**
 * Create a new API client instance
 */
export function createApiClient(options: ApiClientOptions): HuisHypeApiClient {
  return new HuisHypeApiClient(options);
}
