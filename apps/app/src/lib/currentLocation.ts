import { Platform } from 'react-native';

export interface CurrentLocationCoordinates {
  latitude: number;
  longitude: number;
}

const WEB_LOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0,
};

export async function getCurrentLocation(): Promise<CurrentLocationCoordinates> {
  if (Platform.OS === 'web') {
    return getCurrentLocationOnWeb();
  }

  const { LocationManager } = await import('@maplibre/maplibre-react-native');
  const granted = await LocationManager.requestPermissions();

  if (!granted) {
    throw new Error('Location permission denied');
  }

  const position = await LocationManager.getCurrentPosition();

  if (!position) {
    throw new Error('Current location unavailable');
  }

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}

function getCurrentLocationOnWeb(): Promise<CurrentLocationCoordinates> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not available'));
      return;
    }

    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      reject(new Error('Location is only available on secure origins (HTTPS or localhost)'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        reject(new Error(error.message || 'Unable to get current location'));
      },
      WEB_LOCATION_OPTIONS,
    );
  });
}
