import { describe, expect, it } from '@jest/globals';
import { createFundaReplayClient, normalizeReplayApiUrl } from '../../scripts/funda-listing-replay.js';

const options = {
  sourceServiceUrl: 'http://localhost:8100/', sourceServiceApiKey: 'test-key',
  expectedAppApiUrl: 'http://localhost:3100/', requestId: '5280f080-29b0-4b61-a220-3d651260bbaf', waitMs: 0,
};
const target = { sourceName: 'funda', ingestVersion: 2, writerGeneration: 5, appApiUrl: 'http://localhost:3100' };
function job(status = 'planned', overrides = {}) {
  return { ...target, requestId: options.requestId,
    operationInstanceId: '9f0b9cdd-e43d-4c70-8815-1f764ecf7357', createdAt: '2026-09-14T00:00:00Z', status, eligibleListings: 2,
    processedListings: 0, queuedRecords: 0, deliveredRecords: 0, cursor: null, finalSequence: null, ...overrides };
}
function transport(responses: Array<unknown | Response>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (!responses.length) throw new Error('Unexpected request');
    const next = responses.shift();
    return next instanceof Response ? next : Response.json(next);
  }) as typeof fetch;
  return { request, calls };
}

describe('Funda source-owned listing initialization', () => {
  it('plans without reserving a job, submits the target-bound request, and reads the durable result', async () => {
    const { request, calls } = transport([target, job(), job('queued'), job('running')]);
    const client = createFundaReplayClient(options, request);
    const plan = await client.plan();
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]!.init!.body as string)).toEqual({
      requestId: options.requestId, expectedAppApiUrl: 'http://localhost:3100', dryRun: true,
    });
    const result = await client.execute(plan);
    expect(result.status).toBe('running');
    expect(JSON.parse(calls[2]!.init!.body as string)).toEqual({
      requestId: options.requestId, expectedAppApiUrl: 'http://localhost:3100', dryRun: false,
    });
    expect(calls[3]!.url).toBe(client.statusUrl);
    for (const call of calls) {
      expect(call.init!.redirect).toBe('error');
      expect(call.init!.headers).toMatchObject({ authorization: 'Bearer test-key' });
    }
  });

  it('rejects a production exporter before even requesting a dry-run plan for the local app', async () => {
    const { request, calls } = transport([{ ...target, appApiUrl: 'https://api.huishype.nl' }]);
    const client = createFundaReplayClient(options, request);
    await expect(client.plan()).rejects.toThrow('does not match requested app API http://localhost:3100');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init!.method).toBe('GET');
  });

  it('honors the source server target-change rejection during submission', async () => {
    const { request, calls } = transport([target, job(), new Response(null, { status: 409 })]);
    const client = createFundaReplayClient(options, request);
    await expect(client.execute(await client.plan())).rejects.toThrow('HTTP 409');
    expect(calls).toHaveLength(3);
  });

  it('requires a durable result after submission instead of accepting another plan', async () => {
    const { request } = transport([target, job(), job('queued'), job()]);
    const client = createFundaReplayClient(options, request);
    await expect(client.execute(await client.plan())).rejects.toThrow('did not persist');
  });

  it('rejects a changed writer generation and a mismatched request ID', async () => {
    for (const overrides of [{ writerGeneration: 6 }, { requestId: '156f4a84-bb1a-4e18-b95e-a71a7e15261a' }]) {
      const { request } = transport([target, job(), job('queued', overrides)]);
      const client = createFundaReplayClient(options, request);
      await expect(client.execute(await client.plan())).rejects.toThrow();
    }
  });

  it('reports completion only from the source durable job and surfaces blocked jobs', async () => {
    const completed = transport([target, job(), job('queued'), job('completed', {
      processedListings: 2, queuedRecords: 3, deliveredRecords: 3, finalSequence: 100,
    })]);
    const client = createFundaReplayClient({ ...options, waitMs: 100 }, completed.request);
    expect(await client.execute(await client.plan())).toMatchObject({ status: 'completed', finalSequence: 100 });

    const blocked = transport([target, job(), job('blocked')]);
    const blockedClient = createFundaReplayClient(options, blocked.request);
    await expect(blockedClient.execute(await blockedClient.plan())).rejects.toThrow(`Funda replay ${options.requestId} is blocked`);
  });

  it('pins the actual submitted instance when an expired caller UUID creates a new operation', async () => {
    const operationInstanceId = '879c6e74-8d90-41e7-b680-d860720d2e27';
    const { request } = transport([target, job(), job('queued', { operationInstanceId }), job('completed', { operationInstanceId })]);
    const client = createFundaReplayClient(options, request);
    const plan = await client.plan();
    expect(plan.operationInstanceId).not.toBe(operationInstanceId);
    expect(await client.execute(plan)).toMatchObject({ operationInstanceId, status: 'completed' });
  });

  it('rejects a different durable operation returned by the first read or a later poll', async () => {
    const replacement = job('completed', { operationInstanceId: '879c6e74-8d90-41e7-b680-d860720d2e27' });
    for (const responses of [[target, job(), job('queued'), replacement], [target, job(), job('queued'), job('running'), replacement]]) {
      const { request } = transport(responses);
      const client = createFundaReplayClient({ ...options, waitMs: 25 }, request);
      await expect(client.execute(await client.plan())).rejects.toThrow('operation instance changed');
    }
  });

  it('requires server-provided operation identity and creation time', async () => {
    for (const overrides of [{ operationInstanceId: undefined }, { operationInstanceId: 'not-a-uuid' }, { createdAt: undefined }]) {
      const { request } = transport([target, job(), job('queued', overrides)]);
      const client = createFundaReplayClient(options, request);
      await expect(client.execute(await client.plan())).rejects.toThrow();
    }
  });

  it('requires explicit credentials and rejects URL credentials, query strings, and redirects', async () => {
    expect(() => createFundaReplayClient({ ...options, sourceServiceApiKey: '' })).toThrow('FUNDA_SOURCE_SERVICE_API_KEY');
    for (const url of ['ftp://localhost', 'http://user:pass@localhost', 'https://example.test?target=production', 'https://example.test#production']) {
      expect(() => normalizeReplayApiUrl(url)).toThrow();
    }
    const { request } = transport([new Response(null, { status: 302 })]);
    await expect(createFundaReplayClient(options, request).plan()).rejects.toThrow('HTTP 302');
  });
});
