import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  getMapPriceSuggestions,
  getMapVisiblePriceModes,
  isMapFilterCategoryActive,
  isMapStatusPillActive,
  MAP_STATUS_PILL_STATES,
  type MapFilterCategory,
  type MapPriceMode,
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
}

type PriceBound = 'from' | 'to';

interface MapFilterPillProps {
  label: string;
  active: boolean;
  open: boolean;
  onPress: () => void;
  onDismiss?: () => void;
  testID: string;
  variant?: 'panel' | 'toggle';
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
          active ? <Icon name="Check" size="sm" color={COLORS.white} /> : null
        ) : active ? (
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

const PRICE_MODE_META: Record<MapPriceMode, { title: string; testId: string }> = {
  sale: { title: 'Sale Price', testId: 'sale' },
  rent: { title: 'Rent Price', testId: 'rent' },
};

export function MapFilterBar({ controller }: MapFilterBarProps) {
  const insets = useSafeAreaInsets();
  const [activePriceInput, setActivePriceInput] = useState<{
    mode: MapPriceMode;
    bound: PriceBound;
  } | null>(null);
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
  } = controller;

  const topOffset = Platform.OS === 'web' ? 116 : insets.top + 108;
  const isPricePanelOpen = openCategory === 'price';

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
    [appliedFilters.marketState, isPricePanelOpen],
  );

  const getDraftValue = useCallback(
    (mode: MapPriceMode, bound: PriceBound) => {
      if (mode === 'sale') {
        return bound === 'from' ? draftFilters.salePriceFrom : draftFilters.salePriceTo;
      }

      return bound === 'from' ? draftFilters.rentPriceFrom : draftFilters.rentPriceTo;
    },
    [draftFilters],
  );

  const commitAndClosePricePanel = useCallback(() => {
    cancelScheduledPriceInputBlur();
    setActivePriceInput(null);
    commitPriceDraft();
    closeCategoryPanel();
  }, [cancelScheduledPriceInputBlur, closeCategoryPanel, commitPriceDraft]);

  const handlePanelBackdropPress = useCallback(() => {
    cancelScheduledPriceInputBlur();
    setActivePriceInput(null);
    if (openCategory === 'price') {
      commitPriceDraft();
    }
    closeCategoryPanel();
  }, [cancelScheduledPriceInputBlur, closeCategoryPanel, commitPriceDraft, openCategory]);

  const handleCategoryPress = useCallback(
    (nextCategory: MapFilterCategory) => {
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
    [
      closeCategoryPanel,
      commitAndClosePricePanel,
      commitPriceDraft,
      openCategory,
      toggleCategory,
    ],
  );

  const panelTitle = isPricePanelOpen ? getMapFilterPillLabel('price') : null;
  const priceSuggestions = useMemo(() => {
    if (!isPricePanelOpen || activePriceInput == null) {
      return [];
    }

    return getMapPriceSuggestions(
      activePriceInput.mode,
      activePriceInput.bound,
      getDraftValue(activePriceInput.mode, activePriceInput.bound),
    );
  }, [activePriceInput, getDraftValue, isPricePanelOpen]);

  const handleSuggestionSelect = useCallback(
    (mode: MapPriceMode, bound: PriceBound, value: string) => {
      cancelScheduledPriceInputBlur();
      selectPriceSuggestion(mode, bound, value);
      setActivePriceInput(null);
    },
    [cancelScheduledPriceInputBlur, selectPriceSuggestion],
  );

  const handleSuggestionPointerDown = useCallback(
    (mode: MapPriceMode, bound: PriceBound, value: string, event?: { preventDefault?: () => void }) => {
      if (Platform.OS !== 'web') {
        return;
      }

      event?.preventDefault?.();
      webSuggestionPressKeyRef.current = `${mode}:${bound}:${value}`;
      handleSuggestionSelect(mode, bound, value);
    },
    [handleSuggestionSelect],
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
    [handleSuggestionSelect],
  );

  return (
    <>
      {isPricePanelOpen ? (
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
          {orderedCategories
            .filter((category) => category === 'price')
            .map((category) => {
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

          {MAP_STATUS_PILL_STATES.map((state: MapStatusPillState) => (
            <MapFilterPill
              key={state}
              active={isMapStatusPillActive(appliedFilters, state)}
              label={getMapMarketStateLabel(state)}
              onPress={() => toggleStatusPill(state)}
              open={false}
              testID={`map-filter-pill-market-state-${state}`}
              variant="toggle"
            />
          ))}
        </ScrollView>

        {isPricePanelOpen ? (
          <View style={styles.panel} testID="map-filter-panel-price">
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

            {openCategory === 'price' ? (
              <>
                <Text style={styles.panelHint}>
                  Draft edits stay local until you apply, press Enter, or close the panel.
                </Text>

                {visiblePriceModes.map((mode) => {
                  const meta = PRICE_MODE_META[mode];

                  return (
                    <View key={mode} style={styles.priceSection}>
                      {visiblePriceModes.length > 1 ? (
                        <Text style={styles.priceSectionTitle}>{meta.title}</Text>
                      ) : null}

                      <View style={styles.priceInputRow}>
                        <View style={styles.priceInputColumn}>
                          <Text style={styles.inputLabel}>From</Text>
                          <TextInput
                            keyboardType="number-pad"
                            onBlur={schedulePriceInputBlur}
                            onChangeText={(value) => updatePriceDraft(mode, 'from', value)}
                            onFocus={() => {
                              cancelScheduledPriceInputBlur();
                              setActivePriceInput({ mode, bound: 'from' });
                            }}
                            onSubmitEditing={commitAndClosePricePanel}
                            placeholder="0"
                            placeholderTextColor={COLORS.warm400}
                            returnKeyType="done"
                            style={styles.priceInput}
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
                                        event,
                                      )
                                    }
                                    onPress={() =>
                                      handleSuggestionPress(mode, 'from', suggestion.value)
                                    }
                                    style={({ pressed }) => [
                                      styles.suggestionOption,
                                      suggestion.custom && styles.suggestionOptionCustom,
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
                                      {suggestion.label}
                                    </Text>
                                  </Pressable>
                                ))}
                              </ScrollView>
                            </View>
                          ) : null}
                        </View>

                        <View style={styles.priceInputColumn}>
                          <Text style={styles.inputLabel}>To</Text>
                          <TextInput
                            keyboardType="number-pad"
                            onBlur={schedulePriceInputBlur}
                            onChangeText={(value) => updatePriceDraft(mode, 'to', value)}
                            onFocus={() => {
                              cancelScheduledPriceInputBlur();
                              setActivePriceInput({ mode, bound: 'to' });
                            }}
                            onSubmitEditing={commitAndClosePricePanel}
                            placeholder="No max"
                            placeholderTextColor={COLORS.warm400}
                            returnKeyType="done"
                            style={styles.priceInput}
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
                                        event,
                                      )
                                    }
                                    onPress={() =>
                                      handleSuggestionPress(mode, 'to', suggestion.value)
                                    }
                                    style={({ pressed }) => [
                                      styles.suggestionOption,
                                      suggestion.custom && styles.suggestionOptionCustom,
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
                                      {suggestion.label}
                                    </Text>
                                  </Pressable>
                                ))}
                              </ScrollView>
                            </View>
                          ) : null}
                        </View>
                      </View>
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
                    <Text style={styles.secondaryActionText}>Reset</Text>
                  </Pressable>

                  <Pressable
                    onPress={commitAndClosePricePanel}
                    style={({ pressed }) => [
                      styles.primaryAction,
                      pressed && styles.primaryActionPressed,
                    ]}
                    testID="map-filter-apply-price"
                  >
                    <Text style={styles.primaryActionText}>Apply</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
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
