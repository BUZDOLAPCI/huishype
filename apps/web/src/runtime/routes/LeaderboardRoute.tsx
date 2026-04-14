import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Chip } from '@/src/components/ui/Chip';
import { Icon } from '@/src/components/ui/Icon';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { KarmaBadge } from '@/src/components/Comments/KarmaBadge';
import { PropertyImageSurface } from '@/src/components/PropertyImageSurface';
import { useLeaderboard, type LeaderboardPeriod, type LeaderboardEntry, type FeaturedProperty } from '@/src/hooks/useLeaderboard';
import { buildPropertyRoute } from '@/src/utils/property-route';
import {
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type ViewStyle,
  View,
} from '../dom';
import { colors, shadows } from '../theme';

const PERIODS: Array<{ key: LeaderboardPeriod; label: string }> = [
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'all', label: 'All Time' },
];

function RankingRow({ entry, isCurrentUser }: { entry: LeaderboardEntry; isCurrentUser: boolean }) {
  return (
    <View style={[styles.rankingRow, isCurrentUser && styles.rankingRowCurrentUser]}>
      <Text style={[styles.rankNumber, isCurrentUser && styles.rankNumberCurrentUser]}>{entry.rank}</Text>
      <UserAvatar
        username={entry.handle}
        displayName={entry.displayName}
        profilePhotoUrl={entry.profilePhotoUrl}
        size="sm"
      />
      <View style={styles.rankingInfo}>
        <Text style={styles.rankingName} numberOfLines={1}>{entry.displayName}</Text>
        <View style={styles.rankingMeta}>
          <KarmaBadge karma={entry.karma} size="sm" />
          <Text style={styles.rankingMetaText}>
            {entry.commentCount} comments · {entry.guessCount} guesses
          </Text>
        </View>
      </View>
      <Text style={[styles.rankingPoints, isCurrentUser && styles.rankingPointsCurrentUser]}>
        {entry.karma.toLocaleString()}
      </Text>
    </View>
  );
}

function FeaturedPropertyCard({ property, period, onPress }: { property: FeaturedProperty; period: LeaderboardPeriod; onPress: () => void }) {
  const periodLabel = period === 'week' ? 'This week' : period === 'month' ? 'This month' : 'All time';

  return (
    <Pressable
      style={[
        styles.featuredCard,
        (Platform.OS === 'web'
          ? ({ boxShadow: shadows.card } as unknown as ViewStyle)
          : null),
      ]}
      onPress={onPress}
    >
      <View style={styles.featuredMedia}>
        <PropertyImageSurface
          source={{
            listingPhotoUrl: property.thumbnailUrl ?? null,
            aerialImageUrl: property.aerialImageUrl,
            countryCode: property.countryCode,
          }}
          style={styles.featuredMediaSurface}
          imageStyle={styles.featuredMediaImage}
          markerSize={34}
          imageTestID="featured-property-image"
          markerTestID="featured-property-image-marker"
          placeholder={(
            <View style={styles.featuredPlaceholder}>
              <Image
                source={require('../../../assets/images/property-placeholder.png')}
                style={styles.featuredPlaceholderImage}
                resizeMode="cover"
              />
            </View>
          )}
        />
      </View>

      <View style={styles.featuredBadge}>
        <Text style={styles.featuredBadgeText}>{`MOST DISCUSSED · ${periodLabel}`}</Text>
      </View>

      <View style={styles.featuredContent}>
        <Text style={styles.featuredAddress}>{property.address}</Text>
        <Text style={styles.featuredCity}>{property.city}</Text>
      </View>
    </Pressable>
  );
}

export function LeaderboardRoute() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<LeaderboardPeriod>('all');
  const { data } = useLeaderboard(period, 50);

  const rankings = data?.rankings ?? [];
  const currentUserRank = data?.currentUserRank ?? null;
  const featuredProperty = data?.featuredProperty ?? null;

  return (
    <View style={styles.screen}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <Pressable onPress={() => navigate(-1)} hitSlop={8}>
            <Icon name="ArrowLeft" size="lg" color={colors.text} />
          </Pressable>
          <Text style={styles.title}>Leaderboard</Text>
          <View style={{ width: 22 }} />
        </View>

        <View style={styles.periodRow}>
          {PERIODS.map((entry) => (
            <Chip
              key={entry.key}
              label={entry.label}
              active={period === entry.key}
              onPress={() => setPeriod(entry.key)}
            />
          ))}
        </View>

        {featuredProperty ? (
          <FeaturedPropertyCard
            property={featuredProperty}
            period={period}
            onPress={() => navigate(buildPropertyRoute(featuredProperty.id, '/leaderboard'))}
          />
        ) : null}

        <FlatList
          data={rankings}
          keyExtractor={(item) => item.userId}
          renderItem={({ item }) => (
            <RankingRow
              entry={item}
              isCurrentUser={currentUserRank?.userId === item.userId}
            />
          )}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={currentUserRank ? (
            <View style={styles.currentUserCard}>
              <Text style={styles.currentUserLabel}>Your rank</Text>
              <Text style={styles.currentUserValue}>#{currentUserRank.rank}</Text>
            </View>
          ) : null}
          showsVerticalScrollIndicator={false}
        />
      </View>
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
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  periodRow: {
    flexDirection: 'row',
    gap: 10,
    paddingBottom: 14,
  },
  featuredCard: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    marginBottom: 14,
  },
  featuredMedia: {
    height: 190,
  },
  featuredMediaSurface: {
    width: '100%',
    height: 190,
  },
  featuredMediaImage: {
    width: '100%',
    height: 190,
  },
  featuredPlaceholder: {
    width: '100%',
    height: 190,
    backgroundColor: colors.surfaceMuted,
  },
  featuredPlaceholderImage: {
    width: '100%',
    height: 190,
  },
  featuredBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  featuredBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  featuredContent: {
    padding: 16,
    gap: 4,
  },
  featuredAddress: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  featuredCity: {
    color: colors.textMuted,
  },
  listContent: {
    paddingBottom: 96,
    gap: 10,
  },
  rankingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: 18,
  },
  rankingRowCurrentUser: {
    borderWidth: 1,
    borderColor: colors.gold,
  },
  rankNumber: {
    width: 24,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textMuted,
    textAlign: 'center',
  },
  rankNumberCurrentUser: {
    color: colors.goldDeep,
  },
  rankingInfo: {
    flex: 1,
  },
  rankingName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  rankingMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  rankingMetaText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  rankingPoints: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  rankingPointsCurrentUser: {
    color: colors.goldDeep,
  },
  currentUserCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
  },
  currentUserLabel: {
    color: colors.textMuted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  currentUserValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginTop: 4,
  },
});
