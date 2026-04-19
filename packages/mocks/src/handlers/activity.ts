/**
 * Activity API mock handlers
 *
 * Paths match the live Fastify routes.
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { getMockAuthUser } from './auth.js';
import { fixedTimestamp } from '../data/visual-fixtures.js';

type PublicActivityEventType = 'property_like' | 'comment' | 'price_guess';
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
    thumbnailUrl: string | null;
  };
  createdAt: string;
  meta: Record<string, unknown> | null;
}

const mockPublicActivity: ActivityItem<PublicActivityEventType>[] = [
  {
    id: 'a0000000-0000-4000-a000-000000000901',
    eventType: 'comment',
    actor: {
      id: 'a0000000-0000-4000-a000-000000000006',
      displayName: 'Emma van Dijk',
      handle: 'emmavandijk',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=emma',
    },
    property: {
      id: 'a0000000-0000-4000-a000-000000000001',
      address: 'Prinsengracht 263, 1016 GV Amsterdam',
      streetName: 'Prinsengracht',
      houseNumber: 263,
      houseNumberAddition: null,
      city: 'Amsterdam',
      postalCode: '1016 GV',
      countryCode: 'NL',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(0, 6),
    meta: { contentPreview: 'Wat een locatie.' },
  },
  {
    id: 'a0000000-0000-4000-a000-000000000902',
    eventType: 'price_guess',
    actor: {
      id: 'a0000000-0000-4000-a000-000000000004',
      displayName: 'Sophie Meijer',
      handle: 'sophiemeijer',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sophie',
    },
    property: {
      id: 'a0000000-0000-4000-a000-000000000004',
      address: 'Lange Voorhout 102, 2514 EJ Den Haag',
      streetName: 'Lange Voorhout',
      houseNumber: 102,
      houseNumberAddition: null,
      city: 'Den Haag',
      postalCode: '2514 EJ',
      countryCode: 'NL',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(0, 4),
    meta: { isMemeGuess: false },
  },
  {
    id: 'a0000000-0000-4000-a000-000000000903',
    eventType: 'property_like',
    actor: {
      id: 'a0000000-0000-4000-a000-000000000003',
      displayName: 'Pieter Jansen',
      handle: 'pieterjansen',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=pieter',
    },
    property: {
      id: 'a0000000-0000-4000-a000-000000000003',
      address: 'Coolsingel 40, 3011 AD Rotterdam',
      streetName: 'Coolsingel',
      houseNumber: 40,
      houseNumberAddition: null,
      city: 'Rotterdam',
      postalCode: '3011 AD',
      countryCode: 'NL',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(0, 2),
    meta: null,
  },
];

const mockFollowingActivity: ActivityItem<PublicActivityEventType>[] = [
  {
    id: 'a0000000-0000-4000-a000-000000000904',
    eventType: 'comment',
    actor: {
      id: 'a0000000-0000-4000-a000-000000000002',
      displayName: 'Maria Bakker',
      handle: 'mariabakker',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=maria',
    },
    property: {
      id: 'a0000000-0000-4000-a000-000000000002',
      address: 'Herengracht 502, 1017 CB Amsterdam',
      streetName: 'Herengracht',
      houseNumber: 502,
      houseNumberAddition: null,
      city: 'Amsterdam',
      postalCode: '1017 CB',
      countryCode: 'NL',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(0, 5),
    meta: { contentPreview: 'Dit voelt als een slimme aankoop.' },
  },
  {
    id: 'a0000000-0000-4000-a000-000000000905',
    eventType: 'price_guess',
    actor: {
      id: 'a0000000-0000-4000-a000-000000000007',
      displayName: 'Lars Hendriks',
      handle: 'larshendriks',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=lars',
    },
    property: {
      id: 'a0000000-0000-4000-a000-000000000005',
      address: 'Vestdijk 14, 5611 CC Eindhoven',
      streetName: 'Vestdijk',
      houseNumber: 14,
      houseNumberAddition: null,
      city: 'Eindhoven',
      postalCode: '5611 CC',
      countryCode: 'NL',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(0, 1),
    meta: { isMemeGuess: false },
  },
];

const mockPersonalActivity: ActivityItem[] = [
  {
    id: 'a0000000-0000-4000-a000-000000000906',
    eventType: 'save',
    actor: {
      id: 'a0000000-0000-4000-a000-000000000001',
      displayName: 'Jan de Vries',
      handle: 'jandevries',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jan',
    },
    property: {
      id: 'a0000000-0000-4000-a000-000000000004',
      address: 'Lange Voorhout 102, 2514 EJ Den Haag',
      streetName: 'Lange Voorhout',
      houseNumber: 102,
      houseNumberAddition: null,
      city: 'Den Haag',
      postalCode: '2514 EJ',
      countryCode: 'NL',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(0, 7),
    meta: null,
  },
  {
    id: 'a0000000-0000-4000-a000-000000000907',
    eventType: 'comment',
    actor: {
      id: 'a0000000-0000-4000-a000-000000000001',
      displayName: 'Jan de Vries',
      handle: 'jandevries',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jan',
    },
    property: {
      id: 'a0000000-0000-4000-a000-000000000002',
      address: 'Herengracht 502, 1017 CB Amsterdam',
      streetName: 'Herengracht',
      houseNumber: 502,
      houseNumberAddition: null,
      city: 'Amsterdam',
      postalCode: '1017 CB',
      countryCode: 'NL',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(0, 3),
    meta: { contentPreview: 'Prachtig grachtenpand.' },
  },
  {
    id: 'a0000000-0000-4000-a000-000000000908',
    eventType: 'property_like',
    actor: {
      id: 'a0000000-0000-4000-a000-000000000001',
      displayName: 'Jan de Vries',
      handle: 'jandevries',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jan',
    },
    property: {
      id: 'a0000000-0000-4000-a000-000000000003',
      address: 'Coolsingel 40, 3011 AD Rotterdam',
      streetName: 'Coolsingel',
      houseNumber: 40,
      houseNumberAddition: null,
      city: 'Rotterdam',
      postalCode: '3011 AD',
      countryCode: 'NL',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(0, 0),
    meta: null,
  },
];

function sliceActivity<TEventType extends ActivityEventType>(
  items: ActivityItem<TEventType>[],
  limit: number,
  offset: number
) {
  return {
    items: items.slice(offset, offset + limit),
    pagination: {
      limit,
      offset,
      hasMore: offset + limit < items.length,
    },
  };
}

export const activityHandlers = [
  http.get('*/users/me/activity', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    return HttpResponse.json(sliceActivity(mockPersonalActivity, limit, offset));
  }),

  http.get('*/activity', ({ request }) => {
    const url = new URL(request.url);
    const scope = url.searchParams.get('scope') ?? 'public';
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    if (scope === 'following') {
      const authUser = getMockAuthUser(request.headers.get('Authorization'));
      if (!authUser) {
        return HttpResponse.json(
          { error: 'UNAUTHORIZED', message: 'Authentication required' },
          { status: 401 }
        );
      }

      return HttpResponse.json(sliceActivity(mockFollowingActivity, limit, offset));
    }

    return HttpResponse.json(sliceActivity(mockPublicActivity, limit, offset));
  }),
];
