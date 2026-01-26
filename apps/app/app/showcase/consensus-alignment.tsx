/**
 * ConsensusAlignment Component Showcase
 *
 * This page demonstrates the ConsensusAlignment component in all three states:
 * - Aligned (green): User's guess is within 5% of crowd estimate
 * - Close (blue): User's guess is within 5-15% of crowd estimate
 * - Different (amber): User's guess is more than 15% different from crowd estimate
 *
 * Used for visual E2E testing of the consensus-alignment-feedback reference expectation.
 */

import { ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { ConsensusAlignment } from '@/src/components/ConsensusAlignment';

// Sample crowd estimate for demo purposes
const CROWD_ESTIMATE = 350000;
const GUESS_COUNT = 42;

export default function ConsensusAlignmentShowcase() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Consensus Alignment Demo',
        }}
      />
      <ScrollView className="flex-1 bg-gray-100" testID="consensus-alignment-showcase">
        <View className="p-4">
          <Text className="text-2xl font-bold text-gray-900 mb-2">
            Consensus Alignment Feedback
          </Text>
          <Text className="text-gray-500 mb-6">
            This demonstrates the three states of the ConsensusAlignment component
            that appears after submitting a price guess.
          </Text>

          {/* Aligned State - Within 5% of crowd estimate */}
          <View className="mb-6" testID="consensus-aligned-state">
            <Text className="text-lg font-semibold text-gray-800 mb-2">
              1. Aligned State (Green)
            </Text>
            <Text className="text-sm text-gray-500 mb-3">
              User guess: EUR 352,000 (within 5% of EUR 350,000 crowd estimate)
            </Text>
            <ConsensusAlignment
              userGuess={352000}
              crowdEstimate={CROWD_ESTIMATE}
              guessCount={GUESS_COUNT}
              percentileRank={75}
              topPredictorsAgreement={92}
              isVisible={true}
              testID="consensus-alignment-aligned"
            />
          </View>

          {/* Close State - Within 5-15% of crowd estimate */}
          <View className="mb-6" testID="consensus-close-state">
            <Text className="text-lg font-semibold text-gray-800 mb-2">
              2. Close State (Blue)
            </Text>
            <Text className="text-sm text-gray-500 mb-3">
              User guess: EUR 385,000 (10% above EUR 350,000 crowd estimate)
            </Text>
            <ConsensusAlignment
              userGuess={385000}
              crowdEstimate={CROWD_ESTIMATE}
              guessCount={GUESS_COUNT}
              percentileRank={65}
              topPredictorsAgreement={72}
              isVisible={true}
              testID="consensus-alignment-close"
            />
          </View>

          {/* Different State - More than 15% different */}
          <View className="mb-6" testID="consensus-different-state">
            <Text className="text-lg font-semibold text-gray-800 mb-2">
              3. Different State (Amber)
            </Text>
            <Text className="text-sm text-gray-500 mb-3">
              User guess: EUR 450,000 (29% above EUR 350,000 crowd estimate)
            </Text>
            <ConsensusAlignment
              userGuess={450000}
              crowdEstimate={CROWD_ESTIMATE}
              guessCount={GUESS_COUNT}
              percentileRank={95}
              isVisible={true}
              testID="consensus-alignment-different"
            />
          </View>

          {/* Different State - Below crowd estimate */}
          <View className="mb-6" testID="consensus-different-below-state">
            <Text className="text-lg font-semibold text-gray-800 mb-2">
              4. Different State - Below (Amber)
            </Text>
            <Text className="text-sm text-gray-500 mb-3">
              User guess: EUR 280,000 (20% below EUR 350,000 crowd estimate)
            </Text>
            <ConsensusAlignment
              userGuess={280000}
              crowdEstimate={CROWD_ESTIMATE}
              guessCount={GUESS_COUNT}
              percentileRank={15}
              isVisible={true}
              testID="consensus-alignment-different-below"
            />
          </View>

          {/* Context: What this component does */}
          <View className="bg-white rounded-xl p-4 mb-6 border border-gray-200">
            <Text className="text-base font-semibold text-gray-800 mb-2">
              About This Feature
            </Text>
            <Text className="text-sm text-gray-600 leading-5">
              The Consensus Alignment Feedback component provides immediate feedback
              to users after they submit a price guess. It shows how their guess
              aligns with the crowd consensus, creating a "small dopamine hit"
              without revealing right/wrong prematurely.
            </Text>
            <View className="mt-3 space-y-2">
              <View className="flex-row items-center">
                <View className="w-3 h-3 rounded-full bg-green-500 mr-2" />
                <Text className="text-sm text-gray-600">
                  Green: Within 5% - "You agree with X% of top predictors"
                </Text>
              </View>
              <View className="flex-row items-center">
                <View className="w-3 h-3 rounded-full bg-blue-500 mr-2" />
                <Text className="text-sm text-gray-600">
                  Blue: Within 5-15% - "Your guess is close to the crowd consensus"
                </Text>
              </View>
              <View className="flex-row items-center">
                <View className="w-3 h-3 rounded-full bg-amber-500 mr-2" />
                <Text className="text-sm text-gray-600">
                  Amber: Over 15% - Shows price comparison with crowd estimate
                </Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </>
  );
}
