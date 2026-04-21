import { parseFollowingMapFiltersQuery } from './map-filters.js';

describe('parseFollowingMapFiltersQuery', () => {
  it('defaults Following activity to all-time instead of the public all filter', () => {
    expect(parseFollowingMapFiltersQuery({}).activity).toBe('all-time');
  });

  it('treats legacy activity=all as all-time for Following safety', () => {
    expect(parseFollowingMapFiltersQuery({ activity: 'all' }).activity).toBe('all-time');
  });

  it('preserves explicit Following time-window filters', () => {
    expect(parseFollowingMapFiltersQuery({ activity: '10d' }).activity).toBe('10d');
  });
});
