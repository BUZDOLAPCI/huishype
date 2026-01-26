/**
 * AuthModal Component
 * Modal that appears when authentication is required
 * Shows Google and Apple Sign-In options
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Platform,
  ActivityIndicator,
} from 'react-native';
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
}

/**
 * Authentication modal with Google and Apple sign-in options
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
}: AuthModalProps) {
  const {
    signInWithGoogle,
    signInWithApple,
    isSigningIn,
    error,
    clearError,
  } = useAuth();

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle();
      onSuccess?.();
      onClose();
    } catch {
      // Error is handled by useAuth
    }
  };

  const handleAppleSignIn = async () => {
    try {
      await signInWithApple();
      onSuccess?.();
      onClose();
    } catch {
      // Error is handled by useAuth
    }
  };

  const handleClose = () => {
    clearError();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View className="flex-1 bg-white">
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
    </Modal>
  );
}

export default AuthModal;
