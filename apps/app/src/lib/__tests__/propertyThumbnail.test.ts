import {
  getPropertyAerialImageFromGeometry,
  getPropertyAerialImageUrl,
  getPropertyThumbnailFromGeometry,
  getPropertyThumbnailUrl,
  PROPERTY_AERIAL_IMAGE_BOX_SIZE_METERS,
  PROPERTY_AERIAL_IMAGE_HEIGHT,
  PROPERTY_AERIAL_IMAGE_WIDTH,
} from '../propertyThumbnail';

describe('propertyThumbnail', () => {
  it('uses the wider 80m default framing for NL thumbnails', () => {
    const url = getPropertyThumbnailUrl(51.4613225767584, 5.41869962895219, 'NL', 128, 128);

    expect(url).toBeTruthy();

    const bbox = new URL(url!).searchParams.get('BBOX');
    expect(bbox).toBeTruthy();

    const [minX, minY, maxX, maxY] = bbox!.split(',').map(Number);
    expect(maxX - minX).toBeCloseTo(80, 5);
    expect(maxY - minY).toBeCloseTo(80, 5);
  });

  it('builds thumbnails from geometry using the same wider default', () => {
    const url = getPropertyThumbnailFromGeometry(
      { type: 'Point', coordinates: [5.41869962895219, 51.4613225767584] },
      'NL',
    );

    expect(url).toBeTruthy();

    const bbox = new URL(url!).searchParams.get('BBOX');
    expect(bbox).toBeTruthy();

    const [minX, minY, maxX, maxY] = bbox!.split(',').map(Number);
    expect(maxX - minX).toBeCloseTo(80, 5);
    expect(maxY - minY).toBeCloseTo(80, 5);
  });

  it('uses the canonical shared property aerial dimensions', () => {
    const url = getPropertyAerialImageUrl(51.4613225767584, 5.41869962895219, 'NL');

    expect(url).toBeTruthy();

    const parsed = new URL(url!);
    expect(parsed.searchParams.get('width')).toBe(String(PROPERTY_AERIAL_IMAGE_WIDTH));
    expect(parsed.searchParams.get('height')).toBe(String(PROPERTY_AERIAL_IMAGE_HEIGHT));

    const [minX, minY, maxX, maxY] = parsed.searchParams.get('BBOX')!.split(',').map(Number);
    expect(maxX - minX).toBeCloseTo((PROPERTY_AERIAL_IMAGE_BOX_SIZE_METERS * PROPERTY_AERIAL_IMAGE_WIDTH) / PROPERTY_AERIAL_IMAGE_HEIGHT, 5);
    expect(maxY - minY).toBeCloseTo(PROPERTY_AERIAL_IMAGE_BOX_SIZE_METERS, 5);
  });

  it('builds canonical aerial image URLs from imagery geometry', () => {
    const url = getPropertyAerialImageFromGeometry(
      { type: 'Point', coordinates: [5.41869962895219, 51.4613225767584] },
      'NL',
    );

    expect(url).toBeTruthy();
    expect(new URL(url!).searchParams.get('width')).toBe(String(PROPERTY_AERIAL_IMAGE_WIDTH));
  });

  it('returns null for unsupported countries', () => {
    expect(getPropertyThumbnailUrl(51.4613, 5.4187, 'DE')).toBeNull();
    expect(getPropertyAerialImageUrl(51.4613, 5.4187, 'DE')).toBeNull();
    expect(
      getPropertyThumbnailFromGeometry(
        { type: 'Point', coordinates: [5.41869962895219, 51.4613225767584] },
        'DE',
      ),
    ).toBeNull();
    expect(
      getPropertyAerialImageFromGeometry(
        { type: 'Point', coordinates: [5.41869962895219, 51.4613225767584] },
        'DE',
      ),
    ).toBeNull();
  });
});
