import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { usePublicProfile } from '@/src/hooks/useUserProfile';

function KarmaRankBadge({ title, level }: { title: string; level: number }) {
  const colors = [
    '#9CA3AF', '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444',
  ];
  const color = colors[Math.min(level - 1, colors.length - 1)] || colors[0];

  return (
    <View className="flex-row items-center px-3 py-1 rounded-full" style={{ backgroundColor: `${color}20` }}>
      <FontAwesome name="star" size={12} color={color} />
      <Text className="ml-1 text-xs font-semibold" style={{ color }}>{title}</Text>
    </View>
  );
}

function StatItem({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <View className="items-center flex-1">
      <FontAwesome name={icon as any} size={16} color="#6B7280" />
      <Text className="text-lg font-bold text-gray-900 mt-1">{value}</Text>
      <Text className="text-xs text-gray-500">{label}</Text>
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
        <View className="flex-1 items-center justify-center bg-gray-50">
          <FontAwesome name="user" size={32} color="#2563eb" />
          <Text className="text-gray-500 mt-4">Loading profile...</Text>
        </View>
      </>
    );
  }

  if (isError || !profile) {
    return (
      <>
        <Stack.Screen options={{ title: 'Profile' }} />
        <View className="flex-1 items-center justify-center bg-gray-50 px-6">
          <FontAwesome name="user-times" size={48} color="#9CA3AF" />
          <Text className="text-lg font-semibold text-gray-900 mt-4">User not found</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: profile.displayName }} />
      <ScrollView className="flex-1 bg-gray-50" testID="public-profile-screen">
        {/* Profile Header */}
        <View className="bg-white px-6 py-6 items-center border-b border-gray-100">
          <View className="w-20 h-20 rounded-full bg-blue-100 items-center justify-center mb-3">
            {profile.profilePhotoUrl ? (
              <Text className="text-3xl">👤</Text>
            ) : (
              <FontAwesome name="user" size={32} color="#2563eb" />
            )}
          </View>

          <Text className="text-xl font-bold text-gray-900 mb-1">{profile.displayName}</Text>
          <Text className="text-sm text-gray-400 mb-2">@{profile.handle}</Text>

          <KarmaRankBadge title={profile.karmaRank.title} level={profile.karmaRank.level} />

          <Text className="text-sm text-gray-500 mt-2">{profile.karma} karma</Text>
        </View>

        {/* Stats */}
        <View className="bg-white mt-2 px-6 py-5 flex-row border-b border-gray-100">
          <StatItem label="Guesses" value={profile.guessCount} icon="bullseye" />
          <StatItem label="Comments" value={profile.commentCount} icon="comment" />
        </View>

        {/* Member since */}
        <View className="bg-white mt-2 px-6 py-4">
          <Text className="text-sm text-gray-500">
            Member since {new Date(profile.joinedAt).toLocaleDateString('nl-NL', {
              month: 'long',
              year: 'numeric',
            })}
          </Text>
        </View>
      </ScrollView>
    </>
  );
}
