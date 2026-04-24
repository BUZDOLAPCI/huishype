/**
 * AuthModal Component
 *
 * Centered modal card that appears when authentication is required.
 * Matches the pen design: warm card with gold glow shadow, centered
 * on a dark backdrop.
 *
 * Uses React Native's <Modal> so the overlay escapes the screen subtree and
 * covers the full app window, including floating headers/tab bars.
 *
 * Design spec: Section 7.13, 8.6
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  BackHandler,
  TextInput,
  Keyboard,
  Modal,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { HuisHypeLogo } from './branding';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';
import { BlurContainer } from './ui/BlurContainer';
import { shadows } from '../lib/shadows';
import { useReducedMotion } from '../hooks/useReducedMotion';
import {
  DEFAULT_AUTH_MODAL_COPY,
  resolveAuthModalCopy,
  type AuthModalCopyInput,
} from '../lib/authModalCopy';

// ── Auth modal cool grays (Section 1.6) ─────────────────────
// Scoped to this component only — intentionally NOT in global theme.
const AUTH_COLORS = {
  bg: '#F4F4F5',
  textMuted: '#71717A',
  border: '#E4E4E7',
  text: '#1A1A1A',
} as const;

// ── Brand colors ────────────────────────────────────────────
const GOLD_50 = '#FFFBEB';
const GOLD_400 = '#F7C948';
const GOLD_500 = '#F5A623';
const GOLD_700 = '#B47712';
const WARM_500 = '#9C958A';
const WARM_700 = '#504A42';
const WARM_900 = '#2D2926';
const CARD_ENTER_OFFSET_Y = 12;
const CARD_EXIT_OFFSET_Y = 8;
const CARD_ENTER_SCALE = 0.985;
const CARD_EXIT_SCALE = 0.99;
const BACKDROP_ENTER_DURATION = 150;
const CARD_ENTER_DURATION = 180;
const CARD_EXIT_DURATION = 120;

type AuthView = 'main' | 'email-input' | 'email-sent';

interface AuthModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Called when the modal should be closed */
  onClose: () => void;
  /** Optional contextual one-line message explaining why auth is needed */
  message?: string;
  /** Optional contextual copy; only the one-line subtitle is shown in the main auth view */
  copy?: AuthModalCopyInput;
  /** Called after successful authentication */
  onSuccess?: () => void;
  /** Called right before auth sign-in starts (user clicked a sign-in button, not cancel) */
  onAuthStarting?: () => void;
}

/**
 * Authentication modal with Google and Email sign-in options.
 * Renders as a centered card on a dark backdrop.
 *
 * @example
 * ```tsx
 * <AuthModal
 *   visible={showAuth}
 *   onClose={() => setShowAuth(false)}
 *   copy="Sign in to save this property"
 *   onSuccess={() => saveProperty()}
 * />
 * ```
 */
