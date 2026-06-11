import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { AchievementBadge } from '@/src/components/ui/AchievementBadge';
import { Icon } from '@/src/components/ui/Icon';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { useT, type TranslationKey } from '@/src/i18n';
import { shadows } from '@/src/lib/shadows';
import { buildPropertyRoute, toInternalAppHref } from '@/src/utils/property-route';

import type { AchievementDefinition, ActivityItem, PublicUserProfile } from '@huishype/shared';

const ACTIVITY_ICONS: Record<string, { icon: React.ComponentProps<typeof Icon>['name']; color: string }> = {
  comment: { icon: 'ChatCircle', color: '#42A5F5' },
  property_like: { icon: 'Heart', color: '#FF6B35' },
  price_guess: { icon: 'Tag', color: '#4CAF50' },
  save: { icon: 'BookmarkSimple', color: '#F5A623' },
};

const ACTIVITY_LABEL_KEYS: Record<string, TranslationKey> = {
  comment: 'profile.activity.comment',
  property_like: 'profile.activity.propertyLike',
  price_guess: 'profile.activity.priceGuess',
  save: 'profile.activity.save',
};

export type ProfileAchievementItem = {
  definition: AchievementDefinition;
  awardedAt: string;
};

export type ProfileSocialStat = {
  key: string;
  label: string;
  value: number;
  testID?: string;
  onPress?: () => void;
};

