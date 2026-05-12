import { describe, expect, it } from '@jest/globals';
import {
  buildPropertyTilePyramidBuildIdentitySnapshots,
  buildPropertyTilePyramidBuildInputsHash,
  buildPropertyTilePyramidCacheKey,
  buildPropertyTilePyramidEtag,
  buildPropertyTilePyramidQueueJobId,
  getPropertyTilePyramidMaxZoom,
  getPropertyTilePyramidResourceControls,
  type PropertyTilePyramidSlot,
} from './property-tile-pyramid.js';

const slot: PropertyTilePyramidSlot = {
  coverageId: 'public_default_low_zoom',
  filterSignature: 'default',
  maxZoom: 10,
  pyramidKind: 'public_default_low_zoom',
};

function withTemporaryEnv<T>(
  updates: Record<string, string | undefined>,
  run: () => T,
): T {
  const previous = new Map(
    Object.keys(updates).map((key) => [key, process.env[key]] as const),
  );

  try {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const defaultBuildIdentityEnv = {
  PROPERTY_TILE_PRECOMPUTE_MIN_LON: undefined,
  PROPERTY_TILE_PRECOMPUTE_MIN_LAT: undefined,
  PROPERTY_TILE_PRECOMPUTE_MAX_LON: undefined,
  PROPERTY_TILE_PRECOMPUTE_MAX_LAT: undefined,
  PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: undefined,
  PROPERTY_TILE_PYRAMID_CHUNK_TILE_LIMIT: undefined,
  PROPERTY_TILE_PYRAMID_MEMBER_PAGE_SIZE: undefined,
  PROPERTY_TILE_PYRAMID_STATEMENT_TIMEOUT_MS: undefined,
  PROPERTY_TILE_PYRAMID_LEASE_SECONDS: undefined,
  PROPERTY_TILE_PYRAMID_MAX_HEAP_MB: undefined,
  PROPERTY_TILE_PYRAMID_MAX_MEMBER_ROWS: undefined,
  PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_CHUNK: undefined,
  PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_BUILD: undefined,
} satisfies Record<string, string | undefined>;

describe('property tile pyramid service helpers', () => {
  it('partitions public tile cache keys by version id', () => {
    expect(buildPropertyTilePyramidCacheKey({
      versionId: 'version-a',
      z: 0,
      x: 0,
      y: 0,
    })).toBe('pyramid:version-a:0/0/0');

    expect(buildPropertyTilePyramidCacheKey({
      versionId: 'version-b',
      z: 0,
      x: 0,
      y: 0,
    })).toBe('pyramid:version-b:0/0/0');
  });

  it('includes version id in tile etags', () => {
    const payload = Buffer.from('same-payload');
    const etagA = buildPropertyTilePyramidEtag({
      versionId: 'version-a',
      z: 1,
      x: 0,
      y: 0,
      payload,
    });
    const etagB = buildPropertyTilePyramidEtag({
      versionId: 'version-b',
      z: 1,
      x: 0,
      y: 0,
      payload,
    });

    expect(etagA).not.toBe(etagB);
    expect(etagA).toMatch(/^"pyramid-[a-f0-9]{40}"$/);
  });

  it('derives deterministic worker job ids from serving slot and input hashes', () => {
    const jobId = buildPropertyTilePyramidQueueJobId({
      slot,
      buildInputsHash: 'inputs',
      sourceWatermarkHash: 'watermarks',
    });

    expect(jobId).toMatch(/^property-tile-pyramid-[a-f0-9]{40}$/);
    expect(buildPropertyTilePyramidQueueJobId({
      slot,
      buildInputsHash: 'inputs',
      sourceWatermarkHash: 'watermarks-2',
    })).not.toBe(jobId);
  });

  it('hashes immutable build identity inputs and snapshots the resolved definitions', () => {
    const baselineIdentity = withTemporaryEnv(defaultBuildIdentityEnv, () =>
      buildPropertyTilePyramidBuildIdentitySnapshots(slot));
    const baselineHash = baselineIdentity.buildInputsHash;

    expect(baselineHash).toMatch(/^[a-f0-9]{64}$/);
    expect(baselineIdentity.coverageSnapshot).toMatchObject({
      coverageId: slot.coverageId,
      boundsSource: 'env:europe-default',
      bounds: {
        minLon: -11.5,
        minLat: 34.5,
        maxLon: 32.5,
        maxLat: 71.5,
      },
      minZoom: 0,
      maxZoom: slot.maxZoom,
      filterSignature: slot.filterSignature,
    });
    expect(baselineIdentity.configSnapshot).toMatchObject({
      pipelineVersion: 'property-tile-pyramid:v1',
      coverageConfigHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      defaultFilter: {
        signature: 'default',
      },
      resourceControls: {
        chunkTileLimit: 128,
        memberPageSize: 5000,
        statementTimeoutMs: 30000,
        leaseSeconds: 900,
        maxHeapMb: 1024,
        maxMemberRows: 5000000,
        maxWalBytesPerChunk: 1073741824,
        maxWalBytesPerBuild: 10737418240,
      },
    });
    expect(baselineIdentity.groupingConstants).toMatchObject({
      mvtEncoding: {
        layerName: 'properties',
        extent: 4096,
        buffer: 256,
      },
      nodeExposure: {
        single: {
          membershipComplete: true,
          readStateCoverage: 'complete',
          tapRadiusPx: 24,
        },
        cluster: {
          membershipComplete: false,
          readStateCoverage: 'partial',
          previewPropertyIdsLimit: 30,
          tapRadiusPx: 36,
        },
      },
    });

    expect(withTemporaryEnv(defaultBuildIdentityEnv, () => buildPropertyTilePyramidBuildInputsHash({
      ...slot,
      maxZoom: slot.maxZoom + 1,
    }))).not.toBe(baselineHash);
    expect(withTemporaryEnv({
      ...defaultBuildIdentityEnv,
      PROPERTY_TILE_PRECOMPUTE_MAX_LON: '33.5',
    }, () => buildPropertyTilePyramidBuildInputsHash(slot))).not.toBe(baselineHash);
    expect(withTemporaryEnv({
      ...defaultBuildIdentityEnv,
      PROPERTY_TILE_PYRAMID_MEMBER_PAGE_SIZE: '6000',
    }, () => buildPropertyTilePyramidBuildInputsHash(slot))).not.toBe(baselineHash);
  });

  it('keeps source watermark values out of build input hashes', () => {
    const buildInputsHash = withTemporaryEnv(defaultBuildIdentityEnv, () =>
      buildPropertyTilePyramidBuildInputsHash(slot));

    expect(buildInputsHash).toBe(withTemporaryEnv(defaultBuildIdentityEnv, () =>
      buildPropertyTilePyramidBuildInputsHash(slot)));
    expect(buildPropertyTilePyramidQueueJobId({
      slot,
      buildInputsHash,
      sourceWatermarkHash: 'watermarks-a',
    })).not.toBe(buildPropertyTilePyramidQueueJobId({
      slot,
      buildInputsHash,
      sourceWatermarkHash: 'watermarks-b',
    }));
  });

  it('includes immutable coverage, config, and grouping snapshots in the build identity', () => {
    const identity = buildPropertyTilePyramidBuildIdentitySnapshots(slot);
    const lowerZoomIdentity = buildPropertyTilePyramidBuildIdentitySnapshots({
      ...slot,
      maxZoom: 9,
    });

    expect(identity.buildInputsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.buildInputsHash).not.toBe(lowerZoomIdentity.buildInputsHash);
    expect(identity.coverageSnapshot).toMatchObject({
      coverageId: 'public_default_low_zoom',
      minZoom: 0,
      maxZoom: 10,
      filterSignature: 'default',
    });
    expect(identity.configSnapshot).toMatchObject({
      pipelineVersion: 'property-tile-pyramid:v1',
      coverageConfigHash: expect.any(String),
    });
    expect(identity.groupingConstants).toMatchObject({
      pipelineVersion: 'property-tile-pyramid:v1',
      mvtEncoding: {
        layerName: 'properties',
        extent: 4096,
        buffer: 256,
      },
      nodeExposure: {
        cluster: {
          membershipComplete: false,
          readStateCoverage: 'partial',
          propertyIds: 'omitted',
        },
      },
    });
  });

  it('exposes default resource controls required by health output', () => {
    expect(withTemporaryEnv(defaultBuildIdentityEnv, () =>
      getPropertyTilePyramidResourceControls()
    )).toMatchObject({
      chunkTileLimit: 128,
      memberPageSize: 5000,
      statementTimeoutMs: 30000,
      leaseSeconds: 900,
      maxHeapMb: 1024,
      maxMemberRows: 5000000,
      maxWalBytesPerChunk: 1073741824,
      maxWalBytesPerBuild: 10737418240,
    });
  });

  it('fails loudly on invalid pyramid resource control env values', () => {
    expect(() => withTemporaryEnv({
      ...defaultBuildIdentityEnv,
      PROPERTY_TILE_PYRAMID_MEMBER_PAGE_SIZE: '5000ms',
    }, () => getPropertyTilePyramidResourceControls())).toThrow(
      /PROPERTY_TILE_PYRAMID_MEMBER_PAGE_SIZE must be an integer/
    );

    expect(() => withTemporaryEnv({
      ...defaultBuildIdentityEnv,
      PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_BUILD: '0',
    }, () => getPropertyTilePyramidResourceControls())).toThrow(
      /PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_BUILD must be a positive integer/
    );
  });

  it('rejects invalid precompute max zoom values instead of silently clamping or falling back', () => {
    expect(() => withTemporaryEnv({
      ...defaultBuildIdentityEnv,
      PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '23',
    }, () => getPropertyTilePyramidMaxZoom())).toThrow(
      /PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM must be an integer between 0 and 22/
    );

    expect(() => withTemporaryEnv({
      ...defaultBuildIdentityEnv,
      PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: 'ten',
    }, () => getPropertyTilePyramidMaxZoom())).toThrow(
      /PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM must be an integer/
    );
  });
});
