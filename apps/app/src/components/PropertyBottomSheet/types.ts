import type { Property, PropertyDetails, PropertyFmvData } from '../../hooks/useProperties';
import type { AuthModalCopyInput } from '../../lib/authModalCopy';

export type PropertyContentData = Property | PropertyDetails | PropertyDetailsData;

export interface PropertyDetailsData extends Property {
  askingPrice?: number;
  fmv?: PropertyFmvData;
  hasActiveListing?: boolean;
  marketState?: 'for-sale' | 'for-rent' | 'sold' | 'rented' | 'not-listed' | null;
  socialScore?: number;
  recentSocialScore?: number;
  lastSocialAt?: string | null;
  activityLevel: 'hot' | 'warm' | 'cold';
  commentCount: number;
  topLevelCommentCount?: number;
  replyCount?: number;
  guessCount: number;
  viewCount: number;
  uniqueViewerCount?: number;
  propertyLikeCount?: number;
  commentLikeCount?: number;
  recentTopLevelCommentCount?: number;
  recentReplyCount?: number;
  recentPropertyLikeCount?: number;
  recentCommentLikeCount?: number;
  recentGuessCount?: number;
  recentViewCount?: number;
  recentUniqueViewerCount?: number;
  likeCount?: number;
  isSaved?: boolean;
  isLiked?: boolean;
}

export interface SectionProps {
  property: PropertyDetailsData;
}

export interface PropertyBottomSheetProps {
  property: PropertyContentData | null;
  isLoading?: boolean;
  isLiked?: boolean;
  isSaved?: boolean;
  isPreviewCardVisible?: boolean;
  onClose?: () => void;
  onSheetChange?: (index: number) => void;
  onSave?: (propertyId: string) => void;
  onShare?: (propertyId: string) => void;
  onLike?: (propertyId: string) => void;
  onGuessPress?: (propertyId: string) => void;
  onCommentPress?: (propertyId: string) => void;
  onAuthRequired?: (copy?: AuthModalCopyInput) => void;
}

export interface PropertyBottomSheetRef {
  expand: () => void;
  collapse: () => void;
  close: () => void;
  snapToIndex: (index: number) => void;
  openFromPreview: () => void;
  scrollToComments: () => void;
  scrollToGuess: () => void;
  getCurrentIndex: () => number;
}

function isActivityLevel(
  value: unknown
): value is PropertyDetailsData['activityLevel'] {
  return value === 'hot' || value === 'warm' || value === 'cold';
}

export function hasPropertyDetails(
  property: PropertyContentData | null | undefined
): property is PropertyDetails | PropertyDetailsData {
  if (!property) {
    return false;
  }

  return (
    'commentCount' in property && typeof property.commentCount === 'number' &&
    'guessCount' in property && typeof property.guessCount === 'number' &&
    'viewCount' in property && typeof property.viewCount === 'number' &&
    'activityLevel' in property && isActivityLevel(property.activityLevel)
  );
}

export function toPropertyDetails(
  property: PropertyContentData,
  overrides?: { isLiked?: boolean; isSaved?: boolean }
): PropertyDetailsData {
  const details = property as Partial<PropertyDetailsData>;
  const activityLevel =
    isActivityLevel(details.activityLevel)
      ? details.activityLevel
      : (details.recentSocialScore ?? 0) > 0
        ? 'hot'
        : (details.socialScore ?? 0) > 0 || details.hasActiveListing
          ? 'warm'
          : 'cold';

  return {
    ...property,
    askingPrice: property.askingPrice ?? undefined,
    fmv: details.fmv,
    hasActiveListing: details.hasActiveListing ?? false,
    marketState: details.marketState ?? null,
    socialScore: details.socialScore ?? 0,
    recentSocialScore: details.recentSocialScore ?? 0,
    lastSocialAt: details.lastSocialAt ?? null,
    activityLevel,
    commentCount: details.commentCount ?? details.topLevelCommentCount ?? 0,
    topLevelCommentCount: details.topLevelCommentCount ?? details.commentCount ?? 0,
    replyCount: details.replyCount ?? 0,
    guessCount: details.guessCount ?? 0,
    viewCount: details.viewCount ?? 0,
    uniqueViewerCount: details.uniqueViewerCount ?? 0,
    propertyLikeCount: details.propertyLikeCount ?? 0,
    commentLikeCount: details.commentLikeCount ?? 0,
    recentTopLevelCommentCount: details.recentTopLevelCommentCount ?? 0,
    recentReplyCount: details.recentReplyCount ?? 0,
    recentPropertyLikeCount: details.recentPropertyLikeCount ?? 0,
    recentCommentLikeCount: details.recentCommentLikeCount ?? 0,
    recentGuessCount: details.recentGuessCount ?? 0,
    recentViewCount: details.recentViewCount ?? 0,
    recentUniqueViewerCount: details.recentUniqueViewerCount ?? 0,
    likeCount: details.likeCount ?? 0,
    isSaved: overrides?.isSaved ?? details.isSaved ?? false,
    isLiked: overrides?.isLiked ?? details.isLiked ?? false,
  };
}
