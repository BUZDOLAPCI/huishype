import { renderHook, act } from '@testing-library/react-native';
import { useMapCityName, extractCityFromAddress } from '../useMapCityName';
import { apiGeocoder } from '../../services/api-geocoder';

jest.mock('../../services/api-geocoder', () => ({
  apiGeocoder: {
    reverse: jest.fn(),
  },
}));

const mockReverse = apiGeocoder.reverse as jest.Mock;

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

describe('useMapCityName', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('prefers the structured search city over reverse-geocoded output', async () => {
    mockReverse.mockResolvedValue({ city: 'Rotterdam' });

    const { result } = renderHook(() => useMapCityName());

    act(() => {
      result.current.setSearchCity('Eindhoven', [5.47, 51.44]);
      result.current.onViewportCenterChanged(5.4701, 51.4401);
      jest.advanceTimersByTime(600);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.cityName).toBe('Eindhoven');
  });

  it('ignores stale reverse-geocode responses', async () => {
    let firstResolver: ((value: { city: string | null }) => void) | null = null;
    let secondResolver: ((value: { city: string | null }) => void) | null = null;

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
      result.current.onViewportCenterChanged(5.0, 51.0);
      jest.advanceTimersByTime(600);
    });

    act(() => {
      result.current.onViewportCenterChanged(5.2, 51.2);
      jest.advanceTimersByTime(600);
    });

    await act(async () => {
      secondResolver?.({ city: 'Berlin' });
      await Promise.resolve();
    });

    expect(result.current.cityName).toBe('Berlin');

    await act(async () => {
      firstResolver?.({ city: 'Amsterdam' });
      await Promise.resolve();
    });

    expect(result.current.cityName).toBe('Berlin');
  });
});
