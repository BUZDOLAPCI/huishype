/**
 * PropertyContent — Shared content renderer for property detail sections.
 *
 * Used by three containers:
 *   1. Native bottom sheet (PropertyBottomSheet.native.tsx)
 *   2. Web panel / bottom sheet (PropertyBottomSheet.web.tsx)
 *   3. Detail page route (app/property/[id].tsx)
 *
 * The parent owns the detail query for map-sheet surfaces and may also own
 * like/save state there. The detail page passes the fetched property details
 * and lets PropertyContent manage like/save internally.
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { useProperty } from '../../hooks/useProperties';
import { useListings, type ListingData } from '../../hooks/useListings';
import { usePropertyView } from '../../hooks/usePropertyView';
import { usePropertyLike } from '../../hooks/usePropertyLike';
import { usePropertySave } from '../../hooks/usePropertySave';
import {
  hasPropertyDetails,
  toPropertyDetails,
  type PropertyContentData,
  type PropertyDetailsData,
} from './types';
import { PropertyHeader } from './PropertyHeader';
import { PriceSection } from './PriceSection';
import { QuickActions } from './QuickActions';
import { PriceGuessSection } from './PriceGuessSection';
import { CommentsSection } from './CommentsSection';
import { PropertyDetails } from './PropertyDetails';
import { ListingLinks } from './ListingLinks';
import { ListingSubmissionSheet } from './ListingSubmissionSheet';
import { LoadingSkeleton } from './LoadingSkeleton';

export interface PropertyContentProps {
  property: PropertyContentData | null;
  isLoading?: boolean;
  contentWidth?: number;

  // If omitted, PropertyContent can own like/save state itself.
  manageInteractionsInternally?: boolean;
  isLiked?: boolean;
  isSaved?: boolean;
  onSave?: (id: string) => void;
  onLike?: (id: string) => void;
  onShare?: (id: string) => void;

  // Auth
  onAuthRequired?: () => void;

  // Callbacks forwarded from native/web sheets (pass-through to child sections)
  onGuessPress?: (id: string) => void;
  onCommentPress?: (id: string) => void;

  // Navigation to full-page routes
  onViewAllComments?: (id: string) => void;
  onViewAllGuesses?: (id: string) => void;

  // Layout measurement callbacks — containers that need scroll-to-section
  // (native sheet, web panel) provide these; detail page omits them.
  onGuessSectionLayout?: (y: number) => void;
  onCommentsSectionLayout?: (y: number) => void;

  // Visibility flag for view recording.
  // Native sheet: omit (component unmounts when invisible).
  // Web panel: pass sheetState !== 'closed' (component stays mounted).
  // Detail page: omit (always visible when mounted).
  isVisible?: boolean;
}

interface ManagedInteractionState {
  isLiked: boolean;
  isSaved: boolean;
  onLike: () => void;
  onSave: () => void;
}

interface PropertyContentSectionsProps {
  property: PropertyDetailsData | null;
  listings: ListingData[];
  contentWidth?: number;
  onShare?: () => void;
  onLike?: () => void;
  onSave?: () => void;
  onAuthRequired?: () => void;
  onGuessPress?: (id: string) => void;
  onCommentPress?: (id: string) => void;
  onViewAllComments?: (id: string) => void;
  onViewAllGuesses?: (id: string) => void;
  onGuessSectionLayout?: (y: number) => void;
  onCommentsSectionLayout?: (y: number) => void;
}

function PropertyContentSections({
  property,
  listings,
  contentWidth,
  onShare,
  onLike,
  onSave,
  onAuthRequired,
  onGuessPress,
  onCommentPress,
  onViewAllComments,
  onViewAllGuesses,
  onGuessSectionLayout,
  onCommentsSectionLayout,
}: PropertyContentSectionsProps) {
  const queryClient = useQueryClient();
  const [showSubmission, setShowSubmission] = useState(false);

  const guessSectionLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onGuessSectionLayout?.(event.nativeEvent.layout.y);
    },
    [onGuessSectionLayout]
  );

  const commentsSectionLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onCommentsSectionLayout?.(event.nativeEvent.layout.y);
    },
    [onCommentsSectionLayout]
  );

  if (!property) {
    return null;
  }

  return (
    <>
      <View>
        <PropertyHeader property={property} containerWidth={contentWidth} />

        <PriceSection property={property} />

        <QuickActions
          property={property}
          onSave={onSave}
          onShare={onShare}
          onLike={onLike}
        />

        <ListingLinks
          listings={listings}
          onAddListing={() => setShowSubmission(true)}
        />

        <View onLayout={guessSectionLayout}>
          <PriceGuessSection
            property={property}
            onGuessPress={() => onGuessPress?.(property.id)}
            onLoginRequired={onAuthRequired}
          />
        </View>

        <View onLayout={commentsSectionLayout}>
          <CommentsSection
            property={property}
            onAddComment={() => onCommentPress?.(property.id)}
            onViewAll={onViewAllComments ? () => onViewAllComments(property.id) : undefined}
            onAuthRequired={onAuthRequired}
          />
        </View>

        <PropertyDetails property={property} />
      </View>

      <ListingSubmissionSheet
        propertyId={property.id}
        visible={showSubmission}
        onClose={() => setShowSubmission(false)}
        onSubmitted={() => {
          setShowSubmission(false);
          queryClient.invalidateQueries({ queryKey: ['listings', property.id] });
        }}
        onAuthRequired={onAuthRequired}
      />
    </>
  );
}

function ManagedPropertyInteractions({
  propertyId,
  onAuthRequired,
  children,
}: {
  propertyId: string | null;
  onAuthRequired?: () => void;
  children: (state: ManagedInteractionState) => ReactNode;
}) {
  const ownLike = usePropertyLike({
    propertyId,
    onAuthRequired,
  });
  const ownSave = usePropertySave({
    propertyId,
    onAuthRequired,
  });

  return children({
    isLiked: ownLike.isLiked,
    isSaved: ownSave.isSaved,
    onLike: () => ownLike.toggleLike(),
    onSave: () => ownSave.toggleSave(),
  });
}

export function PropertyContent({
  property,
  isLoading = false,
  contentWidth,
  manageInteractionsInternally,
  isLiked: isLikedProp,
  isSaved: isSavedProp,
  onSave,
  onLike,
  onShare,
  onAuthRequired,
  onGuessPress,
  onCommentPress,
  onViewAllComments,
  onViewAllGuesses,
  onGuessSectionLayout,
  onCommentsSectionLayout,
  isVisible = true,
}: PropertyContentProps) {
  const shouldFetchDetails = !!property && !hasPropertyDetails(property);
  const { data: fetchedProperty } = useProperty(
    shouldFetchDetails ? property?.id ?? null : null
  );
  const resolvedProperty = fetchedProperty ?? property;

  const { data: listings = [] } = useListings(property?.id ?? null);

  const { recordPropertyView } = usePropertyView();
  useEffect(() => {
    if (resolvedProperty?.id && isVisible) {
      recordPropertyView(resolvedProperty.id);
    }
  }, [resolvedProperty?.id, isVisible, recordPropertyView]);

  const shouldManageInteractions =
    manageInteractionsInternally ??
    (
      isLikedProp === undefined &&
      isSavedProp === undefined &&
      onLike === undefined &&
      onSave === undefined
    );

  const renderContent = (interactionState?: Partial<ManagedInteractionState>) => {
    const propertyDetails = resolvedProperty
      ? toPropertyDetails(resolvedProperty, {
          isLiked: interactionState?.isLiked ?? isLikedProp,
          isSaved: interactionState?.isSaved ?? isSavedProp,
        })
      : null;

    return (
      <PropertyContentSections
        property={propertyDetails}
        listings={listings}
        contentWidth={contentWidth}
        onSave={interactionState?.onSave ?? (propertyDetails ? () => onSave?.(propertyDetails.id) : undefined)}
        onShare={propertyDetails ? () => onShare?.(propertyDetails.id) : undefined}
        onLike={interactionState?.onLike ?? (propertyDetails ? () => onLike?.(propertyDetails.id) : undefined)}
        onAuthRequired={onAuthRequired}
        onGuessPress={onGuessPress}
        onCommentPress={onCommentPress}
        onViewAllComments={onViewAllComments}
        onViewAllGuesses={onViewAllGuesses}
        onGuessSectionLayout={onGuessSectionLayout}
        onCommentsSectionLayout={onCommentsSectionLayout}
      />
    );
  };

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (!resolvedProperty) {
    return null;
  }

  if (shouldManageInteractions) {
    return (
      <ManagedPropertyInteractions
        propertyId={resolvedProperty.id}
        onAuthRequired={onAuthRequired}
      >
        {renderContent}
      </ManagedPropertyInteractions>
    );
  }

  return renderContent();
}
