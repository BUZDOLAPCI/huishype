import React, { useCallback, useMemo, useRef } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/src/components/ui/Icon';
import type { UseMapFilterControllerReturn } from '@/src/hooks/useMapFilterController';
import {
  getMapFilterPillLabel,
  getMapFilterPillSummary,
  getMapMarketStateLabel,
  isMapFilterCategoryActive,
  MAP_MARKET_STATES,
  type MapFilterCategory,
  type MapMarketState,
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

const SALE_PRICE_SUGGESTIONS = [250000, 500000, 750000, 1000000];
const RENT_PRICE_SUGGESTIONS = [1000, 1500, 2000, 3000];

interface MapFilterBarProps {
  controller: UseMapFilterControllerReturn;
}

interface MapFilterPillProps {
  label: string;
  active: boolean;
  open: boolean;
  onPress: () => void;
  onDismiss?: () => void;
  testID: string;
}

function MapFilterPill({
  label,
  active,
  open,
  onPress,
  onDismiss,
  testID,
}: MapFilterPillProps) {
  return (
    <View style={styles.pillShell}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open, selected: active }}
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
        {active ? (
          <View style={styles.pillActiveBadge}>
            <Text style={styles.pillActiveBadgeText}>On</Text>
          </View>
        ) : (
          <Icon name="CaretDown" size="sm" color={COLORS.warm700} />
        )}
      </Pressable>
      {active && onDismiss ? (
        <Pressable
          accessibilityLabel={`Clear ${label}`}
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

function isPriceCategory(
  category: MapFilterCategory | null,
): category is Extract<MapFilterCategory, 'salePrice' | 'rentPrice'> {
  return category === 'salePrice' || category === 'rentPrice';
}

export function MapFilterBar({ controller }: MapFilterBarProps) {
  const insets = useSafeAreaInsets();
  const priceInputFocusCountRef = useRef(0);
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
    toggleMarketState,
  } = controller;

  const topOffset = Platform.OS === 'web' ? 116 : insets.top + 108;

  const commitAndClosePricePanel = useCallback(
    (category: Extract<MapFilterCategory, 'salePrice' | 'rentPrice'>) => {
      commitPriceDraft(category);
      closeCategoryPanel();
    },
    [closeCategoryPanel, commitPriceDraft],
  );

  const handlePanelBackdropPress = useCallback(() => {
    if (isPriceCategory(openCategory)) {
      commitPriceDraft(openCategory);
    }
    closeCategoryPanel();
  }, [closeCategoryPanel, commitPriceDraft, openCategory]);

  const scheduleBlurCommit = useCallback(
    (category: Extract<MapFilterCategory, 'salePrice' | 'rentPrice'>) => {
      setTimeout(() => {
        if (priceInputFocusCountRef.current === 0) {
          commitAndClosePricePanel(category);
        }
      }, 0);
    },
    [commitAndClosePricePanel],
  );

  const handleCategoryPress = useCallback(
    (nextCategory: MapFilterCategory) => {
      if (isPriceCategory(openCategory) && openCategory !== nextCategory) {
        commitPriceDraft(openCategory);
      }

      if (openCategory === nextCategory) {
        if (isPriceCategory(nextCategory)) {
          commitAndClosePricePanel(nextCategory);
          return;
        }

        closeCategoryPanel();
        return;
      }

      toggleCategory(nextCategory);
    },
    [
      closeCategoryPanel,
      commitAndClosePricePanel,
      commitPriceDraft,
      openCategory,
      toggleCategory,
    ],
  );

  const panelTitle = openCategory ? getMapFilterPillLabel(openCategory) : null;
  const saleSuggestions = useMemo(() => SALE_PRICE_SUGGESTIONS, []);
  const rentSuggestions = useMemo(() => RENT_PRICE_SUGGESTIONS, []);

  return (
    <>
      {openCategory ? (
        <Pressable
          onPress={handlePanelBackdropPress}
          style={styles.panelBackdrop}
          testID="map-filter-panel-backdrop"
        />
      ) : null}

      <View pointerEvents="box-none" style={[styles.container, { top: topOffset }]}>
        <ScrollView
          horizontal
          contentContainerStyle={styles.railContent}
          showsHorizontalScrollIndicator={false}
          style={styles.rail}
          testID="map-filter-rail"
        >
          {orderedCategories.map((category) => {
            const active = isMapFilterCategoryActive(appliedFilters, category);
            const summary = getMapFilterPillSummary(category, appliedFilters);
            const label = getMapFilterPillLabel(category);
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
        </ScrollView>

        {openCategory ? (
          <View style={styles.panel} testID={`map-filter-panel-${openCategory}`}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>{panelTitle}</Text>
              <Pressable
                accessibilityLabel="Close filters"
                accessibilityRole="button"
                hitSlop={10}
                onPress={handlePanelBackdropPress}
                testID="map-filter-panel-close"
              >
                <Icon name="X" size="sm" color={COLORS.warm700} />
              </Pressable>
            </View>

            {isPriceCategory(openCategory) ? (
              <>
                <Text style={styles.panelHint}>
                  Draft edits stay local until you apply, blur, or press Enter.
                </Text>

                <View style={styles.priceInputRow}>
                  <View style={styles.priceInputColumn}>
                    <Text style={styles.inputLabel}>From</Text>
                    <TextInput
                      keyboardType="number-pad"
                      onBlur={() => {
                        priceInputFocusCountRef.current = Math.max(
                          0,
                          priceInputFocusCountRef.current - 1,
                        );
                        scheduleBlurCommit(openCategory);
                      }}
                      onChangeText={(value) => updatePriceDraft(openCategory, 'from', value)}
                      onFocus={() => {
                        priceInputFocusCountRef.current += 1;
                      }}
                      onSubmitEditing={() => commitAndClosePricePanel(openCategory)}
                      placeholder="0"
                      placeholderTextColor={COLORS.warm400}
                      returnKeyType="done"
                      style={styles.priceInput}
                      testID={`map-filter-input-${openCategory}-from`}
                      value={
                        openCategory === 'salePrice'
                          ? draftFilters.salePriceFrom
                          : draftFilters.rentPriceFrom
                      }
                    />
                  </View>

                  <View style={styles.priceInputColumn}>
                    <Text style={styles.inputLabel}>To</Text>
                    <TextInput
                      keyboardType="number-pad"
                      onBlur={() => {
                        priceInputFocusCountRef.current = Math.max(
                          0,
                          priceInputFocusCountRef.current - 1,
                        );
                        scheduleBlurCommit(openCategory);
                      }}
                      onChangeText={(value) => updatePriceDraft(openCategory, 'to', value)}
                      onFocus={() => {
                        priceInputFocusCountRef.current += 1;
                      }}
                      onSubmitEditing={() => commitAndClosePricePanel(openCategory)}
                      placeholder="No max"
                      placeholderTextColor={COLORS.warm400}
                      returnKeyType="done"
                      style={styles.priceInput}
                      testID={`map-filter-input-${openCategory}-to`}
                      value={
                        openCategory === 'salePrice'
                          ? draftFilters.salePriceTo
                          : draftFilters.rentPriceTo
                      }
                    />
                  </View>
                </View>

                <View style={styles.suggestionRow}>
                  {(openCategory === 'salePrice' ? saleSuggestions : rentSuggestions).map(
                    (value) => (
                      <Pressable
                        key={value}
                        onPress={() => selectPriceSuggestion(openCategory, 'from', value)}
                        style={({ pressed }) => [
                          styles.suggestionChip,
                          pressed && styles.suggestionChipPressed,
                        ]}
                        testID={`map-filter-suggestion-${openCategory}-${value}`}
                      >
                        <Text style={styles.suggestionChipText}>{value.toLocaleString()}</Text>
                      </Pressable>
                    ),
                  )}
                </View>

                <View style={styles.panelActions}>
                  <Pressable
                    onPress={() => dismissCategory(openCategory)}
                    style={({ pressed }) => [
                      styles.secondaryAction,
                      pressed && styles.secondaryActionPressed,
                    ]}
                    testID={`map-filter-reset-${openCategory}`}
                  >
                    <Text style={styles.secondaryActionText}>Reset</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => commitAndClosePricePanel(openCategory)}
                    style={({ pressed }) => [
                      styles.primaryAction,
                      pressed && styles.primaryActionPressed,
                    ]}
                    testID={`map-filter-apply-${openCategory}`}
                  >
                    <Text style={styles.primaryActionText}>Apply</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.marketStateWrap}>
                {MAP_MARKET_STATES.map((value: MapMarketState) => {
                  const selected = appliedFilters.marketState.includes(value);

                  return (
                    <Pressable
                      key={value}
                      onPress={() => toggleMarketState(value)}
                      style={({ pressed }) => [
                        styles.marketStateOption,
                        selected && styles.marketStateOptionSelected,
                        pressed && styles.marketStateOptionPressed,
                      ]}
                      testID={`map-filter-market-state-${value}`}
                    >
                      <Text
                        style={[
                          styles.marketStateLabel,
                          selected && styles.marketStateLabelSelected,
                        ]}
                      >
                        {getMapMarketStateLabel(value)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
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
    gap: 10,
    paddingRight: 8,
  },
  pillShell: {
    position: 'relative',
    paddingRight: 8,
  },
  pill: {
    minHeight: 42,
    borderRadius: 21,
    paddingLeft: 16,
    paddingRight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 240,
  },
  pillInactive: {
    backgroundColor: COLORS.whiteOverlay,
    borderWidth: 1,
    borderColor: COLORS.warm300,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 6,
  },
  pillActive: {
    backgroundColor: COLORS.gold500,
    borderWidth: 1,
    borderColor: COLORS.gold600,
    shadowColor: 'rgba(182, 117, 16, 0.28)',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 10,
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
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillActiveBadgeText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '700',
  },
  dismissButton: {
    position: 'absolute',
    right: 0,
    top: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.gold600,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  panel: {
    marginTop: 12,
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
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  suggestionChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.goldTint,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.35)',
  },
  suggestionChipPressed: {
    backgroundColor: 'rgba(245, 166, 35, 0.26)',
  },
  suggestionChipText: {
    color: COLORS.gold600,
    fontSize: 12,
    fontWeight: '700',
  },
  panelActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 16,
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
