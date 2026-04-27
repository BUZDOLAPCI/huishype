import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Icon } from '../ui/Icon';

interface MapWelcomeInfoButtonProps {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export function MapWelcomeInfoButton({ onPress, style }: MapWelcomeInfoButtonProps) {
  return (
    <Pressable
      accessibilityLabel="Open HuisHype introduction"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed ? styles.buttonPressed : null,
        style,
      ]}
      testID="map-welcome-info-button"
    >
      <Icon name="Info" size={18} color="#504A42" weight="bold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(80, 74, 66, 0.12)',
    ...Platform.select({
      web: {
        cursor: 'pointer',
        boxShadow: '0 8px 24px rgba(45, 41, 38, 0.12)',
      } as ViewStyle,
      ios: {
        shadowColor: '#2D2926',
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.12,
        shadowRadius: 14,
      },
      android: {
        elevation: 4,
      },
      default: {},
    }),
  },
  buttonPressed: {
    backgroundColor: 'rgba(255, 248, 240, 0.92)',
    transform: [{ scale: 0.98 }],
  },
});

