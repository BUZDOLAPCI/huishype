import { Stack } from 'expo-router';

import { UserSearchScreen } from '@/src/screens/UserSearchScreen';
import { useT } from '@/src/i18n';

export default function UserSearchRoute() {
  const t = useT();

  return (
    <>
      <Stack.Screen options={{ headerShown: false, title: t('profile.searchUser') }} />
      <UserSearchScreen />
    </>
  );
}
