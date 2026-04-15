import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { startStaticWebServer } from './static-web-server.mjs';

async function withTempSite(files, run) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'huishype-static-server-'));

  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const absolutePath = path.join(rootDir, relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, contents);
    }

    await run(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function getAvailablePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to determine ephemeral port')));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

test('serves SPA fallback for non-asset client routes', async () => {
  await withTempSite(
    {
      'index.html': '<!doctype html><html><body>root shell</body></html>',
    },
    async (rootDir) => {
      const port = await getAvailablePort();
      const runtime = startStaticWebServer({
        port,
        rootDir,
        logger: { log() {}, error() {} },
      });

      try {
        await runtime.ready;

        const response = await fetch(`http://127.0.0.1:${port}/map/property/123`);
        const body = await response.text();

        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type') ?? '', /text\/html/);
        assert.equal(body, '<!doctype html><html><body>root shell</body></html>');
      } finally {
        await runtime.stop();
      }
    },
  );
});

test('returns 404 for unresolved asset-like paths instead of serving index.html', async () => {
  await withTempSite(
    {
      'index.html': '<!doctype html><html><body>root shell</body></html>',
      'assets/app.js': 'console.log("app");',
    },
    async (rootDir) => {
      const port = await getAvailablePort();
      const runtime = startStaticWebServer({
        port,
        rootDir,
        logger: { log() {}, error() {} },
      });

      try {
        await runtime.ready;

        const response = await fetch(`http://127.0.0.1:${port}/assets/missing.js`);
        const body = await response.text();

        assert.equal(response.status, 404);
        assert.match(response.headers.get('content-type') ?? '', /text\/plain/);
        assert.equal(body, 'Not Found');
      } finally {
        await runtime.stop();
      }
    },
  );
});

test('serves route templates for camera-style client routes containing decimal dots', async () => {
  await withTempSite(
    {
      'index.html': '<!doctype html><html><body>root shell</body></html>',
      '@[camera].html': '<!doctype html><html><body>camera shell</body></html>',
    },
    async (rootDir) => {
      const port = await getAvailablePort();
      const runtime = startStaticWebServer({
        port,
        rootDir,
        logger: { log() {}, error() {} },
      });

      try {
        await runtime.ready;

        const response = await fetch(`http://127.0.0.1:${port}/@51.4405702,5.4707418,13z`);
        const body = await response.text();

        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type') ?? '', /text\/html/);
        assert.equal(body, '<!doctype html><html><body>camera shell</body></html>');
      } finally {
        await runtime.stop();
      }
    },
  );
});
