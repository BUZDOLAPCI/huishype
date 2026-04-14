import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';

import { formatPropertyPrice, getValuationLabel, type CountryCode } from '@huishype/shared';

import { Icon } from './ui/Icon';

export type PriceGuessSliderVariant = 'compact' | 'full';

export interface PriceGuessSliderProps {
  propertyId: string;
  countryCode?: string;
  officialValuation?: number;
  askingPrice?: number;
  currentFMV?: number;
  userGuess?: number;
  onGuessChange?: (price: number) => void;
  onGuessSubmit: (price: number) => void;
  disabled?: boolean;
  isSubmitting?: boolean;
  variant?: PriceGuessSliderVariant;
  testID?: string;
}

const MIN_PRICE = 50000;
const MAX_PRICE = 2000000;
const RANGE_STEPS = 1000;

function priceToPosition(price: number): number {
  const minLog = Math.log(MIN_PRICE);
  const maxLog = Math.log(MAX_PRICE);
  const priceLog = Math.log(Math.max(MIN_PRICE, Math.min(MAX_PRICE, price)));
  return (priceLog - minLog) / (maxLog - minLog);
}

function positionToPrice(position: number): number {
  const minLog = Math.log(MIN_PRICE);
  const maxLog = Math.log(MAX_PRICE);
  const clampedPosition = Math.max(0, Math.min(1, position));
  const priceLog = minLog + clampedPosition * (maxLog - minLog);
  return Math.round(Math.exp(priceLog) / 1000) * 1000;
}

function formatPrice(price: number, countryCode?: string): string {
  return formatPropertyPrice(price, countryCode as CountryCode);
}

function formatLabelPrice(price: number, countryCode?: string): string {
  return formatPrice(price, countryCode).replace(/[\s\u00A0\u202F]/g, '');
}

function isNear(pos1: number, pos2: number, threshold = 0.03): boolean {
  return Math.abs(pos1 - pos2) <= threshold;
}

function ReferenceMarker({
  position,
  label,
  color,
  isActive,
}: {
  position: number;
  label: string;
  color: string;
  isActive?: boolean;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: -32,
        left: `${position * 100}%`,
        transform: 'translateX(-18px)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color, opacity: isActive ? 1 : 0.75 }}>
        {label}
      </div>
      <div style={{ width: 2, height: 12, marginTop: 2, backgroundColor: color, opacity: isActive ? 1 : 0.7 }} />
    </div>
  );
}

