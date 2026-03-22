/**
 * CommentInput — Text input with send button for comments.
 *
 * Design spec: Section 7.7 (Property Detail — comment input), Section 7.8 (Comments Page).
 *
 * Features:
 *   - Reply-to indicator with cancel
 *   - Character count
 *   - Gold send button (disabled when empty)
 *   - Auth gating (non-editable placeholder for unauthenticated users)
 *   - Supports both compact (inline) and full (sticky footer) variants
 */

import React, { useCallback, useState } from 'react';
import { Pressable, Text, View, TextInput, StyleSheet } from 'react-native';
import { Icon } from './ui/Icon';
import { UserAvatar } from './ui/UserAvatar';

export type CommentInputVariant = 'compact' | 'full';

export interface ReplyTarget {
  id: string;
  username: string;
}

export interface CommentInputProps {
  /** Called when the user submits a comment. */
  onSubmit?: (content: string) => void;
  /** Reply-to target (shows indicator when set). */
  replyTo?: ReplyTarget | null;
  /** Called when the reply indicator is dismissed. */
  onCancelReply?: () => void;
  /** Whether the user is authenticated. */
  isAuthenticated?: boolean;
  /** Current user's username (for avatar display). */
  currentUsername?: string;
  /** Display variant. Default 'full'. */
  variant?: CommentInputVariant;
  /** Maximum character count. Default 500. */
  maxLength?: number;
  testID?: string;
}

export function CommentInput({
  onSubmit,
  replyTo,
  onCancelReply,
  isAuthenticated = false,
  currentUsername,
  variant = 'full',
  maxLength = 500,
  testID,
}: CommentInputProps) {
  const [content, setContent] = useState('');

  const handleSubmit = useCallback(() => {
    const trimmed = content.trim();
    if (trimmed && onSubmit) {
      onSubmit(trimmed);
      setContent('');
    }
  }, [content, onSubmit]);

  const canSubmit = content.trim().length > 0 && isAuthenticated;

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
            Replying to @{replyTo.username}
          </Text>
          <Pressable
            onPress={onCancelReply}
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
        {currentUsername && (
          <UserAvatar username={currentUsername} size="sm" />
        )}

        {/* Text input */}
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.textInput}
            placeholder={isAuthenticated ? 'Add a comment...' : 'Log in to comment...'}
            placeholderTextColor="#C7BFB3"
            value={content}
            onChangeText={setContent}
            maxLength={maxLength}
            multiline
            editable={isAuthenticated}
            testID="comment-text-input"
          />
        </View>

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
          accessibilityLabel="Send comment"
        >
          <Icon
            name="PaperPlaneTilt"
            size="sm"
            color={canSubmit ? '#FFFFFF' : '#C7BFB3'}
          />
        </Pressable>
      </View>
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
    paddingTop: 8,
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
    backgroundColor: '#FFF8F0',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 40,
    justifyContent: 'center',
  },
  textInput: {
    fontSize: 14,
    color: '#2D2926',
    maxHeight: 100,
    padding: 0,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