export function formatRelativeTime(
  isoDate: string,
  nowMs: number,
  t: (key: TranslationKey, values?: Record<string, string | number | Date>) => string,
): string {
  const diffMs = nowMs - new Date(isoDate).getTime();
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHrs < 1) return t('time.justNow');
  if (diffHrs < 24) return `${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return `${Math.floor(diffDays / 7)}w`;
}

export function ProfilePublicIdentity({
  profile,
  action,
}: {
  profile: PublicUserProfile;
  action?: React.ReactNode;
}) {
  return (
    <>
      <View style={styles.avatarSection} testID="profile-public-avatar-section">
        <UserAvatar
          username={profile.handle}
          displayName={profile.displayName}
          profilePhotoUrl={profile.profilePhotoUrl}
          size="lg"
        />
      </View>
      <View style={styles.identitySection}>
        <View style={styles.identityDisplayRow} testID="profile-display-name-row">
          <Text style={styles.displayName} numberOfLines={1}>
            {profile.displayName}
          </Text>
        </View>
        <View style={styles.identityDisplayRow} testID="profile-handle-row">
          <Text style={styles.handleText} numberOfLines={1}>
            @{profile.handle}
          </Text>
        </View>
      </View>
      {action ? <View style={styles.publicActionSlot}>{action}</View> : null}
    </>
  );
}

export function ProfileSocialStatsRow({ stats }: { stats: ProfileSocialStat[] }) {
  return (
    <View style={styles.socialStatsRow} testID="profile-social-stats-row">
      {stats.map((stat, index) => {
        const content = (
          <>
            <Text style={styles.socialStatValue}>{stat.value}</Text>
            <Text style={styles.socialStatLabel}>{stat.label}</Text>
          </>
        );

        return (
          <React.Fragment key={stat.key}>
            {stat.onPress ? (
              <Pressable onPress={stat.onPress} style={styles.socialStatItem} testID={stat.testID}>
                {content}
              </Pressable>
            ) : (
              <View style={styles.socialStatItem} testID={stat.testID}>
                {content}
              </View>
            )}
            {index < stats.length - 1 ? <View style={styles.socialStatDivider} /> : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

export function ProfileReputationSections({
  guessCount,
  karma,
  averageAccuracy,
  earnedAchievements,
  recentActivities,
  nowMs,
  bottomSpacer = 0,
}: {
  guessCount: number;
  karma: number;
  averageAccuracy: number | null | undefined;
  earnedAchievements: ProfileAchievementItem[];
  recentActivities: ActivityItem[];
  nowMs: number | null;
  bottomSpacer?: number;
}) {
  const t = useT();

  return (
    <>
      <View style={styles.statsSection}>
        <Text style={styles.sectionTitle}>{t('profile.stats.title')}</Text>
        <View style={[styles.statsGroup, shadows.card]} testID="profile-stats-card">
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{guessCount}</Text>
            <Text style={styles.statLabel}>{t('profile.stats.guesses')}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, styles.statValueGold]}>{karma}</Text>
            <Text style={styles.statLabel}>{t('profile.stats.karma')}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, styles.statValueGreen]}>
              {averageAccuracy != null ? `${Math.round(averageAccuracy)}%` : '-'}
            </Text>
            <Text style={styles.statLabel}>{t('profile.stats.accuracy')}</Text>
          </View>
        </View>
      </View>

      {earnedAchievements.length > 0 ? (
        <View style={styles.section} testID="profile-achievements-section">
          <Text style={styles.sectionTitle}>{t('profile.achievements')}</Text>
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
      ) : null}

      <View style={[styles.section, styles.activitySection]} testID="profile-activity-section">
        <Text style={styles.sectionTitle}>{t('profile.recentActivity')}</Text>

        {recentActivities.length === 0 ? (
          <View style={styles.emptyActivity}>
            <Icon name="Flame" size="xl" color="#E8E0D4" />
            <Text style={styles.emptyActivityText}>{t('profile.noRecentActivity')}</Text>
          </View>
        ) : (
          recentActivities.map((item) => {
            const config = ACTIVITY_ICONS[item.eventType] ?? ACTIVITY_ICONS.comment;
            const label = t(ACTIVITY_LABEL_KEYS[item.eventType] ?? 'profile.activity.fallback');

            return (
              <Pressable
                key={item.id}
                style={styles.activityRow}
                testID="profile-activity-row"
                onPress={() =>
                  router.push(toInternalAppHref(buildPropertyRoute(item.property, '/profile')))
                }
              >
                <View style={styles.activityIconWell}>
                  <Icon name={config.icon} size={15} weight="fill" color={config.color} />
                </View>
                <Text style={styles.activityText} numberOfLines={2}>
                  {label} {item.property.address}
                </Text>
                <View style={styles.activityMeta}>
                  <Text style={styles.activityTime}>
                    {nowMs === null ? '\u00A0' : formatRelativeTime(item.createdAt, nowMs, t)}
                  </Text>
                  <Icon name="CaretRight" size={14} color="#C7BFB3" />
                </View>
              </Pressable>
            );
          })
        )}
      </View>

      {bottomSpacer > 0 ? <View style={{ height: bottomSpacer }} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  avatarSection: {
    marginTop: 8,
    marginBottom: 12,
    alignItems: 'center',
    gap: 8,
  },
  identitySection: {
    width: '100%',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
  },
  identityDisplayRow: {
    maxWidth: '88%',
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  displayName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2D2926',
    lineHeight: 26,
    letterSpacing: 0,
    flexShrink: 1,
    textAlign: 'center',
  },
  handleText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#857D72',
    lineHeight: 20,
    letterSpacing: 0,
    flexShrink: 1,
    textAlign: 'center',
  },
  publicActionSlot: {
    width: '100%',
    maxWidth: 320,
    paddingHorizontal: 20,
    marginTop: 2,
    marginBottom: 6,
  },
  socialStatsRow: {
    width: '100%',
    maxWidth: 520,
    marginTop: 12,
    paddingHorizontal: 20,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialStatItem: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(190, 184, 176, 0.5)',
  },
  socialStatValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#000000',
    lineHeight: 24,
    letterSpacing: 0,
    fontVariant: ['tabular-nums'],
  },
  socialStatLabel: {
    marginTop: 0,
    fontSize: 17,
    color: '#8A8580',
    lineHeight: 20,
    letterSpacing: 0,
  },
  statsSection: {
    paddingHorizontal: 16,
    marginBottom: 18,
  },
  statsGroup: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: 'rgba(255, 251, 245, 0.82)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(232, 224, 212, 0.78)',
    overflow: 'hidden',
  },
  statItem: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statDivider: {
    width: 1,
    alignSelf: 'center',
    height: 52,
    backgroundColor: 'rgba(232, 224, 212, 0.82)',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#2D2926',
    letterSpacing: 0,
    lineHeight: 30,
  },
  statValueGold: {
    color: '#F5A623',
  },
  statValueGreen: {
    color: '#4CAF50',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0,
    color: '#9C958A',
    marginTop: 4,
    textTransform: 'uppercase',
  },
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
  activitySection: {
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: 'rgba(255, 251, 245, 0.78)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(232, 224, 212, 0.72)',
  },
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
    minHeight: 46,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(232, 224, 212, 0.6)',
    gap: 10,
  },
  activityIconWell: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.48)',
  },
  activityText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    color: '#504A42',
  },
  activityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    minWidth: 40,
  },
  activityTime: {
    fontSize: 13,
    color: '#C7BFB3',
  },
});
