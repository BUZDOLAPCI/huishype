/**
 * Profile Screen — User profile with stats, achievements, and recent activity.
 *
 * Design spec: matches 7. Profile Screen.jpg.
 *
 * Features:
 *   - Profile card with avatar, display name, karma badge
 *   - Stats grid (guesses, karma, accuracy)
 *   - Achievements row (horizontal scroll of AchievementBadge compact)
 *   - Recent activity log from API
 *   - Settings dropdown (sign out)
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/Icon';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { AchievementBadge } from '@/src/components/ui/AchievementBadge';
import { KarmaBadge } from '@/src/components/Comments/KarmaBadge';
import { AuthModal } from '@/src/components';
import { ScreenHeader } from '@/src/components/navigation/ScreenHeader';

import { useAuthContext } from '@/src/providers/AuthProvider';
import { useMyProfile, useUpdateProfile } from '@/src/hooks/useUserProfile';
import { useAchievements } from '@/src/hooks/useAchievements';
import { useUserActivity, type ActivityItem } from '@/src/hooks/useUserActivity';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';
import { buildPropertyRoute, toInternalAppHref } from '@/src/utils/property-route';

import type { AchievementDefinition } from '@huishype/shared';
import { shadows } from '@/src/lib/shadows';
import { PROFILE_TAB_BAR_SPACER } from '@/src/components/navigation/tabBarMetrics';

// --- Activity event config ---

const ACTIVITY_ICONS: Record<string, { icon: React.ComponentProps<typeof Icon>['name']; color: string }> = {
  comment: { icon: 'ChatCircle', color: '#42A5F5' },
  property_like: { icon: 'Heart', color: '#FF6B35' },
  price_guess: { icon: 'Tag', color: '#4CAF50' },
  save: { icon: 'BookmarkSimple', color: '#F5A623' },
};

const ACTIVITY_LABELS: Record<string, string> = {
  comment: 'Commented on',
  property_like: 'Liked',
  price_guess: 'Guessed on',
  save: 'Saved',
};

function formatRelativeTime(isoDate: string, nowMs: number): string {
  const diffMs = nowMs - new Date(isoDate).getTime();
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHrs < 1) return 'just now';
  if (diffHrs < 24) return `${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return `${Math.floor(diffDays / 7)}w`;
}

// --- Settings dropdown ---

function SettingsDropdown({
  visible,
  onSignOut,
  onDismiss,
}: {
  visible: boolean;
  onSignOut: () => void;
  onDismiss: () => void;
}) {
  if (!visible) return null;

  return (
    <>
      <Pressable style={styles.dropdownBackdrop} onPress={onDismiss} />
      <View style={[styles.dropdown, shadows.dropdown]}>
        <Pressable
          style={styles.dropdownItem}
          onPress={onSignOut}
          testID="settings-sign-out"
        >
          <Icon name="SignOut" size="md" color="#504A42" />
          <Text style={styles.dropdownItemText}>Sign out</Text>
        </Pressable>
      </View>
    </>
  );
}

// --- Main Screen ---

export default function ProfileScreen() {
  const { user, signOut } = useAuthContext();
  const { data: profile, isLoading, refetch } = useMyProfile();
  const updateProfile = useUpdateProfile();
  const { data: achievementsData } = useAchievements();
  const { data: activityData } = useUserActivity();
  const hydratedNow = useHydratedNow();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const canChangeName = useMemo(() => {
    if (!profile?.lastNameChangeAt) return true;
    if (hydratedNow === null) return false;
    const cooldownEnd = new Date(profile.lastNameChangeAt);
    cooldownEnd.setDate(cooldownEnd.getDate() + 30);
    return hydratedNow >= cooldownEnd.getTime();
  }, [hydratedNow, profile?.lastNameChangeAt]);

  const nextNameChangeDate = useMemo(() => {
    if (!profile?.lastNameChangeAt || hydratedNow === null) return null;
    const cooldownEnd = new Date(profile.lastNameChangeAt);
    cooldownEnd.setDate(cooldownEnd.getDate() + 30);
    if (hydratedNow >= cooldownEnd.getTime()) return null;
    return cooldownEnd.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }, [hydratedNow, profile?.lastNameChangeAt]);

  const recentActivities = useMemo(() => {
    if (!activityData?.pages) return [];
    return activityData.pages.flatMap((page) => page.items).slice(0, 5);
  }, [activityData]);

  const earnedAchievements = useMemo(() => {
    if (!achievementsData) return [];
    return achievementsData.earned.map((ea) => ({
      definition: {
        key: ea.key,
        name: ea.name,
        description: ea.description,
        icon: ea.icon,
        category: ea.category,
      } as AchievementDefinition,
      awardedAt: ea.awardedAt,
    }));
  }, [achievementsData]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  const handleStartEdit = useCallback(() => {
    if (!canChangeName) {
      Alert.alert(
        'Name Change Cooldown',
        nextNameChangeDate
          ? `You can change your display name again on ${nextNameChangeDate}.`
          : 'You can change your display name again a little later.'
      );
      return;
    }
    setEditName(profile?.displayName || '');
    setIsEditing(true);
  }, [canChangeName, nextNameChangeDate, profile?.displayName]);

  const handleSaveEdit = useCallback(async () => {
    if (editName.length < 2 || editName.length > 50) {
      Alert.alert(
        'Invalid Name',
        'Display name must be between 2 and 50 characters.'
      );
      return;
    }
    try {
      await updateProfile.mutateAsync({ displayName: editName });
      setIsEditing(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update name';
      Alert.alert('Error', message);
    }
  }, [editName, updateProfile]);

  const handleLogout = useCallback(() => {
    setShowSettings(false);

    if (Platform.OS === 'web') {
      const shouldSignOut =
        typeof globalThis.confirm !== 'function' ||
        globalThis.confirm('Are you sure you want to sign out?');

      if (shouldSignOut) {
        void signOut();
      }
      return;
    }

    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  }, [signOut]);

  // --- Not logged in ---
  if (!user) {
    return (
      <View
        className="flex-1 bg-warm-50"
        testID="profile-auth-required"
        pointerEvents="box-none"
      >
        <ScreenHeader title="Profile" />
        <View className="flex-1 items-center justify-center px-6">
          <View className="bg-primary-100 p-5 rounded-full mb-4">
            <Icon name="User" size="2xl" color="#DE911D" />
          </View>
          <Text className="text-lg font-semibold text-warm-900 text-center mb-2">
            Sign in to see your profile
          </Text>
          <Text className="text-warm-600 text-center mb-6">
            Track your guess history, karma, and saved properties.
          </Text>
          <Button
            label="Sign In"
            onPress={() => setShowAuth(true)}
            style={{ alignSelf: 'stretch', marginHorizontal: 24 }}
            testID="profile-sign-in-button"
          />
          <AuthModal
            visible={showAuth}
            onClose={() => setShowAuth(false)}
            message="Sign in to HuisHype"
            onSuccess={() => setShowAuth(false)}
          />
        </View>
      </View>
    );
  }

  // --- Loading ---
  if (isLoading && !profile) {
    return (
      <View className="flex-1 bg-warm-50" testID="profile-loading">
        <ScreenHeader title="Profile" />
        <View className="flex-1 items-center justify-center">
          <Icon name="User" size="xl" color="#DE911D" />
          <Text className="text-warm-600 mt-4">Loading profile...</Text>
        </View>
      </View>
    );
  }

  if (!profile) return null;

  return (
    <View className="flex-1 bg-warm-50 items-center" testID="profile-screen">
      <ScrollView
        style={{ width: '100%', maxWidth: 768 }}
        className="flex-1"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#DE911D"
            colors={['#DE911D']}
          />
        }
      >
        {/* Profile Header Card */}
        <View style={[styles.profileCard, shadows.card]}>
          {/* Header actions row */}
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push('/notifications')}
              hitSlop={8}
              testID="profile-notifications"
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              accessibilityHint="Opens the notifications screen"
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="Bell" size="lg" color="#504A42" />
            </Pressable>
            <Pressable
              onPress={() => setShowSettings(!showSettings)}
              hitSlop={8}
              testID="profile-settings"
              accessibilityRole="button"
              accessibilityLabel="Settings"
              accessibilityHint="Opens the settings menu"
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="DotsThreeVertical" size="lg" color="#504A42" />
            </Pressable>
          </View>

          {/* Settings dropdown */}
          <SettingsDropdown
            visible={showSettings}
            onSignOut={handleLogout}
            onDismiss={() => setShowSettings(false)}
          />

          {/* Avatar */}
          <View style={styles.avatarContainer}>
            <UserAvatar
              username={profile.handle}
              displayName={profile.displayName}
              profilePhotoUrl={profile.profilePhotoUrl}
              size="lg"
            />
          </View>

          {/* Name + Edit */}
          {isEditing ? (
            <View style={styles.editRow}>
              <TextInput
                value={editName}
                onChangeText={setEditName}
                style={styles.editInput}
                autoFocus
                maxLength={50}
              />
              <Pressable onPress={handleSaveEdit} style={styles.editAction}>
                <Icon name="Check" size="md" color="#4CAF50" />
              </Pressable>
              <Pressable
                onPress={() => setIsEditing(false)}
                style={styles.editAction}
              >
                <Icon name="X" size="md" color="#E53935" />
              </Pressable>
            </View>
          ) : (
            <Text style={styles.displayName}>{profile.displayName}</Text>
          )}

          {/* Karma Badge */}
          <View style={styles.karmaRow}>
            <KarmaBadge karma={profile.karma} size="md" />
          </View>

          {/* Edit display name link */}
          {!isEditing && (
            <Pressable onPress={handleStartEdit}>
              <Text style={styles.editLink}>Edit display name</Text>
            </Pressable>
          )}
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={[styles.statItem, shadows.card]}>
            <Text style={styles.statValue}>{profile.guessCount}</Text>
            <Text style={styles.statLabel}>GUESSES</Text>
          </View>
          <View style={[styles.statItem, shadows.card]}>
            <Text style={[styles.statValue, { color: '#F5A623' }]}>
              {profile.karma}
            </Text>
            <Text style={styles.statLabel}>KARMA</Text>
          </View>
          <View style={[styles.statItem, shadows.card]}>
            <Text style={[styles.statValue, { color: '#4CAF50' }]}>
              {profile.averageAccuracy != null
                ? `${Math.round(profile.averageAccuracy)}%`
                : '-'}
            </Text>
            <Text style={styles.statLabel}>ACCURACY</Text>
          </View>
        </View>

        {/* Achievements Section */}
        {earnedAchievements.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Achievements</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.achievementsScroll}
            >
              {earnedAchievements.map((ea) => (
                <View key={ea.definition.key} style={styles.achievementItem}>
                  <AchievementBadge
                    achievement={ea.definition}
                    earned
                    awardedAt={ea.awardedAt}
                    variant="compact"
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Recent Activity Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>

          {recentActivities.length === 0 ? (
            <View style={styles.emptyActivity}>
              <Icon name="Flame" size="xl" color="#E8E0D4" />
              <Text style={styles.emptyActivityText}>No recent activity</Text>
            </View>
          ) : (
            recentActivities.map((item: ActivityItem) => {
              const config =
                ACTIVITY_ICONS[item.eventType] ?? ACTIVITY_ICONS.comment;
              const label =
                ACTIVITY_LABELS[item.eventType] ?? 'Interacted with';

              return (
                <Pressable
                  key={item.id}
                  style={styles.activityRow}
                  onPress={() =>
                    router.push(
                      toInternalAppHref(buildPropertyRoute(item.property, '/profile')),
                    )
                  }
                >
                  <Icon
                    name={config.icon}
                    size={16}
                    weight="fill"
                    color={config.color}
                  />
                  <Text style={styles.activityText} numberOfLines={1}>
                    {label} {item.property.address}
                  </Text>
                  <View style={styles.activityMeta}>
                    <Text style={styles.activityTime}>
                      {hydratedNow === null ? '\u00A0' : formatRelativeTime(item.createdAt, hydratedNow)}
                    </Text>
                    <Icon name="CaretRight" size={14} color="#C7BFB3" />
                  </View>
                </Pressable>
              );
            })
          )}
        </View>

        <View style={{ height: PROFILE_TAB_BAR_SPACER }} />
      </ScrollView>
    </View>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    margin: 16,
    marginTop: 0,
    paddingBottom: 24,
    alignItems: 'center',
    overflow: 'visible',
  },
  headerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    width: '100%',
  },
  dropdownBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  dropdown: {
    position: 'absolute',
    top: 48,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 8,
    minWidth: 150,
    zIndex: 20,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
  dropdownItemText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#504A42',
  },
  avatarContainer: {
    marginTop: 8,
    marginBottom: 12,
  },
  displayName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2D2926',
    marginBottom: 8,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  editInput: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2D2926',
    borderBottomWidth: 2,
    borderBottomColor: '#F5A623',
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 160,
    textAlign: 'center',
  },
  editAction: {
    padding: 8,
    marginLeft: 4,
  },
  karmaRow: {
    marginBottom: 8,
  },
  editLink: {
    fontSize: 14,
    fontWeight: '500',
    color: '#B47712', // gold-700 — AA contrast on white
  },

  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  statItem: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#2D2926',
    letterSpacing: -0.3,
    lineHeight: 30,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    color: '#9C958A',
    marginTop: 4,
    textTransform: 'uppercase',
  },

  // Achievements
  section: {
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2D2926',
    marginBottom: 12,
  },
  achievementsScroll: {
    gap: 8,
  },
  achievementItem: {
    marginRight: 0,
  },

  // Recent activity
  emptyActivity: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyActivityText: {
    fontSize: 14,
    color: '#C7BFB3',
    marginTop: 8,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F0E8',
    gap: 10,
  },
  activityText: {
    flex: 1,
    fontSize: 14,
    color: '#504A42',
  },
  activityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  activityTime: {
    fontSize: 13,
    color: '#C7BFB3',
  },
});
