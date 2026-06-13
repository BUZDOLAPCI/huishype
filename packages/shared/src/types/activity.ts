import type { OfficialValuationSourceFetch } from './api.js';
import type { MapMarketState } from './property.js';

/**
 * Activity event types for HuisHype
 *
 * Public social events: likes, comments, guesses
 * Private events (save) only in personal activity
 */

export type PublicActivityEventType = 'property_like' | 'comment' | 'price_guess' | 'just_listed';
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

export interface GroupedActivityProperty extends ActivityProperty {
  askingPrice: number | null;
  officialValuation: number | null;
  officialValuationYear: number | null;
  officialValuationSourceFetch: OfficialValuationSourceFetch | null;
  marketState: MapMarketState;
  hasListing: boolean;
  yearBuilt: number | null;
  floorAreaM2: number | null;
  isLiked: boolean;
  isSaved: boolean;
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

export interface GroupedActivityCounts {
  likeCount: number;
  commentCount: number;
  guessCount: number;
}

export interface GroupedActivityCommentPreview {
  kind: 'comment';
  commentId: string;
  createdAt: string;
  actor: ActivityActor;
  contentPreview: string;
  likeCount: number;
  isLiked: boolean;
}

export interface GroupedActivitySummaryPreview {
  kind: 'summary';
  eventType: PublicActivityEventType;
  createdAt: string;
  actor: ActivityActor;
  summary: string;
}

export type GroupedActivityPreview =
  | GroupedActivityCommentPreview
  | GroupedActivitySummaryPreview;

export interface GroupedPropertyActivityItem {
  property: GroupedActivityProperty;
  lastActivityAt: string;
  counts: GroupedActivityCounts;
  recentActors: ActivityActor[];
  preview: GroupedActivityPreview;
}

export interface GroupedPropertyActivityResponse {
  items: GroupedPropertyActivityItem[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}
