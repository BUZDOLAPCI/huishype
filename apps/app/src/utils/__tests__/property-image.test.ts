import {
  derivePropertyAerialImageUrl,
  resolvePropertyImage,
  resolvePropertyImageWithType,
  hasAerialImageSupport,
  toPropertyImageSource,
  withDerivedPropertyImageData,
} from '../property-image';

describe('resolvePropertyImage', () => {
  it('returns listing photo URL when available', () => {
    const result = resolvePropertyImage({
      listingPhotoUrl: 'https://funda.nl/photo.jpg',
      aerialImageUrl: 'https://pdok.nl/aerial.jpg',
      countryCode: 'NL',
    });
    expect(result).toBe('https://funda.nl/photo.jpg');
  });

  it('returns aerial image for NL when no listing photo', () => {
    const result = resolvePropertyImage({
      listingPhotoUrl: null,
      aerialImageUrl: 'https://pdok.nl/aerial.jpg',
      countryCode: 'NL',
    });
    expect(result).toBe('https://pdok.nl/aerial.jpg');
  });

  it('does not return aerial image for unsupported countries', () => {
    const result = resolvePropertyImage({
      listingPhotoUrl: null,
      aerialImageUrl: 'https://someservice.de/aerial.jpg',
      countryCode: 'DE',
    });
    expect(result).toBeNull();
  });

  it('returns null when no images available', () => {
    const result = resolvePropertyImage({
      listingPhotoUrl: null,
      aerialImageUrl: null,
      countryCode: 'NL',
    });
    expect(result).toBeNull();
  });

  it('returns null when no source provided', () => {
    const result = resolvePropertyImage({});
    expect(result).toBeNull();
  });

  it('ignores blocked placeholder.test image hosts', () => {
    const result = resolvePropertyImage({
      listingPhotoUrl: 'https://placeholder.test/fixture.jpg',
      aerialImageUrl: 'https://pdok.nl/aerial.jpg',
      countryCode: 'NL',
    });
    expect(result).toBe('https://pdok.nl/aerial.jpg');
  });

  it('ignores reserved example image hosts and falls back cleanly', () => {
    const result = resolvePropertyImage({
      listingPhotoUrl: 'https://cdn.example.com/fixture.jpg',
      aerialImageUrl: 'https://pdok.nl/aerial.jpg',
      countryCode: 'NL',
    });
    expect(result).toBe('https://pdok.nl/aerial.jpg');
  });

  it('ignores non-http image URLs', () => {
    const result = resolvePropertyImage({
      listingPhotoUrl: 'file:///tmp/image.jpg',
      aerialImageUrl: 'https://pdok.nl/aerial.jpg',
      countryCode: 'NL',
    });
    expect(result).toBe('https://pdok.nl/aerial.jpg');
  });

  it('prioritizes listing photo over aerial', () => {
    const result = resolvePropertyImage({
      listingPhotoUrl: 'https://listing.jpg',
      aerialImageUrl: 'https://aerial.jpg',
      countryCode: 'NL',
    });
    expect(result).toBe('https://listing.jpg');
  });

  it('treats empty string as falsy', () => {
    const result = resolvePropertyImage({
      listingPhotoUrl: '',
      aerialImageUrl: 'https://aerial.jpg',
      countryCode: 'NL',
    });
    expect(result).toBe('https://aerial.jpg');
  });

});

describe('resolvePropertyImageWithType', () => {
  it('identifies listing source type', () => {
    const result = resolvePropertyImageWithType({
      listingPhotoUrl: 'https://photo.jpg',
    });
    expect(result.type).toBe('listing');
    expect(result.url).toBe('https://photo.jpg');
  });

  it('identifies aerial source type', () => {
    const result = resolvePropertyImageWithType({
      aerialImageUrl: 'https://aerial.jpg',
      countryCode: 'NL',
    });
    expect(result.type).toBe('aerial');
  });

  it('identifies placeholder type', () => {
    const result = resolvePropertyImageWithType({});
    expect(result.type).toBe('placeholder');
    expect(result.url).toBeNull();
  });
});

describe('property image data helpers', () => {
  it('maps thumbnailUrl to listingPhotoUrl for shared surfaces', () => {
    expect(
      toPropertyImageSource({
        thumbnailUrl: 'https://cdn.huishype.nl/listing-thumb.jpg',
        countryCode: 'NL',
      })
    ).toEqual({
      listingPhotoUrl: 'https://cdn.huishype.nl/listing-thumb.jpg',
      aerialImageUrl: null,
      countryCode: 'NL',
    });
  });

  it('derives aerial imagery without overwriting listing thumbnails', () => {
    const property = withDerivedPropertyImageData({
      thumbnailUrl: 'https://cdn.huishype.nl/listing-thumb.jpg',
      geometry: { type: 'Point' as const, coordinates: [5.47, 51.44] as [number, number] },
      countryCode: 'NL',
    });

    expect(property.thumbnailUrl).toBe('https://cdn.huishype.nl/listing-thumb.jpg');
    expect(property.aerialImageUrl).toBe(derivePropertyAerialImageUrl(property));
  });
});

describe('hasAerialImageSupport', () => {
  it('returns true for NL', () => {
    expect(hasAerialImageSupport('NL')).toBe(true);
  });

  it('returns false for DE', () => {
    expect(hasAerialImageSupport('DE')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasAerialImageSupport(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasAerialImageSupport('')).toBe(false);
  });
});
