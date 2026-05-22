import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatPropertyPrice } from '@huishype/shared';

import { Icon } from '@/src/components/ui/Icon';
import type { UseMapFilterControllerReturn } from '@/src/hooks/useMapFilterController';
import { useWebDismissibleLayer } from '@/src/providers/WebDismissibleLayerProvider';
import { useT, type TranslationKey } from '@/src/i18n';
import type { MapSocialScope } from '@/src/lib/mapRoute';
import {
  getMapPriceSuggestions,
  getMapVisiblePriceModes,
  isMapFilterCategoryActive,
  isMapStatusPillActive,
  MAP_ACTIVITY_TIME_FILTERS,
  MAP_STATUS_PILL_STATES,
  type MapActivityFilter,
  type MapActivityTimeFilter,
  type MapFilterCategory,
  type MapFilterDraftState,
  type MapFilters,
  type MapMarketState,
  type MapPriceMode,
  type MapPriceSuggestion,
  type MapStatusPillState,
} from '@/src/lib/sharedMapFilters';

const COLORS = {
  white: '#FFFFFF',
  whiteOverlay: 'rgba(255, 255, 255, 0.92)',
  warm100: '#FFF8F0',
  warm200: '#F5F0E8',
  warm300: '#E8E0D4',
  warm400: '#C7BFB3',
  warm700: '#504A42',
  warm900: '#2D2926',
  gold400: '#F7C948',
  gold500: '#F5A623',
  gold600: '#D68B14',
  goldTint: 'rgba(245, 166, 35, 0.18)',
  shadow: 'rgba(65, 52, 36, 0.16)',
} as const;

interface MapFilterBarProps {
  controller: UseMapFilterControllerReturn;
  socialScope?: MapSocialScope;
  onPanelOpenChange?: (open: boolean) => void;
  onToggleFollowing?: () => void;
  followingActivity?: MapActivityTimeFilter;
  onFollowingActivityChange?: (activity: MapActivityTimeFilter) => void;
}

type PriceBound = 'from' | 'to';

interface ActivePriceInputState {
  mode: MapPriceMode;
  bound: PriceBound;
  highlightIndex: number;
  typedSinceOpen: boolean;
}

interface MapFilterPillProps {
  label: string;
  active: boolean;
  open: boolean;
  onPress: () => void;
  onDismiss?: () => void;
  testID: string;
  variant?: 'panel' | 'toggle';
}

interface OptionedFilterPillProps {
  label: string;
  active: boolean;
  open: boolean;
  onBodyPress: () => void;
  onArrowPress: () => void;
  testID: string;
}

function MapFilterPill({
  label,
  active,
  open,
  onPress,
  onDismiss,
  testID,
  variant = 'panel',
}: MapFilterPillProps) {
  const t = useT();
  const showsExpandedState = variant === 'panel';

  return (
    <View style={styles.pillShell}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{
          expanded: showsExpandedState ? open : undefined,
          selected: active,
        }}
        onPress={onPress}
        style={({ pressed }) => [
          styles.pill,
          active ? styles.pillActive : styles.pillInactive,
          open && styles.pillOpen,
          pressed && styles.pillPressed,
        ]}
        testID={testID}
      >
        <Text
          numberOfLines={1}
          style={[styles.pillLabel, active ? styles.pillLabelActive : styles.pillLabelInactive]}
        >
          {label}
        </Text>
        {variant === 'toggle' ? (
          active ? (
            <Icon name="Check" size="sm" color={COLORS.white} />
          ) : null
        ) : active ? (
          <View style={styles.pillActiveBadge}>
            <Text style={styles.pillActiveBadgeText}>{t('filter.on')}</Text>
          </View>
        ) : (
          <Icon name="CaretDown" size="sm" color={COLORS.warm700} />
        )}
      </Pressable>
      {active && onDismiss ? (
        <Pressable
          accessibilityLabel={t('filter.clear', { label })}
          accessibilityRole="button"
          hitSlop={10}
          onPress={onDismiss}
          style={styles.dismissButton}
          testID={`${testID}-dismiss`}
        >
          <Icon name="X" size="sm" color={COLORS.white} />
        </Pressable>
      ) : null}
    </View>
  );
}

function OptionedFilterPill({
  label,
  active,
  open,
  onBodyPress,
  onArrowPress,
  testID,
}: OptionedFilterPillProps) {
  const t = useT();

  return (
    <View style={styles.pillShell}>
      <View
        style={[
          styles.optionedPill,
          active ? styles.pillActive : styles.pillInactive,
          open && styles.pillOpen,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: active }}
          onPress={onBodyPress}
          style={({ pressed }) => [styles.optionedPillBody, pressed && styles.pillPressed]}
          testID={testID}
        >
          <Text
            numberOfLines={1}
            style={[styles.pillLabel, active ? styles.pillLabelActive : styles.pillLabelInactive]}
          >
            {label}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('filter.openOptions', { label })}
          accessibilityState={{ expanded: open }}
          onPress={onArrowPress}
          style={({ pressed }) => [styles.optionedPillArrow, pressed && styles.pillPressed]}
          testID={`${testID}-arrow`}
        >
          <Icon name="CaretDown" size="sm" color={active ? COLORS.white : COLORS.warm700} />
        </Pressable>
      </View>
    </View>
  );
}

