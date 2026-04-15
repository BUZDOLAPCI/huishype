import type { Property, PropertyDetails, PropertyFmvData } from '../../hooks/useProperties';
import type { AuthModalCopyInput } from '../../lib/authModalCopy';

export type PropertyContentData = Property | PropertyDetails | PropertyDetailsData;

export interface PropertyDetailsData extends Property {
  askingPrice?: number;
  fmv?: PropertyFmvData;
  activityLevel: 'hot' | 'warm' | 'cold';
  commentCount: number;
  guessCount: number;
  viewCount: number;
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
  onViewAllComments?: (propertyId: string) => void;
  onViewAllGuesses?: (propertyId: string) => void;
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

  return {
    ...property,
    askingPrice: property.askingPrice ?? undefined,
    fmv: details.fmv,
    activityLevel: isActivityLevel(details.activityLevel) ? details.activityLevel : 'cold',
    commentCount: details.commentCount ?? 0,
    guessCount: details.guessCount ?? 0,
    viewCount: details.viewCount ?? 0,
    likeCount: details.likeCount ?? 0,
    isSaved: overrides?.isSaved ?? details.isSaved ?? false,
    isLiked: overrides?.isLiked ?? details.isLiked ?? false,
  };
}
