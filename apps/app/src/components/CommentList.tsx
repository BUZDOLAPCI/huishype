import { useState, useCallback } from 'react';
import { FlatList, Pressable, Text, View, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KarmaBadge } from './Comments/KarmaBadge';

interface Comment {
  id: string;
  author: string;
  authorKarma: number;
  content: string;
  likes: number;
  createdAt: string;
  replies?: Comment[];
}

interface CommentListProps {
  comments: Comment[];
  onLike?: (commentId: string) => void;
  onReply?: (commentId: string) => void;
  onSubmitComment?: (content: string, replyTo?: string) => void;
  isAuthenticated?: boolean;
}

type SortBy = 'recent' | 'popular';

/**
 * Get initials from a username
 */
function getInitials(name: string): string {
  return name
    .split(/(?=[A-Z])/)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * User Avatar Component - displays circular avatar with initials
 */
function UserAvatar({ author, size = 32 }: { author: string; size?: number }) {
  const initials = getInitials(author);

  // Generate a consistent background color based on username
  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-pink-500',
    'bg-indigo-500',
    'bg-teal-500',
  ];
  const colorIndex =
    author.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) %
    colors.length;
  const bgColor = colors[colorIndex];

  const sizeStyle = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View
      className={`${bgColor} items-center justify-center`}
      style={sizeStyle}
      testID="user-avatar"
    >
      <Text className="text-white font-semibold" style={{ fontSize: size * 0.4 }}>
        {initials}
      </Text>
    </View>
  );
}

function CommentItem({
  comment,
  onLike,
  onReply,
  isReply = false,
}: {
  comment: Comment;
  onLike?: (commentId: string) => void;
  onReply?: (commentId: string) => void;
  isReply?: boolean;
}) {
  return (
    <View
      className={`py-3 ${isReply ? 'ml-10 pl-3 border-l-2 border-gray-200' : ''}`}
      testID={isReply ? 'comment-reply' : 'comment'}
    >
      {/* Header: Avatar, Username, Badge, Timestamp */}
      <View className="flex-row items-start mb-2">
        <UserAvatar author={comment.author} size={isReply ? 28 : 32} />
        <View className="ml-2 flex-1">
          <View className="flex-row items-center flex-wrap">
            <Text className="font-semibold text-gray-900 mr-1.5">
              {comment.author}
            </Text>
            <KarmaBadge karma={comment.authorKarma} size="sm" />
          </View>
          <Text className="text-xs text-gray-400 mt-0.5">
            @{comment.author.toLowerCase().replace(/\s+/g, '')}
          </Text>
        </View>
        <Text className="text-xs text-gray-400">{comment.createdAt}</Text>
      </View>

      {/* Comment Content */}
      <Text className="text-gray-800 mb-2 leading-5">{comment.content}</Text>

      {/* Actions: Like, Reply */}
      <View className="flex-row items-center gap-4">
        <Pressable
          onPress={() => onLike?.(comment.id)}
          className="flex-row items-center"
          testID="like-button"
        >
          <Ionicons name="heart-outline" size={18} color="#6B7280" />
          <Text className="ml-1 text-sm text-gray-500">
            {comment.likes > 0 ? comment.likes : ''}
          </Text>
        </Pressable>

        {!isReply && (
          <Pressable
            onPress={() => onReply?.(comment.id)}
            className="flex-row items-center"
            testID="reply-button"
          >
            <Ionicons name="chatbubble-outline" size={16} color="#6B7280" />
            <Text className="ml-1 text-sm text-gray-500">Reply</Text>
          </Pressable>
        )}
      </View>

      {/* Render Replies */}
      {comment.replies?.map((reply) => (
        <CommentItem
          key={reply.id}
          comment={reply}
          onLike={onLike}
          onReply={onReply}
          isReply
        />
      ))}
    </View>
  );
}

/**
 * Comment Input Component
 */
