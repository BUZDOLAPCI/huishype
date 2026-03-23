import { renderHook, act } from '@testing-library/react-native';
import { useMapCityName } from '../useMapCityName';
import { apiGeocoder } from '../../services/api-geocoder';

jest.mock('../../services/api-geocoder', () => ({
  apiGeocoder: {
    reverse: jest.fn(),
  },
}));

const mockReverse = apiGeocoder.reverse as jest.Mock;

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
