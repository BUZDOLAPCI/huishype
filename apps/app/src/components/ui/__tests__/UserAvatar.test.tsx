import React from 'react';
import { render } from '@testing-library/react-native';
import { UserAvatar, getAvatarColor } from '../UserAvatar';

describe('UserAvatar', () => {
  describe('getAvatarColor', () => {
    it('returns a hex colour string', () => {
      const color = getAvatarColor('testuser');
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it('is deterministic — same input always returns same colour', () => {
      const a = getAvatarColor('alice');
      const b = getAvatarColor('alice');
      expect(a).toBe(b);
    });

    it('returns different colours for different usernames (with high probability)', () => {
      const colors = new Set(
        ['alice', 'bob', 'charlie', 'dave', 'eve', 'frank', 'grace', 'heidi']
          .map(getAvatarColor)
      );
      // At least some diversity in the palette
      expect(colors.size).toBeGreaterThanOrEqual(3);
    });
  });

  describe('component rendering', () => {
    it('renders initials fallback when no profilePhotoUrl', () => {
      const { getByText, getByTestId } = render(
        <UserAvatar username="alice" displayName="Alice Wonderland" />
      );
      expect(getByTestId('user-avatar')).toBeTruthy();
      expect(getByText('AW')).toBeTruthy();
    });

    it('renders single-name initials correctly', () => {
      const { getByText } = render(
        <UserAvatar username="alice" displayName="Alice" />
      );
      expect(getByText('AL')).toBeTruthy();
    });

    it('falls back to username when no displayName', () => {
      const { getByText } = render(
        <UserAvatar username="bob" />
      );
      expect(getByText('BO')).toBeTruthy();
    });

    it('renders Image when profilePhotoUrl is provided', () => {
      const { getByTestId } = render(
        <UserAvatar
          username="charlie"
          profilePhotoUrl="https://example.com/photo.jpg"
        />
      );
      expect(getByTestId('user-avatar')).toBeTruthy();
    });

    it('supports custom testID', () => {
      const { getByTestId } = render(
        <UserAvatar username="dave" testID="custom-avatar" />
      );
      expect(getByTestId('custom-avatar')).toBeTruthy();
    });

    it('supports all size variants', () => {
      const sizes = ['xs', 'sm', 'md', 'lg'] as const;
      for (const size of sizes) {
        const { getByTestId, unmount } = render(
          <UserAvatar username="eve" size={size} testID={`avatar-${size}`} />
        );
        expect(getByTestId(`avatar-${size}`)).toBeTruthy();
        unmount();
      }
    });
  });
});
