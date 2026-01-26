import { Pressable, Text, View } from 'react-native';

interface PropertyMarkerProps {
  price?: number;
  isActive?: boolean;
  activityLevel?: 'hot' | 'warm' | 'cold';
  onPress?: () => void;
}

export function PropertyMarker({
  price,
  isActive = false,
  activityLevel = 'cold',
  onPress,
}: PropertyMarkerProps) {
  const activityStyles = {
    hot: 'bg-red-500 border-red-600',
    warm: 'bg-orange-400 border-orange-500',
    cold: 'bg-gray-400 border-gray-500',
  };

  const activeStyles = isActive
    ? 'scale-110 shadow-lg'
    : 'scale-100';

  return (
    <Pressable onPress={onPress}>
      <View
        className={`
          items-center justify-center
          rounded-full border-2
          ${activityStyles[activityLevel]}
          ${activeStyles}
          ${price ? 'px-2 py-1' : 'w-4 h-4'}
        `}
      >
        {price !== undefined && (
          <Text className="text-xs font-bold text-white">
            {'\u20AC'}{(price / 1000).toFixed(0)}k
          </Text>
        )}
      </View>
    </Pressable>
  );
}
