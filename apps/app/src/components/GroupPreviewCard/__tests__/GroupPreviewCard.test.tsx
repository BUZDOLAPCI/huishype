import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
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

describe('GroupPreviewCard', () => {
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

      const previewSurface = screen.getByTestId('group-preview-touch-overlay');

      expect(previewSurface.props.onTouchStart).toBeUndefined();
      expect(previewSurface.props.onTouchMove).toBeUndefined();
      expect(previewSurface.props.onTouchEnd).toBeUndefined();
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
