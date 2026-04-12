import type { GroupPreviewProperty } from '../GroupPreviewCard';
import type { Property, PropertyDetails, PropertyFmvData } from '../../hooks/useProperties';
import type { AuthModalCopyInput } from '../../lib/authModalCopy';
import type { PropertyImageRecord } from '../../utils/property-image';

export type PropertyContentData = Property | PropertyDetails | PropertyDetailsData | GroupPreviewProperty;

export interface PropertyDetailsData extends PropertyImageRecord {
  id: string;
  address: string;
  city: string;
  nationalId?: string | null;
  region?: string | null;
  postalCode?: string | null;
  countryCode?: string;
  street?: string | null;
  streetName?: string | null;
  houseNumber?: string | number | null;
  houseNumberAddition?: string | null;
  geometry?: Property['geometry'] | null;
  imageryGeometry?: Property['imageryGeometry'] | null;
  yearBuilt?: number | null;
  floorAreaM2?: number | null;
  status?: Property['status'] | null;
  officialValuation?: number;
  hasListing?: boolean;
  askingPrice?: number;
  fmv?: PropertyFmvData;
  activityLevel: 'hot' | 'warm' | 'cold';
  commentCount: number;
  guessCount: number;
  viewCount: number;
  uniqueViewers?: number;
  createdAt?: string;
  updatedAt?: string;
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

export function normalizePropertyFmv(
  fmv: PropertyFmvData | number | null | undefined,
  officialValuation?: number | null,
  askingPrice?: number | null,
): PropertyFmvData | undefined {
  if (fmv == null) {
    return undefined;
  }

  if (typeof fmv === 'number') {
    return {
      fmv,
      confidence: 'none',
      guessCount: 0,
      distribution: null,
      officialValuation: officialValuation ?? null,
      askingPrice: askingPrice ?? null,
      divergence: null,
    };
  }

  return fmv;
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
  const details = property as Partial<PropertyDetailsData> & {
    street?: string | null;
    fmv?: PropertyFmvData;
    hasListing?: boolean;
  };

  return {
    ...property,
    countryCode: details.countryCode ?? undefined,
    postalCode: details.postalCode ?? null,
    streetName: details.streetName ?? details.street ?? null,
    street: details.street ?? details.streetName ?? null,
    houseNumber: details.houseNumber ?? null,
    houseNumberAddition: details.houseNumberAddition ?? null,
    yearBuilt: details.yearBuilt ?? null,
    floorAreaM2: details.floorAreaM2 ?? null,
    status: details.status ?? null,
    officialValuation: details.officialValuation ?? undefined,
    hasListing: details.hasListing,
    askingPrice: details.askingPrice ?? undefined,
    fmv: normalizePropertyFmv(details.fmv, details.officialValuation, details.askingPrice),
    activityLevel: isActivityLevel(details.activityLevel) ? details.activityLevel : 'cold',
    commentCount: details.commentCount ?? 0,
    guessCount: details.guessCount ?? 0,
    viewCount: details.viewCount ?? 0,
    likeCount: details.likeCount ?? 0,
    isSaved: overrides?.isSaved ?? details.isSaved ?? false,
    isLiked: overrides?.isLiked ?? details.isLiked ?? false,
  };
}
