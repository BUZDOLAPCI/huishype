import { Text, View } from 'react-native';

export interface KarmaBadgeProps {
  karma: number;
  size?: 'sm' | 'md';
}

type KarmaRank = 'Newbie' | 'Regular' | 'Trusted' | 'Expert' | 'Legend';

interface KarmaConfig {
  label: KarmaRank;
  bgColor: string;
  textColor: string;
}

/**
 * Get karma rank configuration based on karma points
 * - 0-10: "Newbie" - gray
 * - 11-50: "Regular" - green
 * - 51-100: "Trusted" - blue
 * - 101-499: "Expert" - purple
 * - 500+: "Legend" - gold/amber
 */
export function getKarmaConfig(karma: number): KarmaConfig {
  if (karma >= 500) {
    return {
      label: 'Legend',
      bgColor: 'bg-amber-100',
      textColor: 'text-amber-700',
    };
  }
  if (karma >= 101) {
    return {
      label: 'Expert',
      bgColor: 'bg-purple-100',
      textColor: 'text-purple-700',
    };
  }
  if (karma >= 51) {
    return {
      label: 'Trusted',
      bgColor: 'bg-blue-100',
      textColor: 'text-blue-700',
    };
  }
  if (karma >= 11) {
    return {
      label: 'Regular',
      bgColor: 'bg-green-100',
      textColor: 'text-green-700',
    };
  }
  return {
    label: 'Newbie',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-600',
  };
}

/**
 * KarmaBadge Component
 * Displays a user's karma rank as a colored badge
 */
export function KarmaBadge({ karma, size = 'sm' }: KarmaBadgeProps) {
  const config = getKarmaConfig(karma);

  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-1';
  const textSizeClass = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <View
      className={`rounded-full ${config.bgColor} ${sizeClasses}`}
      testID="karma-badge"
    >
      <Text className={`font-medium ${config.textColor} ${textSizeClass}`}>
        {config.label}
      </Text>
    </View>
  );
}
