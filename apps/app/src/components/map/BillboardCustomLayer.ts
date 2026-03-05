import type maplibregl from 'maplibre-gl';

interface BillboardLayerConfig {
  id: string;
  atlasUrl: string;
  gridCols: number;
  gridRows: number;
  /** Vector tile source ID containing scattered tree points */
  sourceId: string;
  /** Source layer name within the vector tiles */
  sourceLayer: string;
  /** Feature property name for tree variant index */
  variantProperty: string;
  /** Size of billboard in pixels (used for atlas resolution, not world scale) */
  size: number;
  minZoom: number;
  /** Billboard height in meters (default: 10) */
  heightMeters?: number;
}

interface TreePoint {
  x: number; // Mercator x
  y: number; // Mercator y
  variant: number;
}

// Vertex shader: billboard quads that face the camera
// CRITICAL: Vertical offset uses Z axis (altitude in Mercator space), NOT Y (north-south)
const VERT_SHADER = `
  attribute vec2 a_pos;
  attribute vec2 a_texcoord;

  uniform mat4 u_matrix;
  uniform vec2 u_position;
  uniform float u_size;
  uniform float u_bearing;
  uniform vec2 u_grid;
  uniform float u_variant;

  varying vec2 v_texcoord;

  void main() {
    // Billboard: offset quad corners in Mercator space
    // Horizontal offset rotated by bearing to face camera
    float cb = cos(-u_bearing);
    float sb = sin(-u_bearing);
    vec2 horizontalOffset = vec2(
      a_pos.x * cb,
      a_pos.x * sb
    ) * u_size;

    // Vertical offset uses Z axis (altitude in Mercator space)
    float verticalOffset = a_pos.y * u_size;

    vec4 worldPos = vec4(
      u_position.x + horizontalOffset.x,
      u_position.y + horizontalOffset.y,
      verticalOffset,
      1.0
    );

    gl_Position = u_matrix * worldPos;

    // Calculate atlas UV from variant and grid
    float col = mod(u_variant, u_grid.x);
    float row = floor(u_variant / u_grid.x);
    float cellW = 1.0 / u_grid.x;
    float cellH = 1.0 / u_grid.y;
    v_texcoord = vec2(
      (col + a_texcoord.x) * cellW,
      (row + a_texcoord.y) * cellH
    );
  }
`;

// Fragment shader: sample atlas texture, discard transparent pixels
const FRAG_SHADER = `
  precision mediump float;

  uniform sampler2D u_atlas;

  varying vec2 v_texcoord;

  void main() {
    vec4 color = texture2D(u_atlas, v_texcoord);
    if (color.a < 0.1) discard;
    gl_FragColor = color;
  }
`;

// Unit quad vertices (two triangles), bottom-anchored: x in [-0.5, 0.5], y in [0, 1]
const QUAD_VERTICES = new Float32Array([
  -0.5, 0.0, 0.5, 0.0, 0.5, 1.0, -0.5, 0.0, 0.5, 1.0, -0.5, 1.0,
]);

// Tex coords matching quad vertices
const QUAD_TEXCOORDS = new Float32Array([
  0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0,
]);

export class BillboardCustomLayer implements maplibregl.CustomLayerInterface {
  id: string;
  type: 'custom' = 'custom';
  renderingMode: '3d' = '3d';

  private config: BillboardLayerConfig;
  private map: maplibregl.Map | null = null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private textureLoaded = false;
  private vertexBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;

  // Uniform locations (cached after program creation)
  private uniformLocations: Record<string, WebGLUniformLocation | null> = {};
  private attribLocations: Record<string, number> = {};

  // Cached source features
  private cachedPoints: TreePoint[] = [];
  private cacheKey = '';
  private onSourceData: ((e: maplibregl.MapSourceDataEvent) => void) | null = null;

  constructor(config: BillboardLayerConfig) {
    this.id = config.id;
    this.config = config;
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext): void {
    this.map = map;
    this.program = this.createProgram(gl);
    if (this.program) {
      this.cacheLocations(gl);
    }
    this.texture = this.loadTexture(gl);
    this.vertexBuffer = gl.createBuffer();
    this.texCoordBuffer = gl.createBuffer();

    // Upload static quad geometry once
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_TEXCOORDS, gl.STATIC_DRAW);

