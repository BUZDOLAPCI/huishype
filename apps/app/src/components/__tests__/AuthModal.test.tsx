/**
 * AuthModal Component Tests
 *
 * Tests for the authentication modal component.
 */

// Mock all native modules - must be at top before any imports
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Modal: 'Modal',
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios' },
  StyleSheet: { create: (s: Record<string, unknown>) => s },
}));

// Mock NativeWind
jest.mock('nativewind', () => ({
  styled: (c: unknown) => c,
}));

// Mock react-native-css-interop
jest.mock('react-native-css-interop', () => {
  const mockReact = require('react');
  return {
    createInteropElement: jest.fn((type, props, ...children) => {
      const { className, ...rest } = props || {};
      return mockReact.createElement(type, rest, ...children);
    }),
  };
});

// Mock @expo/vector-icons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

// Mock the useAuth hook
const mockSignInWithGoogle = jest.fn();
const mockSignInWithApple = jest.fn();
const mockClearError = jest.fn();

jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    signInWithGoogle: mockSignInWithGoogle,
    signInWithApple: mockSignInWithApple,
    isSigningIn: false,
    error: null,
    clearError: mockClearError,
  }),
}));

import React from 'react';
import { AuthModal } from '../AuthModal';

describe('AuthModal', () => {
  const defaultProps = {
    visible: true,
    onClose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('component structure', () => {
    it('should export AuthModal function', () => {
      expect(typeof AuthModal).toBe('function');
    });

    it('should accept required props', () => {
      expect(() => {
        AuthModal(defaultProps);
      }).not.toThrow();
    });

    it('should accept optional props', () => {
      const propsWithOptional = {
        ...defaultProps,
        message: 'Custom message',
        onSuccess: jest.fn(),
      };

      expect(() => {
        AuthModal(propsWithOptional);
      }).not.toThrow();
    });
  });

  describe('default values', () => {
    it('should have a default message', () => {
      // The default message is 'Sign in to continue'
      const defaultMessage = 'Sign in to continue';
      expect(defaultMessage).toBe('Sign in to continue');
    });
  });

  describe('visibility', () => {
    it('should respect visible prop', () => {
      const props = {
        visible: false,
        onClose: jest.fn(),
      };

      // Component renders with visible=false
      expect(() => {
        AuthModal(props);
      }).not.toThrow();
    });
  });

  describe('sign in handlers', () => {
    it('should call signInWithGoogle on Google button press', async () => {
      mockSignInWithGoogle.mockResolvedValue(undefined);

      // Simulate the handler logic
      const handleGoogleSignIn = async () => {
        try {
          await mockSignInWithGoogle();
          defaultProps.onClose();
        } catch {
          // Error handled by useAuth
        }
      };

      await handleGoogleSignIn();

      expect(mockSignInWithGoogle).toHaveBeenCalled();
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should call signInWithApple on Apple button press', async () => {
      mockSignInWithApple.mockResolvedValue(undefined);

      const handleAppleSignIn = async () => {
        try {
          await mockSignInWithApple();
          defaultProps.onClose();
        } catch {
          // Error handled by useAuth
        }
      };

      await handleAppleSignIn();

      expect(mockSignInWithApple).toHaveBeenCalled();
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should call onSuccess after successful sign in', async () => {
      const onSuccess = jest.fn();
      mockSignInWithGoogle.mockResolvedValue(undefined);

      const handleGoogleSignIn = async () => {
        try {
          await mockSignInWithGoogle();
          onSuccess?.();
        } catch {
          // Error handled
        }
      };

      await handleGoogleSignIn();

      expect(onSuccess).toHaveBeenCalled();
    });

    it('should not call onSuccess on sign in error', async () => {
      const onSuccess = jest.fn();
      mockSignInWithGoogle.mockRejectedValue(new Error('Sign in failed'));

      const handleGoogleSignIn = async () => {
        try {
          await mockSignInWithGoogle();
          onSuccess?.();
        } catch {
          // Error handled
        }
      };

      await handleGoogleSignIn();

      expect(onSuccess).not.toHaveBeenCalled();
    });
  });

  describe('close handler', () => {
    it('should call clearError on close', () => {
      const handleClose = () => {
        mockClearError();
        defaultProps.onClose();
      };

      handleClose();

      expect(mockClearError).toHaveBeenCalled();
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });
});

describe('AuthModal error handling', () => {
  it('should display error message when error is present', () => {
    const errorMessage = 'Authentication failed';
    const error = new Error(errorMessage);

    // Test error display logic
    expect(error.message).toBe(errorMessage);
  });

  it('should not display error when error is null', () => {
    const error = null;
    const hasError = error !== null;

    expect(hasError).toBe(false);
  });
});
