/**
 * AuthModal Component
 * Full-screen overlay that appears when authentication is required.
 * Uses an absolutely positioned View instead of React Native's <Modal>
 * so that Maestro (and other accessibility scanners) can detect the content
 * within the primary window's view hierarchy.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  BackHandler,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';

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
 * Authentication overlay with Google and Apple sign-in options.
 * Renders as an absolutely positioned full-screen View (not a Modal)
 * to remain within the same Android window for Maestro accessibility.
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
  message = 'Sign in to continue',
  onSuccess,
  onAuthStarting,
}: AuthModalProps) {
  const {
    signInWithGoogle,
    signInWithApple,
    signInWithMockToken,
    isSigningIn,
    error,
    clearError,
  } = useAuth();

  const [isDevLoggingIn, setIsDevLoggingIn] = useState(false);

  // Slide-up animation for the content sheet
  const translateY = useSharedValue(1000);

  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, {
        duration: 300,
        easing: Easing.out(Easing.ease),
      });
    } else {
      translateY.value = 1000;
    }
  }, [visible, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Handle Android back button
  useEffect(() => {
    if (!visible) return;

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        handleClose();
        return true; // Prevent default back behavior
      }
    );

    return () => subscription.remove();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGoogleSignIn = () => {
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
  };

  const handleAppleSignIn = () => {
    onAuthStarting?.();
    onClose();
    setTimeout(async () => {
      try {
        await signInWithApple();
        onSuccess?.();
      } catch {
        // Error is handled by useAuth
      }
    }, 100);
  };

  const handleDevLogin = () => {
    // Tell parent to unmount the bottom sheet BEFORE the auth state change.
    // signInWithMockToken → storeAuthData → setState({isAuthenticated:true})
    // triggers a synchronous re-render cascade. If PropertyBottomSheet's
    // Reanimated/GestureDetector components are still mounted during that
    // cascade, a NavigationStateContext crash occurs. onAuthStarting lets
    // the parent dismiss the bottom sheet so React flushes the unmount
    // before the auth state change propagates.
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
  };

  const handleClose = () => {
    clearError();
    onClose();
  };

  if (!visible) return null;

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.overlay]}
      testID="auth-modal-overlay"
    >
      {/* Backdrop - semi-transparent black, tappable to close */}
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={handleClose}
        accessibilityLabel="Close backdrop"
      />

      {/* Content sheet - slides up from bottom */}
      <Animated.View style={[styles.sheet, animatedStyle]}>
        <View className="flex-1 bg-white" style={styles.sheetInner}>
          {/* Header */}
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200">
            <TouchableOpacity
              onPress={handleClose}
              className="p-2"
              accessibilityLabel="Close"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={24} color="#374151" />
            </TouchableOpacity>
            <Text className="text-lg font-semibold text-gray-900">Sign In</Text>
            <View className="w-10" />
          </View>

          {/* Content */}
          <View className="flex-1 px-6 pt-8">
            {/* Logo/Brand */}
            <View className="items-center mb-8">
              <View className="w-20 h-20 bg-orange-500 rounded-2xl items-center justify-center mb-4">
                <Text className="text-white text-3xl font-bold">H</Text>
              </View>
              <Text className="text-2xl font-bold text-gray-900">HuisHype</Text>
              <Text className="text-gray-500 mt-1">Social Real Estate</Text>
            </View>

            {/* Message */}
            <Text className="text-center text-gray-600 mb-8 text-base">
              {message}
            </Text>

            {/* Error Message */}
            {error && (
              <View className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <Text className="text-red-700 text-center text-sm">
                  {error.message}
                </Text>
              </View>
            )}

            {/* Sign In Buttons */}
            <View className="space-y-3">
              {/* Google Sign In */}
              <TouchableOpacity
                onPress={handleGoogleSignIn}
                disabled={isSigningIn}
                className="flex-row items-center justify-center bg-white border border-gray-300 rounded-xl py-4 px-6"
                accessibilityLabel="Sign in with Google"
                accessibilityRole="button"
              >
                {isSigningIn ? (
                  <ActivityIndicator size="small" color="#4285F4" />
                ) : (
                  <>
                    <Ionicons name="logo-google" size={20} color="#4285F4" />
                    <Text className="text-gray-700 font-semibold text-base ml-3">
                      Continue with Google
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Apple Sign In (iOS only) */}
              {Platform.OS === 'ios' && (
                <TouchableOpacity
                  onPress={handleAppleSignIn}
                  disabled={isSigningIn}
                  className="flex-row items-center justify-center bg-black rounded-xl py-4 px-6 mt-3"
                  accessibilityLabel="Sign in with Apple"
                  accessibilityRole="button"
                >
                  {isSigningIn ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="logo-apple" size={20} color="#FFFFFF" />
                      <Text className="text-white font-semibold text-base ml-3">
                        Continue with Apple
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

            </View>

            {/* Terms */}
            <Text className="text-center text-gray-400 text-xs mt-8 px-4">
              By continuing, you agree to our{' '}
              <Text className="text-orange-500">Terms of Service</Text> and{' '}
              <Text className="text-orange-500">Privacy Policy</Text>
            </Text>
          </View>

          {/* Bottom spacer for safe area */}
          <View className="h-8" />
        </View>
      </Animated.View>

      {/* Dev Login button — rendered OUTSIDE Animated.View so Android
          accessibility reports correct bounds (Reanimated translateY
          animation causes y2 < y1 in the a11y tree, making buttons
          inside the sheet undiscoverable by Maestro/uiautomator).
          Positioned absolutely to overlap the auth sheet visually. */}
      {__DEV__ && (
        <View style={styles.devLoginContainer}>
          <TouchableOpacity
            onPress={handleDevLogin}
            disabled={isSigningIn || isDevLoggingIn}
            className="flex-row items-center justify-center bg-purple-600 rounded-xl py-4 px-6"
            accessibilityLabel="Dev Login"
            accessibilityRole="button"
            testID="dev-login-button"
          >
            {isDevLoggingIn ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="code-slash" size={20} color="#FFFFFF" />
                <Text className="text-white font-semibold text-base ml-3">
                  Dev Login
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    zIndex: 9999,
    elevation: 9999,
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Take up most of the screen height (page-sheet style)
    height: '90%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  sheetInner: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  devLoginContainer: {
    position: 'absolute',
    left: 24,
    right: 24,
    // Place it visually where the sign-in buttons are (roughly 55% from top)
    // This is inside the modal overlay but outside the Animated.View,
    // so Android accessibility bounds are correct.
    top: '55%',
    zIndex: 10000,
    elevation: 10000,
  },
});

export default AuthModal;
