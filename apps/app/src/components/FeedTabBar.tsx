import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { FeedTab } from '@/src/hooks';
import { useT, type TranslationKey } from '@/src/i18n';

interface FeedTabDef {
  key: FeedTab;
  labelKey: TranslationKey;
}

const FEED_TABS: FeedTabDef[] = [
  { key: 'trending', labelKey: 'feed.filter.trending' },
  { key: 'latest', labelKey: 'feed.filter.latest' },
  { key: 'recent-activity', labelKey: 'feed.filter.recentActivity' },
  { key: 'following', labelKey: 'feed.filter.following' },
];

const MIN_TAB_WIDTH = 112;
const HORIZONTAL_PADDING = 20;

export interface FeedTabBarProps {
  activeFilter: FeedTab;
  onFilterChange: (filter: FeedTab) => void;
}

export function FeedTabBar({ activeFilter, onFilterChange }: FeedTabBarProps) {
  const t = useT();
  const { width } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = React.useState(0);
  const measuredWidth = containerWidth || width;
  const availableWidth = Math.max(0, measuredWidth - HORIZONTAL_PADDING * 2);
  const equalTabWidth = availableWidth / FEED_TABS.length;
  const shouldOverflow = equalTabWidth < MIN_TAB_WIDTH;

  const tabWidthStyle = useMemo(
    () => ({
      width: shouldOverflow ? MIN_TAB_WIDTH : equalTabWidth,
    }),
    [equalTabWidth, shouldOverflow]
  );

  return (
    <View
      style={styles.container}
      testID="feed-tab-bar"
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        bounces={shouldOverflow}
        contentContainerStyle={[
          styles.scrollContent,
          shouldOverflow ? styles.scrollContentOverflow : styles.scrollContentFit,
        ]}
      >
        {FEED_TABS.map((tab) => {
          const isActive = activeFilter === tab.key;
          return (
            <Pressable
              key={tab.key}
              testID={`feed-tab-${tab.key}`}
              accessibilityRole="tab"
              accessibilityLabel={t(tab.labelKey)}
              accessibilityState={{ selected: isActive }}
              onPress={() => onFilterChange(tab.key)}
              style={({ pressed }) => [
                styles.tab,
                tabWidthStyle,
                pressed && styles.tabPressed,
              ]}
            >
              <Text
                numberOfLines={1}
                style={[styles.tabLabel, isActive ? styles.tabLabelActive : styles.tabLabelIdle]}
              >
                {t(tab.labelKey)}
              </Text>
              <View style={[styles.underline, isActive ? styles.underlineActive : null]} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 2,
    paddingBottom: 4,
  },
  scrollContent: {
    alignItems: 'flex-end',
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  scrollContentFit: {
    flexGrow: 1,
  },
  scrollContentOverflow: {
    minWidth: MIN_TAB_WIDTH * FEED_TABS.length + HORIZONTAL_PADDING * 2,
  },
  tab: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 8,
    paddingTop: 8,
    backgroundColor: 'transparent',
  },
  tabPressed: {
    opacity: 0.72,
  },
  tabLabel: {
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: 0,
    fontFamily: 'Inter_600SemiBold',
  },
  tabLabelActive: {
    color: '#2D2926',
  },
  tabLabelIdle: {
    color: '#7A7066',
  },
  underline: {
    marginTop: 8,
    width: '100%',
    height: 2,
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  underlineActive: {
    backgroundColor: '#F5A623',
  },
});
