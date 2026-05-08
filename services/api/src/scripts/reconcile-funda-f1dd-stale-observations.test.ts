import { describe, expect, it } from '@jest/globals';
import {
  formatDate,
  getExecuteGateErrors,
  parseArgs,
  planActiveJobHandling,
  planStartedProcessingForce,
} from './reconcile-funda-f1dd-stale-observations.js';

const targetRunId = 'f1dd6530-54ce-4a7e-ba4d-da6b55072f5e';

describe('reconcile-funda-f1dd-stale-observations date formatting', () => {
  it('formats Date, string, null, and number values returned by raw DB queries', () => {
    expect(formatDate(new Date('2026-05-08T17:12:34.000Z'))).toBe('2026-05-08T17:12:34.000Z');
    expect(formatDate('2026-05-08T17:12:34.000Z')).toBe('2026-05-08T17:12:34.000Z');
    expect(formatDate(null)).toBe('null');
    expect(formatDate(1_778_261_554_000)).toBe('2026-05-08T17:32:34.000Z');
  });

  it('does not throw for unexpected non-date values', () => {
    expect(formatDate({ raw: '2026-05-08T17:12:34.000Z' })).toBe('[object Object]');
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('reconcile-funda-f1dd-stale-observations args', () => {
  it('parses execute and force confirmation flags', () => {
    expect(parseArgs([
      '--execute',
      '--confirm-run',
      targetRunId,
      '--force-supersede-started-processing',
      '--force-started-processing-sequences',
      '4,6,19',
      '--confirm-worker-stopped',
    ])).toEqual({
      execute: true,
      confirmRun: targetRunId,
      forceSupersedeStartedProcessing: true,
      forceStartedProcessingSequences: [4, 6, 19],
      confirmWorkerStopped: true,
      help: false,
    });
  });

  it('parses the force processing sequence alias', () => {
    expect(parseArgs([
      '--force-supersede-started-processing',
      '--force-processing-sequences',
      '4,6,19',
    ])).toMatchObject({
      forceSupersedeStartedProcessing: true,
      forceStartedProcessingSequences: [4, 6, 19],
    });
  });

  it('rejects invalid force processing sequence lists', () => {
    expect(() => parseArgs(['--force-started-processing-sequences'])).toThrow(
      '--force-started-processing-sequences requires a comma-separated sequence list',
    );
    expect(() => parseArgs(['--force-started-processing-sequences', '4,,19'])).toThrow(
      '--force-started-processing-sequences only accepts positive integer sequences',
    );
    expect(() => parseArgs(['--force-started-processing-sequences', '4,4'])).toThrow(
      '--force-started-processing-sequences contains duplicate sequence 4',
    );
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--unsafe'])).toThrow('Unknown argument: --unsafe');
  });
});

describe('reconcile-funda-f1dd-stale-observations execute gates', () => {
  it('requires confirm-run for execute mode', () => {
    expect(getExecuteGateErrors(parseArgs(['--execute']))).toEqual([
      `--execute requires --confirm-run ${targetRunId}`,
    ]);
  });

  it('requires worker-stopped confirmation for force execute mode', () => {
    expect(getExecuteGateErrors(parseArgs([
      '--execute',
      '--confirm-run',
      targetRunId,
      '--force-supersede-started-processing',
      '--force-started-processing-sequences',
      '4,6,19',
    ]))).toEqual([
      '--force-supersede-started-processing requires --confirm-worker-stopped',
    ]);
  });

  it('requires an explicit force sequence allowlist for force execute mode', () => {
    expect(getExecuteGateErrors(parseArgs([
      '--execute',
      '--confirm-run',
      targetRunId,
      '--force-supersede-started-processing',
      '--confirm-worker-stopped',
    ]))).toEqual([
      '--force-supersede-started-processing requires --force-started-processing-sequences with a non-empty exact allowlist',
    ]);
  });

  it('allows force dry-run so the script can report the included rows without mutating', () => {
    expect(getExecuteGateErrors(parseArgs(['--force-supersede-started-processing']))).toEqual([]);
  });
});

describe('reconcile-funda-f1dd-stale-observations started processing force plan', () => {
  it('includes rows that match the explicit started processing sequence allowlist', () => {
    const rows = [
      { id: 'batch-4', status: 'processing', batchSequence: 4, startedAt: new Date('2026-05-08T10:00:00Z') },
      { id: 'batch-6', status: 'processing', batchSequence: 6, startedAt: new Date('2026-05-08T10:01:00Z') },
      { id: 'batch-19', status: 'processing', batchSequence: 19, startedAt: new Date('2026-05-08T10:02:00Z') },
    ];

    expect(planStartedProcessingForce(rows, true, [4, 6, 19])).toEqual({
      forced: rows,
      unexpected: [],
      staleAllowedSequences: [],
    });
  });

  it('treats every started processing row as unexpected when force is off', () => {
    const rows = [
      { id: 'batch-8', status: 'processing', batchSequence: 8, startedAt: new Date('2026-05-08T10:00:00Z') },
    ];

    expect(planStartedProcessingForce(rows, false, [8])).toEqual({
      forced: [],
      unexpected: rows,
      staleAllowedSequences: [],
    });
  });

  it('does not force any started processing row without an explicit allowlist', () => {
    const rows = [
      { id: 'batch-4', status: 'processing', batchSequence: 4, startedAt: new Date('2026-05-08T10:00:00Z') },
      { id: 'batch-6', status: 'processing', batchSequence: 6, startedAt: new Date('2026-05-08T10:01:00Z') },
    ];

    expect(planStartedProcessingForce(rows, true, [])).toEqual({
      forced: [],
      unexpected: rows,
      staleAllowedSequences: [],
    });
  });

  it('reports started processing rows that are not in the explicit allowlist', () => {
    const rows = [
      { id: 'batch-4', status: 'processing', batchSequence: 4, startedAt: new Date('2026-05-08T10:00:00Z') },
      { id: 'batch-6', status: 'processing', batchSequence: 6, startedAt: new Date('2026-05-08T10:01:00Z') },
      { id: 'batch-19', status: 'processing', batchSequence: 19, startedAt: new Date('2026-05-08T10:02:00Z') },
    ];

    expect(planStartedProcessingForce(rows, true, [4, 6])).toEqual({
      forced: [rows[0], rows[1]],
      unexpected: [rows[2]],
      staleAllowedSequences: [],
    });
  });

  it('reports stale allowlist sequences that are not currently started processing', () => {
    const rows = [
      { id: 'batch-4', status: 'processing', batchSequence: 4, startedAt: new Date('2026-05-08T10:00:00Z') },
      { id: 'batch-6', status: 'processing', batchSequence: 6, startedAt: new Date('2026-05-08T10:01:00Z') },
    ];

    expect(planStartedProcessingForce(rows, true, [4, 6, 19])).toEqual({
      forced: rows,
      unexpected: [],
      staleAllowedSequences: [19],
    });
  });
});

describe('reconcile-funda-f1dd-stale-observations active BullMQ job handling', () => {
  it('blocks default execute planning for any active f1dd job, including DB-completed batches', () => {
    const rows = [
      {
        id: 'completed-batch',
        status: 'completed',
        batchSequence: 4,
        startedAt: new Date('2026-05-08T10:00:00Z'),
        jobState: 'active',
      },
      {
        id: 'queued-batch',
        status: 'queued',
        batchSequence: 5,
        startedAt: null,
        jobState: 'waiting',
      },
    ];

    expect(planActiveJobHandling(rows, false, [], [])).toEqual({
      activeJobs: [rows[0]],
      removableBeforeDbMutation: [],
      abortReasons: ['Target run has 1 active BullMQ ingest-batches jobs across f1dd batches'],
      warnings: [],
    });
  });

  it('allows force planning to remove DB-completed active jobs before DB mutation', () => {
    const rows = [
      {
        id: 'completed-batch',
        status: 'completed',
        batchSequence: 4,
        startedAt: new Date('2026-05-08T10:00:00Z'),
        jobState: 'active',
      },
      {
        id: 'queued-batch',
        status: 'queued',
        batchSequence: 5,
        startedAt: null,
        jobState: 'active',
      },
    ];

    expect(planActiveJobHandling(rows, true, [], [])).toEqual({
      activeJobs: rows,
      removableBeforeDbMutation: rows,
      abortReasons: [],
      warnings: [
        'Force path will attempt exact BullMQ Queue.remove for 2 active f1dd jobs before DB mutation; BullMQ remove returns 0 for live locks and execute will abort.',
      ],
    });
  });

  it('does not allow force planning for started-processing active jobs outside the explicit force set', () => {
    const rows = [
      {
        id: 'batch-19',
        status: 'processing',
        batchSequence: 19,
        startedAt: new Date('2026-05-08T10:00:00Z'),
        jobState: 'active',
      },
    ];

    expect(planActiveJobHandling(rows, true, [], [4, 6])).toEqual({
      activeJobs: rows,
      removableBeforeDbMutation: [],
      abortReasons: [
        'Target run has 1 active started-processing BullMQ jobs outside force allowlist allowed_sequences=4,6',
      ],
      warnings: [],
    });
  });

  it('allows force planning for explicitly allowlisted started-processing active jobs', () => {
    const rows = [
      {
        id: 'batch-4',
        status: 'processing',
        batchSequence: 4,
        startedAt: new Date('2026-05-08T10:00:00Z'),
        jobState: 'active',
      },
    ];

    expect(planActiveJobHandling(rows, true, ['batch-4'], [4])).toEqual({
      activeJobs: rows,
      removableBeforeDbMutation: rows,
      abortReasons: [],
      warnings: [
        'Force path will attempt exact BullMQ Queue.remove for 1 active f1dd jobs before DB mutation; BullMQ remove returns 0 for live locks and execute will abort.',
      ],
    });
  });
});
