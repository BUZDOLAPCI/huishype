/**
 * FeedFilterChips — Horizontal filter chips for the feed screen.
 */

import React from 'react';
import { Chip } from './ui/Chip';
import { Icon } from './ui/Icon';
import type { FeedTab } from '../hooks/useFeed';

interface FilterChipDef {
  key: FeedTab;
  label: string;
  leadingIcon?: boolean;
}

const FILTER_CHIPS: FilterChipDef[] = [
  { key: 'trending', label: 'Trending', leadingIcon: true },
  { key: 'latest', label: 'Latest' },
  { key: 'recent-activity', label: 'Recent Activity' },
];

interface FeedFilterChipsProps {
  activeFilter: FeedTab;
  onFilterChange: (filter: FeedTab) => void;
}

export function FeedFilterChips({
  activeFilter,
  onFilterChange,
}: FeedFilterChipsProps) {
  return (
    <div style={styles.container}>
      <div style={styles.scrollContent}>
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
      </div>
    </div>
  );
}

const styles = {
  container: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  scrollContent: {
    display: 'flex',
    overflowX: 'auto',
    paddingLeft: 20,
    paddingRight: 20,
    gap: 10,
    alignItems: 'center',
  },
} satisfies Record<string, import('react').CSSProperties>;
