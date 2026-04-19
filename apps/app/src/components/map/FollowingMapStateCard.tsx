import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/src/components/ui/Icon';

const COLORS = {
  white: '#FFFFFF',
  warm100: '#FFF8F0',
  warm300: '#E8E0D4',
  warm600: '#736C62',
  warm900: '#2D2926',
  gold500: '#F5A623',
  gold600: '#D68B14',
  goldTint: 'rgba(245, 166, 35, 0.14)',
  shadow: 'rgba(65, 52, 36, 0.16)',
} as const;

export interface FollowingMapStateCardProps {
  mode: 'signed-out' | 'empty';
  onPrimaryPress?: () => void;
}

export function FollowingMapStateCard({
  mode,
  onPrimaryPress,
}: FollowingMapStateCardProps) {
  const isSignedOut = mode === 'signed-out';

  return (
    <View pointerEvents="box-none" style={styles.wrapper}>
      <View style={styles.card} testID={`map-following-state-${mode}`}>
        <View style={styles.header}>
          <View style={styles.iconBadge}>
            <Icon
              color={COLORS.gold600}
              name={isSignedOut ? 'Users' : 'MapPin'}
              size="sm"
            />
          </View>
          <Text style={styles.title}>
            {isSignedOut ? 'Following needs sign-in' : 'Nothing from your circle here yet'}
          </Text>
        </View>
        <Text style={styles.body}>
          {isSignedOut
            ? 'This mode shows homes with activity from people you follow.'
            : 'Try another area, or follow people whose activity you want to see on the map.'}
        </Text>
        {onPrimaryPress ? (
          <Pressable
            accessibilityRole="button"
            onPress={onPrimaryPress}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
            ]}
            testID={`map-following-state-${mode}-action`}
          >
            <Text style={styles.primaryButtonText}>
              {isSignedOut ? 'Sign in' : 'Back to all'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    left: 16,
    position: 'absolute',
    right: 16,
    top: 190,
    zIndex: 12,
  },
  card: {
    alignSelf: 'center',
    backgroundColor: COLORS.white,
    borderColor: COLORS.warm300,
    borderRadius: 24,
    borderWidth: 1,
    elevation: 4,
    maxWidth: 360,
    padding: 16,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 18,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  iconBadge: {
    alignItems: 'center',
    backgroundColor: COLORS.goldTint,
    borderRadius: 999,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  title: {
    color: COLORS.warm900,
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  body: {
    color: COLORS.warm600,
    fontSize: 13,
    lineHeight: 18,
  },
  primaryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.gold500,
    borderRadius: 999,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryButtonPressed: {
    opacity: 0.86,
  },
  primaryButtonText: {
    color: COLORS.warm100,
    fontSize: 13,
    fontWeight: '700',
  },
});
