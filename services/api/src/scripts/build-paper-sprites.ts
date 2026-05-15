import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const ROOT_DIR = path.resolve(import.meta.dirname, '../../../..');
const SPRITES_DIR = path.resolve(import.meta.dirname, '../../sprites');
const DUCK_ATLAS_PATH = path.join(ROOT_DIR, 'duck-atlas.png');
const SPRITE_SIZE = 64;
const DUCK_ATLAS_GRID_COLS = 4;
const DUCK_ATLAS_GRID_ROWS = 4;
const DUCK_COUNT = DUCK_ATLAS_GRID_COLS * DUCK_ATLAS_GRID_ROWS;

type SpriteManifestEntry = {
  height: number;
  width: number;
  x: number;
  y: number;
  pixelRatio: number;
};

type RawImage = {
  data: Buffer;
  info: {
    width: number;
    height: number;
    channels: number;
  };
};

function colorDistance(
  r: number,
  g: number,
  b: number,
  bgR: number,
  bgG: number,
  bgB: number
): number {
  return Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
}

function estimateBackground(cell: RawImage): [number, number, number] {
  const { data, info } = cell;
  const samples: Array<[number, number, number]> = [];
  const sampleSize = Math.max(8, Math.floor(Math.min(info.width, info.height) * 0.04));
  const corners = [
    [0, 0],
    [info.width - sampleSize, 0],
    [0, info.height - sampleSize],
    [info.width - sampleSize, info.height - sampleSize],
  ];

  for (const [startX, startY] of corners) {
    for (let y = startY; y < startY + sampleSize; y++) {
      for (let x = startX; x < startX + sampleSize; x++) {
        const i = (y * info.width + x) * info.channels;
        samples.push([data[i], data[i + 1], data[i + 2]]);
      }
    }
  }

  const totals = samples.reduce(
    (sum, [r, g, b]) => [sum[0] + r, sum[1] + g, sum[2] + b],
    [0, 0, 0]
  );
  return [
    Math.round(totals[0] / samples.length),
    Math.round(totals[1] / samples.length),
    Math.round(totals[2] / samples.length),
  ];
}

function findConnectedBackground(cell: RawImage, bg: [number, number, number]): Uint8Array {
  const { data, info } = cell;
  const pixelCount = info.width * info.height;
  const visited = new Uint8Array(pixelCount);
  const stack: number[] = [];

  function isBackgroundCandidate(index: number): boolean {
    const offset = index * info.channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];
    if (a < 10) return true;
    if (r > 248 && g > 248 && b > 248) return true;
    return Math.min(r, g, b) > 220 && colorDistance(r, g, b, bg[0], bg[1], bg[2]) < 30;
  }

  function pushIfBackground(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) return;
    const index = y * info.width + x;
    if (visited[index] || !isBackgroundCandidate(index)) return;
    visited[index] = 1;
    stack.push(index);
  }

  for (let x = 0; x < info.width; x++) {
    pushIfBackground(x, 0);
    pushIfBackground(x, info.height - 1);
  }
  for (let y = 0; y < info.height; y++) {
    pushIfBackground(0, y);
    pushIfBackground(info.width - 1, y);
  }

  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined) break;
    const x = index % info.width;
    const y = Math.floor(index / info.width);
    pushIfBackground(x + 1, y);
    pushIfBackground(x - 1, y);
    pushIfBackground(x, y + 1);
    pushIfBackground(x, y - 1);
  }

  return visited;
}

function findForegroundBounds(cell: RawImage, background: Uint8Array) {
  const { data, info } = cell;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const index = y * info.width + x;
      const alpha = data[index * info.channels + 3];
      if (alpha < 10 || background[index]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error('Could not find foreground pixels in duck atlas cell');
  }

  const padding = 2;
  return {
    left: Math.max(0, minX - padding),
    top: Math.max(0, minY - padding),
    width: Math.min(info.width - Math.max(0, minX - padding), maxX - minX + 1 + padding * 2),
    height: Math.min(info.height - Math.max(0, minY - padding), maxY - minY + 1 + padding * 2),
  };
}