export function PriceGuessSlider({
  countryCode,
  officialValuation,
  askingPrice,
  currentFMV,
  userGuess,
  onGuessChange,
  onGuessSubmit,
  disabled = false,
  isSubmitting = false,
  variant = 'full',
  testID = 'price-guess-slider',
}: PriceGuessSliderProps) {
  const initialPrice = userGuess ?? officialValuation ?? 350000;
  const [guessedPrice, setGuessedPrice] = useState(initialPrice);
  const [isNearWOZ, setIsNearWOZ] = useState(false);

  useEffect(() => {
    if (userGuess !== undefined && userGuess !== guessedPrice) {
      setGuessedPrice(userGuess);
    }
  }, [guessedPrice, userGuess]);

  const thumbPosition = useMemo(() => priceToPosition(guessedPrice), [guessedPrice]);
  const wozPosition = officialValuation ? priceToPosition(officialValuation) : null;
  const askingPosition = askingPrice ? priceToPosition(askingPrice) : null;
  const fmvPosition = currentFMV ? priceToPosition(currentFMV) : null;

  useEffect(() => {
    setIsNearWOZ(officialValuation ? isNear(thumbPosition, priceToPosition(officialValuation)) : false);
  }, [officialValuation, thumbPosition]);

  const updatePrice = useCallback(
    (position: number) => {
      const newPrice = positionToPrice(position);
      setGuessedPrice(newPrice);
      onGuessChange?.(newPrice);
    },
    [onGuessChange],
  );

  const handleRangeChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      updatePrice(Number(event.currentTarget.value) / RANGE_STEPS);
    },
    [updatePrice],
  );

  const handleSubmit = useCallback(() => {
    if (disabled || isSubmitting) {
      return;
    }
    onGuessSubmit(guessedPrice);
  }, [disabled, guessedPrice, isSubmitting, onGuessSubmit]);

  const handleQuickAdjust = useCallback(
    (delta: number) => {
      if (disabled) return;
      const newPrice = Math.max(MIN_PRICE, Math.min(MAX_PRICE, guessedPrice + delta));
      const newPosition = priceToPosition(newPrice);
      setGuessedPrice(newPrice);
      onGuessChange?.(newPrice);
      setIsNearWOZ(officialValuation ? isNear(newPosition, priceToPosition(officialValuation)) : false);
    },
    [disabled, guessedPrice, officialValuation, onGuessChange],
  );

  const compact = variant === 'compact';

  return (
    <div
      data-testid={testID}
      style={{
        padding: compact ? 12 : 16,
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        boxShadow: '0px 10px 24px rgba(77, 61, 31, 0.06)',
      }}
    >
      <div
        data-testid="price-guess-header"
        style={{ fontSize: compact ? 16 : 18, fontWeight: 700, color: '#2D2926', marginBottom: 4 }}
      >
        What do you think this property is worth?
      </div>

      {officialValuation ? (
        <div style={{ fontSize: 14, color: '#736C62', marginBottom: 12 }}>
          {getValuationLabel(countryCode)}: {formatPrice(officialValuation, countryCode)}
        </div>
      ) : null}

      <div
        data-testid="price-display"
        style={{ fontSize: compact ? 34 : 40, fontWeight: 800, color: disabled ? '#9C958A' : '#F5A623', textAlign: 'center', marginBottom: 18 }}
      >
        {formatPrice(guessedPrice, countryCode)}
      </div>

      <div style={{ marginBottom: 20, paddingTop: 30, position: 'relative' }}>
        {wozPosition !== null ? (
          <ReferenceMarker position={wozPosition} label={countryCode === 'NL' ? 'WOZ' : 'Val.'} color="#7C3AED" isActive={isNearWOZ} />
        ) : null}
        {askingPosition !== null ? (
          <ReferenceMarker position={askingPosition} label="Ask" color="#F97316" />
        ) : null}
        {fmvPosition !== null ? (
          <ReferenceMarker position={fmvPosition} label="FMV" color="#F5A623" />
        ) : null}

        <div style={{ position: 'relative', height: 40 }}>
          <input
            type="range"
            min={0}
            max={RANGE_STEPS}
            step={1}
            value={Math.round(thumbPosition * RANGE_STEPS)}
            onChange={handleRangeChange}
            disabled={disabled}
            aria-label="Price guess slider"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: 40,
              margin: 0,
              opacity: 0,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          />

          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 14,
              height: 12,
              borderRadius: 999,
              backgroundColor: '#E8E0D4',
              overflow: 'visible',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                height: 12,
                width: `${thumbPosition * 100}%`,
                backgroundColor: disabled ? '#E8E0D4' : '#F5A623',
                borderRadius: 999,
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: -10,
                left: `${thumbPosition * 100}%`,
                width: 32,
                height: 32,
                marginLeft: -16,
                borderRadius: 16,
                backgroundColor: disabled ? '#C7BFB3' : isNearWOZ ? '#8B5CF6' : '#DE911D',
                display: 'grid',
                placeItems: 'center',
                boxShadow: '0px 6px 12px rgba(0, 0, 0, 0.12)',
              }}
              data-testid="slider-thumb"
            >
              <div style={{ width: 4, height: 12, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.7)' }} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
          <div style={{ fontSize: 12, color: '#9C958A' }} data-testid="price-range-min">
            {formatLabelPrice(MIN_PRICE, countryCode)}
          </div>
          <div style={{ fontSize: 12, color: '#9C958A' }} data-testid="price-range-max">
            {formatLabelPrice(MAX_PRICE, countryCode)}
          </div>
        </div>
      </div>

      {!compact ? (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {[-50000, -10000, 10000, 50000].map((delta) => (
            <button
              key={delta}
              type="button"
              onClick={() => handleQuickAdjust(delta)}
              disabled={disabled}
              data-testid={`adjust-${delta > 0 ? 'plus' : 'minus'}-${Math.abs(delta / 1000)}k`}
              style={{
                border: '1px solid #E8E0D4',
                borderRadius: 999,
                background: '#FFFFFF',
                padding: '8px 12px',
                color: '#736C62',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              {delta > 0 ? '+' : ''}
              {Math.abs(delta / 1000)}k
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || isSubmitting}
        data-testid="submit-guess-button"
        style={{
          width: '100%',
          border: 'none',
          borderRadius: 16,
          background: disabled || isSubmitting ? '#D6C7B5' : '#F5A623',
          color: '#FFFFFF',
          fontSize: compact ? 15 : 16,
          fontWeight: 700,
          padding: '14px 16px',
          cursor: disabled || isSubmitting ? 'not-allowed' : 'pointer',
          boxShadow: '0px 8px 18px rgba(245, 166, 35, 0.22)',
        }}
      >
        {isSubmitting ? 'Submitting...' : 'Submit Guess'}
      </button>
    </div>
  );
}
