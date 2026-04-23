/**
 * Activity API mock handlers
 *
 * Paths match the live Fastify routes.
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import type {
  GroupedActivityPreview,
  GroupedPropertyActivityItem,
  GroupedPropertyActivityResponse,
} from '@huishype/shared';
import { getMockAuthUser } from './auth.js';
import {
  getMockProperty,
  getMockUser,
  mockComments,
  mockGuesses,
  mockPropertyIds,
  mockUserIds,
} from '../data/fixtures.js';
import { getFollowedUserIds } from './users.js';

export type PublicActivityEventType = 'property_like' | 'comment' | 'price_guess';
type ActivityEventType = PublicActivityEventType | 'save';

interface ActivityItem<TEventType extends ActivityEventType = ActivityEventType> {
  id: string;
  eventType: TEventType;
  actor: {
    id: string;
    displayName: string;
    handle: string;
    profilePhotoUrl: string | null;
  };
  property: {
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
  };
  createdAt: string;
  meta: Record<string, unknown> | null;
}

function toActivityActor(userId: string) {
  const actor = getMockUser(userId);
  if (!actor) {
    return null;
  }

  return {
    id: actor.id,
    displayName: actor.displayName,
    handle: actor.username,
    profilePhotoUrl: actor.profilePhotoUrl ?? null,
  };
}

export interface MockActivityEvent {
  id: string;
  eventType: ActivityEventType;
  actorUserId: string;
  propertyId: string;
  createdAt: string;
  meta: Record<string, unknown> | null;
}

const mockPropertyLikeEvents: MockActivityEvent[] = [
  {
    id: 'a0000000-0000-4000-a000-000000000901',
    eventType: 'property_like',
    actorUserId: mockUserIds.lars,
    propertyId: mockPropertyIds.herengracht502,
    createdAt: '2026-04-18T12:00:00.000Z',
    meta: null,
  },
  {
    id: 'a0000000-0000-4000-a000-000000000902',
    eventType: 'property_like',
    actorUserId: mockUserIds.emma,
    propertyId: mockPropertyIds.coolsingel40,
    createdAt: '2026-04-16T08:30:00.000Z',
    meta: null,
  },
];

const mockSavedActivityEvents: MockActivityEvent[] = [
  {
    id: 'a0000000-0000-4000-a000-000000000951',
    eventType: 'save',
    actorUserId: mockUserIds.jan,
    propertyId: mockPropertyIds.herengracht502,
    createdAt: '2026-04-19T09:15:00.000Z',
    meta: null,
  },
  {
    id: 'a0000000-0000-4000-a000-000000000952',
    eventType: 'save',
    actorUserId: mockUserIds.jan,
    propertyId: mockPropertyIds.prinsengracht263,
    createdAt: '2026-04-17T11:45:00.000Z',
    meta: null,
  },
];

function toActivityAddress(propertyId: string) {
  const property = getMockProperty(propertyId);
  if (!property) {
    return null;
  }

  return {
    id: property.id,
    address: `${property.address}, ${property.postalCode} ${property.city}`,
    streetName: property.streetName,
    houseNumber: Number.parseInt(property.houseNumber, 10) || 0,
    houseNumberAddition: property.houseNumberAddition ?? null,
    city: property.city,
    postalCode: property.postalCode ?? '',
    countryCode: property.countryCode,
    geometry: {
      type: 'Point' as const,
      coordinates: [property.coordinates.lon, property.coordinates.lat] as [number, number],
    },
    thumbnailUrl: property.activeListing?.thumbnailUrl ?? null,
  };
}

export function getMockActivityEvents(): MockActivityEvent[] {
  const commentEvents = mockComments.map<MockActivityEvent>((comment) => ({
    id: comment.id,
    eventType: 'comment',
    actorUserId: comment.userId,
    propertyId: comment.propertyId,
    createdAt: comment.editedAt ?? comment.createdAt,
    meta: { contentPreview: comment.content.slice(0, 100) },
  }));

  const guessEvents = mockGuesses.map<MockActivityEvent>((guess) => ({
    id: guess.id,
    eventType: 'price_guess',
    actorUserId: guess.userId,
    propertyId: guess.propertyId,
    createdAt: guess.createdAt,
    meta: { isMemeGuess: false },
  }));

  return [...mockPropertyLikeEvents, ...commentEvents, ...guessEvents, ...mockSavedActivityEvents]
    .slice()
    .sort((left, right) => {
      const byTime = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
    });
}

function getScopedActivityEvents(
  scope: 'public' | 'following' | 'self',
  viewerId: string | null,
): MockActivityEvent[] {
  const events = getMockActivityEvents();

  if (scope === 'self') {
    return events.filter((event) => event.actorUserId === viewerId);
  }

  if (scope === 'following') {
    if (!viewerId) {
      return [];
    }

    const followedUserIds = new Set(getFollowedUserIds(viewerId));
    return events.filter(
      (event) => event.eventType !== 'save' && followedUserIds.has(event.actorUserId),
    );
  }

  return events.filter((event) => event.eventType !== 'save');
}

function mapActivityEvent<TEventType extends ActivityEventType>(
  event: MockActivityEvent & { eventType: TEventType },
): ActivityItem<TEventType> | null {
  const actor = getMockUser(event.actorUserId);
  const property = toActivityAddress(event.propertyId);

  if (!actor || !property) {
    return null;
  }

  return {
    id: event.id,
    eventType: event.eventType,
    actor: {
      id: actor.id,
      displayName: actor.displayName,
      handle: actor.username,
      profilePhotoUrl: actor.profilePhotoUrl ?? null,
    },
    property,
    createdAt: new Date(event.createdAt).toISOString(),
    meta: event.meta,
  };
}

function buildActivitySummary(event: MockActivityEvent, actorName: string) {
  switch (event.eventType) {
    case 'property_like':
      return `${actorName} liked this property`;
    case 'price_guess':
      return `${actorName} made a price guess`;
    case 'comment':
    default:
      return `${actorName} commented on this property`;
  }
}

function buildGroupedPreview(
  propertyEvents: Array<MockActivityEvent & { eventType: PublicActivityEventType }>,
): GroupedActivityPreview | null {
  const commentEvent = propertyEvents.find((event) => event.eventType === 'comment');
  if (commentEvent) {
    const actor = toActivityActor(commentEvent.actorUserId);
    if (!actor) {
      return null;
    }

    return {
      kind: 'comment',
      commentId: commentEvent.id,
      createdAt: new Date(commentEvent.createdAt).toISOString(),
      actor,
      contentPreview: String(commentEvent.meta?.contentPreview ?? ''),
    };
  }

  const latestEvent = propertyEvents[0];
  if (!latestEvent) {
    return null;
  }

  const actor = toActivityActor(latestEvent.actorUserId);
  if (!actor) {
    return null;
  }

  return {
    kind: 'summary',
    eventType: latestEvent.eventType,
    createdAt: new Date(latestEvent.createdAt).toISOString(),
    actor,
    summary: buildActivitySummary(latestEvent, actor.displayName),
  };
}

function getGroupedActivityItems(
  scope: 'public' | 'following',
  viewerId: string | null,
): GroupedPropertyActivityItem[] {
  const events = getScopedActivityEvents(scope, viewerId).filter(
    (event): event is MockActivityEvent & { eventType: PublicActivityEventType } =>
      event.eventType !== 'save',
  );
  const eventsByProperty = new Map<string, Array<MockActivityEvent & { eventType: PublicActivityEventType }>>();

  for (const event of events) {
    const propertyEvents = eventsByProperty.get(event.propertyId);
    if (propertyEvents) {
      propertyEvents.push(event);
      continue;
    }

    eventsByProperty.set(event.propertyId, [event]);
  }

  const items: GroupedPropertyActivityItem[] = [];

  for (const [propertyId, propertyEvents] of eventsByProperty.entries()) {
    propertyEvents.sort((left, right) => {
      const byTime = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
    });

    const property = toActivityAddress(propertyId);
    const preview = buildGroupedPreview(propertyEvents);
    if (!property || !preview) {
      continue;
    }

    const recentActors: NonNullable<GroupedPropertyActivityItem['recentActors']> = [];
    const seenActorIds = new Set<string>();

    for (const event of propertyEvents) {
      if (seenActorIds.has(event.actorUserId)) {
        continue;
      }

      const actor = toActivityActor(event.actorUserId);
      if (!actor) {
        continue;
      }

      seenActorIds.add(event.actorUserId);
      recentActors.push(actor);

      if (recentActors.length === 3) {
        break;
      }
    }

    items.push({
      property,
      lastActivityAt: new Date(propertyEvents[0].createdAt).toISOString(),
      counts: {
        likeCount: propertyEvents.filter((event) => event.eventType === 'property_like').length,
        commentCount: propertyEvents.filter((event) => event.eventType === 'comment').length,
        guessCount: propertyEvents.filter((event) => event.eventType === 'price_guess').length,
      },
      recentActors,
      preview,
    });
  }

  return items.sort((left, right) => {
    const byTime = Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt);
    return byTime !== 0 ? byTime : right.property.id.localeCompare(left.property.id);
  });
}

function sliceActivity<TEventType extends ActivityEventType>(
  events: Array<MockActivityEvent & { eventType: TEventType }>,
  limit: number,
  offset: number,
) {
  const pagedEvents = events.slice(offset, offset + limit + 1);
  const hasMore = pagedEvents.length > limit;
  const pageItems = (hasMore ? pagedEvents.slice(0, limit) : pagedEvents)
    .map((event) => mapActivityEvent(event))
    .filter((item): item is ActivityItem<TEventType> => item !== null);

  return {
    items: pageItems,
    pagination: {
      limit,
      offset,
      hasMore,
    },
  };
}

export const activityHandlers = [
  http.get('*/users/me/activity', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 },
      );
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const items = getScopedActivityEvents('self', authUser.id).filter(
      (event): event is MockActivityEvent & { eventType: ActivityEventType } => event.actorUserId === authUser.id,
    );

    return HttpResponse.json(sliceActivity(items, limit, offset));
  }),

  http.get('*/activity', ({ request }) => {
    const url = new URL(request.url);
    const scope = (url.searchParams.get('scope') ?? 'public') as 'public' | 'following';
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    if (scope === 'following') {
      const authUser = getMockAuthUser(request.headers.get('Authorization'));
      if (!authUser) {
        return HttpResponse.json(
          { error: 'UNAUTHORIZED', message: 'Authentication required' },
          { status: 401 },
        );
      }

      const items = getScopedActivityEvents('following', authUser.id).filter(
        (event): event is MockActivityEvent & { eventType: PublicActivityEventType } =>
          event.eventType !== 'save',
      );

      return HttpResponse.json(sliceActivity(items, limit, offset));
    }

    const items = getScopedActivityEvents('public', null).filter(
      (event): event is MockActivityEvent & { eventType: PublicActivityEventType } =>
        event.eventType !== 'save',
    );

    return HttpResponse.json(sliceActivity(items, limit, offset));
  }),

  http.get('*/activity/properties', ({ request }) => {
    const url = new URL(request.url);
    const scope = (url.searchParams.get('scope') ?? 'public') as 'public' | 'following';
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    if (scope === 'following') {
      const authUser = getMockAuthUser(request.headers.get('Authorization'));
      if (!authUser) {
        return HttpResponse.json(
          { error: 'UNAUTHORIZED', message: 'Authentication required' },
          { status: 401 },
        );
      }

      const items = getGroupedActivityItems('following', authUser.id);
      const pagedItems = items.slice(offset, offset + limit + 1);
      const hasMore = pagedItems.length > limit;

      return HttpResponse.json<GroupedPropertyActivityResponse>({
        items: hasMore ? pagedItems.slice(0, limit) : pagedItems,
        pagination: {
          limit,
          offset,
          hasMore,
        },
      });
    }

    const items = getGroupedActivityItems('public', null);
    const pagedItems = items.slice(offset, offset + limit + 1);
    const hasMore = pagedItems.length > limit;

    return HttpResponse.json<GroupedPropertyActivityResponse>({
      items: hasMore ? pagedItems.slice(0, limit) : pagedItems,
      pagination: {
        limit,
        offset,
        hasMore,
      },
    });
  }),
];
