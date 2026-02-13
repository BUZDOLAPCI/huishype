/**
 * FMVVisualization Component Showcase
 *
 * This page demonstrates the FMVVisualization component in various states:
 * - Low confidence (1-2 guesses)
 * - Medium confidence (3-9 guesses)
 * - High confidence (10+ guesses)
 * - With/without asking price comparison
 * - With/without user guess marker
 * - No data state
 * - Loading state
 *
 * Used for visual E2E testing of the fmv-distribution-curve reference expectation.
 */

import { useState } from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import { Stack } from 'expo-router';
import { FMVVisualization, type FMVData } from '@/src/components/FMVVisualization';

// Sample data for different states
const LOW_CONFIDENCE_FMV: FMVData = {
  value: 325000,
  confidence: 'low',
  guessCount: 2,
  distribution: {
    min: 300000,
    max: 350000,
    p10: 300000, p25: 310000, p50: 325000, p75: 340000, p90: 350000,
  },
};

const MEDIUM_CONFIDENCE_FMV: FMVData = {
  value: 375000,
  confidence: 'medium',
  guessCount: 7,
  distribution: {
    min: 320000,
    max: 430000,
    p10: 330000, p25: 345000, p50: 370000, p75: 400000, p90: 420000,
  },
};

const HIGH_CONFIDENCE_FMV: FMVData = {
  value: 425000,
  confidence: 'high',
  guessCount: 23,
  distribution: {
    min: 350000,
    max: 520000,
    p10: 370000, p25: 390000, p50: 420000, p75: 470000, p90: 500000,
  },
};

const WIDE_DISTRIBUTION_FMV: FMVData = {
  value: 500000,
  confidence: 'medium',
  guessCount: 12,
  distribution: {
    min: 300000,
    max: 750000,
    p10: 330000, p25: 380000, p50: 485000, p75: 600000, p90: 700000,
  },
};

