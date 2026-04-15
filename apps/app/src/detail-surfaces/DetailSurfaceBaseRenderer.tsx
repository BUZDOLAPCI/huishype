import { Platform, StyleSheet, View } from 'react-native';

import { resolveDetailSurfaceBase } from './detailSurfaceBase';

interface DetailSurfaceBaseRendererProps {
  href: string;
}

export function DetailSurfaceBaseRenderer({
  href,
}: DetailSurfaceBaseRendererProps) {
  const base = resolveDetailSurfaceBase(href);

  if (base.kind === 'map') {
    if (Platform.OS === 'web') {
      const MapScreen =
        require('@/app/(tabs)/index.web').default as typeof import('@/app/(tabs)/index.web').default;
      return <MapScreen pathnameOverride={base.href} />;
    }

    const MapScreen =
      require('@/app/(tabs)/index').default as typeof import('@/app/(tabs)/index').default;
    return <MapScreen />;
  }

  if (base.kind === 'feed') {
    const FeedScreen =
      require('@/app/(tabs)/feed').default as typeof import('@/app/(tabs)/feed').default;
    return (
      <View style={styles.syntheticTabBase}>
        <FeedScreen />
      </View>
    );
  }

  if (base.kind === 'saved') {
    const SavedScreen =
      require('@/app/(tabs)/saved').default as typeof import('@/app/(tabs)/saved').default;
    return (
      <View style={styles.syntheticTabBase}>
        <SavedScreen />
      </View>
    );
  }

  if (base.kind === 'profile') {
    const ProfileScreen =
      require('@/app/(tabs)/profile').default as typeof import('@/app/(tabs)/profile').default;
    return (
      <View style={styles.syntheticTabBase}>
        <ProfileScreen />
      </View>
    );
  }

  if (base.kind === 'notifications') {
    const NotificationsScreen =
      require('@/app/notifications').default as typeof import('@/app/notifications').default;
    return <NotificationsScreen />;
  }

  const LeaderboardScreen =
    require('@/app/leaderboard').default as typeof import('@/app/leaderboard').default;
  return <LeaderboardScreen />;
}

const styles = StyleSheet.create({
  syntheticTabBase: {
    flex: 1,
    paddingBottom: 92,
  },
});
