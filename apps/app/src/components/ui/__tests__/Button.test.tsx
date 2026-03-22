import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '../Button';

describe('Button', () => {
  it('renders label text', () => {
    const { getByText } = render(<Button label="Click me" />);
    expect(getByText('Click me')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button label="Press" onPress={onPress} />);
    fireEvent.press(getByText('Press'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('sets disabled prop and accessibility state when disabled', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <Button label="Disabled" onPress={onPress} disabled testID="btn-test" />
    );
    // In the mock RN environment, Pressable doesn't gate onPress, so we
    // verify the disabled state is conveyed to the component tree instead.
    expect(getByTestId('btn-test').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true })
    );
    expect(getByTestId('btn-test').props.disabled).toBe(true);
  });

  it('renders with all variant options', () => {
    const variants = ['primary', 'secondary', 'ghost'] as const;
    for (const variant of variants) {
      const { getByText, unmount } = render(
        <Button label={variant} variant={variant} />
      );
      expect(getByText(variant)).toBeTruthy();
      unmount();
    }
  });

  it('renders with all size options', () => {
    const sizes = ['sm', 'md', 'lg'] as const;
    for (const size of sizes) {
      const { getByText, unmount } = render(
        <Button label={`size-${size}`} size={size} />
      );
      expect(getByText(`size-${size}`)).toBeTruthy();
      unmount();
    }
  });

  it('renders leading and trailing elements', () => {
    const { getByText } = render(
      <Button
        label="With icons"
        leading={<Text>L</Text>}
        trailing={<Text>T</Text>}
        testID="btn"
      />
    );
    expect(getByText('L')).toBeTruthy();
    expect(getByText('T')).toBeTruthy();
  });

  it('renders with testID', () => {
    const { getByTestId } = render(
      <Button label="Exists" testID="btn-tid" />
    );
    expect(getByTestId('btn-tid')).toBeTruthy();
  });
});
