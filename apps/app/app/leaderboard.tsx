/**
 * Leaderboard Screen — Community rankings page.
 *
 * Design spec: Section 7.11 (Community Leaderboard Page), matches 9. Community Leaderboard.jpg.
 *
 * Features:
 *   - Period tabs (Week, Month, All Time)
 *   - Featured property card (most discussed)
 *   - Top 3 podium with crown for 1st place
 *   - Ranked list with karma badges
 *   - Current user highlighted
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  FlatList,
  Pressable,
  Text,
  View,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/src/components/ui/Icon';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { KarmaBadge } from '@/src/components/Comments/KarmaBadge';
import { Chip } from '@/src/components/ui/Chip';
import {
  useLeaderboard,
  type LeaderboardPeriod,
  type LeaderboardEntry,
  type FeaturedProperty,
} from '@/src/hooks/useLeaderboard';
import { formatPropertyPrice } from '@huishype/shared';
import type { CountryCode } from '@huishype/shared/config';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { shadows } from '@/src/lib/shadows';

// --- Period config ---

const PERIODS: Array<{ key: LeaderboardPeriod; label: string }> = [
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'all', label: 'All Time' },
];

// --- Podium component ---

function PodiumEntry({
  entry,
  position,
  isCurrentUser,
}: {
  entry: LeaderboardEntry;
  position: 1 | 2 | 3;
  isCurrentUser: boolean;
}) {
  const isFirst = position === 1;
  const avatarSize = isFirst ? 52 : 44;
  const nameFontSize = isFirst ? 14 : 13;

  return (
    <View
      style={[
        styles.podiumCard,
        isFirst && styles.podiumCardFirst,
        isCurrentUser && styles.podiumCardCurrentUser,
        shadows.card,
      ]}
      accessibilityLabel={`Rank ${position}: ${entry.displayName}, ${entry.karma} karma points${isCurrentUser ? ', you' : ''}`}
      accessibilityRole="summary"
    >
      {/* Crown for 1st place */}
      {isFirst && (
        <View style={styles.crownContainer}>
          <Icon name="Crown" size={20} weight="fill" color="#F5A623" />
        </View>
      )}

      {/* Rank circle for 2nd/3rd */}
      {!isFirst && (
        <View style={styles.rankCircle}>
          <Text style={styles.rankCircleText}>{position}</Text>
        </View>
      )}

      {/* Avatar */}
      <View
        style={[
          styles.podiumAvatarContainer,
          isFirst && styles.podiumAvatarFirst,
        ]}
      >
        <UserAvatar
          username={entry.handle}
          displayName={entry.displayName}
          profilePhotoUrl={entry.profilePhotoUrl}
          size={isFirst ? 'lg' : 'md'}
        />
      </View>

      {/* Name */}
      <Text
        style={[styles.podiumName, { fontSize: nameFontSize }]}
        numberOfLines={1}
      >
        {entry.displayName}
      </Text>

      {/* Karma badge (1st only) */}
      {isFirst && <KarmaBadge karma={entry.karma} size="sm" />}

      {/* Points */}
      <Text style={[styles.podiumPoints, isFirst && styles.podiumPointsFirst]}>
        {entry.karma.toLocaleString()} pts
      </Text>

      {/* Stats (1st only) */}
      {isFirst && (
        <View style={styles.podiumStats}>
          <View style={styles.podiumStat}>
            <Icon name="ChatCircle" size={12} color="#9C958A" />
            <Text style={styles.podiumStatText}>{entry.commentCount}</Text>
          </View>
          <View style={styles.podiumStat}>
            <Icon name="Tag" size={12} color="#9C958A" />
            <Text style={styles.podiumStatText}>{entry.guessCount}</Text>
          </View>
          <View style={styles.podiumStat}>
            <Icon name="Heart" size={12} color="#9C958A" />
            <Text style={styles.podiumStatText}>{entry.likeCount}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

// --- Ranking row ---

function RankingRow({
  entry,
  isCurrentUser,
}: {
  entry: LeaderboardEntry;
  isCurrentUser: boolean;
}) {
  return (
    <View
      style={[
        styles.rankingRow,
        isCurrentUser && styles.rankingRowCurrentUser,
      ]}
      accessibilityLabel={`Rank ${entry.rank}: ${entry.displayName}, ${entry.karma} karma, ${entry.commentCount} comments, ${entry.guessCount} guesses${isCurrentUser ? ', you' : ''}`}
      accessibilityRole="summary"
    >
      <Text
        style={[
          styles.rankNumber,
          isCurrentUser && styles.rankNumberCurrentUser,
        ]}
      >
        {entry.rank}
      </Text>

      <UserAvatar
        username={entry.handle}
        displayName={entry.displayName}
        profilePhotoUrl={entry.profilePhotoUrl}
        size="sm"
      />

      <View style={styles.rankingInfo}>
        <Text style={styles.rankingName} numberOfLines={1}>
          {entry.displayName}
        </Text>
        <View style={styles.rankingMeta}>
          <KarmaBadge karma={entry.karma} size="sm" />
          <Text style={styles.rankingMetaText}>
            {entry.commentCount} comments · {entry.guessCount} guesses
          </Text>
        </View>
      </View>

      <Text
        style={[
          styles.rankingPoints,
          isCurrentUser && styles.rankingPointsCurrentUser,
        ]}
      >
        {entry.karma.toLocaleString()}
      </Text>
    </View>
  );
}

// --- Featured Property Card ---

function FeaturedPropertyCard({
  property,
  period,
}: {
  property: FeaturedProperty;
  period: LeaderboardPeriod;
}) {
  const periodLabel =
    period === 'week'
      ? 'This week'
      : period === 'month'
        ? 'This month'
        : 'All time';

  return (
    <Pressable
      style={[styles.featuredCard, shadows.card]}
      onPress={() => router.push(`/property/${property.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Featured property: ${property.address}, ${property.city}`}
    >
      <View style={styles.featuredBackdrop}>
        <View style={styles.featuredGlowLarge} />
        <View style={styles.featuredGlowSmall} />
        <View style={styles.featuredRing} />
      </View>

      <View style={styles.featuredBadge}>
        <Text style={styles.featuredBadgeText}>{`MOST DISCUSSED · ${periodLabel}`}</Text>
      </View>

      <View style={styles.featuredGradient} />

      {/* Content overlay */}
      <View style={styles.featuredContent}>
        <View style={styles.featuredTextBlock}>
          <Text style={styles.featuredAddress} numberOfLines={1}>
            {property.address}
          </Text>
          <Text style={styles.featuredCity} numberOfLines={1}>
            {property.city}
            {property.officialValuation
              ? ` · ${formatPropertyPrice(property.officialValuation, property.countryCode as CountryCode)}`
              : ''}
          </Text>
        </View>
        <View style={styles.featuredStats}>
          <View style={styles.featuredStatPill}>
            <Icon name="Star" size={13} weight="fill" color="#FFFFFF" />
            <Text style={styles.featuredStatText}>
              {Math.round(property.engagementScore)}
            </Text>
          </View>
          <View style={styles.featuredStatPill}>
            <Icon name="ChatCircle" size={13} color="#FFFFFF" />
            <Text style={styles.featuredStatText}>{property.commentCount}</Text>
          </View>
          <View style={styles.featuredStatPill}>
            <Icon name="Heart" size={13} color="#FFFFFF" />
            <Text style={styles.featuredStatText}>{property.likeCount}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// --- Main Screen ---

type ListItem =
  | { type: 'podium'; id: string }
  | { type: 'rankings-header'; id: string }
  | { type: 'ranking'; data: LeaderboardEntry; id: string };

export default function LeaderboardScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');

  const { data, isLoading } = useLeaderboard(period);

  const currentUserId = user?.id ?? null;

  // Split podium and rankings
  const podiumEntries = useMemo(() => data?.rankings.slice(0, 3) ?? [], [data?.rankings]);
  const rankingEntries = useMemo(() => data?.rankings.slice(3) ?? [], [data?.rankings]);

  const listItems: ListItem[] = useMemo(() => {
    const items: ListItem[] = [];
    if (podiumEntries.length > 0) {
      items.push({ type: 'podium', id: 'podium' });
    }
    if (rankingEntries.length > 0) {
      items.push({ type: 'rankings-header', id: 'rankings-header' });
      for (const entry of rankingEntries) {
        items.push({ type: 'ranking', data: entry, id: entry.userId });
      }
    }
    return items;
  }, [podiumEntries, rankingEntries]);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === 'podium') {
        // Reorder for visual: [2nd, 1st, 3rd]
        const ordered = [podiumEntries[1], podiumEntries[0], podiumEntries[2]].filter(
          Boolean
        );
        return (
          <View style={styles.podiumContainer}>
            {ordered.map((entry, i) => {
              const position = i === 1 ? 1 : i === 0 ? 2 : 3;
              return (
                <PodiumEntry
                  key={entry.userId}
                  entry={entry}
                  position={position as 1 | 2 | 3}
                  isCurrentUser={entry.userId === currentUserId}
                />
              );
            })}
          </View>
        );
      }

      if (item.type === 'rankings-header') {
        return (
          <View style={styles.rankingsHeader}>
            <Text style={styles.rankingsHeaderText}>ALL RANKINGS</Text>
          </View>
        );
      }

      return (
        <RankingRow
          entry={item.data}
          isCurrentUser={item.data.userId === currentUserId}
        />
      );
    },
    [podiumEntries, currentUserId]
  );

  const keyExtractor = useCallback((item: ListItem) => item.id, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top, alignItems: 'center' }]}>
      <View style={{ width: '100%', maxWidth: 768, flex: 1 }}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="ArrowLeft" size="lg" color="#2D2926" />
          </Pressable>
          <Icon name="Trophy" size="lg" weight="fill" color="#F5A623" />
          <Text style={styles.headerTitle}>Leaderboard</Text>
        </View>
      </View>

      {/* Period chips */}
      <View style={styles.periodChips}>
        {PERIODS.map((p) => (
          <Chip
            key={p.key}
            label={p.label}
            active={period === p.key}
            onPress={() => setPeriod(p.key)}
            testID={`period-${p.key}`}
          />
        ))}
      </View>

      {/* Featured property */}
      {data?.featuredProperty && (
        <View style={styles.featuredSection}>
          <Text style={styles.sectionLabel}>
            {`MOST DISCUSSED${period === 'week' ? ' THIS WEEK' : period === 'month' ? ' THIS MONTH' : ''}`}
          </Text>
          <FeaturedPropertyCard property={data.featuredProperty} period={period} />
        </View>
      )}

      {/* Main content */}
      {isLoading ? (
        <View style={styles.emptyContainer}>
          <Icon name="Trophy" size="xl" color="#DE911D" />
          <Text style={styles.emptyText}>Loading leaderboard...</Text>
        </View>
      ) : listItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="Trophy" size="2xl" color="#C7BFB3" />
          <Text style={styles.emptyTitle}>No rankings yet</Text>
          <Text style={styles.emptyText}>
            Be the first to comment, guess, or like to appear on the
            leaderboard.
          </Text>
        </View>
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          testID="leaderboard-list"
        />
      )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFBF5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#2D2926',
    letterSpacing: -0.3,
    fontFamily: 'Outfit_600SemiBold',
  },
  periodChips: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 10,
  },

  // Featured section
  featuredSection: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    color: '#9C958A',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  featuredCard: {
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#2D2926',
    position: 'relative',
  },
  featuredBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#2D2926',
  },
  featuredGlowLarge: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(245, 166, 35, 0.18)',
    top: -72,
    right: -48,
  },
  featuredGlowSmall: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    bottom: -32,
    left: -12,
  },
  featuredRing: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    right: 18,
    top: 22,
  },
  featuredBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 2,
    backgroundColor: 'rgba(245, 166, 35, 0.92)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  featuredBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
  featuredGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 100,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  featuredContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  featuredTextBlock: {
    flex: 1,
    marginRight: 12,
  },
  featuredAddress: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: 'Outfit_700Bold',
  },
  featuredCity: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
  },
  featuredStats: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  featuredStatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  featuredStatText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // Podium
  podiumContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
  },
  podiumCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
  },
  podiumCardFirst: {
    paddingVertical: 16,
    marginTop: -8,
  },
  podiumCardCurrentUser: {
    borderWidth: 1,
    borderColor: '#FCE588',
    backgroundColor: '#FFFBEB',
  },
  crownContainer: {
    marginBottom: 4,
  },
  rankCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  rankCircleText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  podiumAvatarContainer: {
    marginBottom: 8,
  },
  podiumAvatarFirst: {
    borderWidth: 2,
    borderColor: '#F7C948',
    borderRadius: 26,
  },
  podiumName: {
    fontWeight: '700',
    color: '#2D2926',
    textAlign: 'center',
  },
  podiumPoints: {
    fontSize: 12,
    fontWeight: '500',
    color: '#9C958A',
    marginTop: 4,
  },
  podiumPointsFirst: {
    color: '#DE911D',
    fontWeight: '600',
  },
  podiumStats: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  podiumStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  podiumStatText: {
    fontSize: 11,
    color: '#9C958A',
  },

  // Rankings header
  rankingsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  rankingsHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    color: '#9C958A',
    textTransform: 'uppercase',
  },
  // Ranking row
  rankingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 12,
  },
  rankingRowCurrentUser: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FCE588',
    borderRadius: 12,
    marginHorizontal: 16,
    paddingHorizontal: 12,
  },
  rankNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#C7BFB3',
    width: 24,
    textAlign: 'center',
  },
  rankNumberCurrentUser: {
    color: '#DE911D',
  },
  rankingInfo: {
    flex: 1,
  },
  rankingName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D2926',
  },
  rankingMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  rankingMetaText: {
    fontSize: 12,
    color: '#9C958A',
  },
  rankingPoints: {
    fontSize: 13,
    fontWeight: '700',
    color: '#504A42',
  },
  rankingPointsCurrentUser: {
    color: '#DE911D',
  },

  // Empty states
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2D2926',
    marginTop: 12,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 14,
    color: '#9C958A',
    textAlign: 'center',
    marginTop: 8,
  },
});
