import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AmbientCommentBubble } from '../AmbientCommentBubble';

describe('AmbientCommentBubble', () => {
  it('renders fallback avatar initial and like count', () => {
    render(
      <AmbientCommentBubble
        text="Why is this still unsold?"
        likeCount={2}
        authorName="Nina"
        testID="ambient-bubble"
      />
    );

    expect(screen.getByText('N')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByTestId('ambient-bubble-likes')).toBeTruthy();
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
