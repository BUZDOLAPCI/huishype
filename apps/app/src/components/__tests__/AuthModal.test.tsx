/**
 * AuthModal Component Tests
 *
 * Renders the AuthModal component and interacts with its UI
 * using @testing-library/react-native.
 */

// Define __DEV__ global (normally set by Metro/RN bundler)
(global as any).__DEV__ = true;

// Mock useAuth hook with controllable return values
const mockSignInWithGoogle = jest.fn();
const mockSignInWithApple = jest.fn();
const mockSignInWithMockToken = jest.fn();
const mockClearError = jest.fn();

let mockUseAuthReturn: Record<string, unknown> = {};

jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockUseAuthReturn,
}));

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Platform, BackHandler } from 'react-native';
import { AuthModal } from '../AuthModal';

function setAuthDefaults(overrides: Record<string, unknown> = {}) {
  mockUseAuthReturn = {
    signInWithGoogle: mockSignInWithGoogle,
    signInWithApple: mockSignInWithApple,
    signInWithMockToken: mockSignInWithMockToken,
    isSigningIn: false,
    error: null,
    clearError: mockClearError,
    ...overrides,
  };
}

describe('AuthModal', () => {
  const defaultProps = {
    visible: true,
    onClose: jest.fn(),
    onAuthStarting: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    setAuthDefaults();
  });

  describe('rendering', () => {
    it('renders sign-in message with default text', () => {
      const { getByText } = render(<AuthModal {...defaultProps} />);
      expect(getByText('Sign in to continue')).toBeTruthy();
    });

    it('renders custom message when provided', () => {
      const { getByText } = render(
        <AuthModal {...defaultProps} message="Sign in to save this property" />
      );
      expect(getByText('Sign in to save this property')).toBeTruthy();
    });

    it('renders header title', () => {
      const { getByText } = render(<AuthModal {...defaultProps} />);
      expect(getByText('Sign In')).toBeTruthy();
    });

    it('renders Google Sign In button', () => {
      const { getByLabelText, getByText } = render(
        <AuthModal {...defaultProps} />
      );
      expect(getByLabelText('Sign in with Google')).toBeTruthy();
      expect(getByText('Continue with Google')).toBeTruthy();
    });

    it('renders Apple Sign In button on iOS', () => {
      Platform.OS = 'ios';
      const { getByLabelText, getByText } = render(
        <AuthModal {...defaultProps} />
      );
      expect(getByLabelText('Sign in with Apple')).toBeTruthy();
      expect(getByText('Continue with Apple')).toBeTruthy();
    });

    it('does not render Apple Sign In button on Android', () => {
      Platform.OS = 'android';
      const { queryByLabelText } = render(<AuthModal {...defaultProps} />);
      expect(queryByLabelText('Sign in with Apple')).toBeNull();
      // Restore default
      Platform.OS = 'ios';
    });

    it('renders Dev Login button when __DEV__ is true', () => {
      const { getByLabelText, getByText } = render(
        <AuthModal {...defaultProps} />
      );
      expect(getByLabelText('Dev Login')).toBeTruthy();
      expect(getByText('Dev Login')).toBeTruthy();
    });

    it('renders close button', () => {
      const { getByLabelText } = render(<AuthModal {...defaultProps} />);
      expect(getByLabelText('Close')).toBeTruthy();
    });

    it('renders brand elements', () => {
      const { getByText } = render(<AuthModal {...defaultProps} />);
      expect(getByText('HuisHype')).toBeTruthy();
      expect(getByText('Social Real Estate')).toBeTruthy();
    });

    it('returns null when not visible', () => {
      const { queryByText } = render(
        <AuthModal {...defaultProps} visible={false} />
      );
      expect(queryByText('Sign In')).toBeNull();
      expect(queryByText('Continue with Google')).toBeNull();
    });
  });

  describe('Google Sign In', () => {
    it('calls signInWithGoogle when button is pressed', async () => {
      mockSignInWithGoogle.mockResolvedValue(undefined);
      const { getByLabelText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Sign in with Google'));

      await waitFor(() => {
        expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1);
      });
    });

    it('calls onAuthStarting, onSuccess and onClose after successful sign in', async () => {
      mockSignInWithGoogle.mockResolvedValue(undefined);
      const onSuccess = jest.fn();
      const { getByLabelText } = render(
        <AuthModal {...defaultProps} onSuccess={onSuccess} />
      );

      fireEvent.press(getByLabelText('Sign in with Google'));

      expect(defaultProps.onAuthStarting).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
      });
    });

    it('does not call onSuccess when sign in fails', async () => {
      mockSignInWithGoogle.mockRejectedValue(new Error('Sign in failed'));
      const onSuccess = jest.fn();
      const { getByLabelText } = render(
        <AuthModal {...defaultProps} onSuccess={onSuccess} />
      );

      fireEvent.press(getByLabelText('Sign in with Google'));

      expect(defaultProps.onAuthStarting).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        expect(mockSignInWithGoogle).toHaveBeenCalled();
      });
      expect(onSuccess).not.toHaveBeenCalled();
    });
  });

  describe('Apple Sign In', () => {
    it('calls signInWithApple when button is pressed', async () => {
      Platform.OS = 'ios';
      mockSignInWithApple.mockResolvedValue(undefined);
      const { getByLabelText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Sign in with Apple'));

      await waitFor(() => {
        expect(mockSignInWithApple).toHaveBeenCalledTimes(1);
      });
    });

    it('calls onAuthStarting, onSuccess and onClose after successful Apple sign in', async () => {
      Platform.OS = 'ios';
      mockSignInWithApple.mockResolvedValue(undefined);
      const onSuccess = jest.fn();
      const { getByLabelText } = render(
        <AuthModal {...defaultProps} onSuccess={onSuccess} />
      );

      fireEvent.press(getByLabelText('Sign in with Apple'));

      expect(defaultProps.onAuthStarting).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Dev Login', () => {
    it('calls signInWithMockToken with correct token when pressed', async () => {
      mockSignInWithMockToken.mockResolvedValue(undefined);
      const { getByLabelText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Dev Login'));

      await waitFor(() => {
        expect(mockSignInWithMockToken).toHaveBeenCalledWith(
          'mock-google-maestrotest-gid001'
        );
      });
    });

    it('calls onAuthStarting, onSuccess and onClose after successful dev login', async () => {
      mockSignInWithMockToken.mockResolvedValue(undefined);
      const onSuccess = jest.fn();
      const { getByLabelText } = render(
        <AuthModal {...defaultProps} onSuccess={onSuccess} />
      );

      fireEvent.press(getByLabelText('Dev Login'));

      expect(defaultProps.onAuthStarting).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
      });
    });

    it('does not call onSuccess when dev login fails but still calls onAuthStarting', async () => {
      mockSignInWithMockToken.mockRejectedValue(
        new Error('Mock authentication failed')
      );
      const onSuccess = jest.fn();
      const { getByLabelText } = render(
        <AuthModal {...defaultProps} onSuccess={onSuccess} />
      );

      fireEvent.press(getByLabelText('Dev Login'));

      expect(defaultProps.onAuthStarting).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        expect(mockSignInWithMockToken).toHaveBeenCalled();
      });
      expect(onSuccess).not.toHaveBeenCalled();
    });
  });

  describe('close handler', () => {
    it('calls clearError and onClose when close button is pressed', () => {
      const { getByLabelText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Close'));

      expect(mockClearError).toHaveBeenCalledTimes(1);
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onAuthStarting when close button is pressed', () => {
      const { getByLabelText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Close'));

      expect(defaultProps.onAuthStarting).not.toHaveBeenCalled();
    });
  });

  describe('back handler', () => {
    it('registers BackHandler listener when visible', () => {
      render(<AuthModal {...defaultProps} />);
      expect(BackHandler.addEventListener).toHaveBeenCalledWith(
        'hardwareBackPress',
        expect.any(Function)
      );
    });

    it('does not register BackHandler listener when not visible', () => {
      render(<AuthModal {...defaultProps} visible={false} />);
      expect(BackHandler.addEventListener).not.toHaveBeenCalled();
    });

    it('calls handleClose when back button is pressed', () => {
      render(<AuthModal {...defaultProps} />);

      // Get the callback passed to addEventListener
      const callback = (BackHandler.addEventListener as jest.Mock).mock
        .calls[0][1];
      const result = callback();

      expect(result).toBe(true);
      expect(mockClearError).toHaveBeenCalledTimes(1);
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('removes BackHandler listener on unmount', () => {
      const { unmount } = render(<AuthModal {...defaultProps} />);
      // Get the remove function returned by addEventListener mock
      const mockRemove = (BackHandler.addEventListener as jest.Mock).mock
        .results[0].value.remove;
      unmount();
      expect(mockRemove).toHaveBeenCalled();
    });
  });

  describe('error display', () => {
    it('renders error message when error is present', () => {
      setAuthDefaults({ error: new Error('Authentication failed') });
      const { getByText } = render(<AuthModal {...defaultProps} />);
      expect(getByText('Authentication failed')).toBeTruthy();
    });

    it('does not render error message when error is null', () => {
      setAuthDefaults({ error: null });
      const { queryByText } = render(<AuthModal {...defaultProps} />);
      expect(queryByText('Authentication failed')).toBeNull();
    });
  });

  describe('loading state', () => {
    it('disables sign-in buttons when isSigningIn is true', () => {
      setAuthDefaults({ isSigningIn: true });
      const { getByLabelText } = render(<AuthModal {...defaultProps} />);

      const googleBtn = getByLabelText('Sign in with Google');
      expect(googleBtn.props.disabled).toBe(true);
    });

    it('does not show button text when isSigningIn is true', () => {
      setAuthDefaults({ isSigningIn: true });
      const { queryByText } = render(<AuthModal {...defaultProps} />);

      // Google button shows ActivityIndicator instead of text
      expect(queryByText('Continue with Google')).toBeNull();
    });
  });

  describe('backdrop', () => {
    it('calls clearError and onClose when backdrop is pressed', () => {
      const { getByLabelText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Close backdrop'));

      expect(mockClearError).toHaveBeenCalledTimes(1);
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });
  });
});
