import { extractAppPathFromUrl } from '../deepLink';

describe('extractAppPathFromUrl', () => {
  it('extracts direct canonical app URLs', () => {
    expect(extractAppPathFromUrl('huishype:///eindhoven/5651ha/beeldbuisring/2')).toBe(
      '/eindhoven/5651ha/beeldbuisring/2',
    );
  });

  it('extracts app routes from Expo dev-client wrapper URLs', () => {
    expect(
      extractAppPathFromUrl(
        'exp+huishype://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081%2F--%2Feindhoven%2F5651ha%2Fbeeldbuisring%2F2',
      ),
    ).toBe('/eindhoven/5651ha/beeldbuisring/2');
  });

  it('preserves query strings on nested app URLs', () => {
    expect(
      extractAppPathFromUrl(
        'exp+huishype://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081%2F--%2Fauth%2Fcallback%3FemailToken%3Dabc123',
      ),
    ).toBe('/auth/callback?emailToken=abc123');
  });

  it('returns null for invalid URLs', () => {
    expect(extractAppPathFromUrl(null)).toBeNull();
    expect(extractAppPathFromUrl('not a url')).toBeNull();
  });
});
