/**
 * Chip — Filter chip primitive.
 *
 * Used in feed filters, tag lists, and selection groups.
 * Active chips get the brand gold fill; inactive chips get a bordered
 * outline on white background.
 *
 * Design spec: Section 7.4 (Feed Filter Chips).
 */

import React, { type ReactNode } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';

export interface ChipProps {
  /** Chip label text. */
  label: string;
  /** Whether the chip is currently selected/active. */
  active?: boolean;
  /** Called when the chip is pressed. */
  onPress?: () => void;
  /** Optional leading element (icon or emoji). */
  leading?: ReactNode;
  /** Disable interaction. */
  disabled?: boolean;
  testID?: string;
}

export function Chip({
  label,
  active = false,
  onPress,
  leading,
  disabled = false,
  testID,
}: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      style={[
        styles.chip,
        active ? styles.chipActive : styles.chipInactive,
        disabled && styles.chipDisabled,
      ]}
    >
      {leading && <View style={styles.leading}>{leading}</View>}
      <Text
        style={[
          styles.label,
          active ? styles.labelActive : styles.labelInactive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: '#B47712', // gold-700 — AA contrast with white text (4.8:1)
  },
  chipInactive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E0D4', // warm-300
  },
  chipDisabled: {
    opacity: 0.5,
  },
  leading: {
    marginRight: 6,
  },
  label: {
    fontSize: 13,
    letterSpacing: 0.1,
  },
  labelActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  labelInactive: {
    color: '#504A42', // warm-700
    fontWeight: '500',
  },
});
