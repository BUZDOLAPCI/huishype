import {
  assertEndpointSemanticCoverage,
  validateDecodedPropertyFeature,
  validatePropertyTileResponse,
  type TileSemanticSummary,
} from './property-tile-semantic-validation.js';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROPERTY_ID = '22222222-2222-4222-8222-222222222222';

function baseProperties(overrides: Record<string, number | string | boolean> = {}) {
  return {
    node_class: 'active',
    group_kind: 'single',
    primary_property_id: PROPERTY_ID,
    point_count: 1,
    property_ids: PROPERTY_ID,
    preview_property_ids: PROPERTY_ID,
    membership_complete: true,
    read_state_coverage: 'complete',
    activeListingCount: 1,
    completedListingCount: 0,
    socialCount: 0,
    recentSocialCount: 0,
    socialScoreTotal: 0,
    socialScoreMax: 0,
    recentSocialScoreTotal: 0,
    commentCount: 0,
    ...overrides,
  };
}

describe('property tile semantic validation', () => {
  it('accepts a complete single active point feature', () => {
    const result = validateDecodedPropertyFeature({
      index: 0,
      type: 1,
      pointGeometryCount: 1,
      properties: baseProperties(),
    }, 13);

    expect(result.failures).toEqual([]);
    expect(result.contribution).toMatchObject({
      singleCount: 1,
      clusterCount: 0,
      activeCount: 1,
      pointCount: 1,
    });
  });

  it('requires cluster counts, bbox fields, representative IDs, and partial membership when property IDs are omitted', () => {
    const result = validateDecodedPropertyFeature({
      index: 0,
      type: 1,
      pointGeometryCount: 1,
      properties: baseProperties({
        group_kind: 'cluster',
        point_count: 3,
        property_ids: '',
        preview_property_ids: `${PROPERTY_ID},${OTHER_PROPERTY_ID}`,
        membership_complete: false,
        read_state_coverage: 'partial',
        bbox_west: 4.9,
        bbox_south: 52.3,
        bbox_east: 4.91,
        bbox_north: 52.31,
      }),
    }, 13);

    expect(result.failures).toEqual([]);
    expect(result.contribution).toMatchObject({
      singleCount: 0,
      clusterCount: 1,
      pointCount: 3,
    });
  });

  it('rejects non-active node classes', () => {
    const result = validateDecodedPropertyFeature({
      index: 0,
      type: 1,
      pointGeometryCount: 1,
      properties: baseProperties({
        node_class: 'inactive',
        activeListingCount: 1,
        hasActiveListing: true,
      }),
    }, 13);

    expect(result.failures).toContain('node_class must be active, got "inactive"');
  });

  it('enforces candidate/current pyramid serving for z10 and dynamic serving for z11+', () => {
    const z10Result = validatePropertyTileResponse({
      endpoint: { label: 'candidate', baseUrl: 'http://candidate.test' },
      sample: {
        city: 'candidate z10',
        semanticGroup: 'pyramid-edge',
        z: 10,
        x: 527,
        y: 340,
      },
      status: 204,
      headers: new Headers({ 'x-tile-cache': 'miss' }),
      payload: new Uint8Array(),
    });
    const z11Result = validatePropertyTileResponse({
      endpoint: { label: 'candidate', baseUrl: 'http://candidate.test' },
      sample: {
        city: 'candidate z11',
        semanticGroup: 'transition',
        z: 11,
        x: 1054,
        y: 680,
      },
      status: 204,
      headers: new Headers({
        'x-tile-cache': 'precomputed',
        'x-huishype-tile-status': 'pyramid-promoted',
        'x-huishype-pyramid-version': '00000000-0000-0000-0000-000000000011',
      }),
      payload: new Uint8Array(),
    });
    const mainResult = validatePropertyTileResponse({
      endpoint: { label: 'main', baseUrl: 'http://main.test' },
      sample: {
        city: 'main z10',
        semanticGroup: 'pyramid-edge',
        z: 10,
        x: 527,
        y: 340,
      },
      status: 204,
      headers: new Headers({ 'x-tile-cache': 'miss' }),
      payload: new Uint8Array(),
    });

    expect(z10Result.failures.map((failure) => failure.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('z10 candidate/current low-zoom sample must be served from the promoted pyramid'),
      ])
    );
    expect(z11Result.failures.map((failure) => failure.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('z11 candidate/current sample must stay on the dynamic tile path'),
      ])
    );
    expect(mainResult.failures).toEqual([]);
  });

  it('requires non-empty semantic coverage for low, pyramid edge, transition, detail, and z17 samples', () => {
    const baseSummary: Omit<TileSemanticSummary, 'semanticGroup' | 'tile' | 'featureCount'> = {
      endpoint: 'candidate',
      city: 'sample',
      status: 204,
      bytes: 0,
      singleCount: 0,
      clusterCount: 0,
      activeCount: 0,
      pointCountTotal: 0,
      tileCache: 'miss',
      tileStatus: '',
      pyramidVersion: '',
    };
    const summaries: TileSemanticSummary[] = [
      { ...baseSummary, semanticGroup: 'low-zoom', tile: '8/131/84', featureCount: 1 },
      { ...baseSummary, semanticGroup: 'pyramid-edge', tile: '10/527/340', featureCount: 0 },
      { ...baseSummary, semanticGroup: 'transition', tile: '11/1054/680', featureCount: 0 },
      { ...baseSummary, semanticGroup: 'detail', tile: '14/8434/5443', featureCount: 0 },
      { ...baseSummary, semanticGroup: 'z17-detail', tile: '17/67321/43076', featureCount: 0 },
    ];

    expect(assertEndpointSemanticCoverage(summaries).map((failure) => failure.message)).toEqual(
      expect.arrayContaining([
        'pyramid-edge sample set did not return any properties-layer features',
        'transition sample set did not return any properties-layer features',
        'detail sample set did not return any properties-layer features',
        'z17-detail sample set did not return any properties-layer features',
      ])
    );
  });
});
