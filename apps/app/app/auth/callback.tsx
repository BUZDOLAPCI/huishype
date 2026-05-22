import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { useT } from '@/src/i18n';

/**
 * Web auth callback route — handles magic link email verification.
 *
 * When a user clicks the magic link in their email, this page loads with
 * ?emailToken=... in the URL. The AuthProvider's Linking listener picks up
 * the token and verifies it automatically. This route just shows a loading
 * state and redirects to home once auth completes (or shows an error).
 */
export default function AuthCallbackScreen() {
  const { isAuthenticated, isLoading, authError } = useAuthContext();
  const [timedOut, setTimedOut] = useState(false);
  const t = useT();

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
      <View className="flex-1 items-center justify-center bg-surface-card p-8">
        <Text className="text-lg font-semibold text-warm-900 mb-2">
          {authError || t('auth.callback.expired')}
        </Text>
        <Text
          className="text-sm text-primary-600 mt-4"
          onPress={() => router.replace('/')}
        >
          {t('auth.callback.home')}
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center bg-surface-card">
      <ActivityIndicator size="large" />
      <Text className="mt-4 text-warm-600">
        {isLoading ? t('auth.callback.signingIn') : t('auth.callback.verifying')}
      </Text>
    </View>
  );
}
