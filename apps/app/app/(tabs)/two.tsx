import { Text, View } from 'react-native';

// This screen is hidden in the tab layout but kept for compatibility
export default function TabTwoScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-white">
      <Text className="text-xl font-bold text-gray-900">Tab Two</Text>
      <Text className="text-sm text-gray-500 mt-2">
        This tab is hidden in the navigation.
      </Text>
    </View>
  );
}
