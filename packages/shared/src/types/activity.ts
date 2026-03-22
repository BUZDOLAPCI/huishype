/**
 * Activity event types for HuisHype
 *
 * Public social events: likes, comments, guesses
 * Private events (save) only in personal activity
 */

export type ActivityEventType = 'property_like' | 'comment' | 'price_guess' | 'save';

export interface ActivityActor {
  id: string;
  displayName: string;
  handle: string;
  profilePhotoUrl: string | null;
}

export interface ActivityProperty {
  id: string;
  address: string;
  city: string;
  thumbnailUrl: string | null;
}

export interface ActivityItem {
  id: string;
  eventType: ActivityEventType;
  actor: ActivityActor;
  property: ActivityProperty;
  createdAt: string;
  meta: Record<string, unknown> | null;
}

export interface ActivityResponse {
  items: ActivityItem[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}
