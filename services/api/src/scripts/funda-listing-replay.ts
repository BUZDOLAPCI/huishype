import { z } from 'zod';

const exportTargetSchema = z.object({
  sourceName: z.literal('funda'),
  ingestVersion: z.literal(2),
  writerGeneration: z.number().int().positive(),
  appApiUrl: z.string().url(),
});
const replayJobSchema = exportTargetSchema.extend({
  requestId: z.string().uuid(),
  status: z.enum(['planned', 'queued', 'running', 'completed', 'blocked']),
  eligibleListings: z.number().int().nonnegative(),
  processedListings: z.number().int().nonnegative(),
  queuedRecords: z.number().int().nonnegative(),
  deliveredRecords: z.number().int().nonnegative(),
  cursor: z.string().nullable(),
  finalSequence: z.number().int().nonnegative().nullable(),
}).passthrough();

export type FundaReplayJob = z.infer<typeof replayJobSchema>;
export interface FundaReplayOptions {
  sourceServiceUrl: string;
  sourceServiceApiKey: string;
  expectedAppApiUrl: string;
  requestId: string;
  waitMs: number;
}

export function normalizeReplayApiUrl(raw: string): string {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Replay API URLs must use HTTP(S) and contain no credentials, query, or fragment.');
  }
  return url.href.replace(/\/+$/, '');
}

export function createFundaReplayClient(options: FundaReplayOptions, request: typeof fetch = fetch) {
  const sourceUrl = normalizeReplayApiUrl(options.sourceServiceUrl);
  const expectedAppApiUrl = normalizeReplayApiUrl(options.expectedAppApiUrl);
  const apiKey = options.sourceServiceApiKey.trim();
  if (!apiKey) throw new Error('FUNDA_SOURCE_SERVICE_API_KEY is required for Funda initialization.');
  z.string().uuid().parse(options.requestId);
  if (!Number.isSafeInteger(options.waitMs) || options.waitMs < 0) throw new Error('--wait-ms must be a nonnegative integer.');

  async function json(path: string, body?: Record<string, unknown>): Promise<unknown> {
    const response = await request(`${sourceUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${apiKey}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Funda replay ${options.requestId}: source request ${path} failed with HTTP ${response.status}.`);
    }
    return response.json();
  }

  function assertTarget(target: z.infer<typeof exportTargetSchema>, generation?: number): void {
    if (normalizeReplayApiUrl(target.appApiUrl) !== expectedAppApiUrl) {
      throw new Error(`Funda exporter target ${target.appApiUrl} does not match requested app API ${expectedAppApiUrl}. Configure the source exporter for this app environment.`);
    }
    if (generation !== undefined && target.writerGeneration !== generation) {
      throw new Error(`Funda writer generation changed after planning replay ${options.requestId}; rerun the plan.`);
    }
  }

  function parseJob(payload: unknown, generation: number): FundaReplayJob {
    const job = replayJobSchema.parse(payload);
    assertTarget(job, generation);
    if (job.requestId !== options.requestId) throw new Error('Source returned a different replay request ID.');
    if (job.status === 'blocked') {
      throw new Error(`Funda replay ${job.requestId} is blocked; inspect ${sourceUrl}/source/replays/${job.requestId}.`);
    }
    return job;
  }

  function parseDurableJob(payload: unknown, generation: number): FundaReplayJob {
    const job = parseJob(payload, generation);
    if (job.status === 'planned') throw new Error('Funda source did not persist the requested replay job.');
    return job;
  }

  async function plan(): Promise<FundaReplayJob> {
    const target = exportTargetSchema.parse(await json('/source/export-target'));
    assertTarget(target);
    const job = parseJob(await json('/source/replays', {
      requestId: options.requestId, expectedAppApiUrl, dryRun: true,
    }), target.writerGeneration);
    if (job.status !== 'planned') throw new Error('Funda dry run did not return a non-mutating plan.');
    return job;
  }

  async function execute(planResult: FundaReplayJob): Promise<FundaReplayJob> {
    assertTarget(planResult);
    if (planResult.requestId !== options.requestId || planResult.status !== 'planned') {
      throw new Error('Funda replay requires its matching dry-run plan before submission.');
    }
    let job = parseDurableJob(await json('/source/replays', {
      requestId: options.requestId, expectedAppApiUrl, dryRun: false,
    }), planResult.writerGeneration);
    // Read back the durable job even when the caller only requests a handoff.
    job = parseDurableJob(await json(`/source/replays/${options.requestId}`), planResult.writerGeneration);
    const deadline = Date.now() + options.waitMs;
    while (job.status !== 'completed' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, Math.min(1_000, deadline - Date.now())));
      job = parseDurableJob(await json(`/source/replays/${options.requestId}`), planResult.writerGeneration);
    }
    if (options.waitMs > 0 && job.status !== 'completed') {
      throw new Error(`Funda replay ${job.requestId} remains ${job.status} after --wait-ms; the durable job continues at ${sourceUrl}/source/replays/${job.requestId}.`);
    }
    return job;
  }

  return { plan, execute, statusUrl: `${sourceUrl}/source/replays/${options.requestId}` };
}
