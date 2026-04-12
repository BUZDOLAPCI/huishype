import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { gzipSync } from 'node:zlib';
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

test('serves the exported catchall document for deep canonical client routes', async () => {
  await withTempSite(
    {
      'index.html': '<!doctype html><html><body>root shell</body></html>',
      '[...address].html': '<!doctype html><html><body>address shell</body></html>',
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

        for (const pathname of ['/eindhoven', '/de/allee-des-pervenches-4-c046-1070-anderlecht']) {
          const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
          const body = await response.text();

          assert.equal(response.status, 200);
          assert.match(response.headers.get('content-type') ?? '', /text\/html/);
          assert.equal(body, '<!doctype html><html><body>address shell</body></html>');
        }
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

test('proxies /api requests to the configured API origin', async () => {
  const apiServer = createHttpServer((request, response) => {
    if (request.url === '/health') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
  const apiAddress = apiServer.address();
  if (!apiAddress || typeof apiAddress === 'string') {
    throw new Error('Unable to determine API server port');
  }

  await withTempSite(
    {
      'index.html': '<!doctype html><html><body>root shell</body></html>',
    },
    async (rootDir) => {
      const port = await getAvailablePort();
      const runtime = startStaticWebServer({
        port,
        rootDir,
        apiProxyTarget: `http://127.0.0.1:${apiAddress.port}`,
        logger: { log() {}, error() {} },
      });

      try {
        await runtime.ready;

        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(body, { ok: true });
      } finally {
        await runtime.stop();
      }
    },
  );

  await new Promise((resolve) => apiServer.close(resolve));
});

test('falls back to the SPA entrypoint when a route HTML file cannot be streamed', async () => {
  await withTempSite(
    {
      'index.html': '<!doctype html><html><body>root shell</body></html>',
      '[...address].html': '<!doctype html><html><body>catchall shell</body></html>',
    },
    async (rootDir) => {
      const protectedPath = path.join(rootDir, '[...address].html');
      await fs.chmod(protectedPath, 0o000);

      const port = await getAvailablePort();
      const runtime = startStaticWebServer({
        port,
        rootDir,
        logger: { log() {}, error() {} },
      });

      try {
        await runtime.ready;

        const response = await fetch(`http://127.0.0.1:${port}/definitely-not-a-real-place/0000zz`);
        const body = await response.text();

        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type') ?? '', /text\/html/);
        assert.equal(body, '<!doctype html><html><body>root shell</body></html>');
      } finally {
        await fs.chmod(protectedPath, 0o644).catch(() => {});
        await runtime.stop();
      }
    },
  );
});

test('strips decoded content-encoding and content-length from proxied API responses', async () => {
  const payload = JSON.stringify({ ok: true, message: 'compressed response' });
  const compressed = gzipSync(payload);

  const apiServer = createHttpServer((request, response) => {
    if (request.url === '/compressed') {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Content-Encoding', 'gzip');
      response.setHeader('Content-Length', String(compressed.length));
      response.end(compressed);
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
  const apiAddress = apiServer.address();
  if (!apiAddress || typeof apiAddress === 'string') {
    throw new Error('Unable to determine API server port');
  }

  await withTempSite(
    {
      'index.html': '<!doctype html><html><body>root shell</body></html>',
    },
    async (rootDir) => {
      const port = await getAvailablePort();
      const runtime = startStaticWebServer({
        port,
        rootDir,
        apiProxyTarget: `http://127.0.0.1:${apiAddress.port}`,
        logger: { log() {}, error() {} },
      });

      try {
        await runtime.ready;

        const response = await fetch(`http://127.0.0.1:${port}/api/compressed`);
        const body = await response.text();

        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-encoding'), null);
        assert.equal(response.headers.get('content-length'), null);
        assert.equal(body, payload);
      } finally {
        await runtime.stop();
      }
    },
  );

  await new Promise((resolve) => apiServer.close(resolve));
});
