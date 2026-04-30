import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureDefaultStorageState } from './config.mjs';

test('ensureDefaultStorageState dismisses the welcome modal for the runtime origin', async () => {
  const artifactRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'huishype-playwright-storage-'));

  try {
    const storageStatePath = ensureDefaultStorageState({
      artifactRoot,
      webOrigin: 'http://127.0.0.1:8123',
    });
    const storageState = JSON.parse(await fs.readFile(storageStatePath, 'utf8'));

    assert.deepEqual(storageState, {
      cookies: [],
      origins: [
        {
          origin: 'http://127.0.0.1:8123',
          localStorage: [
            {
              name: 'huishype_welcome_modal_dismissed_v1',
              value: '1',
            },
          ],
        },
      ],
    });
  } finally {
    await fs.rm(artifactRoot, { recursive: true, force: true });
  }
});
