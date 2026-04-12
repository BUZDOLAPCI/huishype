import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthContext } from '@/src/providers/AuthProvider';

/**
 * Web auth callback route — handles magic link email verification.
 *
 * When a user clicks the magic link in their email, this page loads with
 * ?emailToken=... in the URL. The AuthProvider's Linking listener picks up
 * the token and verifies it automatically. This route just shows a loading
 * state and redirects to home once auth completes (or shows an error).
 */
export default function AuthCallbackScreen() {
  const { emailToken } = useLocalSearchParams<{ emailToken?: string | string[] }>();
  const { isAuthenticated, isLoading, authError, verifyEmailToken } = useAuthContext();
  const [timedOut, setTimedOut] = useState(false);
  const verifiedTokenRef = useRef<string | null>(null);

  const resolvedEmailToken = Array.isArray(emailToken) ? emailToken[0] : emailToken;

  useEffect(() => {
    if (
      !resolvedEmailToken ||
      isAuthenticated ||
      isLoading ||
      verifiedTokenRef.current === resolvedEmailToken
    ) {
      return;
    }

    verifiedTokenRef.current = resolvedEmailToken;
    void verifyEmailToken(resolvedEmailToken).catch(() => {});
  }, [isAuthenticated, isLoading, resolvedEmailToken, verifyEmailToken]);

  // Redirect to home once authenticated
  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/');
    }
  }, [isAuthenticated]);

  // Timeout after 15s — fallback for genuinely hanging requests
  useEffect(() => {
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, 15_000);
    return () => clearTimeout(timer);
  }, []);

  // Show error immediately when verification fails
  if ((authError || timedOut) && !isAuthenticated) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-card p-8" testID="auth-callback-error">
        <Text className="text-lg font-semibold text-warm-900 mb-2">
          {authError || 'Invalid or expired link'}
        </Text>
        <Text
          className="text-sm text-primary-600 mt-4"
          onPress={() => router.replace('/')}
          testID="auth-callback-home-link"
        >
          Go to home screen
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center bg-surface-card" testID="auth-callback-loading">
      <ActivityIndicator size="large" />
      <Text className="mt-4 text-warm-600">
        {isLoading ? 'Signing you in...' : 'Verifying your link...'}
      </Text>
    </View>
  );
}
