import React from 'react';
import { render } from '@testing-library/react-native';
import { SkeletonBlock, SkeletonText } from '../Skeleton';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';

jest.mock('@/src/hooks/useReducedMotion', () => ({
  useReducedMotion: jest.fn(() => false),
}));

const mockUseReducedMotion = useReducedMotion as jest.MockedFunction<
  typeof useReducedMotion
>;

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle));
  }

  if (style && typeof style === 'object') {
    return style as Record<string, unknown>;
  }

  return {};
}

describe('Skeleton', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('renders SkeletonBlock with testID', () => {
    const { getByTestId } = render(<SkeletonBlock testID="loading-block" />);

    expect(getByTestId('loading-block')).toBeTruthy();
  });

  it('renders SkeletonText with testID', () => {
    const { getByTestId } = render(<SkeletonText testID="loading-text" />);

    expect(getByTestId('loading-text')).toBeTruthy();
  });

  it('applies width, height, and radius styles', () => {
    const { getByTestId } = render(
      <SkeletonBlock width="75%" height={24} radius={10} testID="skeleton" />
    );

    const style = flattenStyle(getByTestId('skeleton').props.style);

    expect(style.width).toBe('75%');
    expect(style.height).toBe(24);
    expect(style.borderRadius).toBe(10);
  });

  it('supports numeric widths', () => {
    const { getByTestId } = render(
      <SkeletonBlock width={128} height={20} testID="numeric-skeleton" />
    );

    const style = flattenStyle(getByTestId('numeric-skeleton').props.style);

    expect(style.width).toBe(128);
  });

  it('does not render shimmer when reduced motion is enabled', () => {
    mockUseReducedMotion.mockReturnValue(true);

    const { queryByTestId } = render(<SkeletonBlock testID="reduced-motion" />);

    expect(queryByTestId('reduced-motion-shimmer')).toBeNull();
  });

  it('does not render shimmer when animation is disabled', () => {
    const { queryByTestId } = render(
      <SkeletonBlock animated={false} testID="static-skeleton" />
    );

    expect(queryByTestId('static-skeleton-shimmer')).toBeNull();
  });
});
