/**
 * FeedFilterChips — Horizontal filter chips for the feed screen.
 *
 * Two chips: Trending and Activity.
 * Uses the Chip primitive with gold active state.
 *
 * Design spec: Section 7.4 (Feed Filter Chips).
 */

import React from 'react';
import { ScrollView, View, StyleSheet } from 'react-native';
import { Chip } from './ui/Chip';
import { Icon } from './ui/Icon';
import type { FeedTab } from '../hooks/useFeed';
import { useT, type TranslationKey } from '../i18n';

interface FilterChipDef {
  key: FeedTab;
  labelKey: TranslationKey;
  leadingIcon?: boolean;
}

const FILTER_CHIPS: FilterChipDef[] = [
  { key: 'trending', labelKey: 'feed.filter.trending', leadingIcon: true },
  { key: 'activity', labelKey: 'feed.filter.activity' },
];

interface FeedFilterChipsProps {
  activeFilter: FeedTab;
  onFilterChange: (filter: FeedTab) => void;
}

export function FeedFilterChips({
  activeFilter,
  onFilterChange,
}: FeedFilterChipsProps) {
  const t = useT();

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {FILTER_CHIPS.map((chip) => {
          const isActive = activeFilter === chip.key;
          return (
            <Chip
              key={chip.key}
              label={t(chip.labelKey)}
              active={isActive}
              onPress={() => onFilterChange(chip.key)}
              leading={
                chip.leadingIcon ? (
                  <Icon
                    name="Flame"
                    size={14}
                    weight="fill"
                    color={isActive ? '#FFFFFF' : '#B47712'}
                  />
                ) : undefined
              }
              testID={`filter-chip-${chip.key}`}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  scrollContent: {
    paddingHorizontal: 20,
    gap: 10,
    alignItems: 'center',
  },
});
