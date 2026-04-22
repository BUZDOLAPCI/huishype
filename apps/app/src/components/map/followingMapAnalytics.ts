export type MapFollowingAnalyticsEventName =
  | 'map_following_filter_enabled'
  | 'map_following_filter_empty_viewed'
  | 'map_property_click_through_from_following_filter';

export interface MapFollowingAnalyticsEvent {
  name: MapFollowingAnalyticsEventName;
  properties: Record<string, unknown>;
  timestamp: string;
}

interface AnalyticsGlobal {
  __HUISHYPE_ANALYTICS_EVENTS__?: MapFollowingAnalyticsEvent[];
  __HUISHYPE_ANALYTICS_LISTENER__?: (event: MapFollowingAnalyticsEvent) => void;
}

export function emitMapFollowingAnalyticsEvent(
  name: MapFollowingAnalyticsEventName,
  properties: Record<string, unknown> = {},
): void {
  const event: MapFollowingAnalyticsEvent = {
    name,
    properties,
    timestamp: new Date().toISOString(),
  };
  const analyticsGlobal = globalThis as typeof globalThis &
    AnalyticsGlobal & {
      dispatchEvent?: (event: Event) => boolean;
      CustomEvent?: typeof CustomEvent;
    };

  analyticsGlobal.__HUISHYPE_ANALYTICS_LISTENER__?.(event);
  analyticsGlobal.__HUISHYPE_ANALYTICS_EVENTS__?.push(event);

  if (
    typeof analyticsGlobal.dispatchEvent === 'function' &&
    typeof analyticsGlobal.CustomEvent === 'function'
  ) {
    analyticsGlobal.dispatchEvent(
      new analyticsGlobal.CustomEvent('huishype:analytics', {
        detail: event,
      }),
    );
  }
}
