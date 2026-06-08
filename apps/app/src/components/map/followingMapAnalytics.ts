import { trackAnalyticsEvent } from '@/src/lib/analytics';

export type MapFollowingAnalyticsEventName =
  | 'map_following_filter_enabled'
  | 'map_following_filter_empty_viewed'
  | 'map_property_click_through_from_following_filter';

export interface MapFollowingAnalyticsEvent {
  name: MapFollowingAnalyticsEventName;
  properties: Record<string, unknown>;
  timestamp: string;
}

export function emitMapFollowingAnalyticsEvent(
  name: MapFollowingAnalyticsEventName,
  properties: Record<string, unknown> = {},
): void {
  trackAnalyticsEvent(name, properties);
}
