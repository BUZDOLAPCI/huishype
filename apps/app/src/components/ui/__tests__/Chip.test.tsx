import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { Chip } from '../Chip';

describe('Chip', () => {
  it('renders label text', () => {
    const { getByText } = render(<Chip label="Trending" />);
    expect(getByText('Trending')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Chip label="Recent" onPress={onPress} />);
    fireEvent.press(getByText('Recent'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('sets disabled prop when disabled', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <Chip label="Disabled" onPress={onPress} disabled testID="chip-dis" />
    );
    // Mock RN Pressable doesn't gate onPress; verify prop is set
    expect(getByTestId('chip-dis').props.disabled).toBe(true);
  });

  it('renders with active state', () => {
    const { getByText } = render(<Chip label="Active" active />);
    expect(getByText('Active')).toBeTruthy();
  });

  it('renders with inactive state', () => {
    const { getByText } = render(<Chip label="Inactive" active={false} />);
    expect(getByText('Inactive')).toBeTruthy();
  });

  it('renders leading element', () => {
    const { getByText } = render(
      <Chip label="With icon" leading={<Text>IC</Text>} />
    );
    expect(getByText('IC')).toBeTruthy();
  });

  it('sets selected accessibility state when active', () => {
    const { getByTestId } = render(
      <Chip label="Active" active testID="chip-active" />
    );
    expect(getByTestId('chip-active').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true })
    );
  });

  it('sets disabled accessibility state', () => {
    const { getByTestId } = render(
      <Chip label="Disabled" disabled testID="chip-disabled" />
    );
    expect(getByTestId('chip-disabled').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true })
    );
  });
});
