import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

const ATLAS_PATH = path.resolve(import.meta.dirname, '../../../../tree-atlas.png');
const SPRITES_DIR = path.resolve(import.meta.dirname, '../../sprites');

const GRID_COLS = 4;
const GRID_ROWS = 4;
const SPRITE_SIZE = 64; // Output size per sprite (px)

async function sliceAtlas() {
  const metadata = await sharp(ATLAS_PATH).metadata();
  const { width, height } = metadata;
  if (!width || !height) throw new Error('Cannot read atlas dimensions');

  const cellW = Math.floor(width / GRID_COLS);
  const cellH = Math.floor(height / GRID_ROWS);

  console.log(`Atlas: ${width}x${height}, cell: ${cellW}x${cellH}`);

  // Slice each cell
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const index = row * GRID_COLS + col;
      const outPath = path.join(SPRITES_DIR, `tree-${index}.png`);
      await sharp(ATLAS_PATH)
        .extract({ left: col * cellW, top: row * cellH, width: cellW, height: cellH })
        .resize(SPRITE_SIZE, SPRITE_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(outPath);
      console.log(`  tree-${index}.png`);
    }
  }

  // Merge into sprite sheet
  await mergeIntoSpriteSheet(SPRITE_SIZE);
}

async function mergeIntoSpriteSheet(spriteSize: number) {
  for (const suffix of ['', '@2x']) {
    const pngPath = path.join(SPRITES_DIR, `ofm${suffix}.png`);
    const jsonPath = path.join(SPRITES_DIR, `ofm${suffix}.json`);

    const manifest: Record<string, { height: number; width: number; x: number; y: number; pixelRatio: number }> =
      JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

    const existingMeta = await sharp(pngPath).metadata();
    const existingW = existingMeta.width!;
    const existingH = existingMeta.height!;
    const pixelRatio = suffix === '@2x' ? 2 : 1;
    const actualSpriteSize = spriteSize * pixelRatio;

    // Arrange tree sprites in a row below existing sheet
    const treeRowWidth = GRID_COLS * GRID_ROWS * actualSpriteSize;
    const newWidth = Math.max(existingW, treeRowWidth);
    const newHeight = existingH + actualSpriteSize;

    // Build tree sprite composites
    const treeComposites: sharp.OverlayOptions[] = [];
    for (let i = 0; i < GRID_COLS * GRID_ROWS; i++) {
      const treePath = path.join(SPRITES_DIR, `tree-${i}.png`);
      const resized = await sharp(treePath)
        .resize(actualSpriteSize, actualSpriteSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      treeComposites.push({
        input: resized,
        left: i * actualSpriteSize,
        top: existingH,
      });
      manifest[`tree-${i}`] = {
        height: actualSpriteSize,
        width: actualSpriteSize,
        x: i * actualSpriteSize,
        y: existingH,
        pixelRatio,
      };
    }

    // Create blank canvas and composite existing sheet + tree sprites
    const existingBuffer = await sharp(pngPath).png().toBuffer();
    await sharp({
      create: {
        width: newWidth,
        height: newHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        { input: existingBuffer, left: 0, top: 0 },
        ...treeComposites,
      ])
      .png()
      .toFile(pngPath + '.tmp');

    // Rename tmp to final (sharp can't read and write same file in one pipeline)
    fs.renameSync(pngPath + '.tmp', pngPath);
    fs.writeFileSync(jsonPath, JSON.stringify(manifest, null, 2));
    console.log(`Updated ${pngPath} (${newWidth}x${newHeight}) and ${jsonPath}`);
  }
}

sliceAtlas().catch(console.error);
