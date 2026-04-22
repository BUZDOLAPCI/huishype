/**
 * CustomTabBar — Full-width flat dock based on the
 * “1. Map Screen - Alt Tab Bar 2” pen reference.
 */

import React from 'react';
import { View, Pressable, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { Icon, type IconName } from '@/src/components/ui/Icon';
import { BlurContainer } from '@/src/components/ui/BlurContainer';
import {
  TAB_BAR_DOCK_BOTTOM_PADDING,
  TAB_BAR_DOCK_HEIGHT,
  TAB_BAR_DOCK_PANEL_HEIGHT,
  TAB_BAR_DOCK_TOP_PADDING,
  TAB_BAR_SEGMENT_GAP,
  TAB_BAR_SEGMENT_HEIGHT,
  TAB_BAR_SEGMENT_SIDE_PADDING,
} from './tabBarMetrics';

/**
 * Minimal type for the props passed by expo-router's `<Tabs tabBar={...}>`.
 * The full type lives in @react-navigation/bottom-tabs but isn't directly
 * resolvable from the app package in this pnpm workspace. We define just
 * what we need here.
 */
interface TabRoute {
  key: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any;
}

interface TabBarProps {
  state: {
    index: number;
    routes: TabRoute[];
  };
  descriptors: Record<string, {
    options: Record<string, unknown>;
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  navigation: any;
}

/** Tab icon mapping — matches the design spec (Section 6.4). */
const TAB_ICONS: Record<string, IconName> = {
  index: 'MapTrifold',
  feed: 'List',
  saved: 'BookmarkSimple',
  profile: 'User',
};

/** Tab labels (uppercase in rendering). */
const TAB_LABELS: Record<string, string> = {
  index: 'Map',
  feed: 'Feed',
  saved: 'Saved',
  profile: 'Profile',
};

const TAB_HREFS: Record<string, Href> = {
  index: '/',
  feed: '/feed',
  saved: '/saved',
  profile: '/profile',
};

const VISIBLE_TAB_NAMES = new Set(Object.keys(TAB_LABELS));

const MAP_ROUTE_NAMES = new Set([
  'index',
  '@[camera]',
  '[...address]',
  'map/index',
  'map/[...address]',
  'map/[city]/[postcode]/[street]/[house]',
  'map/[country]/[city]/[postcode]/[street]/[house]',
]);

/** Palette derived from the selected pen frame. */
const COLORS = {
  warmDivider: '#E8E0D4',
  warmPanelMap: 'rgba(255, 248, 240, 0.88)',
  warmPanelSolid: '#FDF7EE',
  activeFill: 'rgba(255, 255, 255, 0.78)',
  activeIcon: '#DE911D',
  activeLabel: '#2D2926',
  inactive: '#736C62',
} as const;

export function CustomTabBar({ state, descriptors: _descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const activeRoute = state.routes[state.index];
  const isMapRouteActive = !!activeRoute?.name && MAP_ROUTE_NAMES.has(activeRoute.name);
  const isMapTab = isMapRouteActive;
  const extraBottomInset = Math.max(insets.bottom - TAB_BAR_DOCK_BOTTOM_PADDING, 0);

  const visibleRoutes = state.routes.filter((route: TabRoute) =>
    VISIBLE_TAB_NAMES.has(route.name)
  );

  const tabItems = visibleRoutes.map((route: TabRoute) => {
    const routeIndex = state.routes.indexOf(route);
    const isFocused =
      state.index === routeIndex || (route.name === 'index' && isMapRouteActive);
    const iconName = TAB_ICONS[route.name] ?? 'HouseLine';
    const label = TAB_LABELS[route.name] ?? route.name;

    const activeWeight = route.name === 'saved' ? 'fill' as const : 'bold' as const;
    const iconWeight = isFocused ? activeWeight : 'regular' as const;
    const iconColor = isFocused ? COLORS.activeIcon : COLORS.inactive;
    const labelColor = isFocused ? COLORS.activeLabel : COLORS.inactive;

    const onPress = () => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });

      if (!isFocused && !event.defaultPrevented) {
        if (Platform.OS === 'web') {
          const href = TAB_HREFS[route.name];
          if (href) {
            router.navigate(href);
            return;
          }
        }

        navigation.navigate(route.name, route.params);
      }
    };

    const onLongPress = () => {
      navigation.emit({
        type: 'tabLongPress',
        target: route.key,
      });
    };

    return (
      <Pressable
        key={route.key}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="tab"
        accessibilityState={isFocused ? { selected: true } : {}}
        accessibilityLabel={label}
        accessibilityHint={`Switch to ${label} tab`}
        testID={`tab-${route.name}`}
        style={({ pressed }) => [
          styles.tabItem,
          isFocused && styles.tabItemActive,
          pressed && styles.tabItemPressed,
        ]}
      >
        <Icon
          name={iconName}
          size={16}
          weight={iconWeight}
          color={iconColor}
        />
        <Text
          style={[
            styles.tabLabel,
            { color: labelColor },
          ]}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {label.toUpperCase()}
        </Text>
      </Pressable>
    );
  });

  const dockPanel = (
    <View
      style={[
        styles.dockPanel,
        {
          backgroundColor: isMapTab ? COLORS.warmPanelMap : COLORS.warmPanelSolid,
          paddingBottom: TAB_BAR_DOCK_BOTTOM_PADDING + extraBottomInset,
        },
      ]}
    >
      <View style={styles.segmentRail}>
        {tabItems}
      </View>
    </View>
  );

  return (
    <View
      style={[
        styles.outerWrapper,
        {
          height: TAB_BAR_DOCK_HEIGHT + extraBottomInset,
        },
      ]}
      testID="custom-tab-bar"
      pointerEvents="box-none"
    >
      <View style={styles.dockDivider} />
      {isMapTab ? (
        <BlurContainer
          intensity={72}
          tint="light"
          style={styles.blurDock}
          testID="tab-bar-blur"
        >
          {dockPanel}
        </BlurContainer>
      ) : (
        dockPanel
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    pointerEvents: 'box-none',
  },
  dockDivider: {
    height: 1,
    backgroundColor: COLORS.warmDivider,
  },
  blurDock: {
    overflow: 'hidden',
  },
  dockPanel: {
    minHeight: TAB_BAR_DOCK_PANEL_HEIGHT,
    paddingTop: TAB_BAR_DOCK_TOP_PADDING,
    paddingHorizontal: TAB_BAR_SEGMENT_SIDE_PADDING,
  },
  segmentRail: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    flexDirection: 'row',
    height: TAB_BAR_SEGMENT_HEIGHT,
    gap: TAB_BAR_SEGMENT_GAP,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: TAB_BAR_SEGMENT_HEIGHT,
    borderRadius: 16,
    gap: 2,
    paddingVertical: 7,
  },
  tabItemActive: {
    backgroundColor: COLORS.activeFill,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  tabItemPressed: {
    opacity: 0.84,
  },
  tabLabel: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.4,
  },
});
