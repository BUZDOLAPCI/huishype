import { ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';

import { GuessSliderLabCard } from '@/src/components/showcase/GuessSliderLabCard';

export default function GuessSliderLabShowcase() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Guess Slider Lab',
          headerShown: false,
        }}
      />
      <ScrollView
        className="flex-1 bg-warm-100"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 24,
        }}
        testID="guess-slider-lab-showcase"
      >
        <View style={{ width: '100%', maxWidth: 430 }}>
          <GuessSliderLabCard />
        </View>
      </ScrollView>
    </>
  );
}
