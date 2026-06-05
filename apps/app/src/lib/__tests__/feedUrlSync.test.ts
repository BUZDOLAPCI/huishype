import {
  appendSharedFeedFiltersToPath,
  buildFeedPath,
  getFeedSearchString,
  isFeedBrowserPathname,
  parseFeedTabFromSearchParams,
} from '../feedUrlSync';
import { createDefaultMapFilters, parseMapFiltersFromSearchParams } from '../sharedMapFilters';

describe('feedUrlSync', () => {
  it('recognizes only the canonical feed browser route as feed-owned', () => {
    expect(isFeedBrowserPathname('/feed')).toBe(true);
    expect(isFeedBrowserPathname('/feed/')).toBe(true);
    expect(isFeedBrowserPathname('/feedback')).toBe(false);
    expect(isFeedBrowserPathname('/@51.441642,5.469722,17z')).toBe(false);
  });

  it('parses valid feed tabs and falls back for invalid or unauthorized following tabs', () => {
    expect(
      parseFeedTabFromSearchParams(new URLSearchParams('feedTab=latest'), {
        isAuthenticated: false,
      })
    ).toBe('latest');
    expect(
      parseFeedTabFromSearchParams(new URLSearchParams('feedTab=following'), {
        isAuthenticated: false,
      })
    ).toBe('trending');
    expect(
      parseFeedTabFromSearchParams(new URLSearchParams('feedTab=following'), {
        isAuthenticated: true,
      })
    ).toBe('following');
    expect(
      parseFeedTabFromSearchParams(new URLSearchParams('feedTab=unknown'), {
        isAuthenticated: true,
      })
    ).toBe('trending');
  });

  it('builds feed URLs with canonical shared filters and omits the default feed tab', () => {
    const filters = parseMapFiltersFromSearchParams(
      new URLSearchParams(
        'feedTab=latest&marketState=for-sale&area=street:NL:beeldbuisring:city=eindhoven'
      )
    );

    expect(buildFeedPath(filters, 'latest')).toBe(
      '/feed?feedTab=latest&marketState=for-sale&area=street%3ANL%3Abeeldbuisring%3Acity%3Deindhoven'
    );
    expect(buildFeedPath(createDefaultMapFilters(), 'trending')).toBe('/feed');
  });

  it('preserves unrelated params through the shared filter helper and strips old feedTab', () => {
    const filters = parseMapFiltersFromSearchParams(new URLSearchParams('marketState=for-rent'));

    expect(getFeedSearchString(filters, 'recent-activity', '?feedTab=latest&debug=1')).toBe(
      '?feedTab=recent-activity&debug=1&marketState=for-rent'
    );
  });

  it('appends only shared filters to map camera paths', () => {
    const filters = parseMapFiltersFromSearchParams(
      new URLSearchParams('feedTab=latest&marketState=for-sale')
    );

    expect(appendSharedFeedFiltersToPath('/@51.441642,5.469722,17z', filters)).toBe(
      '/@51.441642,5.469722,17z?marketState=for-sale'
    );
  });
});
