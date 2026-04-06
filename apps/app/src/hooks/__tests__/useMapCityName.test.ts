import { renderHook, act } from '@testing-library/react-native';
import {
  useMapCityName,
  extractCityFromAddress,
  getMapHeaderLocationLabel,
} from '../useMapCityName';
import { apiGeocoder } from '../../services/api-geocoder';

jest.mock('../../services/api-geocoder', () => ({
  apiGeocoder: {
    reverse: jest.fn(),
  },
}));

const mockReverse = apiGeocoder.reverse as jest.Mock;

const AMSTERDAM_REVERSE_RESULT = {
  locality: 'Burgwallen-Oude Zijde',
  district: 'Centrum',
  county: 'Amsterdam',
  city: 'Amsterdam',
  state: 'Noord-Holland',
  country: 'Nederland',
  countryCode: 'NL',
};

describe('extractCityFromAddress', () => {
  it('extracts city from NL-style address "Street 1, 5641 HN Eindhoven"', () => {
    expect(extractCityFromAddress('Beeldbuisring 41, 5641 HN Eindhoven')).toBe('Eindhoven');
  });

  it('extracts city from French-style address "Rue de Rivoli 1, 75001 Paris"', () => {
    expect(extractCityFromAddress('Rue de Rivoli 1, 75001 Paris')).toBe('Paris');
  });

  it('extracts city from German-style address "Marienplatz 1, 80331 München"', () => {
    expect(extractCityFromAddress('Marienplatz 1, 80331 München')).toBe('München');
  });

  it('handles Swiss city names with diacritics (Zürich)', () => {
    expect(extractCityFromAddress('Bahnhofstrasse 1, 8001 Zürich')).toBe('Zürich');
  });

  it('handles Swedish city names with diacritics (Malmö)', () => {
    expect(extractCityFromAddress('Stortorget 1, 211 22 Malmö')).toBe('Malmö');
  });

  it('handles Polish city names (Łódź)', () => {
    expect(extractCityFromAddress('Piotrkowska 1, 90-001 Łódź')).toBe('Łódź');
  });

  it('extracts city from UK-style address "Street 1, SW1A 2AS London"', () => {
    expect(extractCityFromAddress('70 Whitehall, SW1A 2AS London')).toBe('London');
  });

  it('returns city when address has simple "Name, City" format', () => {
    expect(extractCityFromAddress('Central Park, Amsterdam')).toBe('Amsterdam');
  });

  it('returns null for single-part address', () => {
    expect(extractCityFromAddress('Eindhoven')).toBeNull();
  });

  it('returns last part when no postal code prefix found', () => {
    expect(extractCityFromAddress('Some Place, Rotterdam')).toBe('Rotterdam');
  });
});

describe('getMapHeaderLocationLabel', () => {
  it('shows the country at far zoom', () => {
    expect(getMapHeaderLocationLabel(AMSTERDAM_REVERSE_RESULT, 5)).toBe('Nederland');
  });

  it('shows the region at regional zoom', () => {
    expect(getMapHeaderLocationLabel(AMSTERDAM_REVERSE_RESULT, 7)).toBe('Noord-Holland');
  });

  it('shows the city at city zoom even when more specific fields exist', () => {
    expect(getMapHeaderLocationLabel(AMSTERDAM_REVERSE_RESULT, 11)).toBe('Amsterdam');
  });

  it('shows only the district at district zoom', () => {
    expect(getMapHeaderLocationLabel(AMSTERDAM_REVERSE_RESULT, 14)).toBe('Centrum');
  });

  it('shows only the locality at close zoom', () => {
    expect(getMapHeaderLocationLabel(AMSTERDAM_REVERSE_RESULT, 17)).toBe('Burgwallen-Oude Zijde');
  });

  it('keeps a search city only for the city tier', () => {
    expect(getMapHeaderLocationLabel(AMSTERDAM_REVERSE_RESULT, 11, 'Amsterdam')).toBe('Amsterdam');
    expect(getMapHeaderLocationLabel(AMSTERDAM_REVERSE_RESULT, 5, 'Amsterdam')).toBe('Nederland');
  });
});

describe('useMapCityName', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('prefers the structured search city at city zoom over reverse-geocoded locality output', async () => {
    mockReverse.mockResolvedValue(AMSTERDAM_REVERSE_RESULT);

    const { result } = renderHook(() => useMapCityName());

    act(() => {
      result.current.setSearchCity('Eindhoven', [5.47, 51.44]);
      result.current.onViewportCenterChanged(5.4701, 51.4401, 11);
      jest.advanceTimersByTime(600);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.cityName).toBe('Eindhoven');
  });

  it('updates the header label as zoom changes without requiring a new reverse-geocode result', async () => {
    mockReverse.mockResolvedValue(AMSTERDAM_REVERSE_RESULT);

    const { result } = renderHook(() => useMapCityName());

    act(() => {
      result.current.onViewportCenterChanged(4.8952, 52.3702, 11);
      jest.advanceTimersByTime(600);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.cityName).toBe('Amsterdam');

    act(() => {
      result.current.onViewportCenterChanged(4.89521, 52.37021, 5);
    });
    expect(result.current.cityName).toBe('Nederland');

    act(() => {
      result.current.onViewportCenterChanged(4.89522, 52.37022, 17);
    });
    expect(result.current.cityName).toBe('Burgwallen-Oude Zijde');
  });

  it('ignores stale reverse-geocode responses', async () => {
    let firstResolver: ((value: typeof AMSTERDAM_REVERSE_RESULT | null) => void) | null = null;
    let secondResolver: ((value: typeof AMSTERDAM_REVERSE_RESULT | null) => void) | null = null;

    mockReverse
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            firstResolver = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            secondResolver = resolve;
          }),
      );

    const { result } = renderHook(() => useMapCityName());

    act(() => {
      result.current.onViewportCenterChanged(5.0, 51.0, 11);
      jest.advanceTimersByTime(600);
    });

    act(() => {
      result.current.onViewportCenterChanged(5.2, 51.2, 11);
      jest.advanceTimersByTime(600);
    });

    await act(async () => {
      secondResolver?.({
        ...AMSTERDAM_REVERSE_RESULT,
        locality: 'Mitte',
        district: 'Mitte',
        county: 'Berlin',
        city: 'Berlin',
        state: 'Berlin',
        country: 'Germany',
        countryCode: 'DE',
      });
      await Promise.resolve();
    });

    expect(result.current.cityName).toBe('Berlin');

    await act(async () => {
      firstResolver?.(AMSTERDAM_REVERSE_RESULT);
      await Promise.resolve();
    });

    expect(result.current.cityName).toBe('Berlin');
  });
});
