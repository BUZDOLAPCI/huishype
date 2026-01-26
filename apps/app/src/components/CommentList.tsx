import { FlatList, Pressable, Text, View } from 'react-native';

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
  const getKarmaLabel = (karma: number) => {
    if (karma >= 1000) return 'Expert';
    if (karma >= 500) return 'Trusted';
    if (karma >= 100) return 'Active';
    return 'New';
  };

  const karmaColors: Record<string, string> = {
    Expert: 'text-purple-600 bg-purple-100',
    Trusted: 'text-blue-600 bg-blue-100',
    Active: 'text-green-600 bg-green-100',
    New: 'text-gray-600 bg-gray-100',
  };

  const karmaLabel = getKarmaLabel(comment.authorKarma);

  return (
    <View className={`py-3 ${isReply ? 'ml-8 border-l-2 border-gray-100 pl-4' : ''}`}>
      <View className="flex-row items-center mb-1">
        <Text className="font-semibold text-gray-900">{comment.author}</Text>
        <View className={`ml-2 px-2 py-0.5 rounded-full ${karmaColors[karmaLabel]}`}>
          <Text className={`text-xs ${karmaColors[karmaLabel].split(' ')[0]}`}>
            {karmaLabel}
          </Text>
        </View>
        <Text className="ml-auto text-xs text-gray-400">{comment.createdAt}</Text>
      </View>
      <Text className="text-gray-700 mb-2">{comment.content}</Text>
      <View className="flex-row gap-4">
        <Pressable
          onPress={() => onLike?.(comment.id)}
          className="flex-row items-center"
        >
          <Text className="text-sm text-gray-500">
            {'\u2764\uFE0F'} {comment.likes}
          </Text>
        </Pressable>
        {!isReply && (
          <Pressable
            onPress={() => onReply?.(comment.id)}
            className="flex-row items-center"
          >
            <Text className="text-sm text-gray-500">Reply</Text>
          </Pressable>
        )}
      </View>
      {comment.replies?.map((reply) => (
        <CommentItem
          key={reply.id}
          comment={reply}
          onLike={onLike}
          isReply
        />
      ))}
    </View>
  );
}

export function CommentList({ comments, onLike, onReply }: CommentListProps) {
  if (comments.length === 0) {
    return (
      <View className="py-8 items-center">
        <Text className="text-gray-400">No comments yet</Text>
        <Text className="text-sm text-gray-400 mt-1">Be the first to share your thoughts!</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={comments}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <CommentItem comment={item} onLike={onLike} onReply={onReply} />
      )}
      ItemSeparatorComponent={() => <View className="h-px bg-gray-100" />}
    />
  );
}
