import React from 'react';
import { render } from '@testing-library/react-native';
import { UserAvatar, getAvatarColor, getAvatarInitials, getAvatarVariantIndex } from '../UserAvatar';

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

  describe('getAvatarVariantIndex', () => {
    it('is deterministic for the same username', () => {
      expect(getAvatarVariantIndex('alice')).toBe(getAvatarVariantIndex('alice'));
    });

    it('spreads users across a broad illustrated avatar range', () => {
      const variants = new Set(
        [
          'alice',
          'bob',
          'charlie',
          'dave',
          'eve',
          'frank',
          'grace',
          'heidi',
          'ivan',
          'judy',
          'mallory',
          'nia',
          'oscar',
          'peggy',
          'quentin',
          'riley',
        ].map(getAvatarVariantIndex)
      );

      expect(variants.size).toBeGreaterThanOrEqual(10);
    });
  });

  describe('getAvatarInitials', () => {
    it('uses display-name initials when two words are present', () => {
      expect(getAvatarInitials('Alice Wonderland')).toBe('AW');
    });

    it('uses the first two letters for single-word names', () => {
      expect(getAvatarInitials('Alice')).toBe('AL');
    });

    it('returns a placeholder for empty input', () => {
      expect(getAvatarInitials('')).toBe('?');
    });
  });

  describe('component rendering', () => {
    it('renders initials over the illustrated fallback when no profilePhotoUrl', () => {
      const { getByTestId } = render(
        <UserAvatar username="alice" displayName="Alice Wonderland" />
      );

      expect(getByTestId('user-avatar')).toBeTruthy();
      expect(getByTestId('user-avatar-art')).toBeTruthy();
      expect(getByTestId('user-avatar-art-initials').props.children).toBe('AW');
    });

    it('falls back to username initials when displayName is absent', () => {
      const { getByTestId } = render(<UserAvatar username="bob" />);
      expect(getByTestId('user-avatar-art-initials').props.children).toBe('BO');
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
      expect(getByTestId('custom-avatar-art')).toBeTruthy();
    });

    it('supports all size variants', () => {
      const sizes = ['xs', 'sm', 'md', 'lg'] as const;
      for (const size of sizes) {
        const { getByTestId, unmount } = render(
          <UserAvatar username="eve" size={size} testID={`avatar-${size}`} />
        );
        expect(getByTestId(`avatar-${size}`)).toBeTruthy();
        expect(getByTestId(`avatar-${size}-art`)).toBeTruthy();
        unmount();
      }
    });
  });
});
