import { useNavigate, useParams } from 'react-router-dom';

import { Icon } from '@/src/components/ui/Icon';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { ResponsivePanel } from '@/src/components/ui/ResponsivePanel';
import { usePublicProfile } from '@/src/hooks/useUserProfile';
import { StyleSheet, Text, View } from '../dom';
import { colors } from '../theme';

function KarmaRankBadge({ title, level }: { title: string; level: number }) {
  const tones = ['#C7BFB3', '#F5A623', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444'];
  const color = tones[Math.min(level - 1, tones.length - 1)] || tones[0];
  return (
    <View style={[styles.badge, { backgroundColor: `${color}20` }]}>
      <Icon name="Star" size="sm" weight="fill" color={color} />
      <Text style={[styles.badgeText, { color }]}>{title}</Text>
    </View>
  );
}

export function PublicProfileRoute() {
  const navigate = useNavigate();
  const { id = 'user' } = useParams();
  const { data: profile, isLoading, isError } = usePublicProfile(id ?? null);

  if (isLoading) {
    return (
      <ResponsivePanel title="Profile" onClose={() => navigate(-1)}>
        <View style={styles.centered}>
          <Icon name="User" size={32} color={colors.goldDeep} />
          <Text style={styles.body}>Loading profile...</Text>
        </View>
      </ResponsivePanel>
    );
  }

  if (isError || !profile) {
    return (
      <ResponsivePanel title="Profile" onClose={() => navigate(-1)}>
        <View style={styles.centered}>
          <Icon name="WarningCircle" size={48} color={colors.textSoft} />
          <Text style={styles.title}>User not found</Text>
        </View>
      </ResponsivePanel>
    );
  }

  return (
    <ResponsivePanel title={profile.displayName} onClose={() => navigate(-1)}>
      <View style={styles.screen}>
        <View style={styles.headerCard}>
          <UserAvatar username={profile.handle} displayName={profile.displayName} size="lg" />
          <Text style={styles.displayName}>{profile.displayName}</Text>
          <Text style={styles.handle}>@{profile.handle}</Text>
          <KarmaRankBadge title={profile.karmaRank.title} level={profile.karmaRank.level} />
          <Text style={styles.karma}>{profile.karma} karma</Text>
        </View>

        <View style={styles.statsRow}>
          <StatItem label="Guesses" value={profile.guessCount} iconName="Crosshair" />
          <StatItem label="Comments" value={profile.commentCount} iconName="ChatCircle" />
        </View>

        <View style={styles.metaCard}>
          <Text style={styles.metaText}>
            Member since {new Date(profile.joinedAt).toLocaleDateString(undefined, {
              month: 'long',
              year: 'numeric',
            })}
          </Text>
        </View>
      </View>
    </ResponsivePanel>
  );
}

function StatItem({
  label,
  value,
  iconName,
}: {
  label: string;
  value: number;
  iconName: 'Crosshair' | 'ChatCircle';
}) {
  return (
    <View style={styles.statItem}>
      <Icon name={iconName} size="md" color={colors.textSoft} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: colors.bg,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
  },
  body: {
    color: colors.textMuted,
    marginTop: 12,
  },
  screen: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
    backgroundColor: colors.bg,
  },
  headerCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 24,
    paddingVertical: 24,
    paddingHorizontal: 18,
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
  karma: {
    color: colors.textMuted,
    marginTop: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
    marginTop: 8,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 18,
    paddingVertical: 18,
    gap: 2,
  },
  statValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 2,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 12,
  },
  metaCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 14,
  },
  metaText: {
    color: colors.textMuted,
  },
});
