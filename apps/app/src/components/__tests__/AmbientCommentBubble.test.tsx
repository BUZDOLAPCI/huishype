import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  AmbientCommentBubble,
  AMBIENT_COMMENT_BUBBLE_ARROW_TIP_CENTER_X,
  AMBIENT_COMMENT_BUBBLE_WIDTH,
  getAmbientCommentBubbleArrowLayout,
} from '../AmbientCommentBubble';

describe('AmbientCommentBubble', () => {
  it('renders fallback avatar art and like count', () => {
    render(
      <AmbientCommentBubble
        text="Why is this still unsold?"
        likeCount={2}
        authorName="Nina"
        testID="ambient-bubble"
      />
    );

    expect(screen.getByTestId('ambient-bubble-avatar')).toBeTruthy();
    expect(screen.getByTestId('ambient-bubble-avatar-art')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByTestId('ambient-bubble-likes')).toBeTruthy();
  });

  it('uses the compact avatar size and tighter avatar gap', () => {
    render(
      <AmbientCommentBubble
        text="Why is this still unsold?"
        likeCount={2}
        authorName="Nina"
        testID="ambient-bubble"
      />
    );

    expect(screen.getByTestId('ambient-bubble-avatar-art-initials').props.fontSize).toBe(38);
    expect(screen.getByTestId('ambient-bubble-avatar-wrap').props.style.marginRight).toBeCloseTo(
      6.4
    );
  });

  it('pins the reaction badge to the bottom row by splitting text into two lines', () => {
    render(
      <AmbientCommentBubble
        text="Why is this still unsold?"
        likeCount={2}
        authorName="Nina"
        testID="ambient-bubble"
      />
    );

    expect(screen.getByTestId('ambient-bubble-text-line-1').props.children).toBe(
      'Why is this still'
    );
    expect(screen.getByTestId('ambient-bubble-text-line-2').props.children).toBe('unsold?');
  });

  it('truncates the second line when the preview text overflows both lines', () => {
    render(
      <AmbientCommentBubble
        text="This townhouse is probably still unsold because the HOA fees are brutal"
        likeCount={9}
        authorName="Sophie"
        testID="ambient-bubble"
      />
    );

    expect(screen.getByTestId('ambient-bubble-text-line-2').props.children).toMatch(/…$/);
  });

  it('renders the upward arrow variant above the card', () => {
    render(
      <AmbientCommentBubble
        text="Short note"
        likeCount={1}
        authorName="Nina"
        arrowDirection="up"
        testID="ambient-bubble"
      />
    );

    expect(screen.getByTestId('ambient-bubble-arrow-up')).toBeTruthy();
    expect(screen.queryByTestId('ambient-bubble-arrow-down')).toBeNull();
  });

  it('still renders the downward arrow when right-edge alignment is requested', () => {
    render(
      <AmbientCommentBubble
        text="Short note"
        likeCount={1}
        authorName="Nina"
        arrowHorizontalAlign="right"
        testID="ambient-bubble"
      />
    );

    expect(screen.getByTestId('ambient-bubble-arrow-down')).toBeTruthy();
  });

  it('keeps the arrow on the left edge until the anchor passes the horizontal midpoint', () => {
    expect(getAmbientCommentBubbleArrowLayout({ anchorX: 200, viewportWidth: 400 })).toEqual({
      anchorOffsetX: AMBIENT_COMMENT_BUBBLE_ARROW_TIP_CENTER_X,
      arrowHorizontalAlign: 'left',
    });

    expect(getAmbientCommentBubbleArrowLayout({ anchorX: 201, viewportWidth: 400 })).toEqual({
      anchorOffsetX:
        AMBIENT_COMMENT_BUBBLE_WIDTH - AMBIENT_COMMENT_BUBBLE_ARROW_TIP_CENTER_X,
      arrowHorizontalAlign: 'right',
    });
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();

    render(
      <AmbientCommentBubble
        text="Short note"
        likeCount={1}
        authorName="Nina"
        onPress={onPress}
        testID="ambient-bubble"
      />
    );

    fireEvent.press(screen.getByTestId('ambient-bubble'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
