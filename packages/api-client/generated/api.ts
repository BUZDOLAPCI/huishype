/**
 * HuisHype API Types
 *
 * This file contains placeholder types that will be replaced
 * by openapi-typescript generated types once the OpenAPI spec exists.
 *
 * Run `pnpm generate` after creating services/api/openapi.json
 */

// Placeholder paths interface - will be replaced by generated types
export interface paths {
  '/auth/login': {
    POST: {
      requestBody: {
        content: {
          'application/json': {
            provider: 'google' | 'apple';
            idToken: string;
          };
        };
      };
      responses: {
        200: {
          content: {
            'application/json': {
              session: {
                user: unknown;
                accessToken: string;
                refreshToken: string;
                expiresAt: string;
              };
              isNewUser: boolean;
            };
          };
        };
      };
    };
  };
  '/auth/refresh': {
    POST: {
      requestBody: {
        content: {
          'application/json': {
            refreshToken: string;
          };
        };
      };
      responses: {
        200: {
          content: {
            'application/json': {
              accessToken: string;
              expiresAt: string;
            };
          };
        };
      };
    };
  };
  '/auth/logout': {
    POST: {
      requestBody?: {
        content: {
          'application/json': {
            refreshToken?: string;
          };
        };
      };
      responses: {
        204: never;
      };
    };
  };
  '/users/me': {
    GET: {
      responses: {
        200: {
          content: {
            'application/json': unknown;
          };
        };
      };
    };
    PATCH: {
      requestBody: {
        content: {
          'application/json': {
            displayName?: string;
          };
        };
      };
      responses: {
        200: {
          content: {
            'application/json': unknown;
          };
        };
      };
    };
  };
  '/users/{userId}': {
    GET: {
      parameters: {
        path: {
          userId: string;
        };
      };
      responses: {
        200: {
          content: {
            'application/json': unknown;
          };
        };
      };
    };
  };
  '/users/me/saved': {
    GET: {
      parameters: {
        query: {
          page?: number;
          pageSize?: number;
        };
      };
      responses: {
        200: {
          content: {
            'application/json': unknown;
          };
        };
      };
    };
  };
  '/properties/{propertyId}': {
    GET: {
      parameters: {
        path: {
          propertyId: string;
        };
      };
      responses: {
        200: {
          content: {
            'application/json': unknown;
          };
        };
      };
    };
  };
  '/properties/search': {
    GET: {
      parameters: {
        query: {
          query: string;
          city?: string;
          postalCode?: string;
          limit?: number;
        };
      };
      responses: {
        200: {
          content: {
            'application/json': unknown;
          };
        };
      };
    };
  };
  '/properties/map': {
    POST: {
      requestBody: {
        content: {
          'application/json': unknown;
        };
      };
      responses: {
        200: {
          content: {
            'application/json': unknown;
          };
        };
      };
    };
  };
  '/properties/{propertyId}/my-guess': {
    GET: {
      parameters: {
        path: {
          propertyId: string;
        };
      };
      responses: {
        200: {
          content: {
            'application/json': unknown;
          };
        };
        404: {
          content: {
            'application/json': {
              code: string;
              message: string;
            };
          };
        };
      };
    };
  };
  '/properties/{propertyId}/comments': {
    GET: {
      parameters: {
        path: {
          propertyId: string;
        };
        query?: {
          sort?: string;
          cursor?: string;
          limit?: number;
        };
      };
      responses: {
        200: {
          content: {
            'application/json': unknown;
          };
        };
      };
    };
    POST: {
      parameters: {
        path: {
          propertyId: string;
        };
      };
      requestBody: {
        content: {
          'application/json': {
            content: string;
            parentId?: string;
          };
        };
      };
      responses: {
        201: {
          content: {
            'application/json': unknown;
          };
        };
      };
    };
  };
  '/properties/{propertyId}/reactions/{type}': {
    POST: {
      parameters: {
        path: {
          propertyId: string;
          type: 'like' | 'save';
        };
      };
      responses: {
        200: {
          content: {
            'application/json': unknown;
          };
        };
      };
    };
  };
  '/listings': {
    GET: {
      parameters: {
        query?: {
          page?: number;
          pageSize?: number;
          sort?: string;
          city?: string;
          minPrice?: number;
          maxPrice?: number;
        };
      };
      responses: {
        200: {
          content: {
            'application/json': unknown;
          };
        };
      };
    };
    POST: {
      requestBody: {
        content: {
          'application/json': {
            url: string;
          };
        };
      };
      responses: {
        201: {
          content: {
            'application/json': unknown;
          };
        };
      };
    };
  };
  '/guesses': {
    POST: {
      requestBody: {
        content: {
          'application/json': {
            propertyId: string;
            guessedPrice: number;
          };
        };
      };
      responses: {
        201: {
          content: {
            'application/json': unknown;
          };
        };
      };
    };
  };
  '/guesses/{guessId}': {
    PATCH: {
      parameters: {
        path: {
          guessId: string;
        };
      };
      requestBody: {
        content: {
          'application/json': {
            guessedPrice: number;
          };
        };
      };
      responses: {
        200: {
          content: {
            'application/json': unknown;
          };
        };
      };
    };
  };
  '/comments/{commentId}': {
    DELETE: {
      parameters: {
        path: {
          commentId: string;
        };
      };
      responses: {
        204: never;
      };
    };
  };
  '/comments/{commentId}/like': {
    POST: {
      parameters: {
        path: {
          commentId: string;
        };
      };
      responses: {
        200: {
          content: {
            'application/json': {
              isLiked: boolean;
              likeCount: number;
            };
          };
        };
      };
    };
  };
  '/feed/{type}': {
    GET: {
      parameters: {
        path: {
          type: 'trending' | 'new' | 'controversial' | 'overpriced' | 'underpriced';
        };
        query?: {
          page?: number;
          pageSize?: number;
          city?: string;
        };
      };
      responses: {
        200: {
          content: {
            'application/json': unknown;
          };
        };
      };
    };
  };
}

// Export components interface for compatibility
export interface components {
  schemas: Record<string, unknown>;
}
