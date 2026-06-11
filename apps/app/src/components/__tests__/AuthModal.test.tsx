/**
 * AuthModal Component Tests
 *
 * Renders the AuthModal component and interacts with its UI
 * using @testing-library/react-native.
 */

// Define __DEV__ global (normally set by Metro/RN bundler)
Object.defineProperty(globalThis, '__DEV__', {
  configurable: true,
  value: true,
  writable: true,
});

// Mock useAuth hook with controllable return values
const mockSignInWithGoogle = jest.fn();
const mockSignInWithMockToken = jest.fn();
const mockRequestEmailLink = jest.fn();
const mockVerifyEmailToken = jest.fn();
const mockVerifyEmailCode = jest.fn();
const mockClearError = jest.fn();

let mockUseAuthReturn: Record<string, unknown> = {};

jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockUseAuthReturn,
}));



import React from 'react';
import { render as rtlRender, fireEvent, waitFor, act } from '@testing-library/react-native';
import { BackHandler, Platform } from 'react-native';
import { AuthModal } from '../AuthModal';
import { WebDismissibleLayerProvider } from '../../providers/WebDismissibleLayerProvider';
import { LanguageProvider } from '../../i18n';

const originalPlatform = Platform.OS;

function render(ui: React.ReactElement) {
  return rtlRender(ui, { wrapper: LanguageProvider });
}

function renderWithDismissibleLayer(ui: React.ReactElement) {
  return render(<WebDismissibleLayerProvider>{ui}</WebDismissibleLayerProvider>);
}

function setPlatform(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
}

