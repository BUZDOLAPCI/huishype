import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { NotificationBell } from '../NotificationBell';

describe('NotificationBell', () => {
  it('renders the bell icon', () => {
    const { getByTestId } = render(<NotificationBell />);
    expect(getByTestId('notification-bell')).toBeTruthy();
  });

  it('hides badge when unreadCount is 0', () => {
    const { queryByTestId } = render(<NotificationBell unreadCount={0} />);
    expect(queryByTestId('notification-badge')).toBeNull();
  });

  it('shows badge when unreadCount is > 0', () => {
    const { getByTestId, getByText } = render(<NotificationBell unreadCount={5} />);
    expect(getByTestId('notification-badge')).toBeTruthy();
    expect(getByText('5')).toBeTruthy();
  });

  it('caps badge text at 99+', () => {
    const { getByText } = render(<NotificationBell unreadCount={150} />);
    expect(getByText('99+')).toBeTruthy();
  });

  it('shows exact count at 99', () => {
    const { getByText } = render(<NotificationBell unreadCount={99} />);
    expect(getByText('99')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<NotificationBell onPress={onPress} />);
    fireEvent.press(getByTestId('notification-bell'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('has correct accessibility label with unread count', () => {
    const { getByTestId } = render(<NotificationBell unreadCount={3} />);
    const bell = getByTestId('notification-bell');
    expect(bell.props.accessibilityLabel).toBe('Notifications, 3 unread');
  });

  it('has correct accessibility label without unread count', () => {
    const { getByTestId } = render(<NotificationBell unreadCount={0} />);
    const bell = getByTestId('notification-bell');
    expect(bell.props.accessibilityLabel).toBe('Notifications');
  });
});
