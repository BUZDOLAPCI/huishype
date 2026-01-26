import { feedKeys } from '../useFeed';

describe('feedKeys', () => {
  it('generates correct base keys', () => {
    expect(feedKeys.all).toEqual(['feed']);
    expect(feedKeys.lists()).toEqual(['feed', 'list']);
  });

  it('generates correct list keys with filter', () => {
    expect(feedKeys.list('all')).toEqual(['feed', 'list', { filter: 'all', city: undefined }]);
    expect(feedKeys.list('trending', 'Amsterdam')).toEqual([
      'feed',
      'list',
      { filter: 'trending', city: 'Amsterdam' },
    ]);
  });

  it('generates correct infinite keys', () => {
    expect(feedKeys.infinite('new')).toEqual([
      'feed',
      'infinite',
      { filter: 'new', city: undefined },
    ]);
    expect(feedKeys.infinite('price_mismatch', 'Rotterdam')).toEqual([
      'feed',
      'infinite',
      { filter: 'price_mismatch', city: 'Rotterdam' },
    ]);
  });
});

// Note: Hook testing with actual API calls requires more setup
// For integration tests, we would mock the fetch calls or use MSW
describe('useFeed hook', () => {
  it('should be importable', () => {
    const { useFeed, useInfiniteFeed } = require('../useFeed');
    expect(useFeed).toBeDefined();
    expect(useInfiniteFeed).toBeDefined();
  });
});
