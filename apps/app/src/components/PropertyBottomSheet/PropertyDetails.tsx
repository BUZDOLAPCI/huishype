import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { SectionProps } from './types';
import { SectionCard } from './SectionCard';

interface DetailRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | number | null | undefined;
}

function DetailRow({ icon, label, value }: DetailRowProps) {
  if (value === null || value === undefined) {
    return null;
  }

  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIconWrap}>
        <Ionicons name={icon} size={16} color="#9C958A" />
      </View>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function ActivityStat({
  label,
  value,
  helperText,
}: {
  label: string;
  value: string;
  helperText?: string;
}) {
  return (
    <View style={styles.activityTile}>
      <Text style={styles.activityValue}>{value}</Text>
      <Text style={styles.activityLabel}>{label}</Text>
      {helperText ? <Text style={styles.activityHelper}>{helperText}</Text> : null}
    </View>
  );
}

function formatCompactCount(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  }
  return String(value);
}

export function PropertyDetails({ property }: SectionProps) {
  const statusLabels: Record<string, string> = {
    active: 'Active',
    inactive: 'Inactive',
    demolished: 'Demolished',
  };

  return (
    <View style={styles.stack}>
      <SectionCard
        title="Property Details"
        icon="information-circle"
        description="Core reference details for the address itself."
      >
        <View style={styles.detailTable}>
          <DetailRow
            icon="calendar-outline"
            label="Year Built"
            value={property.yearBuilt}
          />
          <DetailRow
            icon="resize-outline"
            label="Surface Area"
            value={property.floorAreaM2 ? `${property.floorAreaM2} m²` : null}
          />
          <DetailRow
            icon="pin-outline"
            label="Postal code"
            value={property.postalCode}
          />
          <DetailRow
            icon="checkmark-circle-outline"
            label="Status"
            value={property.status ? statusLabels[property.status] : null}
          />
        </View>
      </SectionCard>

      <SectionCard
        title="Activity"
        icon="pulse"
        description="How much attention this property is getting right now."
      >
        <View style={styles.activityGrid}>
          <ActivityStat label="Views" value={formatCompactCount(property.viewCount)} />
          <ActivityStat
            label="Guesses"
            value={property.guessCount > 0 ? formatCompactCount(property.guessCount) : '0'}
            helperText={property.guessCount === 0 ? 'Be the first to guess' : undefined}
          />
          <ActivityStat
            label="Comments"
            value={property.commentCount > 0 ? formatCompactCount(property.commentCount) : '0'}
            helperText={property.commentCount === 0 ? 'Start the conversation' : undefined}
          />
        </View>
      </SectionCard>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 14,
  },
  detailTable: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F5EBDD',
    backgroundColor: '#FFFCF7',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F5EBDD',
  },
  detailIconWrap: {
    width: 28,
    alignItems: 'flex-start',
  },
  detailLabel: {
    flex: 1,
    fontSize: 14,
    color: '#8C8479',
  },
  detailValue: {
    maxWidth: '48%',
    fontSize: 14,
    fontWeight: '700',
    color: '#2D2926',
    textAlign: 'right',
  },
  activityGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  activityTile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F5EBDD',
    backgroundColor: '#FFFCF7',
  },
  activityValue: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '700',
    color: '#2D2926',
  },
  activityLabel: {
    marginTop: 6,
    fontSize: 12,
    color: '#8C8479',
  },
  activityHelper: {
    marginTop: 6,
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 14,
    color: '#AEA699',
  },
});
