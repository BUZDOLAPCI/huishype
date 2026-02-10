import { Pressable, ScrollView, Text, TextInput, View, Alert, RefreshControl } from 'react-native';
import { useState, useCallback, useMemo } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import { useAuthContext } from '@/src/providers/AuthProvider';
import { useMyProfile, useUpdateProfile, useMyGuesses } from '@/src/hooks/useUserProfile';

function KarmaRankBadge({ title, level }: { title: string; level: number }) {
  const colors = [
    '#9CA3AF', // level 1 - gray
    '#3B82F6', // level 2 - blue
    '#10B981', // level 3 - green
    '#8B5CF6', // level 4 - purple
    '#F59E0B', // level 5 - amber
    '#EF4444', // level 6 - red
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

function GuessOutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome || outcome === 'pending') {
    return (
      <View className="bg-gray-100 px-2 py-0.5 rounded">
        <Text className="text-xs text-gray-500">Pending</Text>
      </View>
    );
  }
  const config = {
    accurate: { bg: 'bg-green-100', text: 'text-green-700', label: 'Accurate' },
    close: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Close' },
    inaccurate: { bg: 'bg-red-100', text: 'text-red-700', label: 'Inaccurate' },
  } as const;
  const c = config[outcome as keyof typeof config] || config.inaccurate;
  return (
    <View className={`${c.bg} px-2 py-0.5 rounded`}>
      <Text className={`text-xs ${c.text}`}>{c.label}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, signOut } = useAuthContext();
  const { data: profile, isLoading, refetch } = useMyProfile();
  const updateProfile = useUpdateProfile();
  const { data: guessHistory } = useMyGuesses(10, 0);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const canChangeName = useMemo(() => {
    if (!profile?.lastNameChangeAt) return true;
    const cooldownEnd = new Date(profile.lastNameChangeAt);
    cooldownEnd.setDate(cooldownEnd.getDate() + 30);
    return new Date() >= cooldownEnd;
  }, [profile?.lastNameChangeAt]);

  const nextNameChangeDate = useMemo(() => {
    if (!profile?.lastNameChangeAt) return null;
    const cooldownEnd = new Date(profile.lastNameChangeAt);
    cooldownEnd.setDate(cooldownEnd.getDate() + 30);
    if (new Date() >= cooldownEnd) return null;
    return cooldownEnd.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
  }, [profile?.lastNameChangeAt]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  const handleStartEdit = useCallback(() => {
    if (!canChangeName) {
      Alert.alert(
        'Name Change Cooldown',
        `You can change your display name again on ${nextNameChangeDate}.`
      );
      return;
    }
    setEditName(profile?.displayName || '');
    setIsEditing(true);
  }, [canChangeName, nextNameChangeDate, profile?.displayName]);

  const handleSaveEdit = useCallback(async () => {
    if (editName.length < 2 || editName.length > 50) {
      Alert.alert('Invalid Name', 'Display name must be between 2 and 50 characters.');
      return;
    }
    try {
      await updateProfile.mutateAsync({ displayName: editName });
      setIsEditing(false);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update name');
    }
  }, [editName, updateProfile]);

  const handleLogout = useCallback(async () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => signOut(),
      },
    ]);
  }, [signOut]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('nl-NL', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(price);
  };

  // Not logged in
  if (!user) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-6" testID="profile-auth-required" pointerEvents="box-none">
        <View className="bg-blue-100 p-5 rounded-full mb-4">
          <FontAwesome name="user" size={48} color="#2563eb" />
        </View>
        <Text className="text-lg font-semibold text-gray-900 text-center mb-2">
          Sign in to see your profile
        </Text>
        <Text className="text-gray-500 text-center">
          Track your guess history, karma, and saved properties.
        </Text>
      </View>
    );
  }

  // Loading
  if (isLoading && !profile) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50" testID="profile-loading">
        <FontAwesome name="user" size={32} color="#2563eb" />
        <Text className="text-gray-500 mt-4">Loading profile...</Text>
      </View>
    );
  }

  if (!profile) return null;

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      testID="profile-screen"
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#2563eb" colors={['#2563eb']} />
      }
    >
      {/* Profile Header */}
      <View className="bg-white px-6 py-6 items-center border-b border-gray-100">
        {/* Avatar */}
        <View className="w-20 h-20 rounded-full bg-blue-100 items-center justify-center mb-3">
          {profile.profilePhotoUrl ? (
            <Text className="text-3xl">👤</Text>
          ) : (
            <FontAwesome name="user" size={32} color="#2563eb" />
          )}
        </View>

        {/* Name + Edit */}
        {isEditing ? (
          <View className="flex-row items-center mb-1">
            <TextInput
              value={editName}
              onChangeText={setEditName}
              className="text-xl font-bold text-gray-900 border-b-2 border-blue-500 px-2 py-1 min-w-[160px] text-center"
              autoFocus
              maxLength={50}
            />
            <Pressable onPress={handleSaveEdit} className="ml-2 p-2">
              <FontAwesome name="check" size={18} color="#10B981" />
            </Pressable>
            <Pressable onPress={() => setIsEditing(false)} className="ml-1 p-2">
              <FontAwesome name="times" size={18} color="#EF4444" />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={handleStartEdit} className="flex-row items-center mb-1">
            <Text className="text-xl font-bold text-gray-900">{profile.displayName}</Text>
            <FontAwesome name="pencil" size={14} color="#9CA3AF" style={{ marginLeft: 8 }} />
          </Pressable>
        )}

        <Text className="text-sm text-gray-400 mb-2">@{profile.handle}</Text>

        {/* Karma Rank */}
        <KarmaRankBadge title={profile.karmaRank.title} level={profile.karmaRank.level} />

        {/* Karma Score */}
        <Text className="text-sm text-gray-500 mt-2">
          {profile.karma} karma
        </Text>

        {/* Name change cooldown hint */}
        {!canChangeName && nextNameChangeDate && (
          <Text className="text-xs text-gray-400 mt-1">
            Name change available {nextNameChangeDate}
          </Text>
        )}
      </View>

      {/* Stats */}
      <View className="bg-white mt-2 px-6 py-5 flex-row border-b border-gray-100">
        <StatItem label="Guesses" value={profile.guessCount} icon="bullseye" />
        <StatItem label="Comments" value={profile.commentCount} icon="comment" />
        <StatItem label="Saved" value={profile.savedCount} icon="bookmark" />
        <StatItem label="Liked" value={profile.likedCount} icon="heart" />
      </View>

      {/* Member since */}
      <View className="bg-white mt-2 px-6 py-4 border-b border-gray-100">
        <Text className="text-sm text-gray-500">
          Member since {new Date(profile.joinedAt).toLocaleDateString('nl-NL', {
            month: 'long',
            year: 'numeric',
          })}
        </Text>
      </View>

      {/* Guess History */}
      <View className="bg-white mt-2 px-6 py-4">
        <Text className="text-base font-semibold text-gray-900 mb-3">Recent Guesses</Text>

        {(!guessHistory || guessHistory.items.length === 0) ? (
          <View className="py-6 items-center">
            <FontAwesome name="bullseye" size={24} color="#D1D5DB" />
            <Text className="text-sm text-gray-400 mt-2">No guesses yet</Text>
          </View>
        ) : (
          guessHistory.items.map((guess) => (
            <View key={`${guess.propertyId}-${guess.guessedAt}`} className="py-3 border-b border-gray-50 last:border-b-0">
              <View className="flex-row justify-between items-start">
                <View className="flex-1 mr-3">
                  <Text className="text-sm font-medium text-gray-900" numberOfLines={1}>
                    {guess.propertyAddress}
                  </Text>
                  <Text className="text-sm text-blue-600 font-semibold mt-0.5">
                    {formatPrice(guess.guessAmount)}
                  </Text>
                  {guess.actualPrice && (
                    <Text className="text-xs text-gray-500 mt-0.5">
                      Sold: {formatPrice(guess.actualPrice)}
                    </Text>
                  )}
                </View>
                <GuessOutcomeBadge outcome={guess.outcome} />
              </View>
              <Text className="text-xs text-gray-400 mt-1">
                {new Date(guess.guessedAt).toLocaleDateString('nl-NL')}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Logout */}
      <View className="px-6 py-6">
        <Pressable
          onPress={handleLogout}
          className="bg-red-50 py-3 rounded-lg items-center border border-red-200"
          testID="profile-logout-button"
        >
          <Text className="text-red-600 font-semibold">Sign Out</Text>
        </Pressable>
      </View>

      <View className="h-8" />
    </ScrollView>
  );
}
