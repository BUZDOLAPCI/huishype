import React, { useState, useEffect, useCallback } from 'react';

import { useAuth } from '../hooks/useAuth';
import { HuisHypeLogo } from './branding';
import { Icon } from './ui/Icon';
import { BlurContainer } from './ui/BlurContainer';
import { shadows } from '../lib/shadows';
import {
  DEFAULT_AUTH_MODAL_COPY,
  resolveAuthModalCopy,
  type AuthModalCopyInput,
} from '../lib/authModalCopy';

const AUTH_COLORS = {
  bg: '#F4F4F5',
  textMuted: '#71717A',
  border: '#E4E4E7',
  text: '#1A1A1A',
} as const;

const GOLD_50 = '#FFFBEB';
const GOLD_400 = '#F7C948';
const GOLD_500 = '#F5A623';
const GOLD_700 = '#B47712';
const WARM_500 = '#9C958A';
const WARM_700 = '#504A42';
const WARM_900 = '#2D2926';

type AuthView = 'main' | 'email-input' | 'email-sent';

interface AuthModalProps {
  visible: boolean;
  onClose: () => void;
  message?: string;
  copy?: AuthModalCopyInput;
  onSuccess?: () => void;
  onAuthStarting?: () => void;
}

export function AuthModal({
  visible,
  onClose,
  message,
  copy,
  onSuccess,
  onAuthStarting,
}: AuthModalProps) {
  const {
    signInWithGoogle,
    signInWithMockToken,
    requestEmailLink,
    isSigningIn,
    error,
    clearError,
  } = useAuth();

  const [view, setView] = useState<AuthView>('main');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isRequestingEmail, setIsRequestingEmail] = useState(false);

  const resetModalState = useCallback(() => {
    setView('main');
    setEmail('');
    setEmailError(null);
    setIsRequestingEmail(false);
  }, []);

  const handleClose = useCallback(() => {
    clearError();
    onClose();
  }, [clearError, onClose]);

  useEffect(() => {
    if (!visible) {
      resetModalState();
    }
  }, [visible, resetModalState]);

  const resolvedCopy = resolveAuthModalCopy(copy ?? message, DEFAULT_AUTH_MODAL_COPY);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, handleClose]);

  const handleGoogleSignIn = useCallback(() => {
    onAuthStarting?.();
    onClose();
    setTimeout(async () => {
      try {
        await signInWithGoogle();
        onSuccess?.();
      } catch {
        // Error is handled by useAuth
      }
    }, 100);
  }, [signInWithGoogle, onAuthStarting, onClose, onSuccess]);

  const handleDevLogin = useCallback(() => {
    onAuthStarting?.();
    onClose();
    setTimeout(async () => {
      try {
        await signInWithMockToken('mock-google-browser-dev-gid001');
        onSuccess?.();
      } catch {
        // Error is handled by useAuth
      }
    }, 100);
  }, [signInWithMockToken, onAuthStarting, onClose, onSuccess]);

  const handleEmailSubmit = useCallback(async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Please enter a valid email address');
      return;
    }

    setEmailError(null);
    setIsRequestingEmail(true);
    try {
      await requestEmailLink(trimmed);
      setView('email-sent');
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes('RATE_LIMITED') || err.message.includes('Too many')) {
          setEmailError('Too many requests. Please try again later.');
        } else {
          setEmailError(err.message);
        }
      } else {
        setEmailError('Something went wrong. Please try again.');
      }
    } finally {
      setIsRequestingEmail(false);
    }
  }, [email, requestEmailLink]);

  if (!visible) return null;

  const renderMainView = () => (
    <div style={styles.content}>
      <HuisHypeLogo size={72} style={styles.logoContainer} />
      <div style={styles.title}>{DEFAULT_AUTH_MODAL_COPY.title}</div>
      <div style={styles.subtitle}>{resolvedCopy.subtitle}</div>

      {error ? (
        <div style={styles.errorContainer}>
          <div style={styles.errorText}>{error.message}</div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isSigningIn}
        aria-label="Sign in with Google"
        style={{ ...styles.authButton, ...styles.googleButton }}
      >
        {isSigningIn ? (
          <div style={styles.spinner} aria-hidden="true" />
        ) : (
          <>
            <div style={styles.googleG}>G</div>
            <div style={styles.googleText}>Continue with Google</div>
          </>
        )}
      </button>

      <div style={styles.divider}>
        <div style={styles.dividerLine} />
        <div style={styles.dividerText}>or</div>
        <div style={styles.dividerLine} />
      </div>

      <button
        type="button"
        onClick={() => setView('email-input')}
        disabled={isSigningIn}
        aria-label="Continue with email"
        style={styles.emailButton}
      >
        <Icon name="Envelope" size={16} color={GOLD_700} />
        <div style={styles.emailButtonText}>Continue with Email</div>
      </button>
    </div>
  );

  const renderEmailInputView = () => (
    <div style={styles.content}>
      <HuisHypeLogo size={72} style={styles.logoContainer} />
      <div style={styles.title}>Sign in with Email</div>
      <div style={styles.subtitle}>Enter your email and we&apos;ll send you a magic link to sign in.</div>

      <input
        value={email}
        onChange={(event) => {
          setEmail(event.currentTarget.value);
          if (emailError) setEmailError(null);
        }}
        placeholder="your@email.com"
        autoComplete="email"
        inputMode="email"
        aria-label="Email address"
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            void handleEmailSubmit();
          }
        }}
        disabled={isRequestingEmail}
        style={{
          ...styles.emailInput,
          ...(emailError ? styles.emailInputError : null),
        }}
      />

      {emailError ? <div style={styles.emailErrorText}>{emailError}</div> : null}

      <button
        type="button"
        onClick={() => void handleEmailSubmit()}
        disabled={isRequestingEmail || !email.trim()}
        style={styles.sendLinkButton}
      >
        {isRequestingEmail ? 'Sending...' : 'Send Magic Link'}
      </button>

      <button
        type="button"
        onClick={() => {
          setView('main');
          setEmailError(null);
        }}
        style={styles.backLink}
      >
        Back to sign in options
      </button>
    </div>
  );

  const renderEmailSentView = () => (
    <div style={styles.content}>
      <div style={styles.successIconContainer}>
        <Icon name="CheckCircle" size={48} weight="fill" color={GOLD_500} />
      </div>
      <div style={styles.title}>Check your email</div>
      <div style={styles.subtitle}>
        We sent a magic link to{'\n'}
        <span style={styles.emailHighlight}>{email.trim().toLowerCase()}</span>
        {'\n'}Click the link to sign in.
      </div>
      <button
        type="button"
        onClick={() => {
          setView('main');
          setEmail('');
        }}
        style={styles.backLink}
      >
        Use a different method
      </button>
    </div>
  );

  return (
    <div style={styles.overlay} data-testid="auth-modal-overlay">
      <div style={styles.backdropLayer}>
        <BlurContainer
          intensity={92}
          tint="dark"
          style={styles.backdropBlur}
          testID="auth-modal-backdrop-blur"
        />
        <div style={styles.backdropTint} />
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close backdrop"
          style={styles.backdropButton}
        />
      </div>

      <div style={styles.cardWrapper}>
        <div style={{ ...styles.card, ...shadows['auth-glow'] }} data-testid="auth-modal-card">
          <div style={styles.closeRow}>
            <div style={styles.closeRowSpacer} />
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              style={styles.closeButton}
            >
              <Icon name="X" size={18} color={AUTH_COLORS.textMuted} />
            </button>
          </div>

          {view === 'main' ? renderMainView() : null}
          {view === 'email-input' ? renderEmailInputView() : null}
          {view === 'email-sent' ? renderEmailSentView() : null}
        </div>
      </div>

      {__DEV__ ? (
        <div style={{ ...styles.devLoginContainer, bottom: 120 }}>
          <button
            type="button"
            onClick={handleDevLogin}
            disabled={isSigningIn}
            aria-label="Dev Login"
            style={styles.devLoginButton}
            data-testid="dev-login-button"
          >
            {isSigningIn ? <div style={styles.spinner} aria-hidden="true" /> : <Icon name="GearSix" size={20} color="#FFFFFF" />}
            <span style={styles.devLoginText}>Dev Login</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default AuthModal;

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    display: 'grid',
    placeItems: 'center',
  },
  backdropLayer: {
    position: 'absolute',
    inset: 0,
  },
  backdropTint: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(28, 24, 19, 0.62)',
  },
  backdropBlur: {
    position: 'absolute',
    inset: 0,
  },
  backdropButton: {
    position: 'absolute',
    inset: 0,
    border: 'none',
    background: 'transparent',
  },
  cardWrapper: {
    width: '100%',
    maxWidth: 340,
    padding: '0 20px',
    position: 'relative',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingTop: 20,
    paddingBottom: 28,
    paddingLeft: 28,
    paddingRight: 28,
    border: '1px solid rgba(247, 201, 72, 0.16)',
  },
  closeRow: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 4,
  },
  closeRowSpacer: {
    flex: 1,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: AUTH_COLORS.bg,
    display: 'grid',
    placeItems: 'center',
    border: 'none',
    cursor: 'pointer',
  },
  content: {
    display: 'grid',
    justifyItems: 'center',
    gap: 16,
  },
  logoContainer: {
    marginBottom: 4,
  },
  title: {
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 20,
    fontWeight: 600,
    color: WARM_900,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: '20px',
    color: WARM_700,
    textAlign: 'center',
    whiteSpace: 'pre-line',
  },
  errorContainer: {
    backgroundColor: '#FFEBEE',
    border: '1px solid #FFCDD2',
    borderRadius: 10,
    padding: '8px 12px',
    width: '100%',
  },
  errorText: {
    color: '#C62828',
    fontSize: 13,
    textAlign: 'center',
  },
  authButton: {
    height: 52,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    border: 'none',
    cursor: 'pointer',
  },
  googleButton: {
    backgroundColor: '#FFFFFF',
    border: `1px solid ${AUTH_COLORS.border}`,
  },
  googleG: {
    fontFamily: 'sans-serif',
    fontSize: 22,
    fontWeight: 700,
    color: '#4285F4',
    marginRight: 10,
  },
  googleText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    fontWeight: 500,
    color: WARM_700,
  },
  divider: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: AUTH_COLORS.border,
  },
  dividerText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: WARM_500,
  },
  emailButton: {
    height: 44,
    borderRadius: 10,
    backgroundColor: GOLD_50,
    border: `1px solid ${GOLD_400}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    gap: 8,
    cursor: 'pointer',
  },
  emailButtonText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    fontWeight: 500,
    color: GOLD_700,
  },
  emailInput: {
    height: 48,
    borderRadius: 12,
    border: `1px solid ${AUTH_COLORS.border}`,
    backgroundColor: '#FFFFFF',
    padding: '0 16px',
    fontSize: 15,
    color: AUTH_COLORS.text,
    width: '100%',
    boxSizing: 'border-box',
  },
  emailInputError: {
    borderColor: '#E53935',
  },
  emailErrorText: {
    fontSize: 13,
    color: '#E53935',
    textAlign: 'center',
    marginTop: -8,
  },
  sendLinkButton: {
    width: '100%',
    height: 44,
    borderRadius: 10,
    border: 'none',
    backgroundColor: '#F5A623',
    color: '#FFFFFF',
    fontWeight: 600,
    cursor: 'pointer',
  },
  backLink: {
    border: 'none',
    background: 'transparent',
    padding: '4px 0',
    cursor: 'pointer',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: WARM_500,
    textDecoration: 'underline',
  },
  successIconContainer: {
    marginBottom: 4,
  },
  emailHighlight: {
    fontWeight: 600,
    color: WARM_700,
  },
  devLoginContainer: {
    position: 'absolute',
    left: 24,
    right: 24,
    zIndex: 10000,
  },
  devLoginButton: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#7C3AED',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    border: 'none',
    cursor: 'pointer',
    width: '100%',
  },
  devLoginText: {
    color: '#FFFFFF',
    fontWeight: 600,
    fontSize: 15,
  },
  spinner: {
    width: 18,
    height: 18,
    borderRadius: '50%',
    border: '3px solid rgba(255,255,255,0.3)',
    borderTopColor: '#FFFFFF',
    animation: 'runtime-spin 0.8s linear infinite',
  },
} as const;
