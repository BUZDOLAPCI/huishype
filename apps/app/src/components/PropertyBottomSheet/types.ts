import type { Property } from '../../hooks/useProperties';

export interface PropertyDetailsData extends Property {
  listingUrl?: string;
  listingSource?: 'funda' | 'pararius' | 'other';
  askingPrice?: number;
  fmv?: number;
  fmvConfidence?: 'low' | 'medium' | 'high';
  activityLevel: 'hot' | 'warm' | 'cold';
  commentCount: number;
  guessCount: number;
  viewCount: number;
  photos?: string[];
  isSaved?: boolean;
  isFavorite?: boolean;
}

export interface SectionProps {
  property: PropertyDetailsData;
}
