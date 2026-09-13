import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@jest/globals';

const requestId = '5280f080-29b0-4b61-a220-3d651260bbaf';
const script = fileURLToPath(new URL('../../../scripts/seed-listings.ts', import.meta.url));

async function runCli(dryRun: boolean, appApiUrl = 'http://localhost:3100') {
  const calls: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    const parsed = body ? JSON.parse(body) as Record<string, unknown> : {};
    calls.push({ path: req.url!, method: req.method!, body: parsed });
    if (req.headers.authorization !== 'Bearer cli-test-key') {
      res.writeHead(401).end();
      return;
    }
    const target = { sourceName: 'funda', ingestVersion: 2, writerGeneration: 5, appApiUrl };
    const payload = req.url === '/source/export-target' ? target : {
      ...target, requestId, status: parsed.dryRun ? 'planned' : req.method === 'POST' ? 'queued' : 'completed',
      eligibleListings: 2, processedListings: 2, queuedRecords: 3, deliveredRecords: 3,
      cursor: 'source-owned-cursor', finalSequence: 20,
    };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
      execFile(process.execPath, ['--import', 'tsx', script, '--source', 'funda', '--request-id', requestId,
        '--app-api-url', 'http://localhost:3100', ...(dryRun ? ['--dry-run'] : [])], {
        env: { ...process.env,
          FUNDA_SOURCE_SERVICE_URL: `http://127.0.0.1:${port}`, FUNDA_SOURCE_SERVICE_API_KEY: 'cli-test-key',
          DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/unused',
          PARARIUS_MIRROR_URL: 'postgresql://invalid:invalid@127.0.0.1:1/unused',
        }, timeout: 15_000,
      }, (error, stdout, stderr) => resolve({ code: error ? 1 : 0, stdout, stderr }));
    });
    return { ...result, calls };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe('Funda initialization CLI', () => {
  it('hands off and reports durable source completion without accessing app or mirror databases', async () => {
    const result = await runCli(false);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"status": "completed"');
    expect(result.stdout).toContain('"finalSequence": 20');
    expect(result.calls.map(call => [call.method, call.path])).toEqual([
      ['GET', '/source/export-target'], ['POST', '/source/replays'], ['POST', '/source/replays'],
      ['GET', `/source/replays/${requestId}`],
    ]);
    expect(result.calls[2]!.body).toEqual({ requestId, expectedAppApiUrl: 'http://localhost:3100', dryRun: false });
  }, 20_000);

  it('reports a source dry-run plan without submitting a durable job', async () => {
    const result = await runCli(true);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"status": "planned"');
    expect(result.calls).toHaveLength(2);
    expect(result.calls[1]!.body.dryRun).toBe(true);
  }, 20_000);

  it('fails local initialization before any POST when the source exports to production', async () => {
    const result = await runCli(false, 'https://api.huishype.nl');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('does not match requested app API');
    expect(result.calls).toHaveLength(1);
  }, 20_000);
});
