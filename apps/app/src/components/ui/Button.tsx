/**
 * Button — Primary, secondary, and ghost button variants.
 *
 * Design spec: border radius 12px (Section 4), gold-500 primary fill.
 *
 * Variants:
 *   primary   — Gold-500 fill, white text. Pressed state: gold-600.
 *   secondary — Transparent, gold-500 border, gold-700 text.
 *   ghost     — Transparent, no border, warm-700 text.
 */

import React, { type ReactNode } from 'react';
import {
  Pressable,
  Text,
  View,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  /** Button label. */
  label: string;
  /** Visual variant. Default 'primary'. */
  variant?: ButtonVariant;
  /** Size. Default 'md'. */
  size?: ButtonSize;
  /** Called on press. */
  onPress?: () => void;
  /** Disable interaction. */
  disabled?: boolean;
  /** Optional explicit accessibility label. Defaults to `label`. */
  accessibilityLabel?: string;
  /** Optional leading icon/element. */
  leading?: ReactNode;
  /** Optional trailing icon/element. */
  trailing?: ReactNode;
  /** Optional container style override. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const HEIGHT: Record<ButtonSize, number> = { sm: 36, md: 44, lg: 52 };
const FONT_SIZE: Record<ButtonSize, number> = { sm: 13, md: 15, lg: 16 };
const PADDING_H: Record<ButtonSize, number> = { sm: 12, md: 16, lg: 20 };

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  onPress,
  disabled = false,
  accessibilityLabel,
  leading,
  trailing,
  style,
  testID,
}: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.base,
        {
          height: HEIGHT[size],
          paddingHorizontal: PADDING_H[size],
        },
        variantStyles[variant].container,
        pressed && !disabled && variantStyles[variant].pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {leading && <View style={styles.leading}>{leading}</View>}
      <Text
        style={[
          styles.label,
          { fontSize: FONT_SIZE[size] },
          variantStyles[variant].label,
        ]}
      >
        {label}
      </Text>
      {trailing && <View style={styles.trailing}>{trailing}</View>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  disabled: {
    opacity: 0.5,
  },
  leading: {
    marginRight: 8,
  },
  trailing: {
    marginLeft: 8,
  },
  label: {
    fontWeight: '600',
  },
});

const variantStyles = {
  primary: StyleSheet.create({
    container: {
      backgroundColor: '#F5A623', // gold-500
    } as ViewStyle,
    pressed: {
      backgroundColor: '#DE911D', // gold-600
    } as ViewStyle,
    label: {
      color: '#FFFFFF',
    },
  }),
  secondary: StyleSheet.create({
    container: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: '#F5A623', // gold-500
    } as ViewStyle,
    pressed: {
      backgroundColor: '#FFFBEB', // gold-50
    } as ViewStyle,
    label: {
      color: '#B47712', // gold-700
    },
  }),
  ghost: StyleSheet.create({
    container: {
      backgroundColor: 'transparent',
    } as ViewStyle,
    pressed: {
      backgroundColor: '#F5F0E8', // warm-200
    } as ViewStyle,
    label: {
      color: '#504A42', // warm-700
    },
  }),
};
