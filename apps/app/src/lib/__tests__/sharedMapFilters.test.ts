import {
  buildNearbyGroupPath,
  buildPropertyTileTemplateUrl,
  createDefaultMapFilters,
  DEFAULT_CURRENT_LOCATION_RADIUS_METERS,
  doesMapFilterCandidateMatch,
  getLocationFilterTokenCameraBounds,
  getLocationFilterTokenCameraMaxZoom,
  getMapPriceSuggestions,
  getMapVisiblePriceModes,
  isMapStatusPillActive,
  parseLocationFilterToken,
  toggleMapStatusPill,
  updateMapFilterSearchParams,
  parseMapFiltersFromSearchParams,
  serializeLocationFilterToken,
} from '../sharedMapFilters';

describe('sharedMapFilters price suggestions', () => {
  it('prepends a typed custom price and filters presets by digit prefix', () => {
    const suggestions = getMapPriceSuggestions('sale', 'from', '125', {
      filterByPrefix: true,
    });

    expect(suggestions[0]).toMatchObject({
      value: '125',
      custom: true,
    });
    expect(suggestions[1]).toMatchObject({
      value: '125000',
      custom: false,
    });
    expect(suggestions[2]).toMatchObject({
      value: '1250000',
      custom: false,
    });
    expect(suggestions).toHaveLength(3);
  });

  it('skips the custom row when the typed digits exactly match a preset', () => {
    const suggestions = getMapPriceSuggestions('sale', 'from', '600000', {
      filterByPrefix: true,
    });

    expect(suggestions).toEqual([
      expect.objectContaining({
        value: '600000',
        custom: false,
      }),
    ]);
  });

  it('includes a no-max option for upper bounds', () => {
    const suggestions = getMapPriceSuggestions('sale', 'to', '');

    expect(suggestions.at(-1)).toMatchObject({
      value: '',
      label: 'No max',
    });
  });

  it('omits the no-max option once upper-bound suggestions are filtered', () => {
    const suggestions = getMapPriceSuggestions('sale', 'to', '12', {
      filterByPrefix: true,
    });

    expect(suggestions).toEqual([
      expect.objectContaining({
        value: '12',
        custom: true,
      }),
      expect.objectContaining({
        value: '125000',
        custom: false,
      }),
      expect.objectContaining({
        value: '1250000',
        custom: false,
      }),
    ]);
  });

  it('shows the full list again when a populated field is reopened without typing', () => {
    const suggestions = getMapPriceSuggestions('sale', 'from', '600000');

    expect(suggestions).toContainEqual(
      expect.objectContaining({
        value: '600000',
        custom: false,
      }),
    );
    expect(suggestions).toContainEqual(
      expect.objectContaining({
        value: '50000',
        custom: false,
      }),
    );
    expect(suggestions).toContainEqual(
      expect.objectContaining({
        value: '5000000',
        custom: false,
      }),
    );
  });

  it('keeps a reopened custom value as the first row before the full preset list', () => {
    const suggestions = getMapPriceSuggestions('sale', 'from', '612345');

    expect(suggestions[0]).toMatchObject({
      value: '612345',
      custom: true,
    });
    expect(suggestions).toContainEqual(
      expect.objectContaining({
        value: '50000',
        custom: false,
      }),
    );
  });

  it('keeps no-max visible when a populated upper bound is reopened without typing', () => {
    const suggestions = getMapPriceSuggestions('sale', 'to', '850000');

    expect(suggestions.at(-1)).toMatchObject({
      value: '',
      label: 'No max',
    });
  });

  it('does not prefix-filter a typed zero, matching funda reopen behavior', () => {
    const suggestions = getMapPriceSuggestions('sale', 'from', '0', {
      filterByPrefix: true,
    });

    expect(suggestions).toContainEqual(
      expect.objectContaining({
        value: '50000',
      }),
    );
  });

  it('returns sale and rent modes from the current market-state selection', () => {
    expect(getMapVisiblePriceModes(['for-sale', 'for-rent'])).toEqual(['sale', 'rent']);
    expect(getMapVisiblePriceModes(['for-rent', 'rented'])).toEqual(['rent']);
    expect(getMapVisiblePriceModes(['for-sale', 'sold'])).toEqual(['sale']);
  });

  it('does not apply sale bounds to rent-state candidates', () => {
    expect(
      doesMapFilterCandidateMatch(
        {
          activeRentAskingPrice: 1800,
          marketState: 'for-rent',
        },
        {
          salePriceFrom: 500000,
          salePriceTo: null,
          rentPriceFrom: null,
          rentPriceTo: 2000,
          marketState: ['for-rent'],
          activity: 'all',
        },
      ),
    ).toBe(true);
  });

  it('applies the public activity facet independently of market state', () => {
    expect(
      doesMapFilterCandidateMatch(
        {
          marketState: 'for-sale',
          socialScore: 12,
          lastSocialAt: new Date().toISOString(),
        },
        {
          salePriceFrom: null,
          salePriceTo: null,
          rentPriceFrom: null,
          rentPriceTo: null,
          marketState: ['for-sale'],
          activity: 'all-time',
        },
      ),
    ).toBe(true);

    expect(
      doesMapFilterCandidateMatch(
        {
          marketState: 'for-sale',
          socialScore: 12,
          lastSocialAt: '2025-01-01T00:00:00.000Z',
        },
        {
          salePriceFrom: null,
          salePriceTo: null,
          rentPriceFrom: null,
          rentPriceTo: null,
          marketState: ['for-sale'],
          activity: 'today',
        },
      ),
    ).toBe(false);
  });

  it('treats the default market-state set as no status pills selected', () => {
    expect(
      isMapStatusPillActive(
        {
          salePriceFrom: null,
          salePriceTo: null,
          rentPriceFrom: null,
          rentPriceTo: null,
          marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
          activity: 'all',
        },
        'for-sale',
      ),
    ).toBe(false);
  });

  it('toggles status pills into explicit filtering and back to the default set', () => {
    const soldOnly = toggleMapStatusPill(
      {
        salePriceFrom: null,
        salePriceTo: null,
        rentPriceFrom: null,
        rentPriceTo: null,
        marketState: ['for-sale', 'for-rent', 'sold', 'rented', 'not-listed'],
        activity: 'all',
      },
      'sold',
    );
    expect(soldOnly.marketState).toEqual(['sold']);

    const reset = toggleMapStatusPill(soldOnly, 'sold');
    expect(reset.marketState).toEqual([
      'for-sale',
      'for-rent',
      'sold',
      'rented',
      'not-listed',
    ]);
    expect(reset.activity).toBe('all');
  });

  it('removes deprecated socialScope from public search serialization', () => {
    const params = updateMapFilterSearchParams(
      new URLSearchParams('socialScope=following&foo=bar'),
      createDefaultMapFilters(),
    );

    expect(params.get('socialScope')).toBeNull();
    expect(params.get('foo')).toBe('bar');
  });

  it('keeps app-local socialScope out of public tile and nearby URLs', () => {
    const filters = createDefaultMapFilters();

    expect(buildPropertyTileTemplateUrl('http://api.test', filters)).not.toContain('socialScope');
    expect(buildNearbyGroupPath(5.47, 51.44, 14, filters)).not.toContain('socialScope');
  });

  it('serializes and restores selected area chips as repeated URL params', () => {
    const filters = {
      ...createDefaultMapFilters(),
      areas: [
        { type: 'city' as const, countryCode: 'NL', value: 'eindhoven', label: 'Eindhoven' },
        { type: 'city' as const, countryCode: 'NL', value: 'waalre', label: 'Waalre' },
      ],
    };
    const params = updateMapFilterSearchParams(new URLSearchParams(), filters);

    expect(params.toString()).toBe(
      'area=city%3ANL%3Aeindhoven&area=city%3ANL%3Awaalre',
    );
    expect(buildPropertyTileTemplateUrl('http://api.test', filters)).toContain(
      'area=city%3ANL%3Aeindhoven&area=city%3ANL%3Awaalre',
    );
    expect(parseMapFiltersFromSearchParams(params).areas).toEqual([
      expect.objectContaining({ type: 'city', countryCode: 'NL', value: 'eindhoven' }),
      expect.objectContaining({ type: 'city', countryCode: 'NL', value: 'waalre' }),
    ]);
  });

  it('serializes street and postcode area metadata through repeated URL params', () => {
    const filters = {
      ...createDefaultMapFilters(),
      areas: [
        {
          type: 'street' as const,
          countryCode: 'NL',
          value: 'boschdijk',
          label: 'Boschdijk',
          city: 'Eindhoven',
          region: 'Noord-Brabant',
        },
        {
          type: 'postcode' as const,
          countryCode: 'NL',
          value: '5612-ma',
          label: '5612 MA',
          city: 'Eindhoven',
          street: 'Boschdijk',
        },
      ],
    };
    const params = updateMapFilterSearchParams(new URLSearchParams(), filters);

    expect(params.toString()).toBe(
      'area=street%3ANL%3Aboschdijk%3Acity%3Deindhoven&area=postcode%3ANL%3A5612ma%3Acity%3Deindhoven%3Astreet%3Dboschdijk',
    );
    expect(buildPropertyTileTemplateUrl('http://api.test', filters)).toContain(
      'area=street%3ANL%3Aboschdijk%3Acity%3Deindhoven&area=postcode%3ANL%3A5612ma%3Acity%3Deindhoven%3Astreet%3Dboschdijk',
    );
    expect(parseMapFiltersFromSearchParams(params).areas).toEqual([
      expect.objectContaining({
        type: 'street',
        countryCode: 'NL',
        value: 'boschdijk',
        label: 'Boschdijk',
        city: 'Eindhoven',
        region: null,
        postalCode: null,
        street: null,
      }),
      expect.objectContaining({
        type: 'postcode',
        countryCode: 'NL',
        value: '5612ma',
        label: '5612MA',
        city: 'Eindhoven',
        postalCode: '5612MA',
        street: 'Boschdijk',
      }),
    ]);
  });

  it('matches shared/backend-compatible location token identities', () => {
    const postcodeToken = {
      type: 'postcode' as const,
      countryCode: 'NL',
      value: '5651 HA',
      label: '5651 HA',
      postalCode: '5651 HA',
    };
    const streetToken = {
      type: 'street' as const,
      countryCode: 'NL',
      value: 'Beeldbuisring',
      label: 'Beeldbuisring',
      street: 'Beeldbuisring',
      city: 'Eindhoven',
      postalCode: '5651 HA',
    };
    const currentLocationToken = {
      type: 'current-location' as const,
      countryCode: null,
      value: '52.090700,5.121400',
      label: 'Current location',
      coordinates: [5.1214, 52.0907] as [number, number],
      radiusMeters: DEFAULT_CURRENT_LOCATION_RADIUS_METERS,
    };

    expect(serializeLocationFilterToken(postcodeToken)).toBe('postcode:NL:5651ha');
    expect(parseLocationFilterToken('postcode:NL:5651ha')).toEqual(
      expect.objectContaining({
        type: 'postcode',
        countryCode: 'NL',
        value: '5651ha',
        label: '5651HA',
        postalCode: '5651HA',
      }),
    );

    expect(serializeLocationFilterToken(streetToken)).toBe(
      'street:NL:beeldbuisring:city=eindhoven',
    );
    expect(
      parseLocationFilterToken('street:NL:beeldbuisring:city=eindhoven:postcode=5651ha'),
    ).toEqual(
      expect.objectContaining({
        type: 'street',
        countryCode: 'NL',
        value: 'beeldbuisring',
        city: 'Eindhoven',
        postalCode: '5651HA',
      }),
    );

    expect(serializeLocationFilterToken(currentLocationToken)).toBe(
      'current-location:52.090700:5.121400:5000',
    );
    expect(parseLocationFilterToken('current-location:52.090700:5.121400:5000')).toEqual(
      expect.objectContaining({
        type: 'current-location',
        countryCode: null,
        value: '52.090700,5.121400',
        coordinates: [5.1214, 52.0907],
        radiusMeters: DEFAULT_CURRENT_LOCATION_RADIUS_METERS,
      }),
    );
  });

  it('keeps same street value distinct across cities in area params', () => {
    const filters = {
      ...createDefaultMapFilters(),
      areas: [
        {
          type: 'street' as const,
          countryCode: 'NL',
          value: 'kerkstraat',
          label: 'Kerkstraat',
          city: 'Eindhoven',
        },
        {
          type: 'street' as const,
          countryCode: 'NL',
          value: 'kerkstraat',
          label: 'Kerkstraat',
          city: 'Waalre',
        },
      ],
    };

    const params = updateMapFilterSearchParams(new URLSearchParams(), filters);

    expect(params.getAll('area')).toEqual([
      'street:NL:kerkstraat:city=eindhoven',
      'street:NL:kerkstraat:city=waalre',
    ]);
    expect(parseMapFiltersFromSearchParams(params).areas).toEqual([
      expect.objectContaining({ value: 'kerkstraat', city: 'Eindhoven' }),
      expect.objectContaining({ value: 'kerkstraat', city: 'Waalre' }),
    ]);
  });

  it('builds camera bounds from area bboxes, centers, and current-location radius', () => {
    const bounds = getLocationFilterTokenCameraBounds([
      {
        type: 'city',
        countryCode: 'NL',
        value: 'eindhoven',
        label: 'Eindhoven',
        bbox: [5.35, 51.36, 5.57, 51.51],
      },
      {
        type: 'city',
        countryCode: 'NL',
        value: 'waalre',
        label: 'Waalre',
        coordinates: [5.444, 51.386],
      },
    ]);

    expect(bounds).toEqual([5.35, 51.36, 5.57, 51.51]);

    const currentLocationBounds = getLocationFilterTokenCameraBounds([
      {
        type: 'current-location',
        countryCode: null,
        value: '52.090700,5.121400',
        label: 'Current location',
        coordinates: [5.1214, 52.0907],
        radiusMeters: DEFAULT_CURRENT_LOCATION_RADIUS_METERS,
      },
    ]);

    expect(currentLocationBounds?.[0]).toBeLessThan(5.1214);
    expect(currentLocationBounds?.[1]).toBeLessThan(52.0907);
    expect(currentLocationBounds?.[2]).toBeGreaterThan(5.1214);
    expect(currentLocationBounds?.[3]).toBeGreaterThan(52.0907);
  });

  it('uses tighter camera max zoom caps for smaller area types', () => {
    expect(
      getLocationFilterTokenCameraMaxZoom([
        {
          type: 'street',
          countryCode: 'NL',
          value: 'beeldbuisring',
          label: 'Beeldbuisring',
        },
      ])
    ).toBe(16);

    expect(
      getLocationFilterTokenCameraMaxZoom([
        {
          type: 'postcode',
          countryCode: 'NL',
          value: '5651ha',
          label: '5651HA',
        },
      ])
    ).toBe(15);

    expect(
      getLocationFilterTokenCameraMaxZoom([
        {
          type: 'city',
          countryCode: 'NL',
          value: 'eindhoven',
          label: 'Eindhoven',
        },
        {
          type: 'street',
          countryCode: 'NL',
          value: 'beeldbuisring',
          label: 'Beeldbuisring',
        },
      ])
    ).toBe(13);
  });
});
