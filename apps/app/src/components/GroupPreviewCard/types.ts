export interface GroupPreviewProperty {
  id: string;
  address: string;
  city: string;
  postalCode?: string | null;
  wozValue?: number | null;
  askingPrice?: number | null;
  fmv?: number | null;
  activityLevel?: 'hot' | 'warm' | 'cold';
  activityScore?: number;
  thumbnailUrl?: string | null;
  bouwjaar?: number | null;
  oppervlakte?: number | null;
}

export interface GroupPreviewCardProps {
  /** Array of properties to display. Single = 1 item, cluster = multiple. */
  properties: GroupPreviewProperty[];
  /** Which property index is currently displayed (for clusters). */
  currentIndex?: number;
  /** Callback when the visible index changes (swipe or arrow tap). */
  onIndexChange?: (index: number) => void;
  /** Callback to close the preview card. */
  onClose: () => void;
  /** Callback when a property card is tapped (opens detail view). */
  onPropertyTap?: (property: GroupPreviewProperty) => void;
  /** Callback when like button is pressed for the current property. */
  onLike?: (property: GroupPreviewProperty) => void;
  /** Callback when comment button is pressed for the current property. */
  onComment?: (property: GroupPreviewProperty) => void;
  /** Callback when guess button is pressed for the current property. */
  onGuess?: (property: GroupPreviewProperty) => void;
  /** Whether the current property is liked by the user. */
  isLiked?: boolean;
  /** Show a CSS triangle arrow to connect the card to a map marker. */
  showArrow?: boolean;
  /** Direction the arrow pointer points. */
  arrowDirection?: 'up' | 'down';
}
