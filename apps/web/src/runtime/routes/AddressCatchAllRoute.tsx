import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Icon } from '@/src/components/ui/Icon';
import { apiGeocoder } from '@/src/services/api-geocoder';
import { splitHouseNumber } from '@/src/services/address-resolver';
import { resolveProperty } from '@/src/utils/api';

import {
  CenteredState,
  LoadingSpinner,
  mergeStyles,
  primaryButtonStyle,
  secondaryButtonStyle,
  safeTopStyle,
  screenStyle,
} from '../dom';
import { colors } from '../theme';

interface AddressUrlParams {
  city?: string;
  zipcode?: string;
  street?: string;
  housenumber?: string;
}

type AddressSurface = 'city' | 'postcode' | 'property' | 'invalid';

function parseAddressSegments(pathname: string): AddressUrlParams {
  const [city, zipcode, street, housenumber] = pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  return {
    city,
    zipcode,
    street,
    housenumber,
  };
}

function buildSearchQuery(params: AddressUrlParams): string {
  const parts: string[] = [];

  if (params.zipcode && params.housenumber) {
    parts.push(params.zipcode.toUpperCase());
    parts.push(params.housenumber);
  } else if (params.city && params.street && params.housenumber) {
    parts.push(params.street.replace(/-/g, ' '));
    parts.push(params.housenumber);
    parts.push(params.city);
  }

  return parts.join(' ');
}

function isPropertyAddress(params: AddressUrlParams): boolean {
  return !!(params.city && params.zipcode && params.street && params.housenumber);
}

function getAddressSurface(params: AddressUrlParams): AddressSurface {
  if (isPropertyAddress(params)) return 'property';
  if (params.city && params.zipcode) return 'postcode';
  if (params.city) return 'city';
  return 'invalid';
}

function formatZipcode(zipcode: string | undefined): string {
  return zipcode?.toUpperCase() ?? '';
}

function formatCityName(city: string | undefined): string {
  if (!city) return '';

  return city
    .split(/([\s-])/)
    .map((part) => {
      if (!part || part === ' ' || part === '-') {
        return part;
      }
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
}

function PartialAddressState({
  surface,
  params,
  onGoHome,
}: {
  surface: Exclude<AddressSurface, 'property' | 'invalid'>;
  params: AddressUrlParams;
  onGoHome: () => void;
}) {
  const cityName = formatCityName(params.city);
  const title = surface === 'postcode' ? formatZipcode(params.zipcode) : cityName;
  const subtitle =
    surface === 'postcode'
      ? `Browse homes around ${formatZipcode(params.zipcode)} ${cityName}`.trim()
      : `Browse homes and local activity across ${cityName || 'this city'}`;
  const detail =
    surface === 'postcode'
      ? 'Open the map to explore listings and property activity in this postcode.'
      : 'Open the map to explore listings and property activity across this city.';
  const buttonLabel = surface === 'postcode' ? 'Browse Postcode Map' : 'Browse City Map';
  const prefix = surface === 'postcode' ? 'address-postcode' : 'address-city';

  return (
    <div style={mergeStyles(screenStyle, safeTopStyle)} data-testid={`${prefix}-state`}>
      <CenteredState
        icon={<Icon name="HouseLine" size={64} color="#E8E0D4" />}
        title={<div data-testid={`${prefix}-title`}>{title}</div>}
        body={(
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ color: colors.text, fontSize: 18, fontWeight: 700 }} data-testid={`${prefix}-message`}>
              {subtitle}
            </div>
            <div style={{ color: colors.textMuted, lineHeight: 1.6 }} data-testid={`${prefix}-detail`}>
              {detail}
            </div>
          </div>
        )}
        action={(
          <button
            type="button"
            onClick={onGoHome}
            style={primaryButtonStyle}
            data-testid={`${prefix}-go-to-map`}
          >
            {buttonLabel}
          </button>
        )}
      />
    </div>
  );
}

export function AddressCatchAllRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const addressParams = useMemo(
    () => parseAddressSegments(location.pathname),
    [location.pathname],
  );
  const addressSurface = useMemo(
    () => getAddressSurface(addressParams),
    [addressParams],
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (addressSurface !== 'property') {
      return;
    }

    let cancelled = false;

    async function resolveAddress() {
      try {
        const query = buildSearchQuery(addressParams);
        if (!query) {
          if (!cancelled) setError('Invalid address');
          return;
        }

        const results = await apiGeocoder.search(query, { limit: 1 });
        if (cancelled) return;

        if (results.length === 0) {
          setError('Address not found');
          return;
        }

        const geocoded = results[0];
        const houseNumberParts = splitHouseNumber(geocoded.houseNumber);

        if (!geocoded.postalCode || !houseNumberParts.houseNumber) {
          setError('Address not found in our database');
          return;
        }

        const property = await resolveProperty({
          postalCode: geocoded.postalCode,
          houseNumber: houseNumberParts.houseNumber,
          houseNumberAddition: houseNumberParts.houseNumberAddition,
          countryCode: geocoded.countryCode,
          street: geocoded.street,
          city: geocoded.city,
        });
        if (cancelled) return;

        if (property) {
          navigate(`/property/${property.id}`, { replace: true });
          return;
        }

        setError('Property not found in our database');
      } catch {
        if (!cancelled) {
          setError('Failed to resolve address');
        }
      }
    }

    void resolveAddress();

    return () => {
      cancelled = true;
    };
  }, [addressParams, addressSurface, navigate]);

  if (addressSurface === 'city' || addressSurface === 'postcode') {
    return (
      <PartialAddressState
        surface={addressSurface}
        params={addressParams}
        onGoHome={() => navigate('/', { replace: true })}
      />
    );
  }

  if (addressSurface === 'invalid') {
    return (
      <div style={mergeStyles(screenStyle, safeTopStyle)} data-testid="address-invalid-state">
        <CenteredState
          icon={<Icon name="WarningCircle" size={52} color={colors.textSoft} />}
          title={<div data-testid="address-invalid-title">Address not found</div>}
          body={<div data-testid="address-invalid-message">This browser path does not match a city, postcode, or full property address.</div>}
          action={(
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              style={secondaryButtonStyle}
              data-testid="address-invalid-go-to-map"
            >
              Return to map
            </button>
          )}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div style={mergeStyles(screenStyle, safeTopStyle)} data-testid="address-not-found-state">
        <CenteredState
          icon={<Icon name="WarningCircle" size={52} color={colors.textSoft} />}
          title={<div data-testid="address-not-found-title">{error}</div>}
          action={(
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              style={secondaryButtonStyle}
              data-testid="address-not-found-go-to-map"
            >
              Return to map
            </button>
          )}
        />
      </div>
    );
  }

  return (
    <div style={mergeStyles(screenStyle, safeTopStyle)}>
      <CenteredState
        icon={<LoadingSpinner />}
        title="Resolving address"
        body="Looking up the canonical property route for this address."
      />
    </div>
  );
}
