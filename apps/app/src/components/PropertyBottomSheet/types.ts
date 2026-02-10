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
