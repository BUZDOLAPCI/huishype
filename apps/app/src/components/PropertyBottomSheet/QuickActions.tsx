/**
 * PropertyBottomSheet QuickActions — Uses the shared QuickActions module
 * to maintain visual language parity between preview cards and detail view.
 *
 * Replaces the old Ionicons-based implementation with Phosphor icons
 * from the shared QuickActions component.
 */
import { useCallback, useState } from 'react';
import { QuickActions as SharedQuickActions } from '../QuickActions';
import type { SectionProps } from './types';
import { Platform, Share } from 'react-native';
import { SectionCard } from './SectionCard';
import { SharePropertyModal } from './SharePropertyModal';
import { useWebDismissibleLayer } from '../../providers/WebDismissibleLayerProvider';
import {
  buildPropertySharePayload,
  isUnsupportedWebShareError,
} from '../../utils/property-share';

interface QuickActionsProps extends SectionProps {
  onSave?: () => void;
  onShare?: () => void;
  onLike?: () => void;
  onComment?: () => void;
  onGuess?: () => void;
}

export function QuickActions({
  property,
  onSave,
  onShare,
  onLike,
  onComment,
  onGuess,
}: QuickActionsProps) {
  const [isShareModalVisible, setIsShareModalVisible] = useState(false);
  const sharePayload = buildPropertySharePayload(property);
  const closeShareModal = useCallback(() => {
    setIsShareModalVisible(false);
  }, []);

  useWebDismissibleLayer({
    id: `property-share-modal:${property.id}`,
    active: isShareModalVisible,
    onDismiss: closeShareModal,
    stateKey: property.id,
    enabled: Platform.OS === 'web',
  });

  const handleShare = async () => {
    try {
      await Share.share(sharePayload);
      onShare?.();
    } catch (error) {
      if (isUnsupportedWebShareError(error)) {
        setIsShareModalVisible(true);
        return;
      }

      console.error('Error sharing:', error);
    }
  };

  return (
    <>
      <SectionCard
        title="Take Action"
        icon="flash-outline"
      >
        <SharedQuickActions
          isLiked={property.isLiked}
          isSaved={property.isSaved}
          likeCount={property.likeCount}
          commentCount={property.commentCount}
          guessCount={property.guessCount}
          onLike={onLike}
          onComment={onComment}
          onGuess={onGuess}
          onSave={onSave}
          onShare={handleShare}
          variant="full"
        />
      </SectionCard>

      <SharePropertyModal
        property={property}
        visible={isShareModalVisible}
        payload={sharePayload}
        onClose={closeShareModal}
      />
    </>
  );
}
