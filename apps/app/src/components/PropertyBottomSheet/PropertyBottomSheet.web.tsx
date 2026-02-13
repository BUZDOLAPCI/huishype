/**
 * PropertyBottomSheet (web) — CSS side panel for property details.
 *
 * Slides in from the right like Zillow / Redfin / Google Maps.
 * Reuses the same shared sub-components as the native bottom sheet.
 */
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
} from 'react';
import { ScrollView, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';

import { useProperty } from '../../hooks/useProperties';
import { useListings } from '../../hooks/useListings';
import { usePropertyView } from '../../hooks/usePropertyView';
import type { PropertyBottomSheetProps, PropertyBottomSheetRef } from './types';
import { toPropertyDetails } from './types';
import { PropertyHeader } from './PropertyHeader';
import { PriceSection } from './PriceSection';
import { QuickActions } from './QuickActions';
import { PriceGuessSection } from './PriceGuessSection';
import { CommentsSection } from './CommentsSection';
import { PropertyDetails } from './PropertyDetails';
import { ListingLinks } from './ListingLinks';
import { ListingSubmissionSheet } from './ListingSubmissionSheet';

// CSS for the panel — injected once into <head>
const PANEL_CSS_ID = 'web-property-panel-css';
if (typeof document !== 'undefined' && !document.getElementById(PANEL_CSS_ID)) {
  const style = document.createElement('style');
  style.id = PANEL_CSS_ID;
  style.textContent = `
    .web-property-panel-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.15);
      z-index: 2000;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    .web-property-panel-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }
    .web-property-panel {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 420px;
      max-width: 100vw;
      background: white;
      z-index: 2001;
      box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
    }
    .web-property-panel.open {
      transform: translateX(0);
    }
    .web-property-panel-header {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid #F3F4F6;
      flex-shrink: 0;
    }
    .web-property-panel-close {
      width: 36px;
      height: 36px;
      border-radius: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #F3F4F6;
      border: none;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .web-property-panel-close:hover {
      background: #E5E7EB;
    }
    @media (max-width: 640px) {
      .web-property-panel {
        width: 100vw;
      }
    }
  `;
  document.head.appendChild(style);
}

export const PropertyBottomSheet = forwardRef<PropertyBottomSheetRef, PropertyBottomSheetProps>(
  function PropertyBottomSheet(
    {
      property,
      isLiked: isLikedProp,
      isSaved: isSavedProp,
      onClose,
      onSheetChange,
      onSave,
      onShare,
      onLike,
      onGuessPress,
      onCommentPress,
      onAuthRequired,
    },
    ref
  ) {
    const [isOpen, setIsOpen] = useState(false);
    const scrollRef = useRef<ScrollView>(null);
    const queryClient = useQueryClient();

    // Listing submission modal state
    const [showSubmission, setShowSubmission] = useState(false);

    // Section position refs for scroll-to
    const guessSectionY = useRef(0);
    const commentsSectionY = useRef(0);

    // Fetch enriched property details (viewCount, activityLevel, etc.)
    const { data: enrichedProperty } = useProperty(property?.id ?? null);

    // Record view when property is opened
    const { recordPropertyView } = usePropertyView();
    useEffect(() => {
      if (property?.id && isOpen) {
        recordPropertyView(property.id);
      }
    }, [property?.id, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    // Listings
    const { data: listings = [] } = useListings(property?.id ?? null);

    // Expose ref methods
    useImperativeHandle(ref, () => ({
      expand: () => {
        setIsOpen(true);
        onSheetChange?.(2);
      },
      collapse: () => {
        setIsOpen(false);
        onSheetChange?.(-1);
      },
      close: () => {
        setIsOpen(false);
        onSheetChange?.(-1);
        onClose?.();
      },
      snapToIndex: (index: number) => {
        if (index >= 0) {
          setIsOpen(true);
          onSheetChange?.(index);
        } else {
          setIsOpen(false);
          onSheetChange?.(-1);
        }
      },
      scrollToComments: () => {
        setIsOpen(true);
        onSheetChange?.(2);
        setTimeout(() => {
          scrollRef.current?.scrollTo({ y: commentsSectionY.current, animated: true });
        }, 350);
      },
      scrollToGuess: () => {
        setIsOpen(true);
        onSheetChange?.(2);
        setTimeout(() => {
          scrollRef.current?.scrollTo({ y: guessSectionY.current, animated: true });
        }, 350);
      },
      getCurrentIndex: () => (isOpen ? 2 : -1),
    }));

    const handleClose = useCallback(() => {
      setIsOpen(false);
      onSheetChange?.(-1);
      onClose?.();
    }, [onClose, onSheetChange]);

    // Close on Escape key
    useEffect(() => {
      if (!isOpen) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') handleClose();
      };
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }, [isOpen, handleClose]);

    // Convert property to detailed format, merging enriched API data
    const propertyDetails = property
      ? toPropertyDetails(property, enrichedProperty as Record<string, unknown> | null | undefined, { isLiked: isLikedProp, isSaved: isSavedProp })
      : null;

    return (
      <>
        {/* Backdrop */}
        <div
          className={`web-property-panel-backdrop ${isOpen ? 'open' : ''}`}
          onClick={handleClose}
          data-testid="web-panel-backdrop"
        />

        {/* Panel */}
        <div
          className={`web-property-panel ${isOpen ? 'open' : ''}`}
          data-testid="web-property-panel"
        >
          {/* Header bar */}
          <div className="web-property-panel-header">
            <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>
              Property Details
            </Text>
            <button
              className="web-property-panel-close"
              onClick={handleClose}
              data-testid="web-panel-close"
              aria-label="Close panel"
            >
              <Ionicons name="close" size={20} color="#6B7280" />
            </button>
          </div>

          {/* Scrollable content */}
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            showsVerticalScrollIndicator
            contentContainerStyle={{ paddingBottom: 40 }}
          >
            {propertyDetails ? (
              <View>
                <PropertyHeader property={propertyDetails} />
                <PriceSection property={propertyDetails} />
                <QuickActions
                  property={propertyDetails}
                  onSave={() => onSave?.(propertyDetails.id)}
                  onShare={() => onShare?.(propertyDetails.id)}
                  onLike={() => onLike?.(propertyDetails.id)}
                />
                <ListingLinks
                  listings={listings}
                  onAddListing={() => setShowSubmission(true)}
                />
                <View
                  onLayout={(e) => {
                    guessSectionY.current = e.nativeEvent.layout.y;
                  }}
                >
                  <PriceGuessSection
                    property={propertyDetails}
                    onGuessPress={() => onGuessPress?.(propertyDetails.id)}
                    onLoginRequired={onAuthRequired}
                  />
                </View>
                <View
                  onLayout={(e) => {
                    commentsSectionY.current = e.nativeEvent.layout.y;
                  }}
                >
                  <CommentsSection
                    property={propertyDetails}
                    onAddComment={() => onCommentPress?.(propertyDetails.id)}
                    onAuthRequired={onAuthRequired}
                  />
                </View>
                <PropertyDetails property={propertyDetails} />
              </View>
            ) : (
              <View style={{ padding: 24, alignItems: 'center' }}>
                <Ionicons name="home-outline" size={48} color="#D1D5DB" />
                <Text style={{ color: '#9CA3AF', marginTop: 12 }}>
                  Select a property to view details
                </Text>
              </View>
            )}
          </ScrollView>
        </div>

        {/* Listing submission modal */}
        {property && (
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
        )}
      </>
    );
  }
);
