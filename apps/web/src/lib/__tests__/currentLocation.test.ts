import { getCurrentLocation } from '../currentLocation';

describe('getCurrentLocation', () => {
  const originalGeolocation = global.navigator.geolocation;
  const originalSecureContext = global.window?.isSecureContext;

  afterEach(() => {
    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: originalGeolocation,
    });
    if (global.window) {
      Object.defineProperty(global.window, 'isSecureContext', {
        configurable: true,
      value: originalSecureContext,
      });
    }
    jest.clearAllMocks();
  });

  it('returns browser coordinates on web', async () => {
    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: {
        clearWatch: jest.fn(),
        watchPosition: jest.fn(),
        getCurrentPosition: jest.fn((success: PositionCallback) => {
          success({
            coords: {
              latitude: 51.4416,
              longitude: 5.4697,
            },
          } as GeolocationPosition);
        }),
      } as unknown as Geolocation,
    });

    await expect(getCurrentLocation()).resolves.toEqual({
      latitude: 51.4416,
      longitude: 5.4697,
    });
  });

  it('rejects when browser geolocation is unavailable', async () => {
    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: undefined,
    });

    await expect(getCurrentLocation()).rejects.toThrow('Geolocation is not available');
  });

  it('rejects on insecure web origins before requesting geolocation', async () => {
    const getCurrentPosition = jest.fn();
    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: {
        clearWatch: jest.fn(),
        watchPosition: jest.fn(),
        getCurrentPosition,
      } as unknown as Geolocation,
    });
    Object.defineProperty(global.window, 'isSecureContext', {
      configurable: true,
      value: false,
    });

    await expect(getCurrentLocation()).rejects.toThrow(
      'Location is only available on secure origins (HTTPS or localhost)'
    );
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
});
