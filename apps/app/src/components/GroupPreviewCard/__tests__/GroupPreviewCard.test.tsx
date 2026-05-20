import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Animated, Image, Platform, StyleSheet } from 'react-native';
import { GroupPreviewCard, shouldClaimPreviewSwipe } from '../GroupPreviewCard';
import type { GroupPreviewProperty } from '../types';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    useWindowDimensions: jest.fn(() => ({
      width: 1280,
      height: 720,
      scale: 1,
      fontScale: 1,
    })),
  };
});

const makeProperty = (overrides: Partial<GroupPreviewProperty> = {}): GroupPreviewProperty => ({
  id: 'prop-1',
  address: 'Teststraat 42',
  city: 'Eindhoven',
  postalCode: '5600 AA',
  officialValuation: 350000,
  activityLevel: 'warm',
  ...overrides,
});

const makeProperties = (count: number): GroupPreviewProperty[] =>
  Array.from({ length: count }, (_, i) =>
    makeProperty({
      id: `prop-${i + 1}`,
      address: `Straat ${i + 1}`,
      officialValuation: 300000 + i * 10000,
    })
  );

const originalPlatformOS = Platform.OS;
let prefetchSpy: jest.SpiedFunction<typeof Image.prefetch>;

function setPlatformOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
}

function getRenderedCarouselAddresses(): string[] {
  return screen
    .getAllByTestId('property-preview-address')
    .map((address) => address.props.children);
}

function fireWebTouchStart(pageX: number, pageY = 120) {
  fireEvent(screen.getByTestId('group-preview-swipe-surface'), 'touchStart', {
    nativeEvent: {
      touches: [{ pageX, pageY }],
      changedTouches: [],
    },
  });
}

function fireWebTouchMove(pageX: number, pageY = 124) {
  fireEvent(screen.getByTestId('group-preview-swipe-surface'), 'touchMove', {
    nativeEvent: {
      touches: [{ pageX, pageY }],
      changedTouches: [],
    },
    stopPropagation: jest.fn(),
  });
}

function fireWebTouchEnd(pageX: number, pageY = 124) {
  fireEvent(screen.getByTestId('group-preview-swipe-surface'), 'touchEnd', {
    nativeEvent: {
      touches: [],
      changedTouches: [{ pageX, pageY }],
    },
    stopPropagation: jest.fn(),
  });
}

type CarouselTransformStyle = {
  transform?: Array<{ translateX?: unknown }>;
};

function getAnimatedTranslateXValue(): number {
  const styles = screen.getByTestId('group-preview-swipe-surface').props.style as Array<
    CarouselTransformStyle | null | false
  >;
  const translateXValue = styles
    .filter((style): style is CarouselTransformStyle => Boolean(style))
    .flatMap((style) => style?.transform ?? [])
    .map((transform) => transform.translateX)
    .find((value): value is { _value: number } => (
      typeof value === 'object' &&
      value !== null &&
      '_value' in value &&
      typeof value._value === 'number'
    ));

  if (!translateXValue) {
    throw new Error('Expected carousel swipe surface to include an Animated translateX value');
  }

  return translateXValue._value;
}

function getCarouselNumericTranslateXValues(): number[] {
  const styles = screen.getByTestId('group-preview-swipe-surface').props.style as Array<
    CarouselTransformStyle | null | false
  >;

  return styles
    .filter((style): style is CarouselTransformStyle => Boolean(style))
    .flatMap((style) => style?.transform ?? [])
    .map((transform) => transform.translateX)
    .filter((value): value is number => typeof value === 'number');
}

function flattenNodeStyle(testID: string) {
  return flattenStyle(screen.getByTestId(testID).props.style);
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, entry) => ({ ...acc, ...flattenStyle(entry) }),
      {}
    );
  }

  return (StyleSheet.flatten(style as never) as Record<string, unknown> | undefined) ?? {};
}

