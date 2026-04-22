/**
 * Activity event types for HuisHype
 *
 * Public social events: likes, comments, guesses
 * Private events (save) only in personal activity
 */

export type PublicActivityEventType = 'property_like' | 'comment' | 'price_guess';
export type ActivityEventType = PublicActivityEventType | 'save';

export interface ActivityActor {
  id: string;
  displayName: string;
  handle: string;
  profilePhotoUrl: string | null;
}

export interface ActivityProperty {
  id: string;
  address: string;
  streetName: string;
  houseNumber: number;
  houseNumberAddition: string | null;
  city: string;
  postalCode: string;
  countryCode: string;
  geometry: { type: 'Point'; coordinates: [number, number] } | null;
  thumbnailUrl: string | null;
}

export interface ActivityItem<TEventType extends ActivityEventType = ActivityEventType> {
  id: string;
  eventType: TEventType;
  actor: ActivityActor;
  property: ActivityProperty;
  createdAt: string;
  meta: Record<string, unknown> | null;
}

export interface ActivityResponse<TEventType extends ActivityEventType = ActivityEventType> {
  items: ActivityItem<TEventType>[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export type PublicActivityResponse = ActivityResponse<PublicActivityEventType>;
