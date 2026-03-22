/**
 * Card — Standard card container primitive.
 *
 * White surface with warm-tinted shadow and 16px radius.
 * Applies both the web Tailwind shadow class and native shadow style
 * for cross-platform rendering.
 *
 * Design spec: Section 7.5 (Feed Card), radius from Section 4.
 */

import React, { type ReactNode } from 'react';
import { View, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { shadows } from '../../lib/shadows';

export interface CardProps {
  children: ReactNode;
  /** Called when the card is pressed. Omit for non-interactive cards. */
  onPress?: () => void;
  /** Additional styles. */
  style?: ViewStyle;
  /** Shadow variant. Default 'card'. */
  shadow?: 'card' | 'card-alt' | 'preview' | 'none';
  testID?: string;
}

export function Card({
  children,
  onPress,
  style,
  shadow = 'card',
  testID,
}: CardProps) {
  const shadowStyle = shadow !== 'none' ? shadows[shadow] : undefined;

  const content = (
    <View
      style={[styles.card, shadowStyle, style]}
      testID={testID}
      className="shadow-card"
    >
      {children}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button">
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF', // surface-card
    borderRadius: 16,
    overflow: 'hidden',
  },
});
