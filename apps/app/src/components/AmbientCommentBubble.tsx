import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';

import { Icon } from './ui/Icon';
import { UserAvatar } from './ui/UserAvatar';
import type { WebViewStyle } from '@/src/lib/webStyle';

const COLORS = {
  white: '#FFFDF9',
  warm100: '#FFF8F0',
  warm200: '#F5ECDD',
  warm500: '#93806E',
  warm700: '#54483F',
  warm900: '#2E2621',
  heart: '#BCAEA0',
} as const;

const AMBIENT_COMMENT_BUBBLE_SCALE = 0.8;

function scaleBubbleSize(value: number): number {
  return value * AMBIENT_COMMENT_BUBBLE_SCALE;
}

const WEB_BUBBLE_SHADOW: WebViewStyle = {
  boxShadow: `0px ${scaleBubbleSize(14)}px ${scaleBubbleSize(30)}px rgba(33, 27, 22, 0.14), 0px ${scaleBubbleSize(3)}px ${scaleBubbleSize(12)}px rgba(180, 119, 18, 0.08)`,
};

export const AMBIENT_COMMENT_BUBBLE_WIDTH = scaleBubbleSize(236);
export const AMBIENT_COMMENT_BUBBLE_HEIGHT = scaleBubbleSize(64);
export const AMBIENT_COMMENT_BUBBLE_MARKER_OFFSET_PX = scaleBubbleSize(24);
export const AMBIENT_COMMENT_BUBBLE_ARROW_TIP_CENTER_X = scaleBubbleSize(35);
export type AmbientCommentBubbleArrowHorizontalAlign = 'left' | 'right';

export function getAmbientCommentBubbleArrowLayout(params: {
  anchorX: number;
  viewportWidth: number;
}): {
  anchorOffsetX: number;
  arrowHorizontalAlign: AmbientCommentBubbleArrowHorizontalAlign;
} {
  const { anchorX, viewportWidth } = params;
  const arrowHorizontalAlign =
    Number.isFinite(anchorX) &&
      Number.isFinite(viewportWidth) &&
      viewportWidth > 0 &&
      anchorX > viewportWidth / 2
      ? 'right'
      : 'left';

  return {
    anchorOffsetX:
      arrowHorizontalAlign === 'right'
        ? AMBIENT_COMMENT_BUBBLE_WIDTH - AMBIENT_COMMENT_BUBBLE_ARROW_TIP_CENTER_X
        : AMBIENT_COMMENT_BUBBLE_ARROW_TIP_CENTER_X,
    arrowHorizontalAlign,
  };
}

const FULL_WIDTH_LINE_CHAR_BUDGET = 19;
const BADGE_LINE_CHAR_BUDGET = 13;

function takePreviewLine(text: string, charBudget: number): { line: string; rest: string } {
  if (text.length <= charBudget) {
    return { line: text, rest: '' };
  }

  const probe = text.slice(0, charBudget + 1);
  const breakAt = Math.max(probe.lastIndexOf(' '), probe.lastIndexOf('-'));

  if (breakAt >= Math.floor(charBudget * 0.6)) {
    return {
      line: text.slice(0, breakAt).trimEnd(),
      rest: text.slice(breakAt + 1).trimStart(),
    };
  }

  return {
    line: text.slice(0, charBudget).trimEnd(),
    rest: text.slice(charBudget).trimStart(),
  };
}

function truncateLine(text: string, charBudget: number): string {
  if (text.length <= charBudget) {
    return text;
  }

  return `${text.slice(0, Math.max(charBudget - 1, 1)).trimEnd()}…`;
}

function splitBubbleText(text: string): { firstLine: string; secondLine: string | null } {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    return { firstLine: '', secondLine: null };
  }

  const firstPass = takePreviewLine(normalized, FULL_WIDTH_LINE_CHAR_BUDGET);
  if (!firstPass.rest) {
    return { firstLine: firstPass.line, secondLine: null };
  }

  const secondPass = takePreviewLine(firstPass.rest, BADGE_LINE_CHAR_BUDGET);
  const secondLine = secondPass.rest
    ? truncateLine(`${secondPass.line} ${secondPass.rest}`.trim(), BADGE_LINE_CHAR_BUDGET)
    : secondPass.line;

  return {
    firstLine: firstPass.line,
    secondLine,
  };
}

export interface AmbientCommentBubbleProps {
  text: string;
  likeCount: number;
  authorName: string;
  authorPhotoUrl?: string | null;
  arrowDirection?: 'up' | 'down';
  arrowHorizontalAlign?: AmbientCommentBubbleArrowHorizontalAlign;
  onPress?: () => void;
  testID?: string;
}

