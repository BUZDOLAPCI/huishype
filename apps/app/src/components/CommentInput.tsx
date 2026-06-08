/**
 * CommentInput — Text input with send button for comments.
 *
 * Design spec: Section 7.7 (Property Detail — comment input), Section 7.8 (Comments Page).
 *
 * Features:
 *   - Reply-to indicator with cancel
 *   - Near-limit character count
 *   - Inline send button (disabled when empty)
 *   - Auth gating via onSubmit while preserving signed-out drafts
 *   - Supports both compact (inline) and full (sticky footer) variants
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  Text,
  View,
  TextInput,
  StyleSheet,
  type NativeSyntheticEvent,
  type TextInput as TextInputType,
  type TextInputContentSizeChangeEventData,
} from 'react-native';
import { Icon } from './ui/Icon';
import { UserAvatar } from './ui/UserAvatar';
import { useT } from '@/src/i18n';

export type CommentInputVariant = 'compact' | 'full';

export interface ReplyTarget {
  id: string;
  username: string;
}

export interface CommentInputProps {
  /** Called when the user submits a comment. */
  onSubmit?: (content: string) => boolean | void;
  /** Reply-to target (shows indicator when set). */
  replyTo?: ReplyTarget | null;
  /** Called when the reply indicator is dismissed. */
  onCancelReply?: () => void;
  /** Whether the user is authenticated. */
  isAuthenticated?: boolean;
  /** Current user's username (for avatar display). */
  currentUsername?: string;
  /** Current user's display name (preferred for fallback initials). */
  currentUserDisplayName?: string;
  /** Current user's profile photo URL. */
  currentUserProfilePhotoUrl?: string | null;
  /** Whether a comment submit is currently pending. */
  isSubmitting?: boolean;
  /** Optional placeholder override. */
  placeholder?: string;
  /** Display variant. Default 'full'. */
  variant?: CommentInputVariant;
  /** Maximum character count. Default 500. */
  maxLength?: number;
  testID?: string;
}

export const MIN_TEXT_INPUT_HEIGHT = 34;

export function getFittedTextInputHeight(contentHeight: number) {
  return Math.max(MIN_TEXT_INPUT_HEIGHT, Math.ceil(contentHeight));
}

export function CommentInput({
  onSubmit,
  replyTo,
  onCancelReply,
  isAuthenticated = false,
  currentUsername,
  currentUserDisplayName,
  currentUserProfilePhotoUrl,
  isSubmitting = false,
  placeholder,
  variant = 'full',
  maxLength = 500,
  testID,
}: CommentInputProps) {
  const t = useT();
  const [content, setContent] = useState('');
  const [inputHeight, setInputHeight] = useState(MIN_TEXT_INPUT_HEIGHT);
  const inputRef = useRef<TextInputType>(null);

  useEffect(() => {
    if (!replyTo) {
      return;
    }

    const timeoutId = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [replyTo]);

  const handleChangeText = useCallback((nextContent: string) => {
    setContent(nextContent);
    if (nextContent.length === 0) {
      setInputHeight(MIN_TEXT_INPUT_HEIGHT);
    }
  }, []);

  const handleContentSizeChange = useCallback(
    (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const nextHeight = getFittedTextInputHeight(
        event.nativeEvent.contentSize.height
      );

      setInputHeight((currentHeight) => (
        currentHeight === nextHeight ? currentHeight : nextHeight
      ));
    },
    []
  );

  const handleSubmit = useCallback(() => {
    const trimmed = content.trim();
    if (
      !trimmed ||
      content.length > maxLength ||
      isSubmitting ||
      !onSubmit
    ) {
      return;
    }

    const submitted = onSubmit(trimmed);
    if (submitted === false) {
      return;
    }

    setContent('');
    setInputHeight(MIN_TEXT_INPUT_HEIGHT);
    Keyboard.dismiss();
  }, [content, isSubmitting, maxLength, onSubmit]);

  const handleCancelReply = useCallback(() => {
    onCancelReply?.();
    setContent('');
    setInputHeight(MIN_TEXT_INPUT_HEIGHT);
  }, [onCancelReply]);

  const isOverLimit = content.length > maxLength;
  const showCharacterCount = content.length > Math.min(450, maxLength * 0.9);
  const canSubmit =
    content.trim().length > 0 && !isOverLimit && !isSubmitting;
  const inputPlaceholder = replyTo
    ? t('comments.input.replyPlaceholder', { username: replyTo.username })
    : placeholder ?? t('comments.input.addPlaceholder');

  return (
    <View
      style={variant === 'full' ? styles.fullContainer : styles.compactContainer}
      testID={testID ?? 'comment-input'}
    >
      {/* Reply indicator */}
      {replyTo && (
        <View style={styles.replyIndicator}>
          <Icon name="ArrowLeft" size={12} color="#9C958A" />
          <Text style={styles.replyText} numberOfLines={1}>
            {t('comments.replyingTo')} @{replyTo.username}
          </Text>
          <Pressable
            onPress={handleCancelReply}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID="cancel-reply"
          >
            <Icon name="X" size={14} color="#9C958A" />
          </Pressable>
        </View>
      )}

      {/* Input row */}
      <View style={styles.inputRow}>
        {/* User avatar */}
        <UserAvatar
          username={currentUsername ?? 'guest'}
          displayName={currentUserDisplayName}
          profilePhotoUrl={currentUserProfilePhotoUrl}
          anonymous={!isAuthenticated}
          size="sm"
        />

        {/* Text input */}
        <View
          style={[styles.inputWrapper, { minHeight: inputHeight + 8 }]}
          testID="comment-input-wrapper"
        >
          <TextInput
            ref={inputRef}
            style={[styles.textInput, { height: inputHeight }]}
            placeholder={inputPlaceholder}
            placeholderTextColor="#C7BFB3"
            value={content}
            onChangeText={handleChangeText}
            onContentSizeChange={handleContentSizeChange}
            maxLength={maxLength + 50}
            multiline
            scrollEnabled={false}
            editable={!isSubmitting}
            testID="comment-text-input"
          />

          {/* Send button */}
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={[
              styles.sendButton,
              { backgroundColor: canSubmit ? '#F5A623' : '#F5F0E8' },
            ]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID="comment-send-button"
            accessibilityRole="button"
            accessibilityLabel={t('comments.input.send')}
          >
            <Icon
              name="PaperPlaneTilt"
              size={18}
              weight="bold"
              color={canSubmit ? '#FFFFFF' : '#C7BFB3'}
            />
          </Pressable>
        </View>
      </View>

      {showCharacterCount && (
        <Text
          style={[
            styles.characterCount,
            { color: isOverLimit ? '#EF4444' : '#9C958A' },
          ]}
          testID="character-count"
        >
          {content.length}/{maxLength}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fullContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F5F0E8',
    backgroundColor: '#FFFFFF',
  },
  compactContainer: {
    paddingTop: 0,
  },
  replyIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBF5',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
    gap: 6,
  },
  replyText: {
    fontSize: 13,
    color: '#9C958A',
    flex: 1,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#FFF8F0',
    borderRadius: 22,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 4,
    minHeight: 42,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#2D2926',
    paddingTop: 7,
    paddingBottom: 7,
    paddingHorizontal: 0,
    textAlignVertical: 'top',
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  characterCount: {
    alignSelf: 'flex-end',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
    marginRight: 8,
  },
});
