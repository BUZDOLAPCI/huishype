import React from 'react';
import type { CSSProperties } from 'react';
import { Icon } from '../ui/Icon';
import { PropertyPreviewCard } from '../PropertyPreviewCard';
import type { GroupPreviewCardProps } from './types';

const CARD_WIDTH = 280;
const PREVIEW_ARROW_SIZE = 10;

export function GroupPreviewCard({
  properties,
  currentIndex: controlledIndex,
  onIndexChange,
  onClose,
  onPropertyTap,
  onLike,
  onComment,
  onGuess,
  isLiked = false,
  showArrow = false,
  arrowDirection = 'down',
}: GroupPreviewCardProps) {
  if (properties.length === 0) return null;

  const currentIndex = controlledIndex ?? 0;
  const currentProperty = properties[currentIndex] ?? properties[0];
  const isCluster = properties.length > 1;
  const arrowUp = arrowDirection === 'up';

  const goLeft = () => {
    if (currentIndex > 0) onIndexChange?.(currentIndex - 1);
  };
  const goRight = () => {
    if (currentIndex < properties.length - 1) onIndexChange?.(currentIndex + 1);
  };

  const preview = (
    <div style={styles.shell} data-testid="group-preview-card">
      {isCluster && (
        <button
          type="button"
          onClick={onClose}
          style={styles.clusterCloseButton}
          data-testid="group-preview-close-button"
          aria-label="Close preview"
        >
          <Icon name="X" size={14} color="#504A42" />
        </button>
      )}

      <div style={styles.clusterRow}>
        {isCluster && (
          <button
            type="button"
            onClick={goLeft}
            disabled={currentIndex === 0}
            style={{ ...styles.navButton, ...(currentIndex === 0 ? styles.navButtonDisabled : {}) }}
            data-testid="group-preview-nav-left"
            aria-label="Previous property"
          >
            <Icon name="CaretLeft" size={18} color={currentIndex === 0 ? '#C7BFB3' : '#504A42'} />
          </button>
        )}

        <div style={{ width: CARD_WIDTH, flexShrink: 0 }}>
          <PropertyPreviewCard
            property={currentProperty}
            isLiked={isLiked}
            onClose={isCluster ? undefined : onClose}
            onPress={onPropertyTap ? () => onPropertyTap(currentProperty) : undefined}
            onLike={onLike ? () => onLike(currentProperty) : undefined}
            onComment={onComment ? () => onComment(currentProperty) : undefined}
            onGuess={onGuess ? () => onGuess(currentProperty) : undefined}
            showCloseButton={!isCluster}
            showArrow={false}
          />
        </div>

        {isCluster && (
          <button
            type="button"
            onClick={goRight}
            disabled={currentIndex === properties.length - 1}
            style={{ ...styles.navButton, ...(currentIndex === properties.length - 1 ? styles.navButtonDisabled : {}) }}
            data-testid="group-preview-nav-right"
            aria-label="Next property"
          >
            <Icon name="CaretRight" size={18} color={currentIndex === properties.length - 1 ? '#C7BFB3' : '#504A42'} />
          </button>
        )}
      </div>

      {isCluster && (
        <div style={styles.pageIndicator} data-testid="group-preview-page-indicator">
          <div style={styles.pageText}>{currentIndex + 1} of {properties.length}</div>
        </div>
      )}
    </div>
  );

  if (!showArrow) return preview;

  return (
    <div style={styles.wrapperWithArrow} data-testid="property-preview-wrapper">
      {arrowUp && <div style={{ ...styles.arrow, transform: 'rotate(180deg)' }} data-testid="group-preview-arrow-up" />}
      {preview}
      {!arrowUp && <div style={styles.arrow} data-testid="group-preview-arrow-down" />}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrapperWithArrow: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' },
  shell: { position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: '100%' },
  clusterRow: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'center' },
  navButton: { width: 36, height: 36, borderRadius: 18, border: '1px solid #E8E0D4', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flexShrink: 0 },
  navButtonDisabled: { opacity: 0.35, cursor: 'default' },
  clusterCloseButton: { position: 'absolute', top: -6, right: 0, width: 28, height: 28, borderRadius: 14, border: '1px solid #E8E0D4', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 1 },
  pageIndicator: { display: 'flex', justifyContent: 'center', width: '100%' },
  pageText: { fontSize: 12, fontWeight: 600, color: '#736C62' },
  arrow: {
    width: 0,
    height: 0,
    borderLeft: `${PREVIEW_ARROW_SIZE}px solid transparent`,
    borderRight: `${PREVIEW_ARROW_SIZE}px solid transparent`,
    borderTop: `${PREVIEW_ARROW_SIZE}px solid #FFFFFF`,
    filter: 'drop-shadow(0px 2px 4px rgba(0,0,0,0.09))',
  },
};
