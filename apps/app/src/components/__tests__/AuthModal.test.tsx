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
const mockSignInWithMockToken = jest.fn();
const mockRequestEmailLink = jest.fn();
const mockVerifyEmailToken = jest.fn();
const mockClearError = jest.fn();

let mockUseAuthReturn: Record<string, unknown> = {};

jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockUseAuthReturn,
}));



import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { AuthModal } from '../AuthModal';

function setAuthDefaults(overrides: Record<string, unknown> = {}) {
  mockUseAuthReturn = {
    signInWithGoogle: mockSignInWithGoogle,
    signInWithMockToken: mockSignInWithMockToken,
    requestEmailLink: mockRequestEmailLink,
    verifyEmailToken: mockVerifyEmailToken,
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
    it('renders welcome title', () => {
      const { getByText } = render(<AuthModal {...defaultProps} />);
      expect(getByText('Welcome to HuisHype')).toBeTruthy();
    });

    it('renders default subtitle when no message provided', () => {
      const { getByText } = render(<AuthModal {...defaultProps} />);
      expect(
        getByText('Sign in to save properties, guess prices, and join the conversation')
      ).toBeTruthy();
    });

    it('renders custom message when provided', () => {
      const { getByText } = render(
        <AuthModal {...defaultProps} message="Sign in to save this property" />
      );
      expect(getByText('Sign in to save this property')).toBeTruthy();
    });

    it('renders Google Sign In button', () => {
      const { getByLabelText, getByText } = render(
        <AuthModal {...defaultProps} />
      );
      expect(getByLabelText('Sign in with Google')).toBeTruthy();
      expect(getByText('Continue with Google')).toBeTruthy();
    });

    it('renders Email button', () => {
      const { getByLabelText, getByText } = render(
        <AuthModal {...defaultProps} />
      );
      expect(getByLabelText('Continue with email')).toBeTruthy();
      expect(getByText('Continue with Email')).toBeTruthy();
    });

    it('does not render Apple Sign In button', () => {
      const { queryByText, queryByLabelText } = render(
        <AuthModal {...defaultProps} />
      );
      expect(queryByText('Continue with Apple')).toBeNull();
      expect(queryByLabelText('Sign in with Apple')).toBeNull();
    });

    it('renders "or" divider', () => {
      const { getByText } = render(<AuthModal {...defaultProps} />);
      expect(getByText('or')).toBeTruthy();
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

    it('returns null when not visible', () => {
      const { queryByText } = render(
        <AuthModal {...defaultProps} visible={false} />
      );
      expect(queryByText('Welcome to HuisHype')).toBeNull();
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

  describe('Email magic link', () => {
    it('navigates to email input view when email button is pressed', () => {
      const { getByLabelText, getByText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Continue with email'));

      expect(getByText('Sign in with Email')).toBeTruthy();
      expect(getByLabelText('Email address')).toBeTruthy();
    });

    it('shows validation error for invalid email', async () => {
      const { getByLabelText, getByText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Continue with email'));

      const input = getByLabelText('Email address');
      fireEvent.changeText(input, 'not-an-email');

      fireEvent.press(getByLabelText('Send magic link'));

      expect(getByText('Please enter a valid email address')).toBeTruthy();
    });

    it('calls requestEmailLink with valid email', async () => {
      mockRequestEmailLink.mockResolvedValue(undefined);
      const { getByLabelText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Continue with email'));

      const input = getByLabelText('Email address');
      fireEvent.changeText(input, 'test@example.com');
      fireEvent.press(getByLabelText('Send magic link'));

      await waitFor(() => {
        expect(mockRequestEmailLink).toHaveBeenCalledWith('test@example.com');
      });
    });

    it('shows email sent confirmation view after successful request', async () => {
      mockRequestEmailLink.mockResolvedValue(undefined);
      const { getByLabelText, getByText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Continue with email'));

      const input = getByLabelText('Email address');
      fireEvent.changeText(input, 'user@test.com');
      fireEvent.press(getByLabelText('Send magic link'));

      await waitFor(() => {
        expect(getByText('Check your email')).toBeTruthy();
        expect(getByText('user@test.com')).toBeTruthy();
      });
    });

    it('shows rate limit error', async () => {
      mockRequestEmailLink.mockRejectedValue(
        new Error('Too many requests. Please try again later.')
      );
      const { getByLabelText, getByText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Continue with email'));

      const input = getByLabelText('Email address');
      fireEvent.changeText(input, 'test@example.com');
      fireEvent.press(getByLabelText('Send magic link'));

      await waitFor(() => {
        expect(
          getByText('Too many requests. Please try again later.')
        ).toBeTruthy();
      });
    });

    it('navigates back from email input to main view', () => {
      const { getByLabelText, getByText, queryByText } = render(
        <AuthModal {...defaultProps} />
      );

      fireEvent.press(getByLabelText('Continue with email'));
      expect(getByText('Sign in with Email')).toBeTruthy();

      fireEvent.press(getByLabelText('Back to sign in options'));
      expect(queryByText('Sign in with Email')).toBeNull();
      expect(getByText('Welcome to HuisHype')).toBeTruthy();
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
