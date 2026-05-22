import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { useT } from '@/src/i18n';

export default function NotFoundScreen() {
  const t = useT();

  return (
    <>
      <Stack.Screen options={{ title: t('route.notFound.title') }} />
      <View className="flex-1 items-center justify-center p-5 bg-surface-card">
        <Text className="text-xl font-bold text-warm-900">
          {t('route.notFound.message')}
        </Text>

        <Link href="/" className="mt-4 py-4">
          <Text className="text-sm text-primary-600">{t('route.notFound.home')}</Text>
        </Link>
      </View>
    </>
  );
}
