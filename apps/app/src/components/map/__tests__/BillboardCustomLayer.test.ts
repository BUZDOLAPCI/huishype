import { BillboardCustomLayer } from '../BillboardCustomLayer';

const defaultConfig = {
  id: 'test-trees',
  atlasUrl: 'http://localhost:3100/sprites/tree-atlas.png',
  gridCols: 4,
  gridRows: 4,
  sourceId: 'tree-source',
  sourceLayer: 'scattered-trees',
  variantProperty: 'tree_variant',
  size: 64,
  minZoom: 15,
};

describe('BillboardCustomLayer', () => {
  test('creates with correct id and type', () => {
    const layer = new BillboardCustomLayer(defaultConfig);
    expect(layer.id).toBe('test-trees');
    expect(layer.type).toBe('custom');
    expect(layer.renderingMode).toBe('3d');
  });

  test('implements CustomLayerInterface methods', () => {
    const layer = new BillboardCustomLayer(defaultConfig);
    expect(typeof layer.onAdd).toBe('function');
    expect(typeof layer.render).toBe('function');
    expect(typeof layer.onRemove).toBe('function');
  });

  test('uses config id as layer id', () => {
    const layer = new BillboardCustomLayer({ ...defaultConfig, id: 'my-layer' });
    expect(layer.id).toBe('my-layer');
  });

  test('render returns early when program is null (before onAdd)', () => {
    const layer = new BillboardCustomLayer(defaultConfig);
    // Should not throw when called before onAdd
    expect(() => {
      layer.render(
        {} as WebGLRenderingContext,
        { projectionMatrix: new Float64Array(16) } as any,
      );
    }).not.toThrow();
  });

  test('onRemove cleans up without errors when called before onAdd', () => {
    const layer = new BillboardCustomLayer(defaultConfig);
    expect(() => {
      layer.onRemove(
        {} as any,
        { deleteProgram: jest.fn(), deleteTexture: jest.fn(), deleteBuffer: jest.fn() } as any,
      );
    }).not.toThrow();
  });
});
