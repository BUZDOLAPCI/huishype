#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
}

const maestro = run('maestro', ['test', 'apps/app/e2e/mobile/full-flow.yaml']);
if (maestro.error) {
  console.error(maestro.error.message);
  process.exitCode = 1;
} else if (typeof maestro.status === 'number') {
  process.exitCode = maestro.status;
}

const finalize = run('node', ['./scripts/visual-overhaul/finalize-mobile-artifacts.mjs']);
if (finalize.error) {
  console.error(finalize.error.message);
  process.exitCode = 1;
} else if (typeof finalize.status === 'number' && finalize.status !== 0 && process.exitCode === 0) {
  process.exitCode = finalize.status;
}