export default function FMVVisualizationShowcase() {
  const [showLoading, setShowLoading] = useState(false);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'FMV Visualization Demo',
        }}
      />
      <ScrollView className="flex-1 bg-gray-100" testID="fmv-visualization-showcase">
        <View className="p-4">
          <Text className="text-2xl font-bold text-gray-900 mb-2">
            FMV Distribution Curve
          </Text>
          <Text className="text-gray-500 mb-6">
            This demonstrates the Fair Market Value (FMV) Visualization component
            that shows crowd-estimated property values with distribution curves.
          </Text>

          {/* High Confidence State */}
          <View className="mb-6" testID="fmv-high-confidence-state">
            <Text className="text-lg font-semibold text-gray-800 mb-2">
              1. High Confidence (23 guesses)
            </Text>
            <Text className="text-sm text-gray-500 mb-3">
              Strong consensus with wide participation. Shows asking price comparison and user guess marker.
            </Text>
            <FMVVisualization
              fmv={HIGH_CONFIDENCE_FMV}
              askingPrice={480000}
              userGuess={435000}
              wozValue={390000}
              testID="fmv-visualization-high"
            />
          </View>

          {/* Medium Confidence State */}
          <View className="mb-6" testID="fmv-medium-confidence-state">
            <Text className="text-lg font-semibold text-gray-800 mb-2">
              2. Medium Confidence (7 guesses)
            </Text>
            <Text className="text-sm text-gray-500 mb-3">
              Building consensus. Asking price is below estimate (good deal indicator).
            </Text>
            <FMVVisualization
              fmv={MEDIUM_CONFIDENCE_FMV}
              askingPrice={340000}
              wozValue={350000}
              testID="fmv-visualization-medium"
            />
          </View>

          {/* Low Confidence State */}
          <View className="mb-6" testID="fmv-low-confidence-state">
            <Text className="text-lg font-semibold text-gray-800 mb-2">
              3. Low Confidence (2 guesses)
            </Text>
            <Text className="text-sm text-gray-500 mb-3">
              Early stage - needs more guesses. Shows narrow distribution with WOZ anchoring.
            </Text>
            <FMVVisualization
              fmv={LOW_CONFIDENCE_FMV}
              wozValue={315000}
              testID="fmv-visualization-low"
            />
          </View>

          {/* Wide Distribution State */}
          <View className="mb-6" testID="fmv-wide-distribution-state">
            <Text className="text-lg font-semibold text-gray-800 mb-2">
              4. Wide Distribution (Polarizing)
            </Text>
            <Text className="text-sm text-gray-500 mb-3">
              Controversial property with wide range of opinions. User guess significantly below median.
            </Text>
            <FMVVisualization
              fmv={WIDE_DISTRIBUTION_FMV}
              askingPrice={550000}
              userGuess={380000}
              wozValue={420000}
              testID="fmv-visualization-wide"
            />
          </View>

          {/* No Data State */}
          <View className="mb-6" testID="fmv-no-data-state">
            <Text className="text-lg font-semibold text-gray-800 mb-2">
              5. No Data State
            </Text>
            <Text className="text-sm text-gray-500 mb-3">
              No guesses yet - encourages user to be the first.
            </Text>
            <FMVVisualization
              fmv={null}
              testID="fmv-visualization-no-data"
            />
          </View>

          {/* Loading State */}
          <View className="mb-6" testID="fmv-loading-state">
            <Text className="text-lg font-semibold text-gray-800 mb-2">
              6. Loading State
            </Text>
            <Text className="text-sm text-gray-500 mb-3">
              Skeleton placeholder while fetching data.
            </Text>
            <Pressable
              onPress={() => setShowLoading(!showLoading)}
              className="mb-3 bg-primary-600 py-2 px-4 rounded-lg self-start"
            >
              <Text className="text-white font-medium">
                {showLoading ? 'Show Loaded' : 'Show Loading'}
              </Text>
            </Pressable>
            <FMVVisualization
              fmv={showLoading ? null : HIGH_CONFIDENCE_FMV}
              isLoading={showLoading}
              testID="fmv-visualization-loading"
            />
          </View>

          {/* Context: What this component does */}
          <View className="bg-white rounded-xl p-4 mb-6 border border-gray-200">
            <Text className="text-base font-semibold text-gray-800 mb-2">
              About FMV Visualization
            </Text>
            <Text className="text-sm text-gray-600 leading-5 mb-3">
              The FMV (Fair Market Value) Visualization shows the crowd-estimated
              property value based on user price guesses. It is central to user
              engagement and data generation in HuisHype.
            </Text>
            <View className="space-y-2">
              <Text className="text-sm font-medium text-gray-700 mb-1">Key Features:</Text>
              <View className="flex-row items-start">
                <Text className="text-primary-600 mr-2">1.</Text>
                <Text className="text-sm text-gray-600 flex-1">
                  Weighted FMV value - Credibility-weighted crowd estimate
                </Text>
              </View>
              <View className="flex-row items-start">
                <Text className="text-primary-600 mr-2">2.</Text>
                <Text className="text-sm text-gray-600 flex-1">
                  Distribution curve - Shows range (min/max) and median
                </Text>
              </View>
              <View className="flex-row items-start">
                <Text className="text-primary-600 mr-2">3.</Text>
                <Text className="text-sm text-gray-600 flex-1">
                  Confidence indicator - Low/Medium/High based on guess count
                </Text>
              </View>
              <View className="flex-row items-start">
                <Text className="text-primary-600 mr-2">4.</Text>
                <Text className="text-sm text-gray-600 flex-1">
                  Price comparisons - vs. asking price and user guess
                </Text>
              </View>
              <View className="flex-row items-start">
                <Text className="text-primary-600 mr-2">5.</Text>
                <Text className="text-sm text-gray-600 flex-1">
                  Reference markers - User, Ask, and Median positions on bar
                </Text>
              </View>
            </View>
          </View>

          {/* Confidence Level Legend */}
          <View className="bg-white rounded-xl p-4 mb-6 border border-gray-200">
            <Text className="text-base font-semibold text-gray-800 mb-3">
              Confidence Levels
            </Text>
            <View className="space-y-3">
              <View className="flex-row items-center">
                <View className="w-20 h-6 bg-yellow-100 rounded-full items-center justify-center mr-3">
                  <Text className="text-xs font-medium text-yellow-700">Low</Text>
                </View>
                <Text className="text-sm text-gray-600 flex-1">
                  1-2 guesses - Anchored closer to WOZ value
                </Text>
              </View>
              <View className="flex-row items-center">
                <View className="w-20 h-6 bg-blue-100 rounded-full items-center justify-center mr-3">
                  <Text className="text-xs font-medium text-blue-700">Medium</Text>
                </View>
                <Text className="text-sm text-gray-600 flex-1">
                  3-9 guesses - Building consensus
                </Text>
              </View>
              <View className="flex-row items-center">
                <View className="w-20 h-6 bg-green-100 rounded-full items-center justify-center mr-3">
                  <Text className="text-xs font-medium text-green-700">High</Text>
                </View>
                <Text className="text-sm text-gray-600 flex-1">
                  10+ guesses - Strong consensus
                </Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </>
  );
}
