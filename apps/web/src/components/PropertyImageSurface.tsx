import React, { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Icon } from './ui/Icon';
import {
  getPropertyImageCandidates,
  type ImageSourceType,
  type PropertyImageSource,
} from '../utils/property-image';

type StyleInput = CSSProperties | StyleInput[] | null | undefined;
type ResizeMode = 'cover' | 'contain' | 'stretch' | 'center';

export interface PropertyImageSurfaceProps {
  source: PropertyImageSource;
  style?: StyleInput;
  imageStyle?: StyleInput;
  listingResizeMode?: ResizeMode;
  aerialResizeMode?: ResizeMode;
  markerSize?: number;
  imageTestID?: string;
  markerTestID?: string;
  onLoadEnd?: () => void;
  onError?: () => void;
  placeholder?: React.ReactNode;
  onResolvedSourceChange?: (type: ImageSourceType) => void;
}

export function PropertyImageSurface({
  source,
  style,
  imageStyle,
  listingResizeMode = 'cover',
  aerialResizeMode = 'cover',
  markerSize = 36,
  imageTestID,
  markerTestID,
  onLoadEnd,
  onError,
  placeholder,
  onResolvedSourceChange,
}: PropertyImageSurfaceProps) {
  const {
    listingPhotoUrl,
    aerialImageUrl,
    countryCode,
  } = source;
  const candidateKey = `${listingPhotoUrl ?? ''}|${aerialImageUrl ?? ''}|${countryCode ?? ''}`;
  const candidates = useMemo(
    () => getPropertyImageCandidates(source),
    [source],
  );
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidateKey]);

  const resolved = candidates[candidateIndex] ?? null;

  useEffect(() => {
    onResolvedSourceChange?.(resolved?.type ?? 'placeholder');
  }, [onResolvedSourceChange, resolved?.type]);

  const containerStyle = {
    position: 'relative',
    backgroundColor: '#FFFBF5',
    overflow: 'hidden',
    ...flattenStyle(style),
  } satisfies CSSProperties;

  if (!resolved?.url) {
    return (
      <div style={containerStyle} data-testid="property-thumbnail-container">
        {placeholder}
      </div>
    );
  }

  const isAerial = resolved.type === 'aerial';
  const handleError = () => {
    const nextCandidateIndex = candidateIndex + 1;

    if (nextCandidateIndex < candidates.length) {
      setCandidateIndex(nextCandidateIndex);
      return;
    }

    setCandidateIndex(candidates.length);
    onError?.();
  };

  const imageStyleObject = {
    width: '100%',
    height: '100%',
    display: 'block',
    objectFit: resizeModeToObjectFit(isAerial ? aerialResizeMode : listingResizeMode),
    ...flattenStyle(imageStyle),
  } satisfies CSSProperties;

  return (
    <div style={containerStyle} data-testid="property-thumbnail-container">
      <img
        src={resolved.url}
        style={imageStyleObject}
        onLoad={onLoadEnd}
        onError={handleError}
        data-testid={imageTestID}
        alt=""
      />

      {isAerial ? (
        <div
          style={markerContainerStyle}
          data-testid={markerTestID}
          aria-hidden="true"
        >
          <div style={markerShadowStyle}>
            <div
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                display: 'flex',
                marginBottom: Math.round(markerSize * 0.16),
              }}
            >
              <Icon
                name="MapPin"
                size={markerSize}
                weight="fill"
                color="#FFFFFF"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function flattenStyle(style?: StyleInput): CSSProperties {
  if (!style) return {};
  if (Array.isArray(style)) {
    return style.reduce<CSSProperties>((acc, item) => ({ ...acc, ...flattenStyle(item) }), {});
  }
  return style;
}

function resizeModeToObjectFit(resizeMode: ResizeMode): CSSProperties['objectFit'] {
  switch (resizeMode) {
    case 'contain':
      return 'contain';
    case 'stretch':
      return 'fill';
    case 'center':
      return 'none';
    case 'cover':
    default:
      return 'cover';
  }
}

const markerContainerStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
};

const markerShadowStyle: CSSProperties = {
  boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.28)',
};

export default PropertyImageSurface;