const PRICE_MODE_META: Record<MapPriceMode, { titleKey: TranslationKey; testId: string }> = {
  sale: { titleKey: 'filter.price.sale', testId: 'sale' },
  rent: { titleKey: 'filter.price.rent', testId: 'rent' },
};

const MARKET_STATE_LABEL_KEYS: Record<MapMarketState, TranslationKey> = {
  'for-sale': 'filter.status.forSale',
  'for-rent': 'filter.status.forRent',
  sold: 'filter.status.sold',
  rented: 'filter.status.rented',
  'not-listed': 'filter.status.notListed',
};

const ACTIVITY_LABEL_KEYS: Record<MapActivityFilter, TranslationKey> = {
  all: 'filter.activity.any',
  today: 'filter.activity.today',
  '10d': 'filter.activity.10d',
  '30d': 'filter.activity.30d',
  'all-time': 'filter.activity.allTime',
};

function parseDraftInputValue(value: string): number | null {
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) {
    return null;
  }

  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getPriceFieldError(
  draftFilters: MapFilterDraftState,
  mode: MapPriceMode,
  t: ReturnType<typeof useT>
): string | null {
  const fromValue = parseDraftInputValue(
    mode === 'sale' ? draftFilters.salePriceFrom : draftFilters.rentPriceFrom
  );
  const toValue = parseDraftInputValue(
    mode === 'sale' ? draftFilters.salePriceTo : draftFilters.rentPriceTo
  );

  if (fromValue != null && toValue != null && fromValue > toValue) {
    return t('filter.price.errorRange');
  }

  return null;
}

function formatCompactPrice(value: number | null): string | null {
  if (value == null) {
    return null;
  }

  return formatPropertyPrice(value, 'NL', { compact: true }).replace(/\s+/g, ' ').trim();
}

function getPriceBoundsForMode(filters: MapFilters, mode: MapPriceMode): [number | null, number | null] {
  return mode === 'sale'
    ? [filters.salePriceFrom, filters.salePriceTo]
    : [filters.rentPriceFrom, filters.rentPriceTo];
}

function summarizePriceBounds(
  from: number | null,
  to: number | null,
  t: ReturnType<typeof useT>
): string | null {
  const fromLabel = formatCompactPrice(from);
  const toLabel = formatCompactPrice(to);

  if (fromLabel && toLabel) {
    return `${fromLabel} - ${toLabel}`;
  }

  if (fromLabel) {
    return t('filter.price.fromSummary', { price: fromLabel });
  }

  if (toLabel) {
    return t('filter.price.toSummary', { price: toLabel });
  }

  return null;
}

function getMapActivityFilterLabel(activity: MapActivityFilter, t: ReturnType<typeof useT>): string {
  return t(ACTIVITY_LABEL_KEYS[activity]);
}

function getMapMarketStateLabel(state: MapMarketState, t: ReturnType<typeof useT>): string {
  return t(MARKET_STATE_LABEL_KEYS[state]);
}

function getMapFilterPillSummary(
  category: MapFilterCategory,
  filters: MapFilters,
  t: ReturnType<typeof useT>
): string | null {
  if (category === 'price') {
    const segments = getMapVisiblePriceModes(filters.marketState)
      .map((mode) => {
        const [from, to] = getPriceBoundsForMode(filters, mode);
        const summary = summarizePriceBounds(from, to, t);

        if (!summary) {
          return null;
        }

        return mode === 'sale'
          ? t('filter.price.saleSummary', { summary })
          : t('filter.price.rentSummary', { summary });
      })
      .filter((summary): summary is string => summary != null);

    return segments.length > 0 ? segments.join(' · ') : null;
  }

  if (category === 'marketState') {
    if (filters.marketState.length === 1) {
      return getMapMarketStateLabel(filters.marketState[0]!, t);
    }

    return filters.marketState.length > 0
      ? t('filter.selectedCount', { count: filters.marketState.length })
      : null;
  }

  return filters.activity === 'all' ? null : getMapActivityFilterLabel(filters.activity, t);
}

