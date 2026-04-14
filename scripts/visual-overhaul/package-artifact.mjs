#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const VISUAL_OVERHAUL_ROOT = path.join(REPO_ROOT, 'test-results', 'visual-overhaul');

function usage() {
  console.error(
    [
      'Usage:',
      '  node scripts/visual-overhaul/package-artifact.mjs \\',
      '    --surface <surface> [--source <file>] [--name <file>] [--note <text>]',
      '',
      'Examples:',
      '  node scripts/visual-overhaul/package-artifact.mjs --surface map-screen \\',
      '    --note "Wide web capture imported manually from a debugging session"',
    ].join('\n')
  );
}

function parseArgs(argv) {
  const args = {
    notes: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    index += 1;

    if (key === 'note') {
      args.notes.push(value);
      continue;
    }

    args[key] = value;
  }

  return args;
}

function toRelative(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
}

async function ensureSurface(surface) {
  await Promise.all([
    fs.mkdir(path.join(VISUAL_OVERHAUL_ROOT, surface, 'web'), { recursive: true }),
  ]);

  const notesPath = path.join(VISUAL_OVERHAUL_ROOT, surface, 'notes.md');
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

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    usage();
    console.error(`\n${error.message}`);
    process.exitCode = 1;
    return;
  }

  const surface = args.surface;

  if (!surface) {
    usage();
    console.error('\n--surface is required.');
    process.exitCode = 1;
    return;
  }

  if (args.platform) {
    usage();
    console.error('\n--platform is no longer supported; web artifacts are the only active path.');
    process.exitCode = 1;
    return;
  }

  const notesPath = await ensureSurface(surface);
  const platform = 'web';
  const platformDir = path.join(VISUAL_OVERHAUL_ROOT, surface, platform);

  let destinationPath = null;
  if (args.source) {
    const sourcePath = path.resolve(REPO_ROOT, args.source);
    const sourceStat = await fs.stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) {
      throw new Error(`Source file not found: ${sourcePath}`);
    }

    const targetName = args.name ?? path.basename(sourcePath);
    destinationPath = path.join(platformDir, targetName);
    await fs.copyFile(sourcePath, destinationPath);
  } else if (args.name) {
    destinationPath = path.join(platformDir, args.name);
  }

  const lines = [
    '',
    `## ${new Date().toISOString()} - ${platform.toUpperCase()} artifact import`,
    `- Platform: \`${platform}\``,
  ];

  if (destinationPath) {
    lines.push(`- Artifact: \`${toRelative(destinationPath)}\``);
  }

  if (args.source) {
    lines.push(`- Source: \`${toRelative(path.resolve(REPO_ROOT, args.source))}\``);
  }

  for (const note of args.notes) {
    lines.push(`- ${note}`);
  }

  await fs.appendFile(notesPath, `${lines.join('\n')}\n`, 'utf8');

  if (destinationPath) {
    console.log(toRelative(destinationPath));
  } else {
    console.log(toRelative(notesPath));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
