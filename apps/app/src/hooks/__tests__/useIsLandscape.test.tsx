import { renderHook, act } from '@testing-library/react-native';
import { useIsLandscape } from '../useIsLandscape';

function setWindowSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: height,
  });
  window.dispatchEvent(new Event('resize'));
}

describe('useIsLandscape', () => {
  it('reflects the current window dimensions immediately and after resize', () => {
    setWindowSize(390, 844);

    const { result } = renderHook(() => useIsLandscape());
    expect(result.current).toBe(false);

    act(() => {
      setWindowSize(1280, 720);
    });

    expect(result.current).toBe(true);
  });
});
