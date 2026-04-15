/**
 * CustomTabBar — Floating pill tab bar replacing the default Expo Router tab bar.
 *
 * Design spec (Section 7.1):
 * - Floating pill: 62px height, rounded-[36px], internal padding 4px
 * - Translucent (#FFFFFFCC) on map tab, solid (#FFFFFF) on other tabs
 * - Backdrop blur 20px (expo-blur on native, CSS backdrop-filter on web)
 * - 1px inside stroke $warm-200 (#F5F0E8)
 * - Shadow: blur 12, color #00000010, offset (0, 2)
 * - Active tab: gold capsule ($gold-500), white icon + label
 * - Inactive tab: transparent, $warm-400 icon + label
 * - Labels: Inter 10/600, letterSpacing 0.5, uppercase
 * - Icons: Phosphor 18px, bold weight for active
 *
 * Safe-area aware: positioned above the bottom safe area inset.
 */

import React from 'react';
import { View, Pressable, Text, Platform, StyleSheet } from 'react-native';
import { Link, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';

import { Icon, type IconName } from '@/src/components/ui/Icon';
import { BlurContainer } from '@/src/components/ui/BlurContainer';
import { shadows } from '@/src/lib/shadows';

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

function getVisibleTabHref(routeName: string): Href {
  switch (routeName) {
    case 'feed':
      return '/feed';
    case 'saved':
      return '/saved';
    case 'profile':
      return '/profile';
    case 'index':
    default:
      return '/';
  }
}

/** Palette constants from design spec. */
const COLORS = {
  gold500: '#F5A623',
  warm200: '#F5F0E8',
  warm400: '#C7BFB3',
  white: '#FFFFFF',
  /** 80% white — used as translucent pill fill on the map tab */
  whiteTranslucent: 'rgba(255, 255, 255, 0.80)',
} as const;

export function CustomTabBar({ state, descriptors: _descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  // Determine if the currently active tab is the map screen.
  const activeRoute = state.routes[state.index];
  const isMapRouteActive = !!activeRoute?.name && MAP_ROUTE_NAMES.has(activeRoute.name);
  const isMapTab = isMapRouteActive;

  // Only render the four user-facing tabs. Deep-link helper routes live in the
  // same navigator so the tab shell stays mounted, but they must never appear
  // as separate tab items.
  const visibleRoutes = state.routes.filter((route: TabRoute) =>
    VISIBLE_TAB_NAMES.has(route.name)
  );

  // Build the inner tab items.
  const tabItems = visibleRoutes.map((route: TabRoute) => {
    const routeIndex = state.routes.indexOf(route);
    const isFocused =
      state.index === routeIndex || (route.name === 'index' && isMapRouteActive);
    const iconName = TAB_ICONS[route.name] ?? 'HouseLine';
    const label = TAB_LABELS[route.name] ?? route.name;

    // Saved tab uses 'fill' weight when active instead of 'bold'.
    const activeWeight = route.name === 'saved' ? 'fill' as const : 'bold' as const;
    const iconWeight = isFocused ? activeWeight : 'regular' as const;
    const iconColor = isFocused ? COLORS.white : COLORS.warm400;
    const labelColor = isFocused ? COLORS.white : COLORS.warm400;

    const onPress = (pressEvent?: { preventDefault?: () => void }) => {
      const navigationEvent = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });

      if (navigationEvent.defaultPrevented) {
        pressEvent?.preventDefault?.();
        return;
      }

      if (Platform.OS !== 'web' && !isFocused) {
        navigation.navigate(route.name, route.params);
      }
    };

    const onLongPress = () => {
      navigation.emit({
        type: 'tabLongPress',
        target: route.key,
      });
    };

    if (Platform.OS === 'web') {
      return (
        <Link
          key={route.key}
          href={getVisibleTabHref(route.name)}
          onPress={onPress}
          accessibilityRole="tab"
          accessibilityState={isFocused ? { selected: true } : {}}
          accessibilityLabel={label}
          accessibilityHint={`Switch to ${label} tab`}
          testID={`tab-${route.name}`}
          style={[
            styles.tabItem,
            isFocused && styles.tabItemActive,
            reducedMotion && isFocused && { opacity: 1 },
          ]}
        >
          <Icon
            name={iconName}
            size={18}
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
        </Link>
      );
    }

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
        style={[
          styles.tabItem,
          isFocused && styles.tabItemActive,
          reducedMotion && isFocused && { opacity: 1 },
        ]}
      >
        <Icon
          name={iconName}
          size={18}
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

  // The blur container wraps the pill on map tab; on other tabs it's solid white.
  const pillContent = (
    <View
      style={[
        styles.pill,
        !isMapTab && { backgroundColor: COLORS.white },
        isMapTab && Platform.OS !== 'web' && { backgroundColor: 'transparent' },
        isMapTab && Platform.OS === 'web' && { backgroundColor: COLORS.whiteTranslucent },
      ]}
    >
      {tabItems}
    </View>
  );

  return (
    <View
      style={[
        styles.outerWrapper,
        {
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}
      testID="custom-tab-bar"
      // Ensure touches on the tab bar don't fall through to the map.
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.pillShadowWrapper,
          shadows['tab-bar'],
        ]}
        // Web shadow is applied via className, native via style.
        // We keep the shadow on an outer view because BlurView clips overflow.
        className="shadow-tab-bar"
      >
        {isMapTab ? (
          <BlurContainer
            intensity={80}
            tint="light"
            style={styles.blurPill}
            testID="tab-bar-blur"
          >
            {pillContent}
          </BlurContainer>
        ) : (
          pillContent
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 100,
    paddingHorizontal: 16,
    paddingTop: 12,
    // No background — the gradient underneath will handle the fade.
    pointerEvents: 'box-none',
  },
  pillShadowWrapper: {
    borderRadius: 36,
    zIndex: 101,
    elevation: 101,
    // Constrain max width for wide screens / tablets / landscape.
    maxWidth: 420,
    alignSelf: 'center',
    width: '100%',
  },
  pill: {
    height: 62,
    zIndex: 102,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: COLORS.warm200,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  blurPill: {
    zIndex: 102,
    borderRadius: 36,
    overflow: 'hidden',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 54,
    borderRadius: 26,
    gap: 4,
  },
  tabItemActive: {
    backgroundColor: COLORS.gold500,
  },
  tabLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
  },
});