async function sliceDuckAtlas(): Promise<string[]> {
  const metadata = await sharp(DUCK_ATLAS_PATH).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Cannot read atlas dimensions for ${DUCK_ATLAS_PATH}`);
  }

  const cellWidth = Math.floor(metadata.width / DUCK_ATLAS_GRID_COLS);
  const cellHeight = Math.floor(metadata.height / DUCK_ATLAS_GRID_ROWS);
  const spriteNames: string[] = [];

  for (let index = 0; index < DUCK_COUNT; index++) {
    const row = Math.floor(index / DUCK_ATLAS_GRID_COLS);
    const col = index % DUCK_ATLAS_GRID_COLS;
    const spriteName = `duck-${index}`;
    const cell = await sharp(DUCK_ATLAS_PATH)
      .extract({
        left: col * cellWidth,
        top: row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const background = findConnectedBackground(cell, estimateBackground(cell));
    const bounds = findForegroundBounds(cell, background);
    const trimmed = Buffer.alloc(bounds.width * bounds.height * cell.info.channels);

    for (let y = 0; y < bounds.height; y++) {
      for (let x = 0; x < bounds.width; x++) {
        const srcX = bounds.left + x;
        const srcY = bounds.top + y;
        const srcIndex = srcY * cell.info.width + srcX;
        const srcOffset = srcIndex * cell.info.channels;
        const destOffset = (y * bounds.width + x) * cell.info.channels;
        trimmed[destOffset] = cell.data[srcOffset];
        trimmed[destOffset + 1] = cell.data[srcOffset + 1];
        trimmed[destOffset + 2] = cell.data[srcOffset + 2];
        trimmed[destOffset + 3] = background[srcIndex] ? 0 : cell.data[srcOffset + 3];
      }
    }

    await sharp(trimmed, {
      raw: {
        width: bounds.width,
        height: bounds.height,
        channels: cell.info.channels,
      },
    })
      .resize(SPRITE_SIZE, SPRITE_SIZE, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(path.join(SPRITES_DIR, `${spriteName}.png`));

    spriteNames.push(spriteName);
    console.log(`Sliced ${spriteName} from duck atlas cell ${col},${row}`);
  }

  return spriteNames;
}

async function mergePaperSprites(spriteNames: string[]): Promise<void> {
  for (const suffix of ['', '@2x']) {
    const pngPath = path.join(SPRITES_DIR, `ofm${suffix}.png`);
    const jsonPath = path.join(SPRITES_DIR, `ofm${suffix}.json`);
    const manifest = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<
      string,
      SpriteManifestEntry
    >;
    const existingMeta = await sharp(pngPath).metadata();
    const existingW = existingMeta.width;
    if (!existingW) {
      throw new Error(`Cannot read sprite sheet dimensions for ${pngPath}`);
    }

    const pixelRatio = suffix === '@2x' ? 2 : 1;
    const actualSpriteSize = SPRITE_SIZE * pixelRatio;

    for (const spriteName of spriteNames) {
      delete manifest[spriteName];
    }

    const baseHeight = Math.max(
      ...Object.values(manifest).map((entry) => entry.y + entry.height),
      0
    );
    const baseBuffer = await sharp(pngPath)
      .extract({ left: 0, top: 0, width: existingW, height: baseHeight })
      .png()
      .toBuffer();

    const columns = Math.max(1, Math.floor(existingW / actualSpriteSize));
    const rows = Math.ceil(spriteNames.length / columns);
    const newWidth = Math.max(existingW, columns * actualSpriteSize);
    const newHeight = baseHeight + rows * actualSpriteSize;

    const composites: sharp.OverlayOptions[] = [{ input: baseBuffer, left: 0, top: 0 }];
    for (let i = 0; i < spriteNames.length; i++) {
      const spriteName = spriteNames[i];
      const spritePath = path.join(SPRITES_DIR, `${spriteName}.png`);
      const resized = await sharp(spritePath)
        .resize(actualSpriteSize, actualSpriteSize, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      const x = (i % columns) * actualSpriteSize;
      const y = baseHeight + Math.floor(i / columns) * actualSpriteSize;

      composites.push({ input: resized, left: x, top: y });
      manifest[spriteName] = {
        height: actualSpriteSize,
        width: actualSpriteSize,
        x,
        y,
        pixelRatio,
      };
    }

    await sharp({
      create: {
        width: newWidth,
        height: newHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(composites)
      .png()
      .toFile(`${pngPath}.tmp`);

    fs.renameSync(`${pngPath}.tmp`, pngPath);
    fs.writeFileSync(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

async function main(): Promise<void> {
  const duckSprites = await sliceDuckAtlas();
  await mergePaperSprites(duckSprites);
  console.log(`Sliced and merged ${DUCK_COUNT} duck sprites from ${DUCK_ATLAS_PATH}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