function CommentInput({
  onSubmit,
  replyTo,
  onCancelReply,
  isAuthenticated = false,
}: {
  onSubmit?: (content: string) => void;
  replyTo?: { id: string; username: string } | null;
  onCancelReply?: () => void;
  isAuthenticated?: boolean;
}) {
  const [content, setContent] = useState('');
  const maxLength = 500;

  const handleSubmit = useCallback(() => {
    if (content.trim() && onSubmit) {
      onSubmit(content.trim());
      setContent('');
    }
  }, [content, onSubmit]);

  return (
    <View className="border-t border-gray-100 pt-3 mt-3">
      {/* Reply indicator */}
      {replyTo && (
        <View className="flex-row items-center mb-2 bg-gray-50 rounded-lg px-3 py-2">
          <Ionicons name="arrow-undo" size={14} color="#6B7280" />
          <Text className="text-sm text-gray-500 ml-2 flex-1">
            Replying to @{replyTo.username}
          </Text>
          <Pressable onPress={onCancelReply}>
            <Ionicons name="close" size={18} color="#6B7280" />
          </Pressable>
        </View>
      )}

      {/* Input field */}
      <View className="flex-row items-center bg-gray-50 rounded-xl px-3 py-2">
        <TextInput
          className="flex-1 text-gray-800 text-sm"
          placeholder={isAuthenticated ? 'Share your thoughts...' : 'Log in to comment...'}
          placeholderTextColor="#9CA3AF"
          value={content}
          onChangeText={setContent}
          maxLength={maxLength}
          multiline
          editable={isAuthenticated}
        />
        {isAuthenticated && (
          <View className="flex-row items-center gap-2">
            <Text className="text-xs text-gray-400">
              {content.length}/{maxLength}
            </Text>
            <Pressable
              onPress={handleSubmit}
              disabled={!content.trim()}
              className={`p-1.5 rounded-full ${content.trim() ? 'bg-blue-500' : 'bg-gray-200'}`}
            >
              <Ionicons
                name="send"
                size={16}
                color={content.trim() ? 'white' : '#9CA3AF'}
              />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

export function CommentList({
  comments,
  onLike,
  onReply,
  onSubmitComment,
  isAuthenticated = true
}: CommentListProps) {
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);

  // Handle reply
  const handleReply = useCallback((commentId: string) => {
    const comment = comments.find((c) => c.id === commentId);
    if (comment) {
      setReplyTo({ id: commentId, username: comment.author });
    }
    onReply?.(commentId);
  }, [comments, onReply]);

  // Handle cancel reply
  const handleCancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  // Handle submit
  const handleSubmit = useCallback((content: string) => {
    onSubmitComment?.(content, replyTo?.id);
    setReplyTo(null);
  }, [onSubmitComment, replyTo]);

  // Sort comments
  const sortedComments = [...comments].sort((a, b) => {
    if (sortBy === 'popular') {
      return b.likes - a.likes;
    }
    // For 'recent', keep original order (assuming already sorted by date)
    return 0;
  });

  // Empty state
  if (comments.length === 0) {
    return (
      <View>
        {/* Sort toggle - still show even for empty state */}
        <View className="flex-row bg-gray-100 rounded-lg p-0.5 self-end mb-4">
          <Pressable
            onPress={() => setSortBy('recent')}
            className={`px-3 py-1.5 rounded-md ${
              sortBy === 'recent' ? 'bg-white shadow-sm' : ''
            }`}
          >
            <Text
              className={`text-sm ${
                sortBy === 'recent' ? 'text-gray-900 font-medium' : 'text-gray-500'
              }`}
            >
              Recent
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSortBy('popular')}
            className={`px-3 py-1.5 rounded-md ${
              sortBy === 'popular' ? 'bg-white shadow-sm' : ''
            }`}
          >
            <Text
              className={`text-sm ${
                sortBy === 'popular' ? 'text-gray-900 font-medium' : 'text-gray-500'
              }`}
            >
              Popular
            </Text>
          </Pressable>
        </View>

        {/* Empty state content */}
        <View className="bg-gray-50 rounded-xl p-4 items-center">
          <Ionicons name="chatbubble-ellipses-outline" size={32} color="#9CA3AF" />
          <Text className="text-gray-500 mt-2">No comments yet</Text>
          <Text className="text-xs text-gray-400 mt-1">
            Be the first to share your thoughts!
          </Text>
        </View>

        {/* Comment input */}
        <CommentInput
          onSubmit={handleSubmit}
          replyTo={replyTo}
          onCancelReply={handleCancelReply}
          isAuthenticated={isAuthenticated}
        />
      </View>
    );
  }

  return (
    <View>
      {/* Sort toggle */}
      <View className="flex-row bg-gray-100 rounded-lg p-0.5 self-end mb-4">
        <Pressable
          onPress={() => setSortBy('recent')}
          className={`px-3 py-1.5 rounded-md ${
            sortBy === 'recent' ? 'bg-white shadow-sm' : ''
          }`}
        >
          <Text
            className={`text-sm ${
              sortBy === 'recent' ? 'text-gray-900 font-medium' : 'text-gray-500'
            }`}
          >
            Recent
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setSortBy('popular')}
          className={`px-3 py-1.5 rounded-md ${
            sortBy === 'popular' ? 'bg-white shadow-sm' : ''
          }`}
        >
          <Text
            className={`text-sm ${
              sortBy === 'popular' ? 'text-gray-900 font-medium' : 'text-gray-500'
            }`}
          >
            Popular
          </Text>
        </Pressable>
      </View>

      {/* Comments list */}
      <FlatList
        data={sortedComments}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <CommentItem comment={item} onLike={onLike} onReply={handleReply} />
        )}
        ItemSeparatorComponent={() => <View className="h-px bg-gray-100" />}
        scrollEnabled={false}
        testID="comments-list"
      />

      {/* Comment input */}
      <CommentInput
        onSubmit={handleSubmit}
        replyTo={replyTo}
        onCancelReply={handleCancelReply}
        isAuthenticated={isAuthenticated}
      />
    </View>
  );
}
