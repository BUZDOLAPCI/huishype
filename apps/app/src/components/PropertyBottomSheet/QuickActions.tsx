/**
 * PropertyBottomSheet QuickActions — Uses the shared QuickActions module
 * to maintain visual language parity between preview cards and detail view.
 *
 * Replaces the old Ionicons-based implementation with Phosphor icons
 * from the shared QuickActions component.
 */
import { View } from 'react-native';
import { QuickActions as SharedQuickActions } from '../QuickActions';
import type { SectionProps } from './types';
import { Share } from 'react-native';

interface QuickActionsProps extends SectionProps {
  onSave?: () => void;
  onShare?: () => void;
  onLike?: () => void;
}

export function QuickActions({
  property,
  onSave,
  onShare,
  onLike,
}: QuickActionsProps) {
  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out this property: ${property.address}, ${property.city}`,
        title: `${property.address} - HuisHype`,
      });
      onShare?.();
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  return (
    <View className="px-4 py-3 border-t border-warm-100">
      <SharedQuickActions
        isLiked={property.isLiked}
        isSaved={property.isSaved}
        likeCount={property.likeCount}
        commentCount={property.commentCount}
        guessCount={property.guessCount}
        onLike={onLike}
        onSave={onSave}
        onShare={handleShare}
        variant="full"
      />
    </View>
  );
}
