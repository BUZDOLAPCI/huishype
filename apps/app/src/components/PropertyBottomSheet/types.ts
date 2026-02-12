import type { Property, PropertyFmvData } from '../../hooks/useProperties';

export interface PropertyDetailsData extends Property {
  askingPrice?: number;
  fmv?: PropertyFmvData;
  activityLevel: 'hot' | 'warm' | 'cold';
  commentCount: number;
  guessCount: number;
  viewCount: number;
  photos?: string[];
  isSaved?: boolean;
  isLiked?: boolean;
}

export interface SectionProps {
  property: PropertyDetailsData;
}

export interface PropertyBottomSheetProps {
  property: Property | null;
  isLoading?: boolean;
  isLiked?: boolean;
  isSaved?: boolean;
  onClose?: () => void;
  onSheetChange?: (index: number) => void;
  onSave?: (propertyId: string) => void;
  onShare?: (propertyId: string) => void;
  onLike?: (propertyId: string) => void;
  onGuessPress?: (propertyId: string) => void;
  onCommentPress?: (propertyId: string) => void;
  onAuthRequired?: () => void;
}

export interface PropertyBottomSheetRef {
  expand: () => void;
  collapse: () => void;
  close: () => void;
  snapToIndex: (index: number) => void;
  scrollToComments: () => void;
  scrollToGuess: () => void;
  getCurrentIndex: () => number;
}

/** Convert basic Property to PropertyDetailsData, merging enriched API data when available */
export function toPropertyDetails(
  property: Property,
  enriched?: Record<string, unknown> | null,
  overrides?: { isLiked?: boolean; isSaved?: boolean }
): PropertyDetailsData {
  return {
    ...property,
    activityLevel: (enriched?.activityLevel as 'hot' | 'warm' | 'cold') ?? 'cold',
    commentCount: (enriched?.commentCount as number) ?? 0,
    guessCount: (enriched?.guessCount as number) ?? 0,
    viewCount: (enriched?.viewCount as number) ?? 0,
    isSaved: overrides?.isSaved ?? (enriched?.isSaved as boolean) ?? false,
    isLiked: overrides?.isLiked ?? (enriched?.isLiked as boolean) ?? false,
  };
}
