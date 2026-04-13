import type { Feature } from 'geojson';

import {
  buildMapClickHitBox,
  prioritizeRenderedPropertyFeatures,
  queryPrioritizedRenderedPropertyFeatures,
} from '../mapClick';

function buildFeature(groupKind: 'cluster' | 'single', pointCount: number, id: string): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [5.4697, 51.4416],
    },
    properties: {
      node_class: 'active',
      group_kind: groupKind,
      primary_property_id: id,
      point_count: pointCount,
      property_ids: id,
    },
  } as Feature;
}

describe('prioritizeRenderedPropertyFeatures', () => {
  it('prefers cluster features over overlapping single nodes', () => {
    const single = buildFeature('single', 1, 'single-1');
    const cluster = buildFeature('cluster', 5, 'cluster-1');

    const prioritized = prioritizeRenderedPropertyFeatures([single, cluster]);

    expect(prioritized).toHaveLength(2);
    expect(prioritized[0]).toBe(cluster);
    expect(prioritized[1]).toBe(single);
  });

  it('keeps larger clusters ahead of smaller clusters', () => {
    const smallerCluster = buildFeature('cluster', 3, 'cluster-3');
    const largerCluster = buildFeature('cluster', 12, 'cluster-12');

    const prioritized = prioritizeRenderedPropertyFeatures([smallerCluster, largerCluster]);

    expect(prioritized).toHaveLength(2);
    expect(prioritized[0]).toBe(largerCluster);
    expect(prioritized[1]).toBe(smallerCluster);
  });

  it('drops non-property features from the click target list', () => {
    const single = buildFeature('single', 1, 'single-1');
    const nonProperty = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [5.4697, 51.4416],
      },
      properties: {
        node_class: 'other',
      },
    } as Feature;

    const prioritized = prioritizeRenderedPropertyFeatures([nonProperty, single]);

    expect(prioritized).toEqual([single]);
  });
});

describe('buildMapClickHitBox', () => {
  it('expands the click point into a deterministic square hit box', () => {
    expect(buildMapClickHitBox({ x: 100, y: 200 }, 12)).toEqual([
      [88, 188],
      [112, 212],
    ]);
  });
});

describe('queryPrioritizedRenderedPropertyFeatures', () => {
  it('queries a box around the click point and prioritizes the cluster result', () => {
    const cluster = buildFeature('cluster', 8, 'cluster-1');
    const single = buildFeature('single', 1, 'single-1');

    const map = {
      getLayer: jest.fn().mockReturnValue(true),
      queryRenderedFeatures: jest.fn().mockReturnValue([single, cluster]),
    };

    const prioritized = queryPrioritizedRenderedPropertyFeatures(
      map,
      { x: 64, y: 96 },
      ['property-clusters', 'active-nodes'],
      10,
    );

    expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
      [[54, 86], [74, 106]],
      { layers: ['property-clusters', 'active-nodes'] },
    );
    expect(prioritized[0]).toBe(cluster);
  });
});
