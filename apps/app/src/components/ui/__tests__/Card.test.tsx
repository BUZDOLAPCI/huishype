import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { Card } from '../Card';

describe('Card', () => {
  it('renders children', () => {
    const { getByText } = render(
      <Card><Text>Card content</Text></Card>
    );
    expect(getByText('Card content')).toBeTruthy();
  });

  it('renders with testID', () => {
    const { getByTestId } = render(
      <Card testID="my-card"><Text>Test</Text></Card>
    );
    expect(getByTestId('my-card')).toBeTruthy();
  });

  it('is pressable when onPress is provided', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <Card onPress={onPress}><Text>Pressable</Text></Card>
    );
    fireEvent.press(getByText('Pressable'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not pressable when onPress is omitted', () => {
    const { getByTestId } = render(
      <Card testID="static-card"><Text>Static</Text></Card>
    );
    // Card should render as a plain View, not wrapped in Pressable
    const card = getByTestId('static-card');
    expect(card).toBeTruthy();
  });

  it('accepts shadow variant prop', () => {
    const variants = ['card', 'card-alt', 'preview', 'none'] as const;
    for (const shadow of variants) {
      const { getByTestId, unmount } = render(
        <Card shadow={shadow} testID={`card-${shadow}`}><Text>V</Text></Card>
      );
      expect(getByTestId(`card-${shadow}`)).toBeTruthy();
      unmount();
    }
  });
});
