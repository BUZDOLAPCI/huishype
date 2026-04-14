/**
 * CustomTabBar — Floating pill tab bar for the web route shell.
 *
 * Design spec (Section 7.1):
 * - Floating pill: 62px height, rounded-[36px], internal padding 4px
 * - Translucent (#FFFFFFCC) on map tab, solid (#FFFFFF) on other tabs
 * - Backdrop blur 20px via CSS `backdrop-filter`
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
import type { CSSProperties } from 'react';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';

import { Icon, type IconName } from '@/src/components/ui/Icon';
import { BlurContainer } from '@/src/components/ui/BlurContainer';
import { shadows } from '@/src/lib/shadows';

/**
 * Minimal type for the current tab-shell adapter props. We define only the
 * shape the web shell actually needs.
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

/** Palette constants from design spec. */
const COLORS = {
  gold500: '#F5A623',
  warm200: '#F5F0E8',
  warm400: '#C7BFB3',
  white: '#FFFFFF',
  /** 80% white — used as translucent pill fill on the map tab */
  whiteTranslucent: 'rgba(255, 255, 255, 0.80)',
} as const;

export function CustomTabBar({ state, descriptors, navigation }: TabBarProps) {
  const reducedMotion = useReducedMotion();

  // Determine if the currently active tab is the map screen.
  const activeRoute = state.routes[state.index];
  const isMapTab = activeRoute?.name === 'index';

  // Filter out hidden tabs (like "two" which has `href: null`).
  const visibleRoutes = state.routes.filter((_route: TabRoute, i: number) => {
    const descriptor = descriptors[state.routes[i].key];
    if (!descriptor) return true;
    // Hidden routes set `href` to null/false in the tab descriptor.
    const hrefValue = descriptor.options.href;
    return hrefValue !== null;
  });

  // Build the inner tab items.
  const tabItems = visibleRoutes.map((route: TabRoute) => {
    const routeIndex = state.routes.indexOf(route);
    const isFocused = state.index === routeIndex;
    const iconName = TAB_ICONS[route.name] ?? 'HouseLine';
    const label = TAB_LABELS[route.name] ?? route.name;

    // Saved tab uses 'fill' weight when active instead of 'bold'.
    const activeWeight = route.name === 'saved' ? 'fill' as const : 'bold' as const;
    const iconWeight = isFocused ? activeWeight : 'regular' as const;
    const iconColor = isFocused ? COLORS.white : COLORS.warm400;
    const labelColor = isFocused ? COLORS.white : COLORS.warm400;

    const onPress = () => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });

      if (!isFocused && !event.defaultPrevented) {
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
      <button
        key={route.key}
        type="button"
        role="tab"
        aria-selected={isFocused}
        onClick={onPress}
        onContextMenu={(event) => {
          event.preventDefault();
          onLongPress();
        }}
        aria-label={`Switch to ${label} tab`}
        title={`Switch to ${label} tab`}
        data-testid={`tab-${route.name}`}
        style={{
          ...styles.tabItem,
          ...(isFocused ? styles.tabItemActive : {}),
          ...(reducedMotion && isFocused ? { opacity: 1 } : {}),
        }}
      >
        <Icon
          name={iconName}
          size={18}
          weight={iconWeight}
          color={iconColor}
        />
        <span
          style={{
            ...styles.tabLabel,
            color: labelColor,
          }}
        >
          {label.toUpperCase()}
        </span>
      </button>
    );
  });

  // The blur container wraps the pill on map tab; on other tabs it's solid white.
  const pillContent = (
    <div
      style={{
        ...styles.pill,
        backgroundColor: isMapTab ? COLORS.whiteTranslucent : COLORS.white,
      }}
    >
      {tabItems}
    </div>
  );

  return (
    <div
      data-testid="custom-tab-bar"
      style={{
        ...styles.outerWrapper,
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div
        style={{
          ...styles.pillShadowWrapper,
          ...shadows['tab-bar'],
        }}
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
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  outerWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 12,
    // No background — the gradient underneath will handle the fade.
    pointerEvents: 'none',
  },
  pillShadowWrapper: {
    borderRadius: 36,
    // Constrain max width for wide screens / tablets / landscape.
    maxWidth: 420,
    alignSelf: 'center',
    width: '100%',
    pointerEvents: 'auto',
  },
  pill: {
    height: 62,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: COLORS.warm200,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 4,
    overflow: 'hidden',
  },
  blurPill: {
    borderRadius: 36,
    overflow: 'hidden',
  },
  tabItem: {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 54,
    borderRadius: 26,
    gap: 4,
    cursor: 'pointer',
    padding: 0,
  },
  tabItemActive: {
    backgroundColor: COLORS.gold500,
  },
  tabLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
  },
};
