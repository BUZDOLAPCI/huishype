import { describe, expect, it } from '@jest/globals';
import { PROPERTY_PREVIEW_MEMBER_LIMIT } from '@huishype/shared';
import {
  buildPropertyTilePyramidRollingSocialWindowFingerprint,
  buildPropertyTilePyramidBuildIdentitySnapshots,
  buildPropertyTilePyramidBuildInputsHash,
  buildPropertyTilePyramidCacheKey,
  buildPropertyTilePyramidEtag,
  buildPropertyTilePyramidQueueJobId,
  evaluatePropertyTilePyramidFullBuildEligibility,
  evaluatePropertyTilePyramidGuardrailVerdict,
  getPropertyTilePyramidGuardrailControls,
  getPropertyTilePyramidFullRebuildCadenceMs,
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

function withTemporaryEnv<T>(updates: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map(Object.keys(updates).map((key) => [key, process.env[key]] as const));

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
  PROPERTY_TILE_PYRAMID_FULL_REBUILD_CADENCE_MS: undefined,
  PROPERTY_TILE_PYRAMID_FULL_BUILD_MAX_CURRENT_NODE_COUNT: undefined,
  PROPERTY_TILE_PYRAMID_FULL_BUILD_MAX_CURRENT_ENCODED_PAYLOAD_BYTES: undefined,
  PROPERTY_TILE_PYRAMID_FULL_BUILD_MAX_CURRENT_WAL_BYTES: undefined,
  PROPERTY_TILE_PYRAMID_GUARDRAILS_ENABLED: undefined,
  PROPERTY_TILE_PYRAMID_UNSAFE_BYPASS_HARD_GUARDRAILS: undefined,
  PROPERTY_TILE_PYRAMID_GUARDRAIL_HOST_OBSERVATION_MAX_AGE_MS: undefined,
  PROPERTY_TILE_PYRAMID_GUARDRAIL_ROOT_MAX_USED_PERCENT: undefined,
  PROPERTY_TILE_PYRAMID_GUARDRAIL_ROOT_MIN_FREE_BYTES: undefined,
  PROPERTY_TILE_PYRAMID_GUARDRAIL_DB_MAX_BYTES: undefined,
  PROPERTY_TILE_PYRAMID_GUARDRAIL_GENERATED_MAX_BYTES: undefined,
  PROPERTY_TILE_PYRAMID_GUARDRAIL_RETAINED_GENERATION_MAX: undefined,
} satisfies Record<string, string | undefined>;

describe('property tile pyramid service helpers', () => {
  it('partitions public tile cache keys by version id', () => {
    expect(
      buildPropertyTilePyramidCacheKey({
        versionId: 'version-a',
        z: 0,
        x: 0,
        y: 0,
      })
    ).toBe('pyramid:version-a:0/0/0');

    expect(
      buildPropertyTilePyramidCacheKey({
        versionId: 'version-b',
        z: 0,
        x: 0,
        y: 0,
      })
    ).toBe('pyramid:version-b:0/0/0');
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
    expect(
      buildPropertyTilePyramidQueueJobId({
        slot,
        buildInputsHash: 'inputs',
        sourceWatermarkHash: 'watermarks-2',
      })
    ).not.toBe(jobId);
  });

  it('hashes immutable build identity inputs and snapshots the resolved definitions', () => {
    const baselineIdentity = withTemporaryEnv(defaultBuildIdentityEnv, () =>
      buildPropertyTilePyramidBuildIdentitySnapshots(slot)
    );
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
          previewPropertyIdsLimit: PROPERTY_PREVIEW_MEMBER_LIMIT,
          tapRadiusPx: 36,
        },
      },
    });

    expect(
      withTemporaryEnv(defaultBuildIdentityEnv, () =>
        buildPropertyTilePyramidBuildInputsHash({
          ...slot,
          maxZoom: slot.maxZoom + 1,
        })
      )
    ).not.toBe(baselineHash);
    expect(
      withTemporaryEnv(
        {
          ...defaultBuildIdentityEnv,
          PROPERTY_TILE_PRECOMPUTE_MAX_LON: '33.5',
        },
        () => buildPropertyTilePyramidBuildInputsHash(slot)
      )
    ).not.toBe(baselineHash);
    expect(
      withTemporaryEnv(
        {
          ...defaultBuildIdentityEnv,
          PROPERTY_TILE_PYRAMID_MEMBER_PAGE_SIZE: '6000',
        },
        () => buildPropertyTilePyramidBuildInputsHash(slot)
      )
    ).not.toBe(baselineHash);
  });

  it('keeps source watermark values out of build input hashes', () => {
    const buildInputsHash = withTemporaryEnv(defaultBuildIdentityEnv, () =>
      buildPropertyTilePyramidBuildInputsHash(slot)
    );

    expect(buildInputsHash).toBe(
      withTemporaryEnv(defaultBuildIdentityEnv, () => buildPropertyTilePyramidBuildInputsHash(slot))
    );
    expect(
      buildPropertyTilePyramidQueueJobId({
        slot,
        buildInputsHash,
        sourceWatermarkHash: 'watermarks-a',
      })
    ).not.toBe(
      buildPropertyTilePyramidQueueJobId({
        slot,
        buildInputsHash,
        sourceWatermarkHash: 'watermarks-b',
      })
    );
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
    expect(
      withTemporaryEnv(defaultBuildIdentityEnv, () => getPropertyTilePyramidResourceControls())
    ).toMatchObject({
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

  it('defaults full rebuild eligibility cadence to 24 hours and rejects invalid overrides', () => {
    expect(
      withTemporaryEnv(defaultBuildIdentityEnv, () => getPropertyTilePyramidFullRebuildCadenceMs())
    ).toBe(24 * 60 * 60 * 1000);

    expect(() =>
      withTemporaryEnv(
        {
          ...defaultBuildIdentityEnv,
          PROPERTY_TILE_PYRAMID_FULL_REBUILD_CADENCE_MS: '0',
        },
        () => getPropertyTilePyramidFullRebuildCadenceMs()
      )
    ).toThrow(/PROPERTY_TILE_PYRAMID_FULL_REBUILD_CADENCE_MS must be a positive integer/);
  });

  it('coarsens rolling social window fingerprints to the full rebuild cadence', () => {
    const cadenceMs = 24 * 60 * 60 * 1000;
    const dayStart = Date.parse('2026-06-10T00:00:00.000Z');
    const firstHour = buildPropertyTilePyramidRollingSocialWindowFingerprint({
      nowMs: dayStart + 60 * 60 * 1000,
      cadenceMs,
    });
    const laterSameDay = buildPropertyTilePyramidRollingSocialWindowFingerprint({
      nowMs: dayStart + 23 * 60 * 60 * 1000,
      cadenceMs,
    });
    const nextDay = buildPropertyTilePyramidRollingSocialWindowFingerprint({
      nowMs: dayStart + 25 * 60 * 60 * 1000,
      cadenceMs,
    });

    expect(laterSameDay).toEqual(firstHour);
    expect(firstHour).toMatchObject({
      source: 'rolling_social_window',
      bucketUnit: 'cadence',
      cadenceMs,
      cutoffAt: '2026-06-10T00:00:00.000Z',
    });
    expect(nextDay).toMatchObject({
      bucket: (firstHour.bucket as number) + 1,
      cutoffAt: '2026-06-11T00:00:00.000Z',
    });
  });

  it('gates full rebuilds by cadence while allowing operator, cadence, missing, degraded, and corrupt current states', () => {
    const nowMs = Date.parse('2026-06-10T12:00:00.000Z');
    const cadenceMs = 24 * 60 * 60 * 1000;
    const usableCurrent = {
      state: 'usable' as const,
      currentVersionId: 'current-version',
      promotedAt: '2026-06-10T00:00:00.000Z',
      sourceWatermarkHash: 'current-watermarks',
      comparableSourceWatermarkHash: 'current-comparable-with-rolling',
      canonicalComparableSourceWatermarkHash: 'canonical-a',
      nodeCount: 10,
      encodedPayloadBytes: 20,
      walBytes: 30,
    };

    expect(
      evaluatePropertyTilePyramidFullBuildEligibility({
        reason: 'source-watermark',
        current: usableCurrent,
        requestedCanonicalComparableSourceWatermarkHash: 'canonical-a',
        nowMs,
        cadenceMs,
      })
    ).toMatchObject({
      eligible: false,
      reason: 'cadence-not-due',
      nextEligibleAt: '2026-06-11T00:00:00.000Z',
    });
    expect(
      evaluatePropertyTilePyramidFullBuildEligibility({
        reason: 'source-watermark',
        current: usableCurrent,
        requestedCanonicalComparableSourceWatermarkHash: 'canonical-b',
        nowMs,
        cadenceMs,
      })
    ).toMatchObject({
      eligible: false,
      reason: 'cadence-not-due',
    });
    expect(
      evaluatePropertyTilePyramidFullBuildEligibility({
        reason: 'source-watermark',
        current: {
          ...usableCurrent,
          comparableSourceWatermarkHash: 'current-comparable-before-rolling-bucket',
        },
        requestedCanonicalComparableSourceWatermarkHash: 'canonical-a',
        nowMs,
        cadenceMs,
      })
    ).toMatchObject({
      eligible: false,
      reason: 'cadence-not-due',
    });
    expect(
      evaluatePropertyTilePyramidFullBuildEligibility({
        reason: 'operator',
        current: usableCurrent,
        nowMs,
        cadenceMs,
      })
    ).toMatchObject({ eligible: true, reason: 'operator-override' });
    expect(
      evaluatePropertyTilePyramidFullBuildEligibility({
        reason: 'source-watermark',
        current: { ...usableCurrent, promotedAt: '2026-06-09T12:00:00.000Z' },
        requestedCanonicalComparableSourceWatermarkHash: 'canonical-b',
        nowMs,
        cadenceMs,
      })
    ).toMatchObject({ eligible: true, reason: 'canonical-source-watermark-advanced' });
    expect(
      evaluatePropertyTilePyramidFullBuildEligibility({
        reason: 'source-watermark',
        current: { ...usableCurrent, promotedAt: '2026-06-09T12:00:00.000Z' },
        requestedCanonicalComparableSourceWatermarkHash: 'canonical-a',
        nowMs,
        cadenceMs,
      })
    ).toMatchObject({ eligible: true, reason: 'cadence-elapsed' });
    expect(
      evaluatePropertyTilePyramidFullBuildEligibility({
        reason: 'source-watermark',
        current: {
          state: 'missing',
          currentVersionId: null,
          promotedAt: null,
          reason: 'current-missing',
        },
        nowMs,
        cadenceMs,
      })
    ).toMatchObject({ eligible: true, reason: 'current-missing' });
    expect(
      evaluatePropertyTilePyramidFullBuildEligibility({
        reason: 'manifest-missing',
        current: {
          state: 'degraded',
          currentVersionId: 'current-version',
          promotedAt: '2026-06-10T00:00:00.000Z',
          reason: 'tile-invalid',
          sourceWatermarkHash: 'current-watermarks',
          comparableSourceWatermarkHash: 'current-comparable',
          canonicalComparableSourceWatermarkHash: 'canonical-a',
          nodeCount: 10,
          encodedPayloadBytes: 20,
          walBytes: 30,
        },
        nowMs,
        cadenceMs,
      })
    ).toMatchObject({ eligible: true, reason: 'current-degraded' });
    expect(
      evaluatePropertyTilePyramidFullBuildEligibility({
        reason: 'payload-regeneration-error',
        current: {
          state: 'corrupt',
          currentVersionId: 'current-version',
          promotedAt: '2026-06-10T00:00:00.000Z',
          reason: 'current-manifest-missing',
          sourceWatermarkHash: 'current-watermarks',
          comparableSourceWatermarkHash: 'current-comparable',
          canonicalComparableSourceWatermarkHash: 'canonical-a',
          nodeCount: 10,
          encodedPayloadBytes: 20,
          walBytes: 30,
        },
        nowMs,
        cadenceMs,
      })
    ).toMatchObject({ eligible: true, reason: 'current-corrupt' });
    expect(
      evaluatePropertyTilePyramidFullBuildEligibility({
        reason: 'manifest-missing',
        current: usableCurrent,
        nowMs,
        cadenceMs,
      })
    ).toMatchObject({ eligible: false, reason: 'repair-current-usable' });
    expect(
      evaluatePropertyTilePyramidFullBuildEligibility({
        reason: 'tile-miss',
        current: usableCurrent,
        nowMs,
        cadenceMs,
      })
    ).toMatchObject({ eligible: false, reason: 'repair-current-usable' });
    expect(
      evaluatePropertyTilePyramidFullBuildEligibility({
        reason: 'nearby-fallback-miss',
        current: usableCurrent,
        nowMs,
        cadenceMs,
      })
    ).toMatchObject({ eligible: false, reason: 'repair-current-usable' });
  });

  it('evaluates production guardrail observations and hard storage thresholds', () => {
    const controls = {
      enabled: true,
      unsafeOperatorBypass: false,
      hostObservationMaxAgeMs: 5 * 60 * 1000,
      rootMaxUsedPercent: 75,
      rootMinFreeBytes: 40 * 1_073_741_824,
      dbMaxBytes: 130 * 1_073_741_824,
      generatedMaxBytes: 40 * 1_073_741_824,
      retainedGenerationMax: 3,
    };
    const nowMs = Date.parse('2026-06-10T12:00:00.000Z');
    const healthyObservation = {
      source: 'host-watchdog',
      observedAt: '2026-06-10T11:59:00.000Z',
      rootFilesystemBytes: 301 * 1_073_741_824,
      rootFilesystemUsedBytes: 145 * 1_073_741_824,
      rootFilesystemFreeBytes: 144 * 1_073_741_824,
      rootFilesystemUsedPercent: 49,
      postgresVolumeBytes: 85 * 1_073_741_824,
      photonVolumeBytes: 47 * 1_073_741_824,
      dockerVolumes: {},
    };

    expect(
      evaluatePropertyTilePyramidGuardrailVerdict({
        controls,
        hostObservation: healthyObservation,
        dbBytes: 78 * 1_073_741_824,
        generatedBytes: 12 * 1_073_741_824,
        retainedGenerationCount: 2,
        nowMs,
      })
    ).toMatchObject({
      verdict: 'ok',
      automaticBuildsBlocked: false,
      violations: [],
      hostObservationAgeMs: 60_000,
    });

    expect(
      evaluatePropertyTilePyramidGuardrailVerdict({
        controls,
        hostObservation: null,
        dbBytes: 78 * 1_073_741_824,
        generatedBytes: 12 * 1_073_741_824,
        retainedGenerationCount: 2,
        nowMs,
      }).violations.map((violation) => violation.reason)
    ).toContain('guardrail-host-observation-missing');

    expect(
      evaluatePropertyTilePyramidGuardrailVerdict({
        controls,
        hostObservation: {
          ...healthyObservation,
          observedAt: '2026-06-10T11:50:00.000Z',
          rootFilesystemFreeBytes: 30 * 1_073_741_824,
          rootFilesystemUsedPercent: 85,
        },
        dbBytes: 131 * 1_073_741_824,
        generatedBytes: 41 * 1_073_741_824,
        retainedGenerationCount: 4,
        nowMs,
      }).violations.map((violation) => violation.reason)
    ).toEqual(
      expect.arrayContaining([
        'guardrail-host-observation-stale',
        'guardrail-root-disk-high',
        'guardrail-root-disk-free-low',
        'guardrail-db-size-high',
        'guardrail-generated-storage-high',
        'guardrail-retained-generations-high',
      ])
    );
  });

  it('defaults production guardrails on only in production and parses overrides', () => {
    expect(
      withTemporaryEnv(
        {
          ...defaultBuildIdentityEnv,
          NODE_ENV: 'test',
        },
        () => getPropertyTilePyramidGuardrailControls()
      )
    ).toMatchObject({ enabled: false, rootMaxUsedPercent: 75 });

    expect(
      withTemporaryEnv(
        {
          ...defaultBuildIdentityEnv,
          NODE_ENV: 'production',
          PROPERTY_TILE_PYRAMID_GUARDRAIL_GENERATED_MAX_BYTES: '12345',
          PROPERTY_TILE_PYRAMID_UNSAFE_BYPASS_HARD_GUARDRAILS: 'true',
        },
        () => getPropertyTilePyramidGuardrailControls()
      )
    ).toMatchObject({
      enabled: true,
      unsafeOperatorBypass: true,
      generatedMaxBytes: 12345,
    });
  });

  it('fails loudly on invalid pyramid resource control env values', () => {
    expect(() =>
      withTemporaryEnv(
        {
          ...defaultBuildIdentityEnv,
          PROPERTY_TILE_PYRAMID_MEMBER_PAGE_SIZE: '5000ms',
        },
        () => getPropertyTilePyramidResourceControls()
      )
    ).toThrow(/PROPERTY_TILE_PYRAMID_MEMBER_PAGE_SIZE must be an integer/);

    expect(() =>
      withTemporaryEnv(
        {
          ...defaultBuildIdentityEnv,
          PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_BUILD: '0',
        },
        () => getPropertyTilePyramidResourceControls()
      )
    ).toThrow(/PROPERTY_TILE_PYRAMID_MAX_WAL_BYTES_PER_BUILD must be a positive integer/);
  });

  it('rejects invalid precompute max zoom values instead of silently clamping or falling back', () => {
    expect(() =>
      withTemporaryEnv(
        {
          ...defaultBuildIdentityEnv,
          PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: '23',
        },
        () => getPropertyTilePyramidMaxZoom()
      )
    ).toThrow(/PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM must be an integer between 0 and 22/);

    expect(() =>
      withTemporaryEnv(
        {
          ...defaultBuildIdentityEnv,
          PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM: 'ten',
        },
        () => getPropertyTilePyramidMaxZoom()
      )
    ).toThrow(/PROPERTY_TILE_PRECOMPUTE_MAX_ZOOM must be an integer/);
  });
});
