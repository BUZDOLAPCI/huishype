/**
 * AuthModal Component
 *
 * Centered modal card that appears when authentication is required.
 * Matches the pen design: warm card with gold glow shadow, centered
 * on a dark backdrop.
 *
 * Uses an absolutely positioned View instead of React Native's <Modal>
 * so that Maestro (and other accessibility scanners) can detect the content
 * within the primary window's view hierarchy.
 *
 * Design spec: Section 7.13, 8.6
 */

import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { HuisHypeLogo } from './branding';
import { Icon } from './ui/Icon';
import { shadows } from '../lib/shadows';
import { useReducedMotion } from '../hooks/useReducedMotion';

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

type AuthView = 'main' | 'email-input' | 'email-sent';

interface AuthModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Called when the modal should be closed */
  onClose: () => void;
  /** Optional message explaining why auth is needed */
  message?: string;
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
 *   message="Sign in to save this property"
 *   onSuccess={() => saveProperty()}
 * />
 * ```
 */
export function AuthModal({
  visible,
  onClose,
  message,
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
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();

  // Card entrance animation
  const scale = useSharedValue(0.9);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      if (reducedMotion) {
        // Skip animation — instant show
        opacity.value = 1;
        scale.value = 1;
      } else {
        opacity.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) });
        scale.value = withSpring(1, { damping: 20, stiffness: 300 });
      }
    } else {
      opacity.value = 0;
      scale.value = 0.9;
      // Reset state when closing
      setView('main');
      setEmail('');
      setEmailError(null);
      setIsRequestingEmail(false);
    }
  }, [visible, opacity, scale, reducedMotion]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

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
        await signInWithMockToken('mock-google-maestrotest-gid001');
        onSuccess?.();
      } catch {
        // Error is handled by useAuth
      }
    }, 100);
  }, [signInWithMockToken, onAuthStarting, onClose, onSuccess]);

  const handleEmailSubmit = useCallback(async () => {
    const trimmed = email.trim().toLowerCase();
    // Basic email validation
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

  const handleClose = useCallback(() => {
    clearError();
    try { Keyboard.dismiss(); } catch { /* Keyboard not available in test env */ }
    onClose();
  }, [clearError, onClose]);

  if (!visible) return null;

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.overlay]}
      testID="auth-modal-overlay"
    >
      {/* Backdrop — warm-900 at 75% */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={handleClose}
          accessibilityLabel="Close backdrop"
        />
      </Animated.View>

      {/* Centered card */}
      <Animated.View style={[styles.cardWrapper, cardStyle]}>
        <View style={[styles.card, shadows['auth-glow']]} className="shadow-auth-glow">
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
  );

  // ── View renderers ────────────────────────────────────────

  function renderMainView() {
    return (
      <View style={styles.content}>
        <HuisHypeLogo size={72} style={styles.logoContainer} />

        {/* Title */}
        <Text style={styles.title}>Welcome to HuisHype</Text>

        {/* Subtitle */}
        <Text style={styles.subtitle}>
          {message || 'Sign in to save properties, guess prices, and join the conversation'}
        </Text>

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
        <TouchableOpacity
          onPress={handleEmailSubmit}
          disabled={isRequestingEmail || !email.trim()}
          style={[
            styles.sendLinkButton,
            (!email.trim() || isRequestingEmail) && styles.sendLinkButtonDisabled,
          ]}
          accessibilityLabel="Send magic link"
          accessibilityRole="button"
          testID="send-magic-link-button"
        >
          {isRequestingEmail ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.sendLinkText}>Send Magic Link</Text>
          )}
        </TouchableOpacity>

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
    zIndex: 9999,
    elevation: 9999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    backgroundColor: '#2D2926BF', // warm-900 at 75%
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
    height: 48,
    borderRadius: 12,
    backgroundColor: GOLD_700, // gold-700 — AA contrast with white text
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  sendLinkButtonDisabled: {
    opacity: 0.5,
  },
  sendLinkText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
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