export function MapFilterBar({
  controller,
  socialScope = 'all',
  onPanelOpenChange,
  onToggleFollowing,
  followingActivity = 'all-time',
  onFollowingActivityChange,
}: MapFilterBarProps) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const [activePriceInput, setActivePriceInput] = useState<ActivePriceInputState | null>(null);
  const [openOptionsPanel, setOpenOptionsPanel] = useState<'activity' | 'following' | null>(null);
  const priceInputBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webSuggestionPressKeyRef = useRef<string | null>(null);
  const {
    appliedFilters,
    draftFilters,
    openCategory,
    orderedCategories,
    toggleCategory,
    closeCategoryPanel,
    dismissCategory,
    updatePriceDraft,
    selectPriceSuggestion,
    commitPriceDraft,
    toggleStatusPill,
    toggleActivity,
    setActivity,
  } = controller;

  const topOffset = Platform.OS === 'web' ? 116 : insets.top + 108;
  const isPricePanelOpen = openCategory === 'price';
  const isActivityPanelOpen = openOptionsPanel === 'activity';
  const isFollowingPanelOpen = openOptionsPanel === 'following';
  const isAnyPanelOpen = isPricePanelOpen || openOptionsPanel != null;

  useEffect(() => {
    onPanelOpenChange?.(isAnyPanelOpen);
    return () => {
      onPanelOpenChange?.(false);
    };
  }, [isAnyPanelOpen, onPanelOpenChange]);

  const cancelScheduledPriceInputBlur = useCallback(() => {
    if (priceInputBlurTimeoutRef.current != null) {
      clearTimeout(priceInputBlurTimeoutRef.current);
      priceInputBlurTimeoutRef.current = null;
    }
  }, []);

  const schedulePriceInputBlur = useCallback(() => {
    cancelScheduledPriceInputBlur();
    priceInputBlurTimeoutRef.current = setTimeout(() => {
      priceInputBlurTimeoutRef.current = null;
      setActivePriceInput(null);
    }, 0);
  }, [cancelScheduledPriceInputBlur]);

  useEffect(() => () => cancelScheduledPriceInputBlur(), [cancelScheduledPriceInputBlur]);

  const visiblePriceModes = useMemo(
    () => (isPricePanelOpen ? getMapVisiblePriceModes(appliedFilters.marketState) : []),
    [appliedFilters.marketState, isPricePanelOpen]
  );
  const priceErrors = useMemo(
    () => ({
      sale: getPriceFieldError(draftFilters, 'sale', t),
      rent: getPriceFieldError(draftFilters, 'rent', t),
    }),
    [draftFilters, t]
  );
  const hasPriceRangeError = visiblePriceModes.some((mode) => priceErrors[mode] != null);

  const getDraftValue = useCallback(
    (mode: MapPriceMode, bound: PriceBound) => {
      if (mode === 'sale') {
        return bound === 'from' ? draftFilters.salePriceFrom : draftFilters.salePriceTo;
      }

      return bound === 'from' ? draftFilters.rentPriceFrom : draftFilters.rentPriceTo;
    },
    [draftFilters]
  );

  const getSuggestionsForInput = useCallback(
    (mode: MapPriceMode, bound: PriceBound, typedSinceOpen: boolean): MapPriceSuggestion[] =>
      getMapPriceSuggestions(mode, bound, getDraftValue(mode, bound), {
        filterByPrefix: typedSinceOpen,
      }),
    [getDraftValue]
  );

  const getHighlightedSuggestionIndex = useCallback(
    (
      suggestions: MapPriceSuggestion[],
      mode: MapPriceMode,
      bound: PriceBound,
      currentValueOverride?: string
    ): number => {
      if (suggestions.length === 0) {
        return -1;
      }

      const currentValue = currentValueOverride ?? getDraftValue(mode, bound);
      const selectedIndex = suggestions.findIndex(
        (suggestion) => suggestion.value === currentValue
      );
      return selectedIndex >= 0 ? selectedIndex : 0;
    },
    [getDraftValue]
  );

  const openPriceSuggestions = useCallback(
    (mode: MapPriceMode, bound: PriceBound, typedSinceOpen = false) => {
      cancelScheduledPriceInputBlur();
      const suggestions = getSuggestionsForInput(mode, bound, typedSinceOpen);
      setActivePriceInput({
        mode,
        bound,
        highlightIndex: getHighlightedSuggestionIndex(suggestions, mode, bound),
        typedSinceOpen,
      });
    },
    [cancelScheduledPriceInputBlur, getHighlightedSuggestionIndex, getSuggestionsForInput]
  );

  const commitAndClosePricePanel = useCallback(() => {
    if (hasPriceRangeError) {
      cancelScheduledPriceInputBlur();
      return;
    }

    cancelScheduledPriceInputBlur();
    setActivePriceInput(null);
    commitPriceDraft();
    closeCategoryPanel();
  }, [cancelScheduledPriceInputBlur, closeCategoryPanel, commitPriceDraft, hasPriceRangeError]);

  const handlePanelBackdropPress = useCallback(() => {
    cancelScheduledPriceInputBlur();
    setActivePriceInput(null);
    setOpenOptionsPanel(null);
    if (openCategory === 'price' && !hasPriceRangeError) {
      commitPriceDraft();
    }
    closeCategoryPanel();
  }, [
    cancelScheduledPriceInputBlur,
    closeCategoryPanel,
    commitPriceDraft,
    hasPriceRangeError,
    openCategory,
  ]);

  useWebDismissibleLayer({
    id: 'map-filter-panel',
    active: isAnyPanelOpen,
    onDismiss: handlePanelBackdropPress,
    enabled: Platform.OS === 'web',
  });

  const handleCategoryPress = useCallback(
    (nextCategory: MapFilterCategory) => {
      setOpenOptionsPanel(null);
      if (openCategory === 'price' && openCategory !== nextCategory) {
        commitPriceDraft();
      }

      if (openCategory === nextCategory) {
        if (nextCategory === 'price') {
          commitAndClosePricePanel();
          return;
        }

        closeCategoryPanel();
        return;
      }

      toggleCategory(nextCategory);
    },
    [closeCategoryPanel, commitAndClosePricePanel, commitPriceDraft, openCategory, toggleCategory]
  );

  const openActivityPanel = useCallback(() => {
    if (openCategory === 'price' && !hasPriceRangeError) {
      commitPriceDraft();
    }
    closeCategoryPanel();
    setOpenOptionsPanel((current) => (current === 'activity' ? null : 'activity'));
  }, [closeCategoryPanel, commitPriceDraft, hasPriceRangeError, openCategory]);

  const openFollowingPanel = useCallback(() => {
    if (openCategory === 'price' && !hasPriceRangeError) {
      commitPriceDraft();
    }
    closeCategoryPanel();
    setOpenOptionsPanel((current) => (current === 'following' ? null : 'following'));
  }, [closeCategoryPanel, commitPriceDraft, hasPriceRangeError, openCategory]);

  const handleActivityBodyPress = useCallback(() => {
    setOpenOptionsPanel(null);
    toggleActivity('all-time');
  }, [toggleActivity]);

  const handleActivityOptionPress = useCallback(
    (activity: MapActivityTimeFilter) => {
      setActivity(activity);
      setOpenOptionsPanel(null);
    },
    [setActivity]
  );

  const handleFollowingBodyPress = useCallback(() => {
    setOpenOptionsPanel(null);
    if (socialScope === 'following' && followingActivity === 'all-time') {
      onToggleFollowing?.();
      return;
    }
    onFollowingActivityChange?.('all-time');
    if (socialScope !== 'following') {
      onToggleFollowing?.();
    }
  }, [followingActivity, onFollowingActivityChange, onToggleFollowing, socialScope]);

  const handleFollowingOptionPress = useCallback(
    (activity: MapActivityTimeFilter) => {
      onFollowingActivityChange?.(activity);
      if (socialScope !== 'following') {
        onToggleFollowing?.();
      }
      setOpenOptionsPanel(null);
    },
    [onFollowingActivityChange, onToggleFollowing, socialScope]
  );

  const panelTitle = isPricePanelOpen ? t('filter.price') : null;
  const priceSuggestions = useMemo(() => {
    if (!isPricePanelOpen || activePriceInput == null) {
      return [];
    }

    return getSuggestionsForInput(
      activePriceInput.mode,
      activePriceInput.bound,
      activePriceInput.typedSinceOpen
    );
  }, [activePriceInput, getSuggestionsForInput, isPricePanelOpen]);

  useEffect(() => {
    if (activePriceInput == null) {
      return;
    }

    setActivePriceInput((current) => {
      if (
        current == null ||
        current.mode !== activePriceInput.mode ||
        current.bound !== activePriceInput.bound
      ) {
        return current;
      }

      const nextHighlightIndex =
        priceSuggestions.length === 0
          ? -1
          : Math.min(
              current.highlightIndex < 0 ? 0 : current.highlightIndex,
              priceSuggestions.length - 1
            );

      if (nextHighlightIndex === current.highlightIndex) {
        return current;
      }

      return {
        ...current,
        highlightIndex: nextHighlightIndex,
      };
    });
  }, [activePriceInput, priceSuggestions]);

  const handleSuggestionSelect = useCallback(
    (mode: MapPriceMode, bound: PriceBound, value: string) => {
      cancelScheduledPriceInputBlur();
      selectPriceSuggestion(mode, bound, value);
      setActivePriceInput(null);
    },
    [cancelScheduledPriceInputBlur, selectPriceSuggestion]
  );

  const handleSuggestionPointerDown = useCallback(
    (
      mode: MapPriceMode,
      bound: PriceBound,
      value: string,
      event?: { preventDefault?: () => void }
    ) => {
      if (Platform.OS !== 'web') {
        return;
      }

      event?.preventDefault?.();
      webSuggestionPressKeyRef.current = `${mode}:${bound}:${value}`;
      handleSuggestionSelect(mode, bound, value);
    },
    [handleSuggestionSelect]
  );

  const handleSuggestionPress = useCallback(
    (mode: MapPriceMode, bound: PriceBound, value: string) => {
      const selectionKey = `${mode}:${bound}:${value}`;
      if (Platform.OS === 'web' && webSuggestionPressKeyRef.current === selectionKey) {
        webSuggestionPressKeyRef.current = null;
        return;
      }

      webSuggestionPressKeyRef.current = null;
      handleSuggestionSelect(mode, bound, value);
    },
    [handleSuggestionSelect]
  );

  const handlePriceDraftChange = useCallback(
    (mode: MapPriceMode, bound: PriceBound, value: string) => {
      updatePriceDraft(mode, bound, value);

      setActivePriceInput((current) => {
        if (current == null || current.mode !== mode || current.bound !== bound) {
          const suggestions = getMapPriceSuggestions(mode, bound, value, {
            filterByPrefix: false,
          });
          return {
            mode,
            bound,
            highlightIndex: getHighlightedSuggestionIndex(suggestions, mode, bound, value),
            typedSinceOpen: false,
          };
        }

        const suggestions = getMapPriceSuggestions(mode, bound, value, {
          filterByPrefix: current.typedSinceOpen,
        });
        return {
          ...current,
          highlightIndex: getHighlightedSuggestionIndex(suggestions, mode, bound, value),
        };
      });
    },
    [getHighlightedSuggestionIndex, updatePriceDraft]
  );

  const moveHighlightedSuggestion = useCallback(
    (direction: -1 | 1) => {
      if (priceSuggestions.length === 0) {
        return;
      }

      setActivePriceInput((current) => {
        if (current == null) {
          return current;
        }

        const currentIndex = current.highlightIndex >= 0 ? current.highlightIndex : 0;
        const nextIndex =
          (currentIndex + direction + priceSuggestions.length) % priceSuggestions.length;

        return {
          ...current,
          highlightIndex: nextIndex,
        };
      });
    },
    [priceSuggestions.length]
  );

  const selectHighlightedSuggestion = useCallback(() => {
    if (activePriceInput == null) {
      return false;
    }

    const highlightedSuggestion = priceSuggestions[activePriceInput.highlightIndex];
    if (!highlightedSuggestion) {
      return false;
    }

    handleSuggestionSelect(
      activePriceInput.mode,
      activePriceInput.bound,
      highlightedSuggestion.value
    );
    return true;
  }, [activePriceInput, handleSuggestionSelect, priceSuggestions]);

  const handlePriceInputKeyPress = useCallback(
    (
      mode: MapPriceMode,
      bound: PriceBound,
      event: { nativeEvent?: { key?: string }; preventDefault?: () => void }
    ) => {
      const key = event.nativeEvent?.key;
      if (key == null) {
        return;
      }

      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault?.();
        if (
          activePriceInput == null ||
          activePriceInput.mode !== mode ||
          activePriceInput.bound !== bound
        ) {
          openPriceSuggestions(mode, bound, false);
          return;
        }

        moveHighlightedSuggestion(key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (key === 'Enter') {
        if (activePriceInput?.mode === mode && activePriceInput.bound === bound) {
          event.preventDefault?.();
          if (selectHighlightedSuggestion()) {
            return;
          }
        }
        return;
      }

      if (/^\d$/.test(key)) {
        if (
          activePriceInput == null ||
          activePriceInput.mode !== mode ||
          activePriceInput.bound !== bound
        ) {
          openPriceSuggestions(mode, bound, true);
          return;
        }

        setActivePriceInput((current) => {
          if (current == null || current.mode !== mode || current.bound !== bound) {
            return current;
          }

          return {
            ...current,
            typedSinceOpen: true,
            highlightIndex: 0,
          };
        });
        return;
      }

      if (key.length === 1 && key !== 'Backspace' && key !== 'Delete' && key !== 'Tab') {
        event.preventDefault?.();
      }
    },
    [activePriceInput, moveHighlightedSuggestion, openPriceSuggestions, selectHighlightedSuggestion]
  );

  return (
    <>
      {isAnyPanelOpen ? (
        <Pressable
          onPress={handlePanelBackdropPress}
          style={styles.panelBackdrop}
          testID="map-filter-panel-backdrop"
        />
      ) : null}

      <View
        pointerEvents={isAnyPanelOpen ? 'auto' : 'box-none'}
        style={[styles.container, { top: topOffset }]}
      >
        <ScrollView
          horizontal
          contentContainerStyle={styles.railContent}
          showsHorizontalScrollIndicator={false}
          style={styles.rail}
          testID="map-filter-rail"
        >
          {orderedCategories
            .filter((category) => category === 'price')
            .map((category) => {
              const active = isMapFilterCategoryActive(appliedFilters, category);
              const summary = getMapFilterPillSummary(category, appliedFilters, t);
              const label = t('filter.price');
              const pillLabel = active && summary ? `${label}: ${summary}` : label;

              return (
                <MapFilterPill
                  key={category}
                  active={active}
                  label={pillLabel}
                  onDismiss={() => dismissCategory(category)}
                  onPress={() => handleCategoryPress(category)}
                  open={openCategory === category}
                  testID={`map-filter-pill-${category}`}
                />
              );
            })}

          {MAP_STATUS_PILL_STATES.map((state: MapStatusPillState) => (
            <MapFilterPill
              key={state}
              active={isMapStatusPillActive(appliedFilters, state)}
              label={getMapMarketStateLabel(state, t)}
              onPress={() => toggleStatusPill(state)}
              open={false}
              testID={`map-filter-pill-market-state-${state}`}
              variant="toggle"
            />
          ))}

          <OptionedFilterPill
            active={appliedFilters.activity !== 'all'}
            label={
              appliedFilters.activity === 'all'
                ? t('filter.activity')
                : `${t('filter.activity')}: ${getMapActivityFilterLabel(appliedFilters.activity, t)}`
            }
            onArrowPress={openActivityPanel}
            onBodyPress={handleActivityBodyPress}
            open={isActivityPanelOpen}
            testID="map-filter-pill-activity"
          />

          {onToggleFollowing ? (
            <OptionedFilterPill
              active={socialScope === 'following'}
              label={
                socialScope === 'following'
                  ? `${t('filter.following')}: ${getMapActivityFilterLabel(followingActivity, t)}`
                  : t('filter.following')
              }
              onArrowPress={openFollowingPanel}
              onBodyPress={handleFollowingBodyPress}
              open={isFollowingPanelOpen}
              testID="map-filter-pill-following"
            />
          ) : null}
        </ScrollView>

        {isPricePanelOpen ? (
          <View style={styles.panel} testID="map-filter-panel-price">
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>{panelTitle}</Text>
              <Pressable
                accessibilityLabel={t('filter.closeFilters')}
                accessibilityRole="button"
                hitSlop={10}
                onPress={handlePanelBackdropPress}
                testID="map-filter-panel-close"
              >
                <Icon name="X" size="sm" color={COLORS.warm700} />
              </Pressable>
            </View>

            {openCategory === 'price' ? (
              <>
                <Text style={styles.panelHint}>
                  {t('filter.price.hint')}
                </Text>

                {visiblePriceModes.map((mode) => {
                  const meta = PRICE_MODE_META[mode];
                  const priceError = priceErrors[mode];

                  return (
                    <View key={mode} style={styles.priceSection}>
                      {visiblePriceModes.length > 1 ? (
                        <Text style={styles.priceSectionTitle}>{t(meta.titleKey)}</Text>
                      ) : null}

                      <View style={styles.priceInputRow}>
                        <View style={styles.priceInputColumn}>
                          <Text style={styles.inputLabel}>{t('filter.from')}</Text>
                          <TextInput
                            keyboardType="number-pad"
                            onBlur={schedulePriceInputBlur}
                            onChangeText={(value) => handlePriceDraftChange(mode, 'from', value)}
                            onFocus={() => openPriceSuggestions(mode, 'from', false)}
                            onKeyPress={(event) => handlePriceInputKeyPress(mode, 'from', event)}
                            onPressIn={() => openPriceSuggestions(mode, 'from', false)}
                            onSubmitEditing={commitAndClosePricePanel}
                            placeholder="0"
                            placeholderTextColor={COLORS.warm400}
                            returnKeyType="done"
                            style={[
                              styles.priceInput,
                              priceError != null && styles.priceInputError,
                            ]}
                            testID={`map-filter-input-price-${meta.testId}-from`}
                            value={getDraftValue(mode, 'from')}
                          />

                          {activePriceInput?.mode === mode &&
                          activePriceInput.bound === 'from' &&
                          priceSuggestions.length > 0 ? (
                            <View
                              style={styles.suggestionListShell}
                              testID={`map-filter-suggestions-price-${meta.testId}-from`}
                            >
                              <ScrollView
                                keyboardShouldPersistTaps="handled"
                                nestedScrollEnabled
                                style={styles.suggestionList}
                              >
                                {priceSuggestions.map((suggestion) => (
                                  <Pressable
                                    key={suggestion.key}
                                    onPointerDown={(event) =>
                                      handleSuggestionPointerDown(
                                        mode,
                                        'from',
                                        suggestion.value,
                                        event
                                      )
                                    }
                                    onPress={() =>
                                      handleSuggestionPress(mode, 'from', suggestion.value)
                                    }
                                    style={({ pressed }) => [
                                      styles.suggestionOption,
                                      suggestion.custom && styles.suggestionOptionCustom,
                                      activePriceInput.highlightIndex >= 0 &&
                                        priceSuggestions[activePriceInput.highlightIndex]?.key ===
                                          suggestion.key &&
                                        styles.suggestionOptionHighlighted,
                                      pressed && styles.suggestionOptionPressed,
                                    ]}
                                    testID={`map-filter-suggestion-price-${meta.testId}-from-${
                                      suggestion.value || 'empty'
                                    }`}
                                  >
                                    <Text
                                      style={[
                                        styles.suggestionOptionText,
                                        suggestion.custom && styles.suggestionOptionTextCustom,
                                      ]}
                                    >
                                      {suggestion.value ? suggestion.label : t('filter.noMax')}
                                    </Text>
                                  </Pressable>
                                ))}
                              </ScrollView>
                            </View>
                          ) : null}
                        </View>

                        <View style={styles.priceInputColumn}>
                          <Text style={styles.inputLabel}>{t('filter.to')}</Text>
                          <TextInput
                            keyboardType="number-pad"
                            onBlur={schedulePriceInputBlur}
                            onChangeText={(value) => handlePriceDraftChange(mode, 'to', value)}
                            onFocus={() => openPriceSuggestions(mode, 'to', false)}
                            onKeyPress={(event) => handlePriceInputKeyPress(mode, 'to', event)}
                            onPressIn={() => openPriceSuggestions(mode, 'to', false)}
                            onSubmitEditing={commitAndClosePricePanel}
                            placeholder={t('filter.noMax')}
                            placeholderTextColor={COLORS.warm400}
                            returnKeyType="done"
                            style={[
                              styles.priceInput,
                              priceError != null && styles.priceInputError,
                            ]}
                            testID={`map-filter-input-price-${meta.testId}-to`}
                            value={getDraftValue(mode, 'to')}
                          />

                          {activePriceInput?.mode === mode &&
                          activePriceInput.bound === 'to' &&
                          priceSuggestions.length > 0 ? (
                            <View
                              style={styles.suggestionListShell}
                              testID={`map-filter-suggestions-price-${meta.testId}-to`}
                            >
                              <ScrollView
                                keyboardShouldPersistTaps="handled"
                                nestedScrollEnabled
                                style={styles.suggestionList}
                              >
                                {priceSuggestions.map((suggestion) => (
                                  <Pressable
                                    key={suggestion.key}
                                    onPointerDown={(event) =>
                                      handleSuggestionPointerDown(
                                        mode,
                                        'to',
                                        suggestion.value,
                                        event
                                      )
                                    }
                                    onPress={() =>
                                      handleSuggestionPress(mode, 'to', suggestion.value)
                                    }
                                    style={({ pressed }) => [
                                      styles.suggestionOption,
                                      suggestion.custom && styles.suggestionOptionCustom,
                                      activePriceInput.highlightIndex >= 0 &&
                                        priceSuggestions[activePriceInput.highlightIndex]?.key ===
                                          suggestion.key &&
                                        styles.suggestionOptionHighlighted,
                                      pressed && styles.suggestionOptionPressed,
                                    ]}
                                    testID={`map-filter-suggestion-price-${meta.testId}-to-${
                                      suggestion.value || 'empty'
                                    }`}
                                  >
                                    <Text
                                      style={[
                                        styles.suggestionOptionText,
                                        suggestion.custom && styles.suggestionOptionTextCustom,
                                      ]}
                                    >
                                      {suggestion.value ? suggestion.label : t('filter.noMax')}
                                    </Text>
                                  </Pressable>
                                ))}
                              </ScrollView>
                            </View>
                          ) : null}
                        </View>
                      </View>

                      {priceError ? (
                        <Text
                          style={styles.priceErrorText}
                          testID={`map-filter-error-price-${meta.testId}`}
                        >
                          {priceError}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}

                <View style={styles.panelActions}>
                  <Pressable
                    onPress={() => dismissCategory('price')}
                    style={({ pressed }) => [
                      styles.secondaryAction,
                      pressed && styles.secondaryActionPressed,
                    ]}
                    testID="map-filter-reset-price"
                  >
                    <Text style={styles.secondaryActionText}>{t('filter.reset')}</Text>
                  </Pressable>

                  <Pressable
                    disabled={hasPriceRangeError}
                    onPress={commitAndClosePricePanel}
                    style={({ pressed }) => [
                      styles.primaryAction,
                      hasPriceRangeError && styles.primaryActionDisabled,
                      pressed && styles.primaryActionPressed,
                    ]}
                    testID="map-filter-apply-price"
                  >
                    <Text style={styles.primaryActionText}>{t('filter.apply')}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        {isActivityPanelOpen ? (
          <View style={styles.panel} testID="map-filter-panel-activity">
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>{t('filter.activity')}</Text>
              <Pressable
                accessibilityLabel={t('filter.closeActivity')}
                accessibilityRole="button"
                hitSlop={10}
                onPress={handlePanelBackdropPress}
                testID="map-filter-panel-activity-close"
              >
                <Icon name="X" size="sm" color={COLORS.warm700} />
              </Pressable>
            </View>

            <View style={styles.optionList}>
              {MAP_ACTIVITY_TIME_FILTERS.map((activity) => {
                const selected = appliedFilters.activity === activity;
                return (
                  <Pressable
                    key={activity}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => handleActivityOptionPress(activity)}
                    style={({ pressed }) => [
                      styles.optionRow,
                      selected && styles.optionRowSelected,
                      pressed && styles.optionRowPressed,
                    ]}
                    testID={`map-filter-option-activity-${activity}`}
                  >
                    <Text style={[styles.optionRowText, selected && styles.optionRowTextSelected]}>
                      {getMapActivityFilterLabel(activity, t)}
                    </Text>
                    {selected ? <Icon name="Check" size="sm" color={COLORS.gold600} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {isFollowingPanelOpen ? (
          <View style={styles.panel} testID="map-filter-panel-following">
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>{t('filter.following')}</Text>
              <Pressable
                accessibilityLabel={t('filter.closeFollowing')}
                accessibilityRole="button"
                hitSlop={10}
                onPress={handlePanelBackdropPress}
                testID="map-filter-panel-following-close"
              >
                <Icon name="X" size="sm" color={COLORS.warm700} />
              </Pressable>
            </View>

            <View style={styles.optionList}>
              {MAP_ACTIVITY_TIME_FILTERS.map((activity) => {
                const selected = socialScope === 'following' && followingActivity === activity;
                return (
                  <Pressable
                    key={activity}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => handleFollowingOptionPress(activity)}
                    style={({ pressed }) => [
                      styles.optionRow,
                      selected && styles.optionRowSelected,
                      pressed && styles.optionRowPressed,
                    ]}
                    testID={`map-filter-option-following-${activity}`}
                  >
                    <Text style={[styles.optionRowText, selected && styles.optionRowTextSelected]}>
                      {getMapActivityFilterLabel(activity, t)}
                    </Text>
                    {selected ? <Icon name="Check" size="sm" color={COLORS.gold600} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  panelBackdrop: {
    position: 'absolute',
    inset: 0,
    zIndex: 92,
  },
  container: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 95,
  },
  rail: {
    overflow: 'visible',
  },
  railContent: {
    alignItems: 'center',
    gap: 4,
    paddingRight: 8,
  },
  pillShell: {
    position: 'relative',
    paddingRight: 4,
  },
  pill: {
    minHeight: 34,
    borderRadius: 17,
    paddingLeft: 12,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 240,
  },
  optionedPill: {
    minHeight: 34,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
    maxWidth: 260,
  },
  optionedPillBody: {
    minHeight: 34,
    paddingLeft: 12,
    paddingRight: 8,
    justifyContent: 'center',
    flexShrink: 1,
  },
  optionedPillArrow: {
    minHeight: 34,
    width: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(80, 74, 66, 0.18)',
  },
  pillInactive: {
    backgroundColor: COLORS.whiteOverlay,
    borderWidth: 1,
    borderColor: COLORS.warm300,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  pillActive: {
    backgroundColor: COLORS.gold500,
    borderWidth: 1,
    borderColor: COLORS.gold600,
    shadowColor: 'rgba(182, 117, 16, 0.28)',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 5,
  },
  pillOpen: {
    transform: [{ translateY: 1 }],
  },
  pillPressed: {
    opacity: 0.96,
  },
  pillLabel: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  pillLabelInactive: {
    color: COLORS.warm700,
  },
  pillLabelActive: {
    color: COLORS.white,
  },
  pillActiveBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  pillActiveBadgeText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '700',
  },
  dismissButton: {
    position: 'absolute',
    right: 0,
    top: -3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.gold600,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  panel: {
    marginTop: 12,
    position: 'relative',
    zIndex: 1,
    borderRadius: 22,
    padding: 16,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.warm300,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 1,
    shadowRadius: 28,
    elevation: 12,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  panelTitle: {
    color: COLORS.warm900,
    fontSize: 16,
    fontWeight: '700',
  },
  panelHint: {
    color: COLORS.warm700,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  priceSection: {
    gap: 10,
    marginBottom: 14,
  },
  priceSectionTitle: {
    color: COLORS.warm900,
    fontSize: 13,
    fontWeight: '700',
  },
  priceInputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  priceInputColumn: {
    flex: 1,
    gap: 6,
  },
  inputLabel: {
    color: COLORS.warm700,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  priceInput: {
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: COLORS.warm100,
    borderWidth: 1,
    borderColor: COLORS.warm300,
    color: COLORS.warm900,
    fontSize: 15,
    fontWeight: '600',
  },
  priceInputError: {
    borderColor: '#B94A48',
  },
  priceErrorText: {
    color: '#B94A48',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  suggestionListShell: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.warm300,
    backgroundColor: COLORS.white,
    overflow: 'hidden',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 10,
  },
  suggestionList: {
    maxHeight: 220,
  },
  suggestionOption: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.warm300,
  },
  suggestionOptionCustom: {
    backgroundColor: COLORS.goldTint,
  },
  suggestionOptionHighlighted: {
    backgroundColor: COLORS.warm100,
  },
  suggestionOptionPressed: {
    backgroundColor: COLORS.warm100,
  },
  suggestionOptionText: {
    color: COLORS.warm900,
    fontSize: 14,
    fontWeight: '600',
  },
  suggestionOptionTextCustom: {
    color: COLORS.gold600,
  },
  panelActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 16,
  },
  optionList: {
    gap: 8,
  },
  optionRow: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.warm100,
    borderWidth: 1,
    borderColor: COLORS.warm300,
  },
  optionRowSelected: {
    backgroundColor: COLORS.goldTint,
    borderColor: COLORS.gold400,
  },
  optionRowPressed: {
    opacity: 0.92,
  },
  optionRowText: {
    color: COLORS.warm700,
    fontSize: 14,
    fontWeight: '700',
  },
  optionRowTextSelected: {
    color: COLORS.gold600,
  },
  secondaryAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.warm100,
    borderWidth: 1,
    borderColor: COLORS.warm300,
  },
  secondaryActionPressed: {
    backgroundColor: COLORS.warm200,
  },
  secondaryActionText: {
    color: COLORS.warm700,
    fontSize: 14,
    fontWeight: '700',
  },
  primaryAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gold500,
  },
  primaryActionDisabled: {
    backgroundColor: COLORS.warm400,
  },
  primaryActionPressed: {
    backgroundColor: COLORS.gold600,
  },
  primaryActionText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  marketStateWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  marketStateOption: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.warm100,
    borderWidth: 1,
    borderColor: COLORS.warm300,
  },
  marketStateOptionSelected: {
    backgroundColor: COLORS.goldTint,
    borderColor: COLORS.gold400,
  },
  marketStateOptionPressed: {
    opacity: 0.92,
  },
  marketStateLabel: {
    color: COLORS.warm700,
    fontSize: 13,
    fontWeight: '600',
  },
  marketStateLabelSelected: {
    color: COLORS.gold600,
  },
});
