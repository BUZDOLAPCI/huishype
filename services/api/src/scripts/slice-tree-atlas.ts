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

  // Slice each cell, trim transparent padding, and anchor at bottom-center
  // so the trunk touches the very bottom pixel row (Paper Mario "rooted" look)
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const index = row * GRID_COLS + col;
      const outPath = path.join(SPRITES_DIR, `tree-${index}.png`);

      // Extract cell, remove white background, trim transparent padding
      const cell = await sharp(ATLAS_PATH)
        .extract({ left: col * cellW, top: row * cellH, width: cellW, height: cellH })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Find bounding box of non-white/non-transparent pixels
      const cw = cell.info.width;
      const ch = cell.info.height;
      const px = cell.data; // RGBA raw pixels
      let minX = cw, minY = ch, maxX = 0, maxY = 0;
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const i = (y * cw + x) * 4;
          const r = px[i], g = px[i+1], b = px[i+2], a = px[i+3];
          // Skip near-white and transparent pixels (background)
          if (a < 10 || (r > 240 && g > 240 && b > 240)) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }

      const tw = maxX - minX + 1;
      const th = maxY - minY + 1;

      const trimmed = await sharp(ATLAS_PATH)
        .extract({ left: col * cellW + minX, top: row * cellH + minY, width: tw, height: th })
        .ensureAlpha()
        .toBuffer({ resolveWithObject: true });

      // Scale to fit within SPRITE_SIZE preserving aspect ratio
      const scale = Math.min(SPRITE_SIZE / tw, SPRITE_SIZE / th);
      const scaledW = Math.round(tw * scale);
      const scaledH = Math.round(th * scale);

      const resized = await sharp(trimmed.data)
        .resize(scaledW, scaledH)
        .toBuffer();

      // Place on canvas: horizontally centered, vertically anchored at bottom
      await sharp({
        create: {
          width: SPRITE_SIZE,
          height: SPRITE_SIZE,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: resized, left: Math.round((SPRITE_SIZE - scaledW) / 2), top: SPRITE_SIZE - scaledH }])
        .png()
        .toFile(outPath);

      console.log(`  tree-${index}.png (${tw}x${th} trimmed → ${scaledW}x${scaledH} anchored bottom)`);
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
