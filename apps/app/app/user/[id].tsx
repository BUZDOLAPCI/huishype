import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';

import { Icon } from '@/src/components/ui/Icon';
import { usePublicProfile } from '@/src/hooks/useUserProfile';

function KarmaRankBadge({ title, level }: { title: string; level: number }) {
  const colors = [
    '#C7BFB3', '#F5A623', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444',
  ];
  const color = colors[Math.min(level - 1, colors.length - 1)] || colors[0];

  return (
    <View className="flex-row items-center px-3 py-1 rounded-full" style={{ backgroundColor: `${color}20` }}>
      <Icon name="Star" size="sm" weight="fill" color={color} />
      <Text className="ml-1 text-xs font-semibold" style={{ color }}>{title}</Text>
    </View>
  );
}

function StatItem({ label, value, iconName }: { label: string; value: number; iconName: 'Crosshair' | 'ChatCircle' }) {
  return (
    <View className="items-center flex-1">
      <Icon name={iconName} size="md" color="#9C958A" />
      <Text className="text-lg font-bold text-warm-900 mt-1">{value}</Text>
      <Text className="text-xs text-warm-500">{label}</Text>
    </View>
  );
}

export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: profile, isLoading, isError } = usePublicProfile(id ?? null);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Profile' }} />
        <View className="flex-1 items-center justify-center bg-warm-50">
          <Icon name="User" size={32} color="#DE911D" />
          <Text className="text-warm-500 mt-4">Loading profile...</Text>
        </View>
      </>
    );
  }

  if (isError || !profile) {
    return (
      <>
        <Stack.Screen options={{ title: 'Profile' }} />
        <View className="flex-1 items-center justify-center bg-warm-50 px-6">
          <Icon name="WarningCircle" size={48} color="#C7BFB3" />
          <Text className="text-lg font-semibold text-warm-900 mt-4">User not found</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: profile.displayName }} />
      <ScrollView className="flex-1 bg-warm-50" testID="public-profile-screen">
        {/* Profile Header */}
        <View className="bg-surface-card px-6 py-6 items-center border-b border-warm-100">
          <View className="w-20 h-20 rounded-full bg-primary-100 items-center justify-center mb-3">
            <Icon name="User" size={32} color="#DE911D" />
          </View>

          <Text className="text-xl font-bold text-warm-900 mb-1">{profile.displayName}</Text>
          <Text className="text-sm text-warm-400 mb-2">@{profile.handle}</Text>

          <KarmaRankBadge title={profile.karmaRank.title} level={profile.karmaRank.level} />

          <Text className="text-sm text-warm-500 mt-2">{profile.karma} karma</Text>
        </View>

        {/* Stats */}
        <View className="bg-surface-card mt-2 px-6 py-5 flex-row border-b border-warm-100">
          <StatItem label="Guesses" value={profile.guessCount} iconName="Crosshair" />
          <StatItem label="Comments" value={profile.commentCount} iconName="ChatCircle" />
        </View>

        {/* Member since */}
        <View className="bg-surface-card mt-2 px-6 py-4">
          <Text className="text-sm text-warm-500">
            Member since {new Date(profile.joinedAt).toLocaleDateString(undefined, {
              month: 'long',
              year: 'numeric',
            })}
          </Text>
        </View>
      </ScrollView>
    </>
  );
}