describe('GroupPreviewCard', () => {
  beforeEach(() => {
    if (!Image.prefetch) {
      Object.defineProperty(Image, 'prefetch', {
        configurable: true,
        value: jest.fn(),
      });
    }
    prefetchSpy = jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
    prefetchSpy.mockClear();
  });

  afterEach(() => {
    setPlatformOS(originalPlatformOS);
    jest.restoreAllMocks();
  });

  describe('shouldClaimPreviewSwipe', () => {
    it('does not claim low-drift thumb jitter', () => {
      expect(shouldClaimPreviewSwipe({ dx: 11, dy: 3, vx: 0.12 })).toBe(false);
      expect(shouldClaimPreviewSwipe({ dx: 15, dy: 13, vx: 0.2 })).toBe(false);
    });

    it('claims clearly horizontal drags', () => {
      expect(shouldClaimPreviewSwipe({ dx: 22, dy: 6, vx: 0.18 })).toBe(true);
      expect(shouldClaimPreviewSwipe({ dx: -24, dy: 9, vx: -0.2 })).toBe(true);
    });

    it('keeps short deliberate flicks eligible for cluster swipe navigation', () => {
      expect(shouldClaimPreviewSwipe({ dx: 13, dy: 2, vx: 0.42 })).toBe(true);
      expect(shouldClaimPreviewSwipe({ dx: -14, dy: 4, vx: -0.5 })).toBe(true);
    });
  });

  // ---- Single property mode ----

  describe('single property', () => {
    it('renders address and city', () => {
      render(
        <GroupPreviewCard
          properties={[makeProperty()]}
          onClose={jest.fn()}
        />
      );
      expect(screen.getByTestId('property-preview-address').props.children).toBe('Teststraat 42');
      expect(screen.getByText('Eindhoven, 5600 AA')).toBeTruthy();
    });

    it('displays formatted valuation price', () => {
      render(
        <GroupPreviewCard
          properties={[makeProperty({ officialValuation: 350000 })]}
          onClose={jest.fn()}
        />
      );
      // Price is rendered as formatted value
      expect(screen.getByText(/350/)).toBeTruthy();
    });

    it('displays formatted asking price when no FMV', () => {
      render(
        <GroupPreviewCard
          properties={[makeProperty({ fmv: null, askingPrice: 395000, officialValuation: 350000 })]}
          onClose={jest.fn()}
        />
      );
      // Asking price takes priority over valuation
      expect(screen.getByText(/395/)).toBeTruthy();
    });

    it('prefers FMV over asking price over valuation', () => {
      render(
        <GroupPreviewCard
          properties={[
            makeProperty({ fmv: 400000, askingPrice: 380000, officialValuation: 350000 }),
          ]}
          onClose={jest.fn()}
        />
      );
      // FMV price should be shown
      expect(screen.getByText(/400/)).toBeTruthy();
    });

    it('handles property without postal code', () => {
      render(
        <GroupPreviewCard
          properties={[makeProperty({ postalCode: null })]}
          onClose={jest.fn()}
        />
      );
      expect(screen.getByText('Eindhoven')).toBeTruthy();
    });

    it('handles property without any price', () => {
      render(
        <GroupPreviewCard
          properties={[makeProperty({ officialValuation: null, askingPrice: null, fmv: null })]}
          onClose={jest.fn()}
        />
      );
      // Should render without crashing
      expect(screen.getByTestId('property-preview-address').props.children).toBe('Teststraat 42');
    });

    it('fires onClose when close button on the card is pressed', () => {
      const onClose = jest.fn();
      render(
        <GroupPreviewCard
          properties={[makeProperty()]}
          onClose={onClose}
        />
      );
      const closeBtn = screen.getByTestId('group-preview-close-button');
      fireEvent.press(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('property-preview-close-button')).toBeNull();
    });

    it('does not mount the retired native hit-test overlay above the real card pressable', () => {
      render(
        <GroupPreviewCard
          properties={[makeProperty()]}
          onClose={jest.fn()}
        />
      );

      const previewSurface = screen.getByTestId('group-preview-active-card');

      expect(previewSurface.props.onTouchStart).toBeUndefined();
      expect(previewSurface.props.onTouchMove).toBeUndefined();
      expect(previewSurface.props.onTouchEnd).toBeUndefined();
      expect(screen.queryByTestId('group-preview-touch-overlay')).toBeNull();
    });

    it('fires onPropertyTap when card body is pressed', () => {
      const onPropertyTap = jest.fn();
      const prop = makeProperty();
      render(
        <GroupPreviewCard
          properties={[prop]}
          onClose={jest.fn()}
          onPropertyTap={onPropertyTap}
        />
      );
      fireEvent.press(screen.getByTestId('property-preview-address'));
      expect(onPropertyTap).toHaveBeenCalledWith(prop);
    });

    it('does not show pagination controls', () => {
      render(
        <GroupPreviewCard
          properties={[makeProperty()]}
          onClose={jest.fn()}
        />
      );
      expect(screen.queryByTestId('group-preview-nav-left')).toBeNull();
      expect(screen.queryByTestId('group-preview-nav-right')).toBeNull();
      expect(screen.queryByTestId('group-preview-page-indicator')).toBeNull();
    });

    it('shows activity level indicator', () => {
      render(
        <GroupPreviewCard
          properties={[makeProperty({ activityLevel: 'hot' })]}
          onClose={jest.fn()}
        />
      );
      expect(screen.getByText('Hot')).toBeTruthy();
    });

    it('uses the compact 238px width for web single-property previews without wrapper maxWidth', () => {
      setPlatformOS('web');
      render(
        <GroupPreviewCard
          properties={[makeProperty()]}
          onClose={jest.fn()}
        />
      );

      expect(flattenNodeStyle('group-preview-card')).toEqual(
        expect.objectContaining({
          width: 238,
        })
      );
      expect(flattenNodeStyle('group-preview-card')).not.toHaveProperty('maxWidth');
      expect(flattenNodeStyle('group-preview-card-container')).toEqual(
        expect.objectContaining({ width: '100%' })
      );
      expect(flattenNodeStyle('group-preview-swipe-surface')).toEqual(
        expect.objectContaining({
          width: 238,
          flexShrink: 0,
        })
      );
      expect(flattenNodeStyle('group-preview-active-card')).toEqual(
        expect.objectContaining({
          width: 238,
          flexBasis: 238,
          flexShrink: 0,
        })
      );
    });

    it('keeps native single-property previews at the full 280px width', () => {
      setPlatformOS('ios');
      render(
        <GroupPreviewCard
          properties={[makeProperty()]}
          onClose={jest.fn()}
        />
      );

      expect(flattenNodeStyle('group-preview-card')).toEqual(
        expect.objectContaining({
          width: 280,
        })
      );
      expect(flattenNodeStyle('group-preview-card')).not.toHaveProperty('maxWidth');
      expect(flattenNodeStyle('group-preview-swipe-surface')).toEqual(
        expect.objectContaining({
          width: 280,
          flexShrink: 0,
        })
      );
      expect(flattenNodeStyle('group-preview-active-card')).toEqual(
        expect.objectContaining({
          width: 280,
          flexBasis: 280,
          flexShrink: 0,
        })
      );
    });

    it('defaults to cold/quiet activity', () => {
      render(
        <GroupPreviewCard
          properties={[makeProperty({ activityLevel: undefined })]}
          onClose={jest.fn()}
        />
      );
      expect(screen.getByText('Quiet')).toBeTruthy();
    });
  });

  // ---- Quick action buttons ----

  describe('quick actions', () => {
    it('renders Like, Comment, Guess buttons', () => {
      render(
        <GroupPreviewCard
          properties={[makeProperty()]}
          onClose={jest.fn()}
        />
      );
      expect(screen.getByText('Like')).toBeTruthy();
      expect(screen.getByText('Comment')).toBeTruthy();
      expect(screen.getByText('Guess')).toBeTruthy();
    });

    it('fires onLike with current property', () => {
      const onLike = jest.fn();
      const prop = makeProperty();
      render(
        <GroupPreviewCard
          properties={[prop]}
          onClose={jest.fn()}
          onLike={onLike}
        />
      );
      fireEvent.press(screen.getByTestId('group-preview-like-button'));
      expect(onLike).toHaveBeenCalledWith(prop);
    });

    it('fires onComment with current property', () => {
      const onComment = jest.fn();
      const prop = makeProperty();
      render(
        <GroupPreviewCard
          properties={[prop]}
          onClose={jest.fn()}
          onComment={onComment}
        />
      );
      fireEvent.press(screen.getByTestId('group-preview-comment-button'));
      expect(onComment).toHaveBeenCalledWith(prop);
    });

    it('fires onGuess with current property', () => {
      const onGuess = jest.fn();
      const prop = makeProperty();
      render(
        <GroupPreviewCard
          properties={[prop]}
          onClose={jest.fn()}
          onGuess={onGuess}
        />
      );
      fireEvent.press(screen.getByTestId('group-preview-guess-button'));
      expect(onGuess).toHaveBeenCalledWith(prop);
    });

    it('shows "Liked" when isLiked is true', () => {
      render(
        <GroupPreviewCard
          properties={[makeProperty()]}
          onClose={jest.fn()}
          isLiked={true}
        />
      );
      expect(screen.getByText('Liked')).toBeTruthy();
      expect(screen.queryByText('Like')).toBeNull();
    });
  });

  // ---- Arrow pointer ----

  describe('arrow pointer', () => {
    it('renders down arrow when showArrow is true', () => {
      render(
        <GroupPreviewCard
          properties={[makeProperty()]}
          onClose={jest.fn()}
          showArrow={true}
          arrowDirection="down"
        />
      );
      expect(screen.getByTestId('group-preview-arrow-down')).toBeTruthy();
      expect(screen.queryByTestId('group-preview-arrow-up')).toBeNull();
    });

    it('renders up arrow when arrowDirection is up', () => {
      render(
        <GroupPreviewCard
          properties={[makeProperty()]}
          onClose={jest.fn()}
          showArrow={true}
          arrowDirection="up"
        />
      );
      expect(screen.getByTestId('group-preview-arrow-up')).toBeTruthy();
      expect(screen.queryByTestId('group-preview-arrow-down')).toBeNull();
    });

    it('does not render arrow when showArrow is false', () => {
      render(
        <GroupPreviewCard
          properties={[makeProperty()]}
          onClose={jest.fn()}
          showArrow={false}
        />
      );
      expect(screen.queryByTestId('group-preview-arrow-down')).toBeNull();
      expect(screen.queryByTestId('group-preview-arrow-up')).toBeNull();
    });
  });

  // ---- Cluster mode ----

  describe('cluster (multiple properties)', () => {
    it('prefetches previous and next adjacent property image candidates', async () => {
      render(
        <GroupPreviewCard
          properties={[
            makeProperty({
              id: 'prev',
              thumbnailUrl: 'https://cdn.huishype.nl/prev.jpg',
            }),
            makeProperty({ id: 'current' }),
            makeProperty({
              id: 'next',
              thumbnailUrl: 'https://cdn.huishype.nl/next.jpg',
            }),
          ]}
          currentIndex={1}
          onIndexChange={jest.fn()}
          onClose={jest.fn()}
        />
      );

      await waitFor(() => expect(prefetchSpy).toHaveBeenCalledTimes(2));
      expect(prefetchSpy).toHaveBeenCalledWith('https://cdn.huishype.nl/prev.jpg');
      expect(prefetchSpy).toHaveBeenCalledWith('https://cdn.huishype.nl/next.jpg');
    });

    it('prefetches only the next image candidate at the first index', async () => {
      render(
        <GroupPreviewCard
          properties={[
            makeProperty({ id: 'current' }),
            makeProperty({
              id: 'next',
              thumbnailUrl: 'https://cdn.huishype.nl/next-only.jpg',
            }),
          ]}
          currentIndex={0}
          onIndexChange={jest.fn()}
          onClose={jest.fn()}
        />
      );

      await waitFor(() => expect(prefetchSpy).toHaveBeenCalledTimes(1));
      expect(prefetchSpy).toHaveBeenCalledWith('https://cdn.huishype.nl/next-only.jpg');
    });

    it('prefetches only the previous image candidate at the last index', async () => {
      render(
        <GroupPreviewCard
          properties={[
            makeProperty({
              id: 'prev',
              thumbnailUrl: 'https://cdn.huishype.nl/prev-only.jpg',
            }),
            makeProperty({ id: 'current' }),
          ]}
          currentIndex={1}
          onIndexChange={jest.fn()}
          onClose={jest.fn()}
        />
      );

      await waitFor(() => expect(prefetchSpy).toHaveBeenCalledTimes(1));
      expect(prefetchSpy).toHaveBeenCalledWith('https://cdn.huishype.nl/prev-only.jpg');
    });

    it('deduplicates matching adjacent image candidate URLs', async () => {
      render(
        <GroupPreviewCard
          properties={[
            makeProperty({
              id: 'prev',
              thumbnailUrl: 'https://cdn.huishype.nl/shared.jpg',
            }),
            makeProperty({ id: 'current' }),
            makeProperty({
              id: 'next',
              thumbnailUrl: 'https://cdn.huishype.nl/shared.jpg',
            }),
          ]}
          currentIndex={1}
          onIndexChange={jest.fn()}
          onClose={jest.fn()}
        />
      );

      await waitFor(() => expect(prefetchSpy).toHaveBeenCalledTimes(1));
      expect(prefetchSpy).toHaveBeenCalledWith('https://cdn.huishype.nl/shared.jpg');
    });

    it('prefetches NL aerial candidates when no listing thumbnail is available', async () => {
      render(
        <GroupPreviewCard
          properties={[
            makeProperty({ id: 'current' }),
            makeProperty({
              id: 'next',
              countryCode: 'NL',
              aerialImageUrl: 'https://images.huishype.nl/aerial-next.jpg',
            }),
          ]}
          currentIndex={0}
          onIndexChange={jest.fn()}
          onClose={jest.fn()}
        />
      );

      await waitFor(() => expect(prefetchSpy).toHaveBeenCalledTimes(1));
      expect(prefetchSpy).toHaveBeenCalledWith('https://images.huishype.nl/aerial-next.jpg');
    });

    it('does not prefetch for single-property previews', async () => {
      render(
        <GroupPreviewCard
          properties={[
            makeProperty({
              thumbnailUrl: 'https://cdn.huishype.nl/single.jpg',
            }),
          ]}
          onClose={jest.fn()}
        />
      );

      await waitFor(() => expect(prefetchSpy).not.toHaveBeenCalled());
    });

    it('renders pagination controls for multiple properties', () => {
      render(
        <GroupPreviewCard
          properties={makeProperties(5)}
          currentIndex={0}
          onIndexChange={jest.fn()}
          onClose={jest.fn()}
        />
      );
      expect(screen.getByTestId('group-preview-nav-left')).toBeTruthy();
      expect(screen.getByTestId('group-preview-nav-right')).toBeTruthy();
      expect(screen.getByTestId('group-preview-page-indicator')).toBeTruthy();
    });

    it('shows correct page text', () => {
      render(
        <GroupPreviewCard
          properties={makeProperties(7)}
          currentIndex={2}
          onIndexChange={jest.fn()}
          onClose={jest.fn()}
        />
      );
      expect(screen.getByText('3 of 7')).toBeTruthy();
    });

    it('shows first page text by default', () => {
      render(
        <GroupPreviewCard
          properties={makeProperties(3)}
          currentIndex={0}
          onIndexChange={jest.fn()}
          onClose={jest.fn()}
        />
      );
      expect(screen.getByText('1 of 3')).toBeTruthy();
    });

    it('displays the current property content', () => {
      const props = makeProperties(3);
      render(
        <GroupPreviewCard
          properties={props}
          currentIndex={1}
          onIndexChange={jest.fn()}
          onClose={jest.fn()}
        />
      );
      expect(screen.getByText('Straat 2')).toBeTruthy();
    });

    it('renders adjacent property content in grouped carousel mode', () => {
      render(
        <GroupPreviewCard
          properties={makeProperties(3)}
          currentIndex={1}
          onIndexChange={jest.fn()}
          onClose={jest.fn()}
        />
      );

      expect(getRenderedCarouselAddresses()).toEqual(['Straat 1', 'Straat 2', 'Straat 3']);
    });

    it.each([
      { label: 'first', currentIndex: 0, expectedAddresses: ['Straat 1', 'Straat 2'] },
      { label: 'middle', currentIndex: 1, expectedAddresses: ['Straat 1', 'Straat 2', 'Straat 3'] },
      { label: 'last', currentIndex: 2, expectedAddresses: ['Straat 2', 'Straat 3'] },
    ])('renders the bounded carousel window at the $label index', ({ currentIndex, expectedAddresses }) => {
      render(
        <GroupPreviewCard
          properties={makeProperties(3)}
          currentIndex={currentIndex}
          onIndexChange={jest.fn()}
          onClose={jest.fn()}
        />
      );

      expect(getRenderedCarouselAddresses()).toEqual(expectedAddresses);
    });

    it('keeps native grouped carousel width math compact without wrapper maxWidth', () => {
      setPlatformOS('ios');
      render(
        <GroupPreviewCard
          properties={makeProperties(3)}
          currentIndex={1}
          onIndexChange={jest.fn()}
          onClose={jest.fn()}
        />
      );

      expect(flattenNodeStyle('group-preview-card')).toEqual(
        expect.objectContaining({
          width: 238,
        })
      );
      expect(flattenNodeStyle('group-preview-card')).not.toHaveProperty('maxWidth');
      expect(flattenNodeStyle('group-preview-card-container')).toEqual(
        expect.objectContaining({ width: '100%' })
      );
      expect(flattenNodeStyle('group-preview-carousel-viewport')).toEqual(
        expect.objectContaining({
          width: '100%',
          overflow: 'hidden',
        })
      );
      expect(flattenNodeStyle('group-preview-swipe-surface')).toEqual(
        expect.objectContaining({
          width: 714,
          flexShrink: 0,
        })
      );
      expect(getCarouselNumericTranslateXValues()).toContain(-238);

      const slideStyles = [
        screen.getByTestId('group-preview-active-card'),
        ...screen.getAllByTestId('group-preview-adjacent-card'),
      ].map((node) => flattenStyle(node.props.style));

      for (const slideStyle of slideStyles) {
        expect(slideStyle).toEqual(
          expect.objectContaining({
            width: 238,
            flexBasis: 238,
            flexShrink: 0,
          })
        );
      }
    });

    it('keeps web grouped carousel width math compact without wrapper maxWidth', () => {
      setPlatformOS('web');
      render(
        <GroupPreviewCard
          properties={makeProperties(3)}
          currentIndex={1}
          onIndexChange={jest.fn()}
          onClose={jest.fn()}
        />
      );

      expect(flattenNodeStyle('group-preview-card')).toEqual(
        expect.objectContaining({
          width: 238,
        })
      );
      expect(flattenNodeStyle('group-preview-card')).not.toHaveProperty('maxWidth');
      expect(flattenNodeStyle('group-preview-card-container')).toEqual(
        expect.objectContaining({ width: '100%' })
      );
      expect(flattenNodeStyle('group-preview-carousel-viewport')).toEqual(
        expect.objectContaining({
          width: '100%',
          overflow: 'hidden',
        })
      );
      expect(flattenNodeStyle('group-preview-swipe-surface')).toEqual(
        expect.objectContaining({
          width: 714,
          flexShrink: 0,
        })
      );
      expect(getCarouselNumericTranslateXValues()).toContain(-238);

      const slideStyles = [
        screen.getByTestId('group-preview-active-card'),
        ...screen.getAllByTestId('group-preview-adjacent-card'),
      ].map((node) => flattenStyle(node.props.style));

      for (const slideStyle of slideStyles) {
        expect(slideStyle).toEqual(
          expect.objectContaining({
            width: 238,
            flexBasis: 238,
            flexShrink: 0,
          })
        );
      }
    });

    it('fires onIndexChange when right arrow is pressed', () => {
      const onIndexChange = jest.fn();
      render(
        <GroupPreviewCard
          properties={makeProperties(5)}
          currentIndex={0}
          onIndexChange={onIndexChange}
          onClose={jest.fn()}
        />
      );
      fireEvent.press(screen.getByTestId('group-preview-nav-right'));
      expect(onIndexChange).toHaveBeenCalledWith(1);
    });

    it('fires onIndexChange when left arrow is pressed', () => {
      const onIndexChange = jest.fn();
      render(
        <GroupPreviewCard
          properties={makeProperties(5)}
          currentIndex={2}
          onIndexChange={onIndexChange}
          onClose={jest.fn()}
        />
      );
      fireEvent.press(screen.getByTestId('group-preview-nav-left'));
      expect(onIndexChange).toHaveBeenCalledWith(1);
    });

    it('left arrow is disabled at first item', () => {
      const onIndexChange = jest.fn();
      render(
        <GroupPreviewCard
          properties={makeProperties(3)}
          currentIndex={0}
          onIndexChange={onIndexChange}
          onClose={jest.fn()}
        />
      );
      fireEvent.press(screen.getByTestId('group-preview-nav-left'));
      expect(onIndexChange).not.toHaveBeenCalled();
    });

    it('right arrow is disabled at last item', () => {
      const onIndexChange = jest.fn();
      render(
        <GroupPreviewCard
          properties={makeProperties(3)}
          currentIndex={2}
          onIndexChange={onIndexChange}
          onClose={jest.fn()}
        />
      );
      fireEvent.press(screen.getByTestId('group-preview-nav-right'));
      expect(onIndexChange).not.toHaveBeenCalled();
    });

    it('close button works in cluster mode', () => {
      const onClose = jest.fn();
      render(
        <GroupPreviewCard
          properties={makeProperties(3)}
          currentIndex={0}
          onIndexChange={jest.fn()}
          onClose={onClose}
        />
      );
      fireEvent.press(screen.getByTestId('group-preview-close-button'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('fires onPropertyTap with the correct cluster property', () => {
      const onPropertyTap = jest.fn();
      const props = makeProperties(3);
      render(
        <GroupPreviewCard
          properties={props}
          currentIndex={1}
          onIndexChange={jest.fn()}
          onClose={jest.fn()}
          onPropertyTap={onPropertyTap}
        />
      );
      fireEvent.press(screen.getByText('Straat 2'));
      expect(onPropertyTap).toHaveBeenCalledWith(props[1]);
    });

    it('quick actions and close target only the active cluster property', () => {
      const onLike = jest.fn();
      const onComment = jest.fn();
      const onGuess = jest.fn();
      const onClose = jest.fn();
      const props = makeProperties(3);

      render(
        <GroupPreviewCard
          properties={props}
          currentIndex={1}
          onIndexChange={jest.fn()}
          onClose={onClose}
          onLike={onLike}
          onComment={onComment}
          onGuess={onGuess}
        />
      );

      for (const button of screen.getAllByTestId('group-preview-like-button')) {
        fireEvent.press(button);
      }
      for (const button of screen.getAllByTestId('group-preview-comment-button')) {
        fireEvent.press(button);
      }
      for (const button of screen.getAllByTestId('group-preview-guess-button')) {
        fireEvent.press(button);
      }

      expect(onLike).toHaveBeenCalledTimes(1);
      expect(onLike).toHaveBeenCalledWith(props[1]);
      expect(onComment).toHaveBeenCalledTimes(1);
      expect(onComment).toHaveBeenCalledWith(props[1]);
      expect(onGuess).toHaveBeenCalledTimes(1);
      expect(onGuess).toHaveBeenCalledWith(props[1]);

      expect(screen.getAllByTestId('group-preview-close-button')).toHaveLength(1);
      fireEvent.press(screen.getByTestId('group-preview-close-button'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('navigates with direct web touch swipes', () => {
      setPlatformOS('web');
      const onIndexChange = jest.fn();
      render(
        <GroupPreviewCard
          properties={makeProperties(3)}
          currentIndex={0}
          onIndexChange={onIndexChange}
          onClose={jest.fn()}
        />
      );

      fireWebTouchStart(240);
      fireWebTouchMove(120);
      fireWebTouchEnd(120);

      expect(onIndexChange).toHaveBeenCalledWith(1);
    });

    it('snaps back after an insufficient web swipe without changing index', () => {
      setPlatformOS('web');
      const timingSpy = jest.spyOn(Animated, 'timing');
      const onIndexChange = jest.fn();

      render(
        <GroupPreviewCard
          properties={makeProperties(3)}
          currentIndex={1}
          onIndexChange={onIndexChange}
          onClose={jest.fn()}
        />
      );

      fireWebTouchStart(220);
      fireWebTouchMove(190);
      fireWebTouchEnd(190);

      expect(onIndexChange).not.toHaveBeenCalled();
      expect(timingSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        })
      );
    });

    it.each([
      { label: 'first', currentIndex: 0, startX: 120, moveX: 220 },
      { label: 'last', currentIndex: 2, startX: 220, moveX: 120 },
    ])('clamps out-of-bounds web swipes at the $label index', ({ currentIndex, startX, moveX }) => {
      setPlatformOS('web');
      const onIndexChange = jest.fn();

      render(
        <GroupPreviewCard
          properties={makeProperties(3)}
          currentIndex={currentIndex}
          onIndexChange={onIndexChange}
          onClose={jest.fn()}
        />
      );

      fireWebTouchStart(startX);
      fireWebTouchMove(moveX);
      expect(getAnimatedTranslateXValue()).toBe(0);
      fireWebTouchEnd(moveX);

      expect(onIndexChange).not.toHaveBeenCalled();
    });

    it('does not treat vertical web touch movement as card navigation', () => {
      setPlatformOS('web');
      const onIndexChange = jest.fn();
      render(
        <GroupPreviewCard
          properties={makeProperties(3)}
          currentIndex={0}
          onIndexChange={onIndexChange}
          onClose={jest.fn()}
        />
      );

      fireWebTouchStart(160, 120);
      fireWebTouchMove(166, 210);
      fireWebTouchEnd(166, 210);

      expect(onIndexChange).not.toHaveBeenCalled();
    });
  });

  // ---- Edge cases ----

  describe('edge cases', () => {
    it('returns null when properties array is empty', () => {
      const { toJSON } = render(
        <GroupPreviewCard
          properties={[]}
          onClose={jest.fn()}
        />
      );
      expect(toJSON()).toBeNull();
    });

    it('renders with thumbnail image', () => {
      render(
        <GroupPreviewCard
          properties={[
            makeProperty({
              countryCode: 'NL',
              thumbnailUrl: 'https://cdn.huishype.nl/photo.jpg',
            }),
          ]}
          onClose={jest.fn()}
        />
      );
      expect(screen.getByTestId('property-thumbnail-image')).toBeTruthy();
    });

    it('shows arrow with cluster', () => {
      render(
        <GroupPreviewCard
          properties={makeProperties(3)}
          currentIndex={0}
          onIndexChange={jest.fn()}
          onClose={jest.fn()}
          showArrow={true}
          arrowDirection="down"
        />
      );
      expect(screen.getByTestId('group-preview-arrow-down')).toBeTruthy();
      expect(screen.getByTestId('group-preview-page-indicator')).toBeTruthy();
    });
  });
});
