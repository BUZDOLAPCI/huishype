/**
 * FeedFilterChips — Horizontal filter chips for the feed screen.
 *
 * Three chips: Trending, Latest, Recent Activity.
 * Uses the Chip primitive with gold active state.
 *
 * Design spec: Section 7.4 (Feed Filter Chips).
 */

import React from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { Chip } from './ui/Chip';
import { Icon } from './ui/Icon';
import type { FeedFilter } from '../hooks/useFeed';

interface FilterChipDef {
  key: FeedFilter;
  label: string;
  leadingIcon?: boolean;
}

const FILTER_CHIPS: FilterChipDef[] = [
  { key: 'trending', label: 'Trending', leadingIcon: true },
  { key: 'recent', label: 'Latest' },
  { key: 'activity', label: 'Recent Activity' },
];

interface FeedFilterChipsProps {
  activeFilter: FeedFilter;
  onFilterChange: (filter: FeedFilter) => void;
}

export function FeedFilterChips({
  activeFilter,
  onFilterChange,
}: FeedFilterChipsProps) {
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
              label={chip.label}
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
