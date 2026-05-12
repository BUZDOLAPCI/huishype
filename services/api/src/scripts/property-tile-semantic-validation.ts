import { VectorTile, VectorTileFeature } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {
  buildRepresentativePropertyTileSamples,
  propertyTileCoordinateKey,
  type PropertyTileSample,
} from './property-tile-benchmark-samples.js';

export type ValidationEndpoint = {
  label: string;
  baseUrl: string;
};

export type ValidationFailure = {
  endpoint: string;
  tile: string;
  message: string;
};

export type ValidationWarning = {
  endpoint: string;
  tile: string;
  message: string;
};

export type TileSemanticSummary = {
  endpoint: string;
  tile: string;
  city: string;
  semanticGroup: PropertyTileSample['semanticGroup'];
  status: number;
  bytes: number;
  featureCount: number;
  singleCount: number;
  clusterCount: number;
  activeCount: number;
  ghostCount: number;
  pointCountTotal: number;
  tileCache: string;
  tileStatus: string;
  pyramidVersion: string;
};

export type TileValidationInput = {
  endpoint: ValidationEndpoint;
  sample: PropertyTileSample;
  status: number;
  headers: Headers;
  payload: Uint8Array;
};

export type TileValidationOutput = {
  summary: TileSemanticSummary;
  failures: ValidationFailure[];
  warnings: ValidationWarning[];
};

type DecodedPropertyFeature = {
  index: number;
  type: VectorTileFeature['type'];
  pointGeometryCount: number;
  properties: Record<string, number | string | boolean>;
};

