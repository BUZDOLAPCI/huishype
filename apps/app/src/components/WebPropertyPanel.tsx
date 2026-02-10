/**
 * WebPropertyPanel — web-native side panel for property details.
 *
 * Replaces @gorhom/bottom-sheet (which is RN-only) on the web map screen.
 * Slides in from the right like Zillow / Redfin / Google Maps.
 * Reuses the exact same sub-components as PropertyBottomSheet.
 */
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
} from 'react';
import { ScrollView, View, Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';

import type { Property } from '../hooks/useProperties';
import { useListings } from '../hooks/useListings';
import type { PropertyDetailsData } from './PropertyBottomSheet/types';
import { PropertyHeader } from './PropertyBottomSheet/PropertyHeader';
import { PriceSection } from './PropertyBottomSheet/PriceSection';
import { QuickActions } from './PropertyBottomSheet/QuickActions';
import { PriceGuessSection } from './PropertyBottomSheet/PriceGuessSection';
import { CommentsSection } from './PropertyBottomSheet/CommentsSection';
import { PropertyDetails } from './PropertyBottomSheet/PropertyDetails';
import { ListingLinks } from './PropertyBottomSheet/ListingLinks';

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

export interface WebPropertyPanelProps {
  property: Property | null;
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

/** Ref interface matching PropertyBottomSheetRef so callers don't need to change */
export interface WebPropertyPanelRef {
  expand: () => void;
  collapse: () => void;
  close: () => void;
  snapToIndex: (index: number) => void;
  scrollToComments: () => void;
  scrollToGuess: () => void;
  getCurrentIndex: () => number;
}

function toPropertyDetails(
  property: Property,
  overrides?: { isLiked?: boolean; isSaved?: boolean }
): PropertyDetailsData {
  const p = property as Partial<PropertyDetailsData>;
  return {
    ...property,
    activityLevel: p.activityLevel ?? 'cold',
    commentCount: p.commentCount ?? 0,
    guessCount: p.guessCount ?? 0,
    viewCount: p.viewCount ?? 0,
    isSaved: overrides?.isSaved ?? p.isSaved ?? false,
    isLiked: overrides?.isLiked ?? p.isLiked ?? false,
  };
}

export const WebPropertyPanel = forwardRef<WebPropertyPanelRef, WebPropertyPanelProps>(
  function WebPropertyPanel(
    {
      property,
      isLiked,
      isSaved,
      onClose,
      onSheetChange,
      onSave,
      onShare,
      onLike,
      onAuthRequired,
    },
    ref
  ) {
    const [isOpen, setIsOpen] = useState(false);
    const scrollRef = useRef<ScrollView>(null);
    const queryClient = useQueryClient();

    // Section position refs for scroll-to
    const guessSectionY = useRef(0);
    const commentsSectionY = useRef(0);

    // Listings
    const { data: listings = [] } = useListings(property?.id ?? null);

    // Open panel when property changes and is non-null
    // (auto-open only if a property is provided — the caller controls when to show)
    // Actually, we DON'T auto-open here. The caller decides via snapToIndex.

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

    const propertyDetails = property
      ? toPropertyDetails(property, { isLiked, isSaved })
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
                <ListingLinks listings={listings} />
                <View
                  onLayout={(e) => {
                    guessSectionY.current = e.nativeEvent.layout.y;
                  }}
                >
                  <PriceGuessSection
                    property={propertyDetails}
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
      </>
    );
  }
);
