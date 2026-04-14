import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthModal } from '@/src/components';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/Icon';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { AchievementBadge } from '@/src/components/ui/AchievementBadge';
import { KarmaBadge } from '@/src/components/Comments/KarmaBadge';
import { ScreenHeader } from '@/src/components/navigation/ScreenHeader';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { useMyProfile } from '@/src/hooks/useUserProfile';
import { useAchievements } from '@/src/hooks/useAchievements';
import { useUserActivity } from '@/src/hooks/useUserActivity';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';
import type { AchievementDefinition } from '@huishype/shared';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  type ViewStyle,
  View,
  mergeStyles,
} from '../dom';
import { colors, shadows } from '../theme';

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

export function ProfileRoute() {
  const navigate = useNavigate();
  const { user, signOut } = useAuthContext();
  const { data: profile, isLoading, refetch } = useMyProfile();
  const { data: achievementsData } = useAchievements();
  const { data: activityData } = useUserActivity();
  const hydratedNow = useHydratedNow();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const recentActivities = useMemo(() => {
    if (!activityData?.pages) return [];
    return activityData.pages.flatMap((page) => page.items).slice(0, 5);
  }, [activityData]);

  const earnedAchievements = useMemo(() => {
    if (!achievementsData) return [];
    return achievementsData.earned.map((entry) => ({
      definition: {
        key: entry.key,
        name: entry.name,
        description: entry.description,
        icon: entry.icon,
        category: entry.category,
      } as AchievementDefinition,
      awardedAt: entry.awardedAt,
    }));
  }, [achievementsData]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  const handleLogout = useCallback(() => {
    if (window.confirm('Are you sure you want to sign out?')) {
      void signOut();
    }
    setShowSettings(false);
  }, [signOut]);

  const handleOpenPublicProfile = useCallback(
    () => navigate(`/user/${profile?.id ?? 'user'}`),
    [navigate, profile?.id],
  );

  if (!user) {
    return (
      <View style={styles.screen} testID="profile-auth-required">
        <ScreenHeader title="Profile" />
        <View style={styles.centered}>
          <View style={styles.iconCircle}>
            <Icon name="User" size="2xl" color={colors.goldDeep} />
          </View>
          <Text style={styles.title}>Sign in to see your profile</Text>
          <Text style={styles.body}>Track your guess history, karma, and saved properties.</Text>
          <Button
            label="Sign In"
            onPress={() => setShowAuth(true)}
            style={styles.primaryButton}
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

  if (isLoading && !profile) {
    return (
      <View style={styles.screen} testID="profile-loading">
        <ScreenHeader title="Profile" />
        <View style={styles.centered}>
          <Icon name="User" size="xl" color={colors.goldDeep} />
          <Text style={styles.body}>Loading profile...</Text>
        </View>
      </View>
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <View style={styles.screen} testID="profile-screen">
      <View style={styles.shell}>
        <ScreenHeader title="Profile" />

        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.goldDeep}
              colors={[colors.goldDeep]}
            />
          }
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={mergeStyles(
              styles.profileCard,
              Platform.OS === 'web' ? ({ boxShadow: shadows.card } as ViewStyle) : null,
            )}
          >
            <View style={styles.profileTopRow}>
              <UserAvatar
                username={profile.handle}
                displayName={profile.displayName}
                profilePhotoUrl={profile.profilePhotoUrl}
                size="lg"
              />
              <View style={styles.profileCopy}>
                <Text style={styles.displayName}>{profile.displayName}</Text>
                <Text style={styles.handle}>@{profile.handle}</Text>
                <KarmaBadge karma={profile.karma} size="sm" />
              </View>
            </View>

            <View style={styles.statsRow}>
              <Stat label="Guesses" value={profile.guessCount} />
              <Stat label="Comments" value={profile.commentCount} />
              <Stat label="Karma" value={profile.karma} />
            </View>

            <View style={styles.profileActions}>
              <Button label="Public Profile" variant="secondary" onPress={handleOpenPublicProfile} />
              <Button
                label="Settings"
                variant="ghost"
                onPress={() => setShowSettings((value) => !value)}
              />
            </View>
          </View>

          {showSettings ? (
            <View style={styles.settingsCard}>
              <Pressable style={styles.settingsItem} onPress={handleLogout}>
                <Icon name="SignOut" size="md" color={colors.text} />
                <Text style={styles.settingsText}>Sign out</Text>
              </Pressable>
            </View>
          ) : null}

          <Section title="Achievements">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.achievementRow}>
                {earnedAchievements.length > 0 ? (
                  earnedAchievements.map((achievement) => (
                    <AchievementBadge
                      key={achievement.definition.key}
                      achievement={achievement.definition}
                      earned
                      awardedAt={achievement.awardedAt}
                      variant="compact"
                    />
                  ))
                ) : (
                <Text style={styles.sectionEmpty}>No achievements yet.</Text>
              )}
            </ScrollView>
          </Section>

          <Section title="Recent activity">
            <View style={styles.activityList}>
              {recentActivities.length > 0 ? (
                recentActivities.map((item) => (
                  <View key={item.id} style={styles.activityItem}>
                    <Text style={styles.activityLabel}>{ACTIVITY_LABELS[item.eventType] ?? 'Activity'}</Text>
                    <Text style={styles.activityBody} numberOfLines={1}>
                      {item.property.address} · {formatRelativeTime(item.createdAt, hydratedNow ?? Date.now())}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.sectionEmpty}>No recent activity.</Text>
              )}
            </View>
          </Section>
        </ScrollView>
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  shell: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 768,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 104,
    gap: 18,
  },
  profileCard: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 20,
    gap: 18,
  },
  profileTopRow: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
  },
  profileCopy: {
    flex: 1,
    gap: 6,
  },
  displayName: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  handle: {
    color: colors.textMuted,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  statLabel: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  profileActions: {
    flexDirection: 'row',
    gap: 12,
  },
  settingsCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 12,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
  },
  settingsText: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '600',
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  achievementRow: {
    gap: 12,
    paddingRight: 8,
  },
  activityList: {
    gap: 10,
  },
  activityItem: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  activityLabel: {
    color: colors.goldDeep,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.08,
  },
  activityBody: {
    color: colors.textMuted,
    fontSize: 14,
  },
  sectionEmpty: {
    color: colors.textMuted,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  iconCircle: {
    backgroundColor: '#FFF3D8',
    padding: 20,
    borderRadius: 999,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  primaryButton: {
    alignSelf: 'stretch',
    marginHorizontal: 24,
  },
});