type FeatureContribution = {
  singleCount: number;
  clusterCount: number;
  activeCount: number;
  ghostCount: number;
  pointCount: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_COUNT_FIELDS = [
  'activeListingCount',
  'completedListingCount',
  'socialCount',
  'recentSocialCount',
  'socialScoreTotal',
  'socialScoreMax',
  'recentSocialScoreTotal',
  'commentCount',
] as const;
const BBOX_FIELDS = ['bbox_west', 'bbox_south', 'bbox_east', 'bbox_north'] as const;
const DEFAULT_ALLOWED_ALL_EMPTY = false;

export function buildDefaultPropertyTileSemanticSamples(): PropertyTileSample[] {
  return buildRepresentativePropertyTileSamples();
}

export function validatePropertyTileResponse(input: TileValidationInput): TileValidationOutput {
  const tileKey = propertyTileCoordinateKey(input.sample);
  const failures: ValidationFailure[] = [];
  const warnings: ValidationWarning[] = [];
  const tileCache = input.headers.get('x-tile-cache') ?? '';
  const tileStatus = input.headers.get('x-huishype-tile-status') ?? '';
  const pyramidVersion = input.headers.get('x-huishype-pyramid-version') ?? '';

  const fail = (message: string) => failures.push({
    endpoint: input.endpoint.label,
    tile: tileKey,
    message,
  });
  const warn = (message: string) => warnings.push({
    endpoint: input.endpoint.label,
    tile: tileKey,
    message,
  });

  validatePyramidHeaders({
    endpoint: input.endpoint,
    sample: input.sample,
    status: input.status,
    tileCache,
    tileStatus,
    pyramidVersion,
    fail,
    warn,
  });

  const summary: TileSemanticSummary = {
    endpoint: input.endpoint.label,
    tile: tileKey,
    city: input.sample.city,
    semanticGroup: input.sample.semanticGroup,
    status: input.status,
    bytes: input.payload.byteLength,
    featureCount: 0,
    singleCount: 0,
    clusterCount: 0,
    activeCount: 0,
    ghostCount: 0,
    pointCountTotal: 0,
    tileCache,
    tileStatus,
    pyramidVersion,
  };

  if (input.status === 204) {
    if (input.payload.byteLength > 0) {
      fail(`204 response must not include a tile payload; got ${input.payload.byteLength} bytes`);
    }
    return { summary, failures, warnings };
  }

  if (input.status !== 200) {
    fail(`expected status 200 or 204, got ${input.status}`);
    return { summary, failures, warnings };
  }

  if (input.payload.byteLength === 0) {
    fail('200 response must include a non-empty tile payload');
    return { summary, failures, warnings };
  }

  const features = decodePropertyFeatures(input.payload, fail);
  summary.featureCount = features.length;

  if (features.length === 0) {
    fail('properties layer must contain at least one feature for a 200 response');
  }

  for (const feature of features) {
    const contribution = validateDecodedPropertyFeature(feature, input.sample.z);
    summary.singleCount += contribution.contribution.singleCount;
    summary.clusterCount += contribution.contribution.clusterCount;
    summary.activeCount += contribution.contribution.activeCount;
    summary.ghostCount += contribution.contribution.ghostCount;
    summary.pointCountTotal += contribution.contribution.pointCount;
    for (const message of contribution.failures) {
      fail(`feature ${feature.index}: ${message}`);
    }
  }

  return { summary, failures, warnings };
}

export function validateDecodedPropertyFeature(
  feature: DecodedPropertyFeature,
  z: number
): { contribution: FeatureContribution; failures: string[] } {
  const failures: string[] = [];
  const props = feature.properties;
  const nodeClass = props.node_class;
  const groupKind = props.group_kind;
  const pointCount = numericProperty(props, 'point_count');
  const primaryPropertyId = stringProperty(props, 'primary_property_id');
  const propertyIds = stringProperty(props, 'property_ids');
  const previewPropertyIds = stringProperty(props, 'preview_property_ids');
  const membershipComplete = props.membership_complete;
  const readStateCoverage = props.read_state_coverage;

  if (feature.type !== 1) {
    failures.push(`expected Point geometry, got ${VectorTileFeature.types[feature.type] ?? feature.type}`);
  }
  if (feature.pointGeometryCount !== 1) {
    failures.push(`expected exactly one point geometry, got ${feature.pointGeometryCount}`);
  }
  if (nodeClass !== 'active' && nodeClass !== 'ghost') {
    failures.push(`node_class must be active or ghost, got ${formatValue(nodeClass)}`);
  }
  if (groupKind !== 'single' && groupKind !== 'cluster') {
    failures.push(`group_kind must be single or cluster, got ${formatValue(groupKind)}`);
  }
  if (!isUuid(primaryPropertyId)) {
    failures.push(`primary_property_id must be a UUID, got ${formatValue(primaryPropertyId)}`);
  }
  if (!Number.isInteger(pointCount) || pointCount < 1) {
    failures.push(`point_count must be a positive integer, got ${formatValue(props.point_count)}`);
  }
  if (typeof propertyIds !== 'string') {
    failures.push(`property_ids must be a string, got ${formatValue(propertyIds)}`);
  }
  if (typeof previewPropertyIds !== 'string') {
    failures.push(`preview_property_ids must be a string, got ${formatValue(previewPropertyIds)}`);
  }
  if (typeof membershipComplete !== 'boolean') {
    failures.push(`membership_complete must be boolean, got ${formatValue(membershipComplete)}`);
  }
  if (readStateCoverage !== 'complete' && readStateCoverage !== 'partial') {
    failures.push(`read_state_coverage must be complete or partial, got ${formatValue(readStateCoverage)}`);
  }

  for (const field of REQUIRED_COUNT_FIELDS) {
    const value = numericProperty(props, field);
    if (!Number.isFinite(value) || value < 0) {
      failures.push(`${field} must be a non-negative number, got ${formatValue(props[field])}`);
    }
  }

  if (nodeClass === 'ghost') {
    if (z < 17) {
      failures.push(`ghost node emitted below reveal zoom z17 on z${z}`);
    }
    if (props.hasActiveListing === true) {
      failures.push('ghost node must not have hasActiveListing=true');
    }
    const activeListingCount = numericProperty(props, 'activeListingCount');
    if (Number.isFinite(activeListingCount) && activeListingCount !== 0) {
      failures.push(`ghost node activeListingCount must be 0, got ${activeListingCount}`);
    }
  }

  const propertyIdList = splitIds(propertyIds);
  const previewPropertyIdList = splitIds(previewPropertyIds);
  validateIdList('property_ids', propertyIdList, failures);
  validateIdList('preview_property_ids', previewPropertyIdList, failures);

  if (groupKind === 'single') {
    if (pointCount !== 1) {
      failures.push(`single feature point_count must be 1, got ${formatValue(pointCount)}`);
    }
    if (propertyIds !== primaryPropertyId) {
      failures.push('single feature property_ids must equal primary_property_id');
    }
    if (!primaryPropertyId || !previewPropertyIdList.includes(primaryPropertyId)) {
      failures.push('single feature preview_property_ids must include primary_property_id');
    }
    if (membershipComplete !== true || readStateCoverage !== 'complete') {
      failures.push('single feature membership must be complete');
    }
  }

  if (groupKind === 'cluster') {
    if (!Number.isInteger(pointCount) || pointCount < 2) {
      failures.push(`cluster feature point_count must be at least 2, got ${formatValue(pointCount)}`);
    }
    validateClusterBbox(props, failures);
    if (previewPropertyIdList.length === 0) {
      failures.push('cluster feature preview_property_ids must include representative IDs');
    }
    if (previewPropertyIdList.length > pointCount) {
      failures.push('cluster feature preview_property_ids cannot exceed point_count');
    }
    if (propertyIdList.length > pointCount) {
      failures.push('cluster feature property_ids cannot exceed point_count');
    }
    if (propertyIdList.length === 0 && (membershipComplete !== false || readStateCoverage !== 'partial')) {
      failures.push('cluster feature with omitted property_ids must have partial membership');
    }
    if (propertyIdList.length > 0 && (membershipComplete !== true || readStateCoverage !== 'complete')) {
      failures.push('cluster feature with property_ids must have complete membership');
    }
  }

  return {
    contribution: {
      singleCount: groupKind === 'single' ? 1 : 0,
      clusterCount: groupKind === 'cluster' ? 1 : 0,
      activeCount: nodeClass === 'active' ? 1 : 0,
      ghostCount: nodeClass === 'ghost' ? 1 : 0,
      pointCount: Number.isInteger(pointCount) && pointCount > 0 ? pointCount : 0,
    },
    failures,
  };
}

export function assertEndpointSemanticCoverage(
  summaries: TileSemanticSummary[],
  allowAllEmpty = DEFAULT_ALLOWED_ALL_EMPTY
): ValidationFailure[] {
  if (allowAllEmpty) return [];

  const failures: ValidationFailure[] = [];
  const byEndpoint = new Map<string, TileSemanticSummary[]>();
  for (const summary of summaries) {
    const entries = byEndpoint.get(summary.endpoint) ?? [];
    entries.push(summary);
    byEndpoint.set(summary.endpoint, entries);
  }

  const requiredNonEmptyGroups: Array<{
    label: string;
    groups: Array<PropertyTileSample['semanticGroup']>;
  }> = [
    { label: 'low-zoom', groups: ['low-zoom', 'pyramid-edge'] },
    { label: 'pyramid-edge', groups: ['pyramid-edge'] },
    { label: 'transition', groups: ['transition'] },
    { label: 'detail', groups: ['detail'] },
    { label: 'ghost-reveal', groups: ['ghost-reveal'] },
  ];

  for (const [endpoint, entries] of byEndpoint) {
    const featureCount = entries.reduce((sum, entry) => sum + entry.featureCount, 0);
    const tile = entries.map((entry) => entry.tile).join(',');
    if (featureCount === 0) {
      failures.push({
        endpoint,
        tile,
        message: 'sample set did not return any properties-layer features; use --allow-all-empty only for empty fixtures',
      });
    }

    for (const requiredGroup of requiredNonEmptyGroups) {
      const groupEntries = entries.filter((entry) => requiredGroup.groups.includes(entry.semanticGroup));
      if (groupEntries.length === 0) {
        continue;
      }

      const groupFeatureCount = groupEntries.reduce((sum, entry) => sum + entry.featureCount, 0);
      if (groupFeatureCount === 0) {
        failures.push({
          endpoint,
          tile: groupEntries.map((entry) => entry.tile).join(','),
          message: `${requiredGroup.label} sample set did not return any properties-layer features`,
        });
      }
    }
  }

  return failures;
}

function decodePropertyFeatures(
  payload: Uint8Array,
  fail: (message: string) => void
): DecodedPropertyFeature[] {
  let tile: VectorTile;
  try {
    tile = new VectorTile(new Pbf(payload));
  } catch (error) {
    fail(`failed to decode MVT payload: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }

  const layer = tile.layers.properties;
  if (!layer) {
    fail(`properties layer missing; found layers: ${Object.keys(tile.layers).join(', ') || '(none)'}`);
    return [];
  }

  const features: DecodedPropertyFeature[] = [];
  for (let index = 0; index < layer.length; index += 1) {
    const vectorFeature = layer.feature(index);
    const geometry = vectorFeature.loadGeometry();
    const pointGeometryCount = geometry.reduce((sum, ring) => sum + ring.length, 0);
    features.push({
      index,
      type: vectorFeature.type,
      pointGeometryCount,
      properties: vectorFeature.properties,
    });
  }
  return features;
}

function validatePyramidHeaders(input: {
  endpoint: ValidationEndpoint;
  sample: PropertyTileSample;
  status: number;
  tileCache: string;
  tileStatus: string;
  pyramidVersion: string;
  fail: (message: string) => void;
  warn: (message: string) => void;
}) {
  const isPromotedStatus =
    input.tileStatus === 'pyramid-promoted' || input.tileStatus === 'pyramid-empty';
  const hasPyramidSignal = input.tileCache === 'precomputed' || isPromotedStatus;
  const enforceCandidateRouteContracts = input.endpoint.label !== 'main';

  if (enforceCandidateRouteContracts && input.sample.z <= 10) {
    const isPyramidCache = input.tileCache === 'precomputed' || input.tileCache === 'hit';
    if (!isPyramidCache || !input.pyramidVersion) {
      input.fail(
        `z${input.sample.z} candidate/current low-zoom sample must be served from the promoted pyramid; got x-tile-cache=${formatValue(input.tileCache)} and x-huishype-pyramid-version=${formatValue(input.pyramidVersion)}`
      );
    }
  }

  if (enforceCandidateRouteContracts && input.sample.z >= 11) {
    if (input.tileCache === 'precomputed' || isPromotedStatus || input.pyramidVersion) {
      input.fail(
        `z${input.sample.z} candidate/current sample must stay on the dynamic tile path; got x-tile-cache=${formatValue(input.tileCache)}, x-huishype-tile-status=${formatValue(input.tileStatus)}, x-huishype-pyramid-version=${formatValue(input.pyramidVersion)}`
      );
    }
  }

  if (!hasPyramidSignal) {
    if (input.pyramidVersion && input.tileCache === 'hit') {
      input.warn(
        'promoted pyramid tile was served from memory cache; restart the API to verify the first-response precomputed header contract'
      );
    }
    return;
  }

  if (input.tileCache !== 'precomputed') {
    input.fail(`promoted pyramid response must include x-tile-cache=precomputed, got ${formatValue(input.tileCache)}`);
  }
  if (!isPromotedStatus) {
    input.fail(
      `promoted pyramid response must include x-huishype-tile-status=pyramid-promoted|pyramid-empty, got ${formatValue(input.tileStatus)}`
    );
  }
  if (!input.pyramidVersion) {
    input.fail('promoted pyramid response must include x-huishype-pyramid-version');
  }
  if (input.tileStatus === 'pyramid-promoted' && input.status !== 200) {
    input.fail(`pyramid-promoted tile status must use HTTP 200, got ${input.status}`);
  }
  if (input.tileStatus === 'pyramid-empty' && input.status !== 204) {
    input.fail(`pyramid-empty tile status must use HTTP 204, got ${input.status}`);
  }
}

function validateClusterBbox(
  props: Record<string, number | string | boolean>,
  failures: string[]
) {
  const values = BBOX_FIELDS.map((field) => numericProperty(props, field));
  BBOX_FIELDS.forEach((field, index) => {
    if (!Number.isFinite(values[index])) {
      failures.push(`cluster feature ${field} must be a number, got ${formatValue(props[field])}`);
    }
  });
  const [west, south, east, north] = values;
  if (values.every(Number.isFinite)) {
    if (west > east) failures.push(`cluster bbox west must be <= east, got ${west} > ${east}`);
    if (south > north) failures.push(`cluster bbox south must be <= north, got ${south} > ${north}`);
    if (west < -180 || east > 180 || south < -90 || north > 90) {
      failures.push(`cluster bbox outside lon/lat range: ${values.join(',')}`);
    }
  }
}

function splitIds(value: string | undefined): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
  return value.split(',').map((id) => id.trim()).filter(Boolean);
}

function validateIdList(field: string, ids: string[], failures: string[]) {
  for (const id of ids) {
    if (!isUuid(id)) {
      failures.push(`${field} contains non-UUID value ${formatValue(id)}`);
    }
  }
}

function stringProperty(
  props: Record<string, number | string | boolean>,
  key: string
): string | undefined {
  const value = props[key];
  return typeof value === 'string' ? value : undefined;
}

function numericProperty(
  props: Record<string, number | string | boolean>,
  key: string
): number {
  const value = props[key];
  return typeof value === 'number' ? value : Number.NaN;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function formatValue(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}