export function AuthModal({
  visible,
  onClose,
  message,
  copy,
  onSuccess,
  onAuthStarting,
}: AuthModalProps) {
  const {
    isAuthenticated,
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
  const [isMounted, setIsMounted] = useState(visible);
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const visibleRef = useRef(visible);
  const authAttemptStartedRef = useRef(false);
  const successHandledRef = useRef(false);

  // Card entrance animation
  const scale = useSharedValue(visible ? 1 : CARD_ENTER_SCALE);
  const opacity = useSharedValue(visible ? 1 : 0);
  const translateY = useSharedValue(visible ? 0 : CARD_ENTER_OFFSET_Y);

  const resetModalState = useCallback(() => {
    setView('main');
    setEmail('');
    setEmailError(null);
    setIsRequestingEmail(false);
  }, []);

  useEffect(() => {
    if (!visible && !isMounted) {
      return;
    }

    if (visible) {
      visibleRef.current = true;
      if (!isMounted) {
        setIsMounted(true);
      }
      if (reducedMotion) {
        // Skip animation — instant show
        opacity.value = 1;
        scale.value = 1;
        translateY.value = 0;
      } else {
        opacity.value = withTiming(1, {
          duration: BACKDROP_ENTER_DURATION,
          easing: Easing.out(Easing.cubic),
        });
        scale.value = withTiming(1, {
          duration: CARD_ENTER_DURATION,
          easing: Easing.out(Easing.cubic),
        });
        translateY.value = withTiming(0, {
          duration: CARD_ENTER_DURATION,
          easing: Easing.out(Easing.cubic),
        });
      }
    } else {
      visibleRef.current = false;
      if (reducedMotion) {
        opacity.value = 0;
        scale.value = CARD_ENTER_SCALE;
        translateY.value = CARD_ENTER_OFFSET_Y;
        resetModalState();
        setIsMounted(false);
        return;
      }

      opacity.value = withTiming(0, {
        duration: CARD_EXIT_DURATION,
        easing: Easing.in(Easing.quad),
      });
      scale.value = withTiming(CARD_EXIT_SCALE, {
        duration: CARD_EXIT_DURATION,
        easing: Easing.in(Easing.quad),
      });
      translateY.value = withTiming(CARD_EXIT_OFFSET_Y, {
        duration: CARD_EXIT_DURATION,
        easing: Easing.in(Easing.quad),
      });

      const finishHide = () => {
        if (visibleRef.current) {
          return;
        }
        resetModalState();
        setIsMounted(false);
      };

      opacity.value = withTiming(
        0,
        {
          duration: CARD_EXIT_DURATION,
          easing: Easing.in(Easing.quad),
        },
        (finished) => {
          if (finished) {
            runOnJS(finishHide)();
          }
        }
      );
    }
  }, [
    visible,
    opacity,
    scale,
    translateY,
    reducedMotion,
    isMounted,
    resetModalState,
  ]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));
  const resolvedCopy = resolveAuthModalCopy(copy ?? message, DEFAULT_AUTH_MODAL_COPY);

  const completeSuccessfulAuth = useCallback(() => {
    if (successHandledRef.current) {
      return;
    }
    successHandledRef.current = true;
    onSuccess?.();
    onClose();
  }, [onClose, onSuccess]);

  useEffect(() => {
    if (visible && authAttemptStartedRef.current && isAuthenticated) {
      completeSuccessfulAuth();
    }
  }, [completeSuccessfulAuth, isAuthenticated, visible]);

  useEffect(() => {
    if (!visible) {
      authAttemptStartedRef.current = false;
      successHandledRef.current = false;
    }
  }, [visible]);

  // Handle Android back button
  useEffect(() => {
    if (!visible) return;

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        handleClose();
        return true;
      }
    );

    return () => subscription.remove();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGoogleSignIn = useCallback(() => {
    authAttemptStartedRef.current = true;
    successHandledRef.current = false;
    onAuthStarting?.();
    void (async () => {
      try {
        await signInWithGoogle();
        completeSuccessfulAuth();
      } catch {
        authAttemptStartedRef.current = false;
        successHandledRef.current = false;
        // Error is handled by useAuth
      }
    })();
  }, [completeSuccessfulAuth, signInWithGoogle, onAuthStarting]);

  const handleDevLogin = useCallback(() => {
    authAttemptStartedRef.current = true;
    successHandledRef.current = false;
    onAuthStarting?.();
    void (async () => {
      try {
        await signInWithMockToken('mock-google-maestrotest-gid001');
        completeSuccessfulAuth();
      } catch {
        authAttemptStartedRef.current = false;
        successHandledRef.current = false;
        // Error is handled by useAuth
      }
    })();
  }, [completeSuccessfulAuth, signInWithMockToken, onAuthStarting]);

  const handleEmailSubmit = useCallback(async () => {
    const trimmed = email.trim().toLowerCase();
    // Basic email validation
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Please enter a valid email address');
      return;
    }
    setEmailError(null);
    setIsRequestingEmail(true);
    authAttemptStartedRef.current = true;
    successHandledRef.current = false;
    onAuthStarting?.();
    try {
      await requestEmailLink(trimmed);
      setView('email-sent');
    } catch (err) {
      authAttemptStartedRef.current = false;
      successHandledRef.current = false;
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
  }, [email, onAuthStarting, requestEmailLink]);

  const handleClose = useCallback(() => {
    clearError();
    try { Keyboard.dismiss(); } catch { /* Keyboard not available in test env */ }
    onClose();
  }, [clearError, onClose]);

  if (!isMounted) return null;

  return (
    <Modal
      visible={isMounted}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent={Platform.OS === 'android'}
      onRequestClose={handleClose}
    >
      <View style={styles.overlay} testID="auth-modal-overlay">
        {/* Backdrop — blur + warm dark tint across the full screen */}
        <Animated.View style={[StyleSheet.absoluteFillObject, backdropStyle]}>
          <BlurContainer
            intensity={Platform.OS === 'web' ? 92 : 84}
            tint="dark"
            style={styles.backdropBlur}
            testID="auth-modal-backdrop-blur"
          />
          <View style={[StyleSheet.absoluteFillObject, styles.backdropTint]} />
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={handleClose}
            accessibilityLabel="Close backdrop"
          />
        </Animated.View>

        {/* Centered card */}
        <Animated.View style={[styles.cardWrapper, cardStyle]}>
          <View
            style={[styles.card, shadows['auth-glow']]}
            className="shadow-auth-glow"
            testID="auth-modal-card"
          >
            {/* Close button — top right, cool gray circle */}
            <View style={styles.closeRow}>
              <View style={styles.closeRowSpacer} />
              <TouchableOpacity
                onPress={handleClose}
                style={styles.closeButton}
                accessibilityLabel="Close"
                accessibilityRole="button"
              >
                <Icon name="X" size={18} color={AUTH_COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            {view === 'main' && renderMainView()}
            {view === 'email-input' && renderEmailInputView()}
            {view === 'email-sent' && renderEmailSentView()}
          </View>
        </Animated.View>

        {/* Dev Login button — rendered OUTSIDE Animated.View so Android
            accessibility reports correct bounds */}
        {__DEV__ && (
          <View
            style={[
              styles.devLoginContainer,
              { bottom: Math.max(insets.bottom + 96, 120) },
            ]}
          >
            <TouchableOpacity
              onPress={handleDevLogin}
              disabled={isSigningIn}
              style={styles.devLoginButton}
              accessibilityLabel="Dev Login"
              accessibilityRole="button"
              testID="dev-login-button"
            >
              {isSigningIn ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Icon name="GearSix" size={20} color="#FFFFFF" />
                  <Text style={styles.devLoginText}>Dev Login</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );

  // ── View renderers ────────────────────────────────────────

  function renderMainView() {
    return (
      <View style={styles.content}>
        <HuisHypeLogo size={72} style={styles.logoContainer} />

        {/* Title */}
        <Text style={styles.title}>{DEFAULT_AUTH_MODAL_COPY.title}</Text>

        {/* Context message */}
        <Text style={styles.subtitle}>{resolvedCopy.subtitle}</Text>

        {/* Error */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error.message}</Text>
          </View>
        )}

        {/* Google button — white with cool gray border */}
        <TouchableOpacity
          onPress={handleGoogleSignIn}
          disabled={isSigningIn}
          style={[styles.authButton, styles.googleButton]}
          accessibilityLabel="Sign in with Google"
          accessibilityRole="button"
        >
          {isSigningIn ? (
            <ActivityIndicator size="small" color="#4285F4" />
          ) : (
            <>
              <Text style={styles.googleG}>G</Text>
              <Text style={styles.googleText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Divider — "or" */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Email button — gold-50 fill, gold border */}
        <TouchableOpacity
          onPress={() => setView('email-input')}
          disabled={isSigningIn}
          style={[styles.emailButton]}
          accessibilityLabel="Continue with email"
          accessibilityRole="button"
        >
          <Icon name="Envelope" size={16} color={GOLD_700} />
          <Text style={styles.emailButtonText}>Continue with Email</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderEmailInputView() {
    return (
      <View style={styles.content}>
        <HuisHypeLogo size={72} style={styles.logoContainer} />

        <Text style={styles.title}>Sign in with Email</Text>
        <Text style={styles.subtitle}>
          Enter your email and we&apos;ll send you a magic link to sign in.
        </Text>

        {/* Email input */}
        <TextInput
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            if (emailError) setEmailError(null);
          }}
          placeholder="your@email.com"
          placeholderTextColor={WARM_500}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          style={[
            styles.emailInput,
            emailError ? styles.emailInputError : null,
          ]}
          testID="email-input"
          accessibilityLabel="Email address"
          onSubmitEditing={handleEmailSubmit}
          returnKeyType="send"
          editable={!isRequestingEmail}
        />

        {emailError && (
          <Text style={styles.emailErrorText}>{emailError}</Text>
        )}

        {/* Send magic link button */}
        <Button
          label={isRequestingEmail ? 'Sending...' : 'Send Magic Link'}
          onPress={handleEmailSubmit}
          disabled={isRequestingEmail || !email.trim()}
          accessibilityLabel="Send magic link"
          style={styles.sendLinkButton}
          testID="send-magic-link-button"
        />

        {/* Back to main */}
        <TouchableOpacity
          onPress={() => {
            setView('main');
            setEmailError(null);
          }}
          style={styles.backLink}
          accessibilityLabel="Back to sign in options"
          accessibilityRole="button"
        >
          <Text style={styles.backLinkText}>Back to sign in options</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderEmailSentView() {
    return (
      <View style={styles.content}>
        {/* Success icon */}
        <View style={styles.successIconContainer}>
          <Icon name="CheckCircle" size={48} weight="fill" color={GOLD_500} />
        </View>

        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.subtitle}>
          We sent a magic link to{'\n'}
          <Text style={styles.emailHighlight}>{email.trim().toLowerCase()}</Text>
          {'\n'}Click the link to sign in.
        </Text>

        {/* Back to main */}
        <TouchableOpacity
          onPress={() => {
            setView('main');
            setEmail('');
          }}
          style={styles.backLink}
          accessibilityLabel="Back to sign in options"
          accessibilityRole="button"
        >
          <Text style={styles.backLinkText}>Use a different method</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

export default AuthModal;

// ── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    zIndex: 9999,
    elevation: 9999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdropTint: {
    backgroundColor: 'rgba(28, 24, 19, 0.62)',
  },
  backdropBlur: {
    ...StyleSheet.absoluteFillObject,
  },
  cardWrapper: {
    width: '100%',
    maxWidth: 340,
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingTop: 20,
    paddingBottom: 28,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: 'rgba(247, 201, 72, 0.16)',
  },
  closeRow: {
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
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Content ──────────────────────────────────────────────
  content: {
    alignItems: 'center',
    gap: 16,
  },
  logoContainer: {
    marginBottom: 4,
  },
  title: {
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 20,
    fontWeight: '600',
    color: WARM_900,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: WARM_700, // warm-700 — AA contrast on white (6.7:1)
    textAlign: 'center',
  },

  // ── Error ────────────────────────────────────────────────
  errorContainer: {
    backgroundColor: '#FFEBEE',
    borderWidth: 1,
    borderColor: '#FFCDD2',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: '100%',
  },
  errorText: {
    color: '#C62828',
    fontSize: 13,
    textAlign: 'center',
  },

  // ── Auth buttons ─────────────────────────────────────────
  authButton: {
    height: 52,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  googleButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: AUTH_COLORS.border,
  },
  googleG: {
    fontFamily: Platform.OS === 'web' ? 'sans-serif' : undefined,
    fontSize: 22,
    fontWeight: '700',
    color: '#4285F4',
    marginRight: 10,
  },
  googleText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    fontWeight: '500',
    color: WARM_700,
  },
  // ── Divider ──────────────────────────────────────────────
  divider: {
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

  // ── Email button ─────────────────────────────────────────
  emailButton: {
    height: 44,
    borderRadius: 10,
    backgroundColor: GOLD_50,
    borderWidth: 1,
    borderColor: GOLD_400,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    gap: 8,
  },
  emailButtonText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    fontWeight: '500',
    color: GOLD_700,
  },

  // ── Email input view ─────────────────────────────────────
  emailInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AUTH_COLORS.border,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    fontSize: 15,
    color: AUTH_COLORS.text,
    width: '100%',
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
  },
  backLink: {
    paddingVertical: 4,
  },
  backLinkText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: WARM_500,
    textDecorationLine: 'underline',
  },

  // ── Email sent view ──────────────────────────────────────
  successIconContainer: {
    marginBottom: 4,
  },
  emailHighlight: {
    fontWeight: '600',
    color: WARM_700,
  },

  // ── Dev login ────────────────────────────────────────────
  devLoginContainer: {
    position: 'absolute',
    left: 24,
    right: 24,
    zIndex: 10000,
    elevation: 10000,
  },
  devLoginButton: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#7C3AED', // purple-600
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  devLoginText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
});
