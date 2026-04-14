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
  return getCurrentLocationOnWeb();
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