function setAuthDefaults(overrides: Record<string, unknown> = {}) {
  mockUseAuthReturn = {
    signInWithGoogle: mockSignInWithGoogle,
    signInWithMockToken: mockSignInWithMockToken,
    requestEmailLink: mockRequestEmailLink,
    verifyEmailToken: mockVerifyEmailToken,
    verifyEmailCode: mockVerifyEmailCode,
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

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  describe('rendering', () => {
    it('renders a full-screen blur backdrop behind the modal', () => {
      const { getByTestId } = render(<AuthModal {...defaultProps} />);
      expect(getByTestId('auth-modal-backdrop-blur')).toBeTruthy();
    });

    it('renders welcome title', () => {
      const { getByText } = render(<AuthModal {...defaultProps} />);
      expect(getByText('Welcome to HuisHype')).toBeTruthy();
    });

    it('renders default subtitle when no message provided', () => {
      const { getByText } = render(<AuthModal {...defaultProps} />);
      expect(getByText('Sign in to continue')).toBeTruthy();
    });

    it('renders legacy custom message when provided', () => {
      const { getByText } = render(
        <AuthModal {...defaultProps} message="Sign in to save this property" />
      );
      expect(getByText('Sign in to save this property')).toBeTruthy();
    });

    it('keeps the welcome title and uses contextual copy as the one-line message', () => {
      const { getByText, queryByText } = render(
        <AuthModal
          {...defaultProps}
          copy={{
            title: 'Ignored title',
            subtitle: 'Sign in to submit your guess',
          }}
        />
      );

      expect(getByText('Welcome to HuisHype')).toBeTruthy();
      expect(getByText('Sign in to submit your guess')).toBeTruthy();
      expect(queryByText('Ignored title')).toBeNull();
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

    it('renders the modal card with a dedicated card container', () => {
      const { getByTestId } = render(<AuthModal {...defaultProps} />);
      expect(getByTestId('auth-modal-card')).toBeTruthy();
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

    it('keeps the modal open while Google sign in is still pending', async () => {
      let resolveSignIn: () => void = () => {};
      mockSignInWithGoogle.mockImplementation(
        () => new Promise<void>((resolve) => {
          resolveSignIn = resolve;
        })
      );
      const onSuccess = jest.fn();
      const { getByLabelText } = render(
        <AuthModal {...defaultProps} onSuccess={onSuccess} />
      );

      fireEvent.press(getByLabelText('Sign in with Google'));

      await waitFor(() => {
        expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1);
      });
      expect(defaultProps.onClose).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();

      resolveSignIn?.();

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

  describe('Email sign-in link', () => {
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

      fireEvent.press(getByLabelText('Next'));

      expect(getByText('Please enter a valid email address')).toBeTruthy();
    });

    it('calls requestEmailLink with valid email', async () => {
      mockRequestEmailLink.mockResolvedValue(undefined);
      const { getByLabelText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Continue with email'));

      const input = getByLabelText('Email address');
      fireEvent.changeText(input, 'test@example.com');
      fireEvent.press(getByLabelText('Next'));

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
      fireEvent.press(getByLabelText('Next'));

      await waitFor(() => {
        expect(getByText('Check your email')).toBeTruthy();
        expect(getByText('user@test.com')).toBeTruthy();
      });
    });

    it('renders code input with verify button disabled until 6 digits are present', async () => {
      mockRequestEmailLink.mockResolvedValue(undefined);
      const { getByLabelText, getByTestId } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Continue with email'));
      fireEvent.changeText(getByLabelText('Email address'), 'user@test.com');
      fireEvent.press(getByLabelText('Next'));

      await waitFor(() => {
        expect(getByLabelText('6-digit sign-in code')).toBeTruthy();
      });

      const verifyButton = getByTestId('verify-email-code-button');
      expect(verifyButton.props.accessibilityState?.disabled).toBe(true);

      fireEvent.changeText(getByLabelText('6-digit sign-in code'), '12345');
      expect(verifyButton.props.accessibilityState?.disabled).toBe(true);
      expect(mockVerifyEmailCode).not.toHaveBeenCalled();
    });

    it('normalizes pasted code and auto-submits once 6 digits are present', async () => {
      mockRequestEmailLink.mockResolvedValue(undefined);
      mockVerifyEmailCode.mockResolvedValue(undefined);
      const { getByLabelText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Continue with email'));
      fireEvent.changeText(getByLabelText('Email address'), 'User@Test.com');
      fireEvent.press(getByLabelText('Next'));

      await waitFor(() => {
        expect(getByLabelText('6-digit sign-in code')).toBeTruthy();
      });

      const codeInput = getByLabelText('6-digit sign-in code');
      fireEvent.changeText(codeInput, '123- 456');

      await waitFor(() => {
        expect(mockVerifyEmailCode).toHaveBeenCalledWith('user@test.com', '123456');
      });
      expect(codeInput.props.value).toBe('123456');
    });

    it('shows inline invalid code errors', async () => {
      mockRequestEmailLink.mockResolvedValue(undefined);
      mockVerifyEmailCode.mockRejectedValue(new Error('Invalid or expired code'));
      const { getByLabelText, getByText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Continue with email'));
      fireEvent.changeText(getByLabelText('Email address'), 'user@test.com');
      fireEvent.press(getByLabelText('Next'));

      await waitFor(() => {
        expect(getByLabelText('6-digit sign-in code')).toBeTruthy();
      });

      fireEvent.changeText(getByLabelText('6-digit sign-in code'), '000000');

      await waitFor(() => {
        expect(getByText('That code is invalid. Please try again.')).toBeTruthy();
      });
    });

    it('shows inline expired code errors', async () => {
      mockRequestEmailLink.mockResolvedValue(undefined);
      mockVerifyEmailCode.mockRejectedValue(new Error('Code has expired'));
      const { getByLabelText, getByText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Continue with email'));
      fireEvent.changeText(getByLabelText('Email address'), 'user@test.com');
      fireEvent.press(getByLabelText('Next'));

      await waitFor(() => {
        expect(getByLabelText('6-digit sign-in code')).toBeTruthy();
      });

      fireEvent.changeText(getByLabelText('6-digit sign-in code'), '000000');

      await waitFor(() => {
        expect(getByText('That code has expired. Request a new one.')).toBeTruthy();
      });
    });

    it('shows inline too-many-attempts code errors', async () => {
      mockRequestEmailLink.mockResolvedValue(undefined);
      mockVerifyEmailCode.mockRejectedValue(new Error('Too many attempts'));
      const { getByLabelText, getByText } = render(<AuthModal {...defaultProps} />);

      fireEvent.press(getByLabelText('Continue with email'));
      fireEvent.changeText(getByLabelText('Email address'), 'user@test.com');
      fireEvent.press(getByLabelText('Next'));

      await waitFor(() => {
        expect(getByLabelText('6-digit sign-in code')).toBeTruthy();
      });

      fireEvent.changeText(getByLabelText('6-digit sign-in code'), '000000');

      await waitFor(() => {
        expect(getByText('Too many attempts. Request a new code.')).toBeTruthy();
      });
    });

    it('closes and calls onSuccess after successful code verification', async () => {
      mockRequestEmailLink.mockResolvedValue(undefined);
      mockVerifyEmailCode.mockResolvedValue(undefined);
      const onClose = jest.fn();
      const onSuccess = jest.fn();
      const { getByLabelText } = render(
        <AuthModal
          {...defaultProps}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      );

      fireEvent.press(getByLabelText('Continue with email'));
      fireEvent.changeText(getByLabelText('Email address'), 'user@test.com');
      fireEvent.press(getByLabelText('Next'));

      await waitFor(() => {
        expect(getByLabelText('6-digit sign-in code')).toBeTruthy();
      });

      fireEvent.changeText(getByLabelText('6-digit sign-in code'), '123456');

      await waitFor(() => {
        expect(mockVerifyEmailCode).toHaveBeenCalledWith('user@test.com', '123456');
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
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
      fireEvent.press(getByLabelText('Next'));

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

    it('dismisses on web popstate before route navigation listeners run', () => {
      setPlatform('web');
      const onClose = jest.fn();
      const routeNavigation = jest.fn();
      window.addEventListener('popstate', routeNavigation);

      try {
        renderWithDismissibleLayer(
          <AuthModal {...defaultProps} onClose={onClose} />
        );

        act(() => {
          window.dispatchEvent(new PopStateEvent('popstate'));
        });

        expect(mockClearError).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(routeNavigation).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('popstate', routeNavigation);
      }
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