    // Trigger repaint when tree-source tiles finish loading so render()
    // picks up the newly available features via querySourceFeatures.
    this.onSourceData = (e: maplibregl.MapSourceDataEvent) => {
      if (e.sourceId === this.config.sourceId && e.isSourceLoaded) {
        this.cacheKey = ''; // invalidate cache
        map.triggerRepaint();
      }
    };
    map.on('sourcedata', this.onSourceData);
  }

  render(gl: WebGLRenderingContext, options: maplibregl.CustomRenderMethodInput): void {
    if (!this.program || !this.map || !this.textureLoaded) return;

    const zoom = this.map.getZoom();
    if (zoom < this.config.minZoom) return;

    // Refresh tree points when map moves or tiles finish loading
    const center = this.map.getCenter();
    const newCacheKey = `${center.lng.toFixed(4)},${center.lat.toFixed(4)},${zoom.toFixed(1)}`;
    if (newCacheKey !== this.cacheKey || this.cachedPoints.length === 0) {
      this.cacheKey = newCacheKey;
      this.cachedPoints = this.getTreePointsFromSource();
    }

    if (this.cachedPoints.length === 0) return;

    // --- Save GL state ---
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
    const prevDepthTest = gl.isEnabled(gl.DEPTH_TEST);
    const prevDepthFunc = gl.getParameter(gl.DEPTH_FUNC);
    const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
    const prevBlend = gl.isEnabled(gl.BLEND);
    const prevBlendSrcRGB = gl.getParameter(gl.BLEND_SRC_RGB);
    const prevBlendDstRGB = gl.getParameter(gl.BLEND_DST_RGB);
    const prevBlendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA);
    const prevBlendDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA);
    const prevActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
    const prevBoundTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    const prevAttrib0Enabled = gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_ENABLED);
    const prevAttrib1Enabled = gl.getVertexAttrib(1, gl.VERTEX_ATTRIB_ARRAY_ENABLED);

    // --- Set up render state ---
    gl.useProgram(this.program);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Bind atlas texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniformLocations.u_atlas, 0);

    // Full model-view-projection matrix that transforms Mercator [0,1] to clip space.
    // `projectionMatrix` is ONLY the perspective projection; `defaultProjectionData.mainMatrix`
    // includes the camera transform and is what custom layers need for Mercator coordinates.
    const mvpMatrix = (options.defaultProjectionData as unknown as { mainMatrix: unknown })?.mainMatrix
      ?? options.projectionMatrix;
    gl.uniformMatrix4fv(
      this.uniformLocations.u_matrix,
      false,
      mvpMatrix as unknown as Float32Array,
    );

    // Grid dimensions
    gl.uniform2f(this.uniformLocations.u_grid, this.config.gridCols, this.config.gridRows);

    // Tree size in Mercator units, with zoom-interpolated scaling.
    // Base height at z15 grows with zoom so trees maintain visual prominence.
    const lat = this.map.getCenter().lat;
    const metersPerMercator = 40075016.686 * Math.cos(lat * (Math.PI / 180));
    const zoomScale = Math.min(Math.pow(1.3, zoom - 15), 2.5); // 1x@z15, 1.3x@z16, 1.7x@z17, capped at 2.5x
    const heightMeters = (this.config.heightMeters ?? 10) * zoomScale;
    const sizeInMercator = heightMeters / metersPerMercator;
    gl.uniform1f(this.uniformLocations.u_size, sizeInMercator);

    // Camera bearing for billboard orientation
    const bearing = this.map.getBearing() * (Math.PI / 180);
    gl.uniform1f(this.uniformLocations.u_bearing, bearing);

    // Bind vertex buffers
    const posLoc = this.attribLocations.a_pos;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const texLoc = this.attribLocations.a_texcoord;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

    // Render each tree
    for (const point of this.cachedPoints) {
      gl.uniform2f(this.uniformLocations.u_position, point.x, point.y);
      gl.uniform1f(this.uniformLocations.u_variant, point.variant);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // --- Restore GL state ---
    gl.disableVertexAttribArray(posLoc);
    gl.disableVertexAttribArray(texLoc);
    if (prevAttrib0Enabled) gl.enableVertexAttribArray(0);
    if (prevAttrib1Enabled) gl.enableVertexAttribArray(1);
    gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuffer);
    gl.useProgram(prevProgram);
    if (prevDepthTest) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    gl.depthFunc(prevDepthFunc);
    gl.depthMask(prevDepthMask);
    if (prevBlend) gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
    gl.blendFuncSeparate(prevBlendSrcRGB, prevBlendDstRGB, prevBlendSrcAlpha, prevBlendDstAlpha);
    gl.activeTexture(prevActiveTexture);
    gl.bindTexture(gl.TEXTURE_2D, prevBoundTexture);
  }

  onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext): void {
    if (this.map && this.onSourceData) {
      this.map.off('sourcedata', this.onSourceData);
      this.onSourceData = null;
    }
    if (this.program) gl.deleteProgram(this.program);
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
    if (this.texCoordBuffer) gl.deleteBuffer(this.texCoordBuffer);
    this.program = null;
    this.texture = null;
    this.vertexBuffer = null;
    this.texCoordBuffer = null;
    this.map = null;
  }

  private getTreePointsFromSource(): TreePoint[] {
    if (!this.map) return [];

    const features = this.map.querySourceFeatures(this.config.sourceId, {
      sourceLayer: this.config.sourceLayer,
    });

    if (features.length === 0) return [];

    // Deduplicate by rounding Mercator coords (vector tiles can have dupes across tile boundaries)
    const seen = new Set<string>();
    const points: TreePoint[] = [];

    for (const f of features) {
      if (f.geometry.type !== 'Point') continue;
      const coords = (f.geometry as GeoJSON.Point).coordinates;
      const mercator = this.lngLatToMercator(coords[0], coords[1]);

      // Round to 10 decimal places for dedup key
      const key = `${mercator.x.toFixed(10)},${mercator.y.toFixed(10)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      points.push({
        x: mercator.x,
        y: mercator.y,
        variant: (f.properties?.[this.config.variantProperty] as number) ?? 0,
      });
    }

    return points;
  }

  /** Fallback Mercator projection when maplibregl global isn't available */
  private lngLatToMercator(
    lng: number,
    lat: number
  ): { x: number; y: number } {
    const x = (lng + 180) / 360;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
    return { x, y };
  }

  private cacheLocations(gl: WebGLRenderingContext): void {
    if (!this.program) return;
    const uniforms = [
      'u_matrix',
      'u_position',
      'u_size',
      'u_bearing',
      'u_grid',
      'u_variant',
      'u_atlas',
    ];
    for (const name of uniforms) {
      this.uniformLocations[name] = gl.getUniformLocation(this.program, name);
    }
    this.attribLocations.a_pos = gl.getAttribLocation(this.program, 'a_pos');
    this.attribLocations.a_texcoord = gl.getAttribLocation(
      this.program,
      'a_texcoord'
    );
  }

  private createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
    const vert = gl.createShader(gl.VERTEX_SHADER);
    if (!vert) return null;
    gl.shaderSource(vert, VERT_SHADER);
    gl.compileShader(vert);
    if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
      console.error(
        '[BillboardCustomLayer] Vertex shader error:',
        gl.getShaderInfoLog(vert)
      );
      gl.deleteShader(vert);
      return null;
    }

    const frag = gl.createShader(gl.FRAGMENT_SHADER);
    if (!frag) {
      gl.deleteShader(vert);
      return null;
    }
    gl.shaderSource(frag, FRAG_SHADER);
    gl.compileShader(frag);
    if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
      console.error(
        '[BillboardCustomLayer] Fragment shader error:',
        gl.getShaderInfoLog(frag)
      );
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      return null;
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      return null;
    }
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(
        '[BillboardCustomLayer] Program link error:',
        gl.getProgramInfoLog(program)
      );
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      return null;
    }

    // Shaders can be detached and deleted after linking
    gl.detachShader(program, vert);
    gl.detachShader(program, frag);
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    return program;
  }

  private loadTexture(gl: WebGLRenderingContext): WebGLTexture | null {
    const texture = gl.createTexture();
    if (!texture) return null;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Placeholder 1x1 transparent pixel until image loads
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0])
    );

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textureLoaded = true;
      this.map?.triggerRepaint();
    };
    image.src = this.config.atlasUrl;

    return texture;
  }
}
