import { Image, Pressable, StyleSheet, Text, View, Platform } from 'react-native';

import { Icon } from './ui/Icon';
import type { WebViewStyle } from '@/src/lib/webStyle';

const COLORS = {
  white: '#FFFDF9',
  warm100: '#FFF8F0',
  warm200: '#F5ECDD',
  warm500: '#93806E',
  warm700: '#54483F',
  warm900: '#2E2621',
  heart: '#BCAEA0',
  avatarBg: '#F4C971',
} as const;

const WEB_BUBBLE_SHADOW: WebViewStyle = {
  boxShadow: '0px 14px 30px rgba(33, 27, 22, 0.14), 0px 3px 12px rgba(180, 119, 18, 0.08)',
};
const WEB_ARROW_UP_SHADOW: WebViewStyle = {
  filter: 'drop-shadow(0px -1px 3px rgba(33, 27, 22, 0.10))',
};
const WEB_ARROW_DOWN_SHADOW: WebViewStyle = {
  filter: 'drop-shadow(0px 1px 3px rgba(33, 27, 22, 0.10))',
};

export const AMBIENT_COMMENT_BUBBLE_WIDTH = 236;
export const AMBIENT_COMMENT_BUBBLE_HEIGHT = 88;
export const AMBIENT_COMMENT_BUBBLE_MARKER_OFFSET_PX = 58;

function getInitial(authorName: string): string {
  const trimmed = authorName.trim();
  if (trimmed.length === 0) return 'H';
  return trimmed.charAt(0).toUpperCase();
}

export interface AmbientCommentBubbleProps {
  text: string;
  likeCount: number;
  authorName: string;
  authorPhotoUrl?: string | null;
  arrowDirection?: 'up' | 'down';
  onPress?: () => void;
  testID?: string;
}

export function AmbientCommentBubble({
  text,
  likeCount,
  authorName,
  authorPhotoUrl,
  arrowDirection = 'down',
  onPress,
  testID = 'ambient-comment-bubble',
}: AmbientCommentBubbleProps) {
  const arrowUp = arrowDirection === 'up';
  const showPhoto = !!authorPhotoUrl;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open comments preview: ${text}`}
      onPress={onPress}
      style={styles.pressable}
      testID={testID}
    >
      {arrowUp && (
        <View
          style={[styles.arrowUp, Platform.OS === 'web' ? WEB_ARROW_UP_SHADOW : null]}
          testID={`${testID}-arrow-up`}
        />
      )}

      <View style={[styles.card, Platform.OS === 'web' ? WEB_BUBBLE_SHADOW : null]}>
        <View style={styles.avatar}>
          {showPhoto ? (
            <Image source={{ uri: authorPhotoUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarInitial}>{getInitial(authorName)}</Text>
          )}
        </View>

        <View style={styles.textColumn}>
          <Text numberOfLines={2} style={styles.text}>
            {text}
          </Text>
        </View>

        <View style={styles.likesRow}>
          <Icon name="Heart" size={16} color={COLORS.heart} weight="fill" />
          <Text style={styles.likesText}>{likeCount}</Text>
        </View>
      </View>

      {!arrowUp && (
        <View
          style={[styles.arrowDown, Platform.OS === 'web' ? WEB_ARROW_DOWN_SHADOW : null]}
          testID={`${testID}-arrow-down`}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    width: AMBIENT_COMMENT_BUBBLE_WIDTH,
    alignItems: 'center',
  },
  card: {
    width: AMBIENT_COMMENT_BUBBLE_WIDTH,
    minHeight: AMBIENT_COMMENT_BUBBLE_HEIGHT,
    borderRadius: 22,
    backgroundColor: COLORS.white,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.warm200,
    shadowColor: '#1F1814',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 7,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.avatarBg,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.warm900,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
    marginRight: 10,
  },
  text: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: COLORS.warm900,
  },
  likesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginBottom: 2,
    gap: 4,
  },
  likesText: {
    fontSize: 15,
    lineHeight: 18,
    color: COLORS.warm500,
    fontWeight: '600',
  },
  arrowUp: {
    width: 18,
    height: 18,
    backgroundColor: COLORS.white,
    transform: [{ rotate: '45deg' }],
    marginBottom: -9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.warm200,
  },
  arrowDown: {
    width: 18,
    height: 18,
    backgroundColor: COLORS.white,
    transform: [{ rotate: '45deg' }],
    marginTop: -9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.warm200,
  },
});
