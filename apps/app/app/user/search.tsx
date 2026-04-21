import { Stack } from 'expo-router';

import { UserSearchScreen } from '@/src/screens/UserSearchScreen';

export default function UserSearchRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Search User' }} />
      <UserSearchScreen />
    </>
  );
}
