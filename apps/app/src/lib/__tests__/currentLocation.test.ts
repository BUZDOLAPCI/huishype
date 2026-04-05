import { Platform } from 'react-native';
import { LocationManager } from '@maplibre/maplibre-react-native';

import { getCurrentLocation } from '../currentLocation';

describe('getCurrentLocation', () => {
  const mockedLocationManager = LocationManager as jest.Mocked<typeof LocationManager>;
  const originalGeolocation = global.navigator.geolocation;
  const originalPlatform = Platform.OS;
  const originalSecureContext = global.window?.isSecureContext;

  afterEach(() => {
    Platform.OS = originalPlatform;
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
    Platform.OS = 'web';
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
    Platform.OS = 'web';
    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: undefined,
    });

    await expect(getCurrentLocation()).rejects.toThrow('Geolocation is not available');
  });

  it('rejects on insecure web origins before requesting geolocation', async () => {
    Platform.OS = 'web';
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

  it('rejects when native location permission is denied', async () => {
    Platform.OS = 'ios';
    mockedLocationManager.requestPermissions.mockResolvedValue(false);

    await expect(getCurrentLocation()).rejects.toThrow('Location permission denied');
    expect(mockedLocationManager.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('returns native coordinates after permission is granted', async () => {
    Platform.OS = 'android';
    mockedLocationManager.requestPermissions.mockResolvedValue(true);
    mockedLocationManager.getCurrentPosition.mockResolvedValue({
      coords: {
        latitude: 52.3676,
        longitude: 4.9041,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    });

    await expect(getCurrentLocation()).resolves.toEqual({
      latitude: 52.3676,
      longitude: 4.9041,
    });
  });
});
