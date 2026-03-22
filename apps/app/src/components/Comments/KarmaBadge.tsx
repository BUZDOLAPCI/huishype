import { Text, View } from 'react-native';
import { getKarmaTier, type KarmaTier } from '@huishype/shared';

export interface KarmaBadgeProps {
  karma: number;
  size?: 'sm' | 'md';
}

/**
 * Get karma configuration for rendering.
 * Delegates to the shared `getKarmaTier()` so that frontend and backend
 * use the same tier definitions.
 */
export function getKarmaConfig(karma: number): {
  label: string;
  bgColor: string;
  textColor: string;
  level: number;
} {
  const tier: KarmaTier = getKarmaTier(karma);
  return {
    label: tier.label,
    bgColor: tier.bgColor,
    textColor: tier.textColor,
    level: tier.level,
  };
}

/**
 * KarmaBadge Component
 * Displays a user's karma rank as a colored badge.
 * Uses the unified tier definitions from @huishype/shared.
 */
export function KarmaBadge({ karma, size = 'sm' }: KarmaBadgeProps) {
  const config = getKarmaConfig(karma);

  const paddingH = size === 'sm' ? 6 : 8;
  const paddingV = size === 'sm' ? 2 : 4;
  const fontSize = size === 'sm' ? 11 : 13;
  const letterSpacing = size === 'sm' ? 0.8 : 0.5;

  return (
    <View
      style={{
        backgroundColor: config.bgColor,
        borderRadius: 8,
        paddingHorizontal: paddingH,
        paddingVertical: paddingV,
      }}
      testID="karma-badge"
    >
      <Text
        style={{
          color: config.textColor,
          fontSize,
          fontWeight: '600',
          letterSpacing,
          textTransform: 'uppercase',
        }}
      >
        {config.label}
      </Text>
    </View>
  );
}
