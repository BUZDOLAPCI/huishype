/**
 * PropertyContent — Shared content renderer for property detail sections.
 *
 * Used by three containers:
 *   1. Native bottom sheet (PropertyBottomSheet.native.tsx)
 *   2. Web panel / bottom sheet (PropertyBottomSheet.web.tsx)
 *   3. Canonical property detail route screen
 *
 * The parent owns the detail query for map-sheet surfaces and may also own
 * like/save state there. The detail page passes the fetched property details
 * and lets PropertyContent manage like/save internally.
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { Pressable, View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { PropertyListingsResponse } from '@huishype/shared';

import { useProperty } from '../../hooks/useProperties';
import { useListings, type ListingData } from '../../hooks/useListings';
import { usePropertyView } from '../../hooks/usePropertyView';
import { usePropertyLike } from '../../hooks/usePropertyLike';
import { usePropertySave } from '../../hooks/usePropertySave';
import type { AuthModalCopyInput } from '../../lib/authModalCopy';
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
import { ReportModal } from '../ReportModal';

export interface PropertyContentProps {
  property: PropertyContentData | null;
  isLoading?: boolean;
  contentWidth?: number;
  scrollViewport?: PropertyContentScrollViewport;
  deferSocialSectionsUntilActionsVisible?: boolean;

  // If omitted, PropertyContent can own like/save state itself.
  manageInteractionsInternally?: boolean;
  isLiked?: boolean;
  isSaved?: boolean;
  onSave?: (id: string) => void;
  onLike?: (id: string) => void;
  onShare?: (id: string) => void;
  onScrollToComments?: () => void;
  onScrollToGuess?: () => void;

  // Auth
  onAuthRequired?: (copy?: AuthModalCopyInput, onAuthenticated?: () => void) => void;

  // Callbacks forwarded from native/web sheets (pass-through to child sections)
  onGuessPress?: (id: string) => void;
  onCommentPress?: (id: string) => void;

  // Navigation to full-page routes
  onViewAllComments?: (id: string) => void;

  // Layout measurement callbacks — containers that need scroll-to-section
  // (native sheet, web panel) provide these; detail page omits them.
  onGuessSectionLayout?: (y: number) => void;
  onCommentsSectionLayout?: (y: number) => void;

  // Internal sheet-only affordance: passive content taps can expand a
  // half-open sheet without changing buttons, links, or drag behavior.
  onHalfExpandedBodyPress?: () => void;

  // Visibility flag for view recording.
  // Native sheet: omit (component unmounts when invisible).
  // Web panel: pass sheetState !== 'closed' (component stays mounted).
  // Detail page: omit (always visible when mounted).
  isVisible?: boolean;
}

export interface PropertyContentScrollViewport {
  offsetY: number;
  height: number;
}

interface MeasuredLayout {
  y: number;
  height: number;
}

const SOCIAL_SECTION_PRELOAD_MARGIN = 120;

function isLayoutNearViewport(
  layout: MeasuredLayout,
  viewport: PropertyContentScrollViewport,
) {
  if (viewport.height <= 0) {
    return false;
  }

  const viewportTop = viewport.offsetY - SOCIAL_SECTION_PRELOAD_MARGIN;
  const viewportBottom = viewport.offsetY + viewport.height + SOCIAL_SECTION_PRELOAD_MARGIN;
  const layoutTop = layout.y;
  const layoutBottom = layout.y + Math.max(layout.height, 1);

  return layoutBottom >= viewportTop && layoutTop <= viewportBottom;
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
  scrollViewport?: PropertyContentScrollViewport;
  deferSocialSectionsUntilActionsVisible?: boolean;
  onShare?: () => void;
  onLike?: () => void;
  onSave?: () => void;
  onScrollToComments?: () => void;
  onScrollToGuess?: () => void;
  onAuthRequired?: (copy?: AuthModalCopyInput, onAuthenticated?: () => void) => void;
  onGuessPress?: (id: string) => void;
  onViewAllComments?: (id: string) => void;
  onGuessSectionLayout?: (y: number) => void;
  onCommentsSectionLayout?: (y: number) => void;
  onHalfExpandedBodyPress?: () => void;
}

function PropertyContentSections({
  property,
  listings,
  contentWidth,
  scrollViewport,
  deferSocialSectionsUntilActionsVisible = false,
  onShare,
  onLike,
  onSave,
  onScrollToComments,
  onScrollToGuess,
  onAuthRequired,
  onGuessPress,
  onViewAllComments,
  onGuessSectionLayout,
  onCommentsSectionLayout,
  onHalfExpandedBodyPress,
}: PropertyContentSectionsProps) {
  const queryClient = useQueryClient();
  const [showSubmission, setShowSubmission] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [sectionStackOffsetY, setSectionStackOffsetY] = useState(0);
  const [quickActionsLayout, setQuickActionsLayout] = useState<MeasuredLayout | null>(null);
  const [shouldMountSocialSections, setShouldMountSocialSections] = useState(
    !deferSocialSectionsUntilActionsVisible,
  );
  const pendingSocialScrollRef = useRef<'guess' | 'comments' | null>(null);
  const guessSectionLocalY = useRef<number | null>(null);
  const commentsSectionLocalY = useRef<number | null>(null);

  useEffect(() => {
    setQuickActionsLayout(null);
    setShouldMountSocialSections(!deferSocialSectionsUntilActionsVisible);
    pendingSocialScrollRef.current = null;
    guessSectionLocalY.current = null;
    commentsSectionLocalY.current = null;
  }, [deferSocialSectionsUntilActionsVisible, property?.id]);

  const handleSectionStackLayout = useCallback(
    (event: LayoutChangeEvent) => {
      setSectionStackOffsetY(event.nativeEvent.layout.y);
    },
    []
  );

  const quickActionsSectionLayout = useCallback(
    (event: LayoutChangeEvent) => {
      setQuickActionsLayout({
        y: event.nativeEvent.layout.y,
        height: event.nativeEvent.layout.height,
      });
    },
    [],
  );

  const replayPendingSocialScroll = useCallback(() => {
    const pendingTarget = pendingSocialScrollRef.current;
    if (pendingTarget === 'guess' && guessSectionLocalY.current !== null) {
      pendingSocialScrollRef.current = null;
      setTimeout(() => {
        onScrollToGuess?.();
      }, 0);
      return;
    }

    if (pendingTarget === 'comments' && commentsSectionLocalY.current !== null) {
      pendingSocialScrollRef.current = null;
      setTimeout(() => {
        onScrollToComments?.();
      }, 0);
    }
  }, [onScrollToComments, onScrollToGuess]);

  const guessSectionLayout = useCallback(
    (event: LayoutChangeEvent) => {
      guessSectionLocalY.current = event.nativeEvent.layout.y;
      onGuessSectionLayout?.(sectionStackOffsetY + event.nativeEvent.layout.y);
      replayPendingSocialScroll();
    },
    [onGuessSectionLayout, replayPendingSocialScroll, sectionStackOffsetY]
  );

  const commentsSectionLayout = useCallback(
    (event: LayoutChangeEvent) => {
      commentsSectionLocalY.current = event.nativeEvent.layout.y;
      onCommentsSectionLayout?.(sectionStackOffsetY + event.nativeEvent.layout.y);
      replayPendingSocialScroll();
    },
    [onCommentsSectionLayout, replayPendingSocialScroll, sectionStackOffsetY]
  );

  useEffect(() => {
    if (guessSectionLocalY.current !== null) {
      onGuessSectionLayout?.(sectionStackOffsetY + guessSectionLocalY.current);
    }
    if (commentsSectionLocalY.current !== null) {
      onCommentsSectionLayout?.(sectionStackOffsetY + commentsSectionLocalY.current);
    }
  }, [onCommentsSectionLayout, onGuessSectionLayout, sectionStackOffsetY]);

  useEffect(() => {
    if (shouldMountSocialSections) {
      replayPendingSocialScroll();
      return;
    }

    if (!deferSocialSectionsUntilActionsVisible || !scrollViewport || !quickActionsLayout) {
      return;
    }

    const measuredQuickActions = {
      y: sectionStackOffsetY + quickActionsLayout.y,
      height: quickActionsLayout.height,
    };

    if (isLayoutNearViewport(measuredQuickActions, scrollViewport)) {
      setShouldMountSocialSections(true);
    }
  }, [
    deferSocialSectionsUntilActionsVisible,
    quickActionsLayout,
    replayPendingSocialScroll,
    scrollViewport,
    sectionStackOffsetY,
    shouldMountSocialSections,
  ]);

  const handleScrollToGuess = useCallback(() => {
    if (!deferSocialSectionsUntilActionsVisible) {
      onScrollToGuess?.();
      return;
    }

    if (shouldMountSocialSections && guessSectionLocalY.current !== null) {
      onScrollToGuess?.();
      return;
    }

    pendingSocialScrollRef.current = 'guess';
    setShouldMountSocialSections(true);
  }, [deferSocialSectionsUntilActionsVisible, onScrollToGuess, shouldMountSocialSections]);

  const handleScrollToComments = useCallback(() => {
    if (!deferSocialSectionsUntilActionsVisible) {
      onScrollToComments?.();
      return;
    }

    if (shouldMountSocialSections && commentsSectionLocalY.current !== null) {
      onScrollToComments?.();
      return;
    }

    pendingSocialScrollRef.current = 'comments';
    setShouldMountSocialSections(true);
  }, [deferSocialSectionsUntilActionsVisible, onScrollToComments, shouldMountSocialSections]);

  if (!property) {
    return null;
  }

  return (
    <>
      <View style={styles.contentShell}>
        <PropertyHeader
          property={property}
          containerWidth={contentWidth}
          onHalfExpandedBodyPress={onHalfExpandedBodyPress}
        />

        <View
          style={styles.sectionStack}
          onLayout={handleSectionStackLayout}
          testID="property-content-section-stack"
        >
          <Pressable
            onPress={onHalfExpandedBodyPress}
            pointerEvents="box-only"
            testID="property-content-passive-price"
          >
            <PriceSection property={property} />
          </Pressable>

          <View onLayout={quickActionsSectionLayout} testID="property-content-quick-actions-section">
            <QuickActions
              property={property}
              onSave={onSave}
              onShare={onShare}
              onLike={onLike}
              onComment={onScrollToComments ? handleScrollToComments : undefined}
              onGuess={onScrollToGuess ? handleScrollToGuess : undefined}
            />
          </View>

          <ListingLinks
            listings={listings}
            onAddListing={() => setShowSubmission(true)}
          />

          <View onLayout={guessSectionLayout} testID="property-content-guess-section">
            {shouldMountSocialSections ? (
              <PriceGuessSection
                key={property.id}
                property={property}
                onGuessPress={() => onGuessPress?.(property.id)}
                onLoginRequired={onAuthRequired}
              />
            ) : (
              <View testID="property-content-guess-section-deferred" />
            )}
          </View>

          <View onLayout={commentsSectionLayout} testID="property-content-comments-section">
            {shouldMountSocialSections ? (
              <CommentsSection
                property={property}
                onViewAll={onViewAllComments ? () => onViewAllComments(property.id) : undefined}
                onAuthRequired={onAuthRequired}
              />
            ) : (
              <View testID="property-content-comments-section-deferred" />
            )}
          </View>

          <View testID="property-content-passive-details">
            <PropertyDetails property={property} onReport={() => setShowReport(true)} />
          </View>
        </View>
      </View>

      <ListingSubmissionSheet
        propertyId={property.id}
        visible={showSubmission}
        onClose={() => setShowSubmission(false)}
        onSubmitted={(submittedListing) => {
          setShowSubmission(false);
          if (submittedListing) {
            queryClient.setQueryData<PropertyListingsResponse>(
              ['listings', property.id],
              (existing) => ({
                data: [
                  submittedListing,
                  ...(existing?.data ?? []).filter((listing) => listing.id !== submittedListing.id),
                ],
              }),
            );
          }
          queryClient.invalidateQueries({ queryKey: ['listings', property.id] });
        }}
        onAuthRequired={onAuthRequired}
      />
      {showReport ? (
        <ReportModal
          visible
          target={{ type: 'property', id: property.id }}
          targetLabel="Tell us what is wrong with this property."
          onClose={() => setShowReport(false)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  contentShell: {
    backgroundColor: '#FFFBF5',
  },
  sectionStack: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 14,
  },
});

function ManagedPropertyInteractions({
  propertyId,
  onAuthRequired,
  children,
}: {
  propertyId: string | null;
  onAuthRequired?: (copy?: AuthModalCopyInput, onAuthenticated?: () => void) => void;
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
    onSave: () => {
      void ownSave.toggleSave();
    },
  });
}

export function PropertyContent({
  property,
  isLoading = false,
  contentWidth,
  scrollViewport,
  deferSocialSectionsUntilActionsVisible = false,
  manageInteractionsInternally,
  isLiked: isLikedProp,
  isSaved: isSavedProp,
  onSave,
  onLike,
  onShare,
  onScrollToComments,
  onScrollToGuess,
  onAuthRequired,
  onGuessPress,
  onCommentPress: _onCommentPress,
  onViewAllComments,
  onGuessSectionLayout,
  onCommentsSectionLayout,
  onHalfExpandedBodyPress,
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
  }, [resolvedProperty?.id, resolvedProperty?.nodeClass, isVisible, recordPropertyView]);

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
        key={propertyDetails?.id ?? 'empty-property'}
        property={propertyDetails}
        listings={listings}
        contentWidth={contentWidth}
        scrollViewport={scrollViewport}
        deferSocialSectionsUntilActionsVisible={deferSocialSectionsUntilActionsVisible}
        onSave={interactionState?.onSave ?? (propertyDetails ? () => onSave?.(propertyDetails.id) : undefined)}
        onShare={propertyDetails ? () => onShare?.(propertyDetails.id) : undefined}
        onLike={interactionState?.onLike ?? (propertyDetails ? () => onLike?.(propertyDetails.id) : undefined)}
        onScrollToComments={onScrollToComments}
        onScrollToGuess={onScrollToGuess}
        onAuthRequired={onAuthRequired}
        onGuessPress={onGuessPress}
        onViewAllComments={onViewAllComments}
        onGuessSectionLayout={onGuessSectionLayout}
        onCommentsSectionLayout={onCommentsSectionLayout}
        onHalfExpandedBodyPress={onHalfExpandedBodyPress}
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
