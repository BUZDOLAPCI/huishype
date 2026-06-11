import {
  buildUserProfileRoute,
  normalizeUserProfileHandle,
  parseUserProfileRouteParam,
} from '../user-route';

describe('user-route', () => {
  it('builds canonical public profile routes from handles', () => {
    expect(buildUserProfileRoute('@Target_User')).toBe('/user/@target_user');
  });

  it('parses only @handle public profile route params', () => {
    expect(parseUserProfileRouteParam('@Target_User')).toBe('target_user');
    expect(parseUserProfileRouteParam('target_user')).toBeNull();
    expect(parseUserProfileRouteParam('a0000000-0000-4000-a000-000000000099')).toBeNull();
  });

  it('normalizes valid handles and rejects invalid values', () => {
    expect(normalizeUserProfileHandle('  @Target_User  ')).toBe('target_user');
    expect(normalizeUserProfileHandle('@ab')).toBeNull();
  });
});
