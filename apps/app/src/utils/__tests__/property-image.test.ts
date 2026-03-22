import {
  resolvePropertyImage,
  resolvePropertyImageWithType,
  hasAerialImageSupport,
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
