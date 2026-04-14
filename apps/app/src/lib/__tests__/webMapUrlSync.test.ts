import {
  getCurrentBrowserPathWithSearch,
  getCurrentBrowserPathname,
  replacePassiveBrowserPath,
} from '../webMapUrlSync';

describe('webMapUrlSync', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('reads the current browser pathname and search string', () => {
    window.history.replaceState(
      {},
      '',
      '/map/eindhoven/5600aa/routelaan/12?returnTo=%2Ffeed',
    );

    expect(getCurrentBrowserPathname('/fallback')).toBe(
      '/map/eindhoven/5600aa/routelaan/12',
    );
    expect(getCurrentBrowserPathWithSearch('/fallback')).toBe(
      '/map/eindhoven/5600aa/routelaan/12?returnTo=%2Ffeed',
    );
  });

  it('replaces the passive browser path only when it actually changes', () => {
    const replaceState = jest.fn();
    const originalReplaceState = window.history.replaceState;
    window.history.replaceState({}, '', '/@51.4416,5.4697,14z');
    window.history.replaceState = replaceState;

    expect(replacePassiveBrowserPath('/@51.4416,5.4697,14z')).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();

    expect(replacePassiveBrowserPath('/map/eindhoven/5600aa/routelaan/12')).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(
      {},
      '',
      '/map/eindhoven/5600aa/routelaan/12',
    );

    window.history.replaceState = originalReplaceState;
  });

  it('collapses an invalid browser path back to root through history state', () => {
    const replaceState = jest.fn();
    const originalReplaceState = window.history.replaceState;
    window.history.replaceState({}, '', '/not-a-valid-route');
    window.history.replaceState = replaceState;

    expect(replacePassiveBrowserPath('/')).toBe(true);
    expect(replaceState).toHaveBeenCalledWith({}, '', '/');

    window.history.replaceState = originalReplaceState;
  });
});
