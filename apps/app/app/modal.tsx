import { StatusBar } from 'expo-status-bar';
import { Platform, Text, View } from 'react-native';

export default function ModalScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-white">
      <Text className="text-xl font-bold text-gray-900">Modal</Text>
      <View className="my-8 h-px w-4/5 bg-gray-200" />
      <Text className="text-sm text-gray-500 px-4 text-center">
        This is a modal screen. You can use it for various purposes like
        settings, help, or additional information.
      </Text>

      {/* Use a light status bar on iOS to account for the black space above the modal */}
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
    </View>
  );
}
