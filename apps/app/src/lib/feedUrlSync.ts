import type { FeedTab } from '@huishype/shared';

import {
  appendSearchToPath,
  getMapFilterSearchString,
  type MapFilters,
} from '@/src/lib/sharedMapFilters';

export const DEFAULT_FEED_TAB: FeedTab = 'trending';
export const FEED_TAB_QUERY_PARAM = 'feedTab';

const FEED_TABS = ['trending', 'latest', 'recent-activity', 'following'] as const;
const FEED_TAB_SET = new Set<string>(FEED_TABS);

export function parseFeedTabFromSearchParams(
  params: URLSearchParams,
  options: { isAuthenticated: boolean }
): FeedTab {
  const candidate = params.get(FEED_TAB_QUERY_PARAM);
  if (!candidate || !FEED_TAB_SET.has(candidate)) {
    return DEFAULT_FEED_TAB;
  }

  if (candidate === 'following' && !options.isAuthenticated) {
    return DEFAULT_FEED_TAB;
  }

  return candidate as FeedTab;
}

function normalizeSearchInput(search: string): string {
  return search.startsWith('?') ? search.slice(1) : search;
}

export function getFeedSearchString(
  filters: MapFilters,
  feedTab: FeedTab,
  currentSearch = ''
): string {
  const currentParams = new URLSearchParams(normalizeSearchInput(currentSearch));
  currentParams.delete(FEED_TAB_QUERY_PARAM);

  const sharedSearch = getMapFilterSearchString(filters, currentParams.toString());
  const sharedParams = new URLSearchParams(normalizeSearchInput(sharedSearch));
  const nextParams = new URLSearchParams();

  if (feedTab !== DEFAULT_FEED_TAB) {
    nextParams.set(FEED_TAB_QUERY_PARAM, feedTab);
  }

  for (const [key, value] of sharedParams.entries()) {
    nextParams.append(key, value);
  }

  const query = nextParams.toString();
  return query ? `?${query}` : '';
}

export function buildFeedPath(filters: MapFilters, feedTab: FeedTab, currentSearch = ''): string {
  return `/feed${getFeedSearchString(filters, feedTab, currentSearch)}`;
}

export function appendSharedFeedFiltersToPath(pathname: string, filters: MapFilters): string {
  return appendSearchToPath(pathname, getMapFilterSearchString(filters));
}
