#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const VISUAL_OVERHAUL_ROOT = path.join(REPO_ROOT, 'test-results', 'visual-overhaul');

function toRelative(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
}

async function ensureSurface(surface) {
  const surfaceDir = path.join(VISUAL_OVERHAUL_ROOT, surface);
  await Promise.all([
    fs.mkdir(path.join(surfaceDir, 'web'), { recursive: true }),
    fs.mkdir(path.join(surfaceDir, 'android'), { recursive: true }),
  ]);

  const notesPath = path.join(surfaceDir, 'notes.md');
  try {
    await fs.access(notesPath);
  } catch {
    await fs.writeFile(
      notesPath,
      `# ${surface}\n\nVisual overhaul evidence log for this surface.\n`,
      'utf8'
    );
  }

  return notesPath;
}

async function appendSurfaceNotes(surface, files) {
  const notesPath = await ensureSurface(surface);
  const timestamp = new Date().toISOString();
  const lines = [
    '',
    `## ${timestamp} - ANDROID capture sweep`,
    '- Platform: `android`',
    ...files.map((file) => `- Artifact: \`${toRelative(file)}\``),
  ];

  await fs.appendFile(notesPath, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const entries = await fs.readdir(VISUAL_OVERHAUL_ROOT, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const surface = entry.name;
    const androidDir = path.join(VISUAL_OVERHAUL_ROOT, surface, 'android');
    const pngFiles = await fs.readdir(androidDir).catch(() => []);
    const screenshots = pngFiles
      .filter((file) => file.endsWith('.png'))
      .map((file) => path.join(androidDir, file));

    if (screenshots.length === 0) continue;

    await appendSurfaceNotes(surface, screenshots);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
