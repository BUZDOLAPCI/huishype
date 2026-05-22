import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { SectionProps } from './types';
import { SectionCard } from './SectionCard';
import { useT, type TranslationKey } from '../../i18n';

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

interface PropertyDetailsProps extends SectionProps {
  onReport?: () => void;
}

export function PropertyDetails({ property, onReport }: PropertyDetailsProps) {
  const t = useT();
  const statusLabelKeys: Record<string, TranslationKey> = {
    active: 'property.status.active',
    inactive: 'property.status.inactive',
    demolished: 'property.status.demolished',
  };

  return (
    <View style={styles.stack}>
      <SectionCard
        title={t('property.details.title')}
        icon="information-circle"
        description={t('property.details.description')}
      >
        <View style={styles.detailTable}>
          <DetailRow
            icon="calendar-outline"
            label={t('property.details.yearBuilt')}
            value={property.yearBuilt}
          />
          <DetailRow
            icon="resize-outline"
            label={t('property.details.surfaceArea')}
            value={property.floorAreaM2 ? `${property.floorAreaM2} m²` : null}
          />
          <DetailRow
            icon="pin-outline"
            label={t('property.details.postalCode')}
            value={property.postalCode}
          />
          <DetailRow
            icon="checkmark-circle-outline"
            label={t('property.details.status')}
            value={
              property.status && statusLabelKeys[property.status]
                ? t(statusLabelKeys[property.status])
                : null
            }
          />
        </View>
      </SectionCard>

      <SectionCard
        title={t('property.activity.title')}
        icon="pulse"
        description={t('property.activity.description')}
      >
        <View style={styles.activityGrid}>
          <ActivityStat label={t('common.views')} value={formatCompactCount(property.viewCount)} />
          <ActivityStat
            label={t('common.guesses')}
            value={property.guessCount > 0 ? formatCompactCount(property.guessCount) : '0'}
            helperText={property.guessCount === 0 ? t('property.activity.beFirstGuess') : undefined}
          />
          <ActivityStat
            label={t('common.comments')}
            value={property.commentCount > 0 ? formatCompactCount(property.commentCount) : '0'}
            helperText={property.commentCount === 0 ? t('property.activity.startConversation') : undefined}
          />
        </View>
        {onReport ? (
          <View style={styles.reportRow}>
            <Pressable
              onPress={onReport}
              style={styles.reportButton}
              testID="property-report-button"
              accessibilityRole="button"
              accessibilityLabel={t('property.report.a11y')}
            >
              <Ionicons name="flag-outline" size={15} color="#8C8479" />
              <Text style={styles.reportText}>{t('property.report.action')}</Text>
            </Pressable>
          </View>
        ) : null}
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
  reportRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  reportButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    backgroundColor: '#F5EFE6',
  },
  reportText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8C8479',
  },
});