export function AmbientCommentBubble({
  text,
  likeCount,
  authorName,
  authorPhotoUrl,
  arrowDirection = 'down',
  arrowHorizontalAlign = 'left',
  onPress,
  testID = 'ambient-comment-bubble',
}: AmbientCommentBubbleProps) {
  const arrowUp = arrowDirection === 'up';
  const arrowHorizontalPosition =
    arrowHorizontalAlign === 'right' ? styles.arrowRightAligned : styles.arrowLeftAligned;
  const { firstLine, secondLine } = splitBubbleText(text);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open comments preview: ${text}`}
      onPress={onPress}
      style={styles.pressable}
      testID={testID}
    >
      <View style={[styles.stack, arrowUp ? styles.stackUp : styles.stackDown]}>
        {arrowUp && (
          <View
            style={[styles.arrowUpContainer, arrowHorizontalPosition]}
            testID={`${testID}-arrow-up`}
          >
            <View style={styles.arrowUpBorder} />
            <View style={styles.arrowUpFill} />
          </View>
        )}

        <View style={[styles.card, Platform.OS === 'web' ? WEB_BUBBLE_SHADOW : null]}>
          <View style={styles.avatar}>
            <UserAvatar
              username={authorName}
              displayName={authorName}
              profilePhotoUrl={authorPhotoUrl}
              size="md"
              testID={`${testID}-avatar`}
            />
          </View>

          <View style={styles.contentColumn}>
            <Text numberOfLines={1} style={styles.text} testID={`${testID}-text-line-1`}>
              {firstLine}
            </Text>

            <View style={styles.bottomRow}>
              {secondLine ? (
                <Text numberOfLines={1} style={styles.text} testID={`${testID}-text-line-2`}>
                  {secondLine}
                </Text>
              ) : (
                <View />
              )}
            </View>

            <View style={styles.likesRow} testID={`${testID}-likes`}>
              <Icon
                name="Heart"
                size={scaleBubbleSize(16)}
                color={COLORS.heart}
                weight="fill"
              />
              <Text style={styles.likesText}>{likeCount}</Text>
            </View>
          </View>
        </View>

        {!arrowUp && (
          <View
            style={[styles.arrowDownContainer, arrowHorizontalPosition]}
            testID={`${testID}-arrow-down`}
          >
            <View style={styles.arrowDownBorder} />
            <View style={styles.arrowDownFill} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    width: AMBIENT_COMMENT_BUBBLE_WIDTH,
  },
  stack: {
    position: 'relative',
    width: AMBIENT_COMMENT_BUBBLE_WIDTH,
  },
  stackUp: {
    paddingTop: scaleBubbleSize(10),
  },
  stackDown: {
    paddingBottom: scaleBubbleSize(10),
  },
  card: {
    position: 'relative',
    width: AMBIENT_COMMENT_BUBBLE_WIDTH,
    minHeight: AMBIENT_COMMENT_BUBBLE_HEIGHT,
    borderRadius: scaleBubbleSize(24),
    backgroundColor: COLORS.white,
    paddingHorizontal: scaleBubbleSize(14),
    paddingTop: scaleBubbleSize(1),
    paddingBottom: scaleBubbleSize(1),
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.warm200,
    shadowColor: '#1F1814',
    shadowOffset: { width: 0, height: scaleBubbleSize(8) },
    shadowOpacity: 0.12,
    shadowRadius: scaleBubbleSize(18),
    elevation: scaleBubbleSize(7),
    zIndex: 1,
  },
  avatar: {
    marginRight: scaleBubbleSize(12),
  },
  contentColumn: {
    flex: 1,
    minWidth: 0,
    minHeight: scaleBubbleSize(30),
    justifyContent: 'center',
  },
  text: {
    fontSize: scaleBubbleSize(15),
    lineHeight: scaleBubbleSize(20),
    fontWeight: '600',
    color: COLORS.warm700,
  },
  bottomRow: {
    minHeight: scaleBubbleSize(17),
    paddingRight: scaleBubbleSize(44),
    marginTop: scaleBubbleSize(-2),
  },
  likesRow: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: scaleBubbleSize(4),
  },
  likesText: {
    fontSize: scaleBubbleSize(15),
    lineHeight: scaleBubbleSize(17),
    color: COLORS.warm500,
    fontWeight: '600',
  },
  arrowLeftAligned: {
    left: scaleBubbleSize(24),
  },
  arrowRightAligned: {
    right: scaleBubbleSize(24),
  },
  arrowUpContainer: {
    position: 'absolute',
    top: scaleBubbleSize(1),
    width: scaleBubbleSize(22),
    height: scaleBubbleSize(10),
    zIndex: 2,
  },
  arrowUpBorder: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    borderLeftWidth: scaleBubbleSize(11),
    borderRightWidth: scaleBubbleSize(11),
    borderBottomWidth: scaleBubbleSize(10),
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: COLORS.warm200,
  },
  arrowUpFill: {
    position: 'absolute',
    left: scaleBubbleSize(1),
    top: scaleBubbleSize(1),
    width: 0,
    height: 0,
    borderLeftWidth: scaleBubbleSize(10),
    borderRightWidth: scaleBubbleSize(10),
    borderBottomWidth: scaleBubbleSize(9),
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: COLORS.white,
  },
  arrowDownContainer: {
    position: 'absolute',
    bottom: scaleBubbleSize(1),
    width: scaleBubbleSize(22),
    height: scaleBubbleSize(10),
    zIndex: 2,
  },
  arrowDownBorder: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: 0,
    height: 0,
    borderLeftWidth: scaleBubbleSize(11),
    borderRightWidth: scaleBubbleSize(11),
    borderTopWidth: scaleBubbleSize(10),
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: COLORS.warm200,
  },
  arrowDownFill: {
    position: 'absolute',
    left: scaleBubbleSize(1),
    bottom: scaleBubbleSize(1),
    width: 0,
    height: 0,
    borderLeftWidth: scaleBubbleSize(10),
    borderRightWidth: scaleBubbleSize(10),
    borderTopWidth: scaleBubbleSize(9),
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: COLORS.white,
  },
});
