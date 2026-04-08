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
import { SectionCard } from './SectionCard';

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
    <SectionCard
      title="Take Action"
      icon="flash-outline"
      description="React, save, or share without leaving the detail surface."
    >
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
    </SectionCard>
  );
}
