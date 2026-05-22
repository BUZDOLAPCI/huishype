import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  Text,
  Pressable,
  Keyboard,
  type TextInput as TextInputType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '../../i18n';

export interface CommentInputProps {
  onSubmit: (content: string) => boolean | void;
  replyTo?: { id: string; username: string } | null;
  onCancelReply?: () => void;
  isSubmitting?: boolean;
  maxLength?: number;
  placeholder?: string;
}

/**
 * CommentInput Component
 * Text input for submitting comments with character counter and reply indicator
 */
export function CommentInput({
  onSubmit,
  replyTo,
  onCancelReply,
  isSubmitting = false,
  maxLength = 500,
  placeholder,
}: CommentInputProps) {
  const t = useT();
  const [content, setContent] = useState('');
  const inputRef = useRef<TextInputType>(null);

  // Auto-focus when replying
  useEffect(() => {
    if (replyTo) {
      // Small delay to ensure the keyboard opens properly
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [replyTo]);

  const handleSubmit = useCallback(() => {
    const trimmedContent = content.trim();
    if (trimmedContent.length === 0 || trimmedContent.length > maxLength) {
      return;
    }

    const submitted = onSubmit(trimmedContent);
    if (submitted === false) {
      return;
    }
    setContent('');
    // Dismiss keyboard after submit (safe call for web/native)
    if (Keyboard?.dismiss) {
      Keyboard.dismiss();
    }
  }, [content, maxLength, onSubmit]);

  const handleCancelReply = useCallback(() => {
    onCancelReply?.();
    setContent('');
  }, [onCancelReply]);

  const isOverLimit = content.length > maxLength;
  const isEmpty = content.trim().length === 0;
  const canSubmit = !isEmpty && !isOverLimit && !isSubmitting;

  const characterCountColor = isOverLimit
    ? 'text-red-500'
    : content.length > maxLength * 0.9
    ? 'text-amber-500'
    : 'text-warm-400';

  return (
    <View className="border-t border-warm-200 bg-surface-card px-4 py-3">
      {/* Reply indicator */}
      {replyTo && (
        <View
          className="flex-row items-center mb-2 bg-warm-100 rounded-lg px-3 py-2"
          testID="reply-indicator"
        >
          <Ionicons name="return-down-forward" size={16} color="#9C958A" />
          <Text className="flex-1 ml-2 text-warm-600 text-sm">
            {t('comments.replyingTo')} <Text className="font-semibold">@{replyTo.username}</Text>
          </Text>
          <Pressable
            onPress={handleCancelReply}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            testID="cancel-reply-button"
          >
            <Ionicons name="close-circle" size={20} color="#C7BFB3" />
          </Pressable>
        </View>
      )}

      {/* Input area */}
      <View className="flex-row items-end">
        <View className="flex-1 bg-warm-100 rounded-xl px-4 py-2.5">
          <TextInput
            ref={inputRef}
            value={content}
            onChangeText={setContent}
            placeholder={
              replyTo
                ? t('comments.input.replyPlaceholder', { username: replyTo.username })
                : placeholder ?? t('comments.placeholder.authenticated')
            }
            placeholderTextColor="#C7BFB3"
            multiline
            maxLength={maxLength + 50} // Allow typing over limit to show error
            editable={!isSubmitting}
            className="text-warm-900 text-base max-h-24"
            testID="comment-input"
          />

          {/* Character counter */}
          <View className="flex-row justify-end mt-1">
            <Text className={`text-xs ${characterCountColor}`} testID="character-count">
              {content.length}/{maxLength}
            </Text>
          </View>
        </View>

        {/* Submit button */}
        <Pressable
          onPress={handleSubmit}
          disabled={!canSubmit}
          className={`ml-2 w-10 h-10 rounded-full items-center justify-center ${
            canSubmit ? 'bg-primary-500' : 'bg-warm-200'
          }`}
          testID="submit-button"
        >
          {isSubmitting ? (
            <Ionicons name="hourglass-outline" size={20} color="#C7BFB3" />
          ) : (
            <Ionicons
              name="send"
              size={18}
              color={canSubmit ? '#FFFFFF' : '#C7BFB3'}
            />
          )}
        </Pressable>
      </View>

      {/* Error message for over limit */}
      {isOverLimit && (
        <Text className="text-red-500 text-xs mt-1 ml-1">
          {t('comments.tooLong')}
        </Text>
      )}
    </View>
  );
}
