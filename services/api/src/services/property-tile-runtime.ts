export type PropertyTileBuildOptions = {
  statementTimeoutMs?: number;
  runtimeBudgetMs?: number;
  runtimeStartedAtMs?: number;
  runtimeDeadlineMs?: number;
  signal?: AbortSignal;
  markUncancellableStage?: (active: boolean) => void;
};

export type PropertyTilePayloadBuildResult = {
  payload: Buffer | null;
  statusCode: 200 | 204;
};

type RuntimeTaskState = 'queued' | 'running' | 'settled';

type RuntimeWaiter<TResult> = {
  id: symbol;
  signal?: AbortSignal;
  coalesced: boolean;
  queueTimer: NodeJS.Timeout;
  budgetTimer: NodeJS.Timeout | null;
  budgetMs: number;
  resolve: (result: PropertyTileRuntimeResult<TResult>) => void;
  settled: boolean;
  onAbort?: () => void;
};

type RuntimeTask<TResult> = {
  key: string;
  zoom: number;
  createdAt: number;
  startedAt: number | null;
  budgetMs: number;
  statementTimeoutMs: number;
  queueWaitMs: number;
  state: RuntimeTaskState;
  waiters: Map<symbol, RuntimeWaiter<TResult>>;
  controller: AbortController;
  builder: (options: PropertyTileBuildOptions) => Promise<TResult>;
  uncancellableStage: boolean;
  timedOut: boolean;
  dropped: boolean;
  invalidated: boolean;
  done: Promise<void> | null;
};

export type PropertyTileRuntimeCompleted<TResult> = {
  state: 'completed';
  result: TResult;
  publishable: boolean;
  coalesced: boolean;
  queueTimeMs: number;
  generationTimeMs: number;
  budgetMs: number;
};

export type PropertyTileRuntimeResult<TResult> =
  | PropertyTileRuntimeCompleted<TResult>
  | {
      state: 'timeout' | 'dropped' | 'aborted';
      coalesced: boolean;
      queueTimeMs: number;
      generationTimeMs: number;
      budgetMs: number;
      error?: unknown;
    }
  | {
      state: 'error';
      coalesced: boolean;
      queueTimeMs: number;
      generationTimeMs: number;
      budgetMs: number;
      error: unknown;
    };

export type PropertyTileRuntimeRunOptions<TResult> = {
  key: string;
  zoom: number;
  budgetMs: number;
  queueWaitMs?: number;
  statementTimeoutMs?: number;
  signal?: AbortSignal;
  builder: (options: PropertyTileBuildOptions) => Promise<TResult>;
};

const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_QUEUE_LIMIT = 96;
const DEFAULT_QUEUE_WAIT_MS = 750;
export const DEFAULT_PUBLIC_PROPERTY_TILE_BUDGET_MS = 3_000;
export const DEFAULT_PRIVATE_PROPERTY_TILE_BUDGET_MS = 2_000;

export class PropertyTileBudgetExceededError extends Error {
  constructor(message = 'Property tile runtime budget exceeded') {
    super(message);
    this.name = 'PropertyTileBudgetExceededError';
  }
}

export class PropertyTileBuildAbortedError extends Error {
  constructor(message = 'Property tile build aborted') {
    super(message);
    this.name = 'PropertyTileBuildAbortedError';
  }
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPropertyTileRuntimeConfig() {
  return {
    maxConcurrency: parsePositiveIntegerEnv(
      'PROPERTY_TILE_MAX_CONCURRENCY',
      DEFAULT_MAX_CONCURRENCY
    ),
    queueLimit: parsePositiveIntegerEnv('PROPERTY_TILE_QUEUE_LIMIT', DEFAULT_QUEUE_LIMIT),
    queueWaitMs: parsePositiveIntegerEnv('PROPERTY_TILE_QUEUE_WAIT_MS', DEFAULT_QUEUE_WAIT_MS),
    publicBudgetMs: parsePositiveIntegerEnv(
      'PROPERTY_TILE_PUBLIC_BUDGET_MS',
      DEFAULT_PUBLIC_PROPERTY_TILE_BUDGET_MS
    ),
    privateBudgetMs: parsePositiveIntegerEnv(
      'PROPERTY_TILE_PRIVATE_BUDGET_MS',
      DEFAULT_PRIVATE_PROPERTY_TILE_BUDGET_MS
    ),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return String(error ?? '');
}

function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export function isPropertyTileStatementTimeoutError(error: unknown): boolean {
  return errorCode(error) === '57014' && /statement timeout/i.test(errorMessage(error));
}

export function isPropertyTileRecoverableError(error: unknown): boolean {
  if (
    error instanceof PropertyTileBudgetExceededError ||
    error instanceof PropertyTileBuildAbortedError ||
    isPropertyTileStatementTimeoutError(error)
  ) {
    return true;
  }

  const code = errorCode(error);
  if (!code) return false;

  return (
    code === '40001' ||
    code === '40P01' ||
    code === '53300' ||
    code === '57P01' ||
    code === '57P02' ||
    code.startsWith('08')
  );
}

function queuePriority<TResult>(task: RuntimeTask<TResult>): number {
  return task.zoom * 1_000_000_000 + task.createdAt;
}

function taskQueueTime<TResult>(task: RuntimeTask<TResult>, now = Date.now()): number {
  return Math.max(0, (task.startedAt ?? now) - task.createdAt);
}

export class PropertyTileRuntime {
  private readonly tasks = new Map<string, RuntimeTask<unknown>>();
  private readonly queue: RuntimeTask<unknown>[] = [];
  private activeCount = 0;

  resetForTests(): void {
    for (const task of this.tasks.values()) {
      task.controller.abort(new PropertyTileBuildAbortedError());
      for (const waiter of task.waiters.values()) {
        clearTimeout(waiter.queueTimer);
        this.resolveWaiter(task, waiter, {
          state: 'aborted',
          coalesced: waiter.coalesced,
          queueTimeMs: taskQueueTime(task),
          generationTimeMs: 0,
          budgetMs: waiter.budgetMs,
        });
      }
    }
    this.tasks.clear();
    this.queue.splice(0, this.queue.length);
    this.activeCount = 0;
  }

  run<TResult>(
    options: PropertyTileRuntimeRunOptions<TResult>
  ): Promise<PropertyTileRuntimeResult<TResult>> {
    const existing = this.tasks.get(options.key) as RuntimeTask<TResult> | undefined;
    if (existing) {
      if (existing.timedOut || existing.controller.signal.aborted) {
        return Promise.resolve({
          state: 'timeout',
          coalesced: true,
          queueTimeMs: taskQueueTime(existing),
          generationTimeMs:
            existing.startedAt == null ? 0 : Math.max(0, Date.now() - existing.startedAt),
          budgetMs: options.budgetMs,
        });
      }
      return this.attachWaiter(
        existing,
        options.signal,
        true,
        options.budgetMs,
        options.queueWaitMs ?? getPropertyTileRuntimeConfig().queueWaitMs
      );
    }

    const config = getPropertyTileRuntimeConfig();
    const task: RuntimeTask<TResult> = {
      key: options.key,
      zoom: options.zoom,
      createdAt: Date.now(),
      startedAt: null,
      budgetMs: options.budgetMs,
      statementTimeoutMs: options.statementTimeoutMs ?? options.budgetMs,
      queueWaitMs: options.queueWaitMs ?? config.queueWaitMs,
      state: 'queued',
      waiters: new Map(),
      controller: new AbortController(),
      builder: options.builder,
      uncancellableStage: false,
      timedOut: false,
      dropped: false,
      invalidated: false,
      done: null,
    };

    this.tasks.set(task.key, task as RuntimeTask<unknown>);
    const waiterPromise = this.attachWaiter(
      task,
      options.signal,
      false,
      task.budgetMs,
      task.queueWaitMs
    );
    this.queue.push(task as RuntimeTask<unknown>);
    this.pruneQueueOverflow();
    this.drain();
    return waiterPromise;
  }

  invalidateMatching(predicate: (key: string) => boolean): number {
    let invalidatedCount = 0;
    for (const task of [...this.tasks.values()]) {
      if (!predicate(task.key)) {
        continue;
      }

      invalidatedCount += 1;
      task.invalidated = true;
      task.controller.abort(new PropertyTileBuildAbortedError('Property tile build invalidated'));

      if (task.state === 'queued') {
        this.removeQueuedTask(task);
        this.tasks.delete(task.key);
      }

      for (const waiter of [...task.waiters.values()]) {
        this.resolveWaiter(task, waiter, {
          state: 'aborted',
          coalesced: waiter.coalesced,
          queueTimeMs: taskQueueTime(task),
          generationTimeMs:
            task.startedAt == null ? 0 : Math.max(0, Date.now() - task.startedAt),
          budgetMs: waiter.budgetMs,
        });
      }
    }

    this.drain();
    return invalidatedCount;
  }

  private attachWaiter<TResult>(
    task: RuntimeTask<TResult>,
    signal: AbortSignal | undefined,
    coalesced: boolean,
    budgetMs: number,
    queueWaitMs: number
  ): Promise<PropertyTileRuntimeResult<TResult>> {
    return new Promise((resolve) => {
      const id = Symbol(task.key);
      const waiter: RuntimeWaiter<TResult> = {
        id,
        signal,
        coalesced,
        budgetMs,
        budgetTimer: null,
        settled: false,
        resolve,
        queueTimer: setTimeout(() => {
          if (task.state !== 'queued') return;
          this.removeWaiter(task, waiter);
          this.resolveWaiter(task, waiter, {
            state: 'timeout',
            coalesced,
            queueTimeMs: Date.now() - task.createdAt,
            generationTimeMs: 0,
            budgetMs,
          });
          this.maybeRemoveUnstartedTask(task);
        }, queueWaitMs),
      };

      if (signal?.aborted) {
        clearTimeout(waiter.queueTimer);
        resolve({
          state: 'aborted',
          coalesced,
          queueTimeMs: taskQueueTime(task),
          generationTimeMs: 0,
          budgetMs,
        });
        return;
      }

      waiter.onAbort = () => {
        this.removeWaiter(task, waiter);
        this.resolveWaiter(task, waiter, {
          state: 'aborted',
          coalesced,
          queueTimeMs: taskQueueTime(task),
          generationTimeMs: task.startedAt == null ? 0 : Math.max(0, Date.now() - task.startedAt),
          budgetMs,
        });

        if (task.state === 'queued') {
          this.maybeRemoveUnstartedTask(task);
        } else if (
          task.state === 'running' &&
          task.waiters.size === 0 &&
          !task.uncancellableStage
        ) {
          task.controller.abort(new PropertyTileBuildAbortedError());
        }
      };
      signal?.addEventListener('abort', waiter.onAbort, { once: true });

      task.waiters.set(id, waiter);
      if (task.state === 'running') {
        this.armWaiterBudgetTimer(task, waiter);
      }
    });
  }

  private armWaiterBudgetTimer<TResult>(
    task: RuntimeTask<TResult>,
    waiter: RuntimeWaiter<TResult>
  ): void {
    if (waiter.settled || task.startedAt == null || waiter.budgetTimer) return;
    const elapsedMs = Math.max(0, Date.now() - task.startedAt);
    const remainingMs = waiter.budgetMs - elapsedMs;

    const onBudgetExpired = () => {
      this.removeWaiter(task, waiter);
      this.resolveWaiter(task, waiter, {
        state: 'timeout',
        coalesced: waiter.coalesced,
        queueTimeMs: taskQueueTime(task),
        generationTimeMs:
          task.startedAt == null ? 0 : Math.max(0, Date.now() - task.startedAt),
        budgetMs: waiter.budgetMs,
      });

      if (
        task.state === 'running' &&
        task.waiters.size === 0 &&
        !task.uncancellableStage
      ) {
        task.controller.abort(new PropertyTileBudgetExceededError());
      }
    };

    if (remainingMs <= 0) {
      onBudgetExpired();
      return;
    }

    waiter.budgetTimer = setTimeout(onBudgetExpired, remainingMs);
  }

  private resolveWaiter<TResult>(
    task: RuntimeTask<TResult>,
    waiter: RuntimeWaiter<TResult>,
    result: PropertyTileRuntimeResult<TResult>
  ): void {
    if (waiter.settled) return;
    waiter.settled = true;
    clearTimeout(waiter.queueTimer);
    if (waiter.budgetTimer) {
      clearTimeout(waiter.budgetTimer);
    }
    if (waiter.onAbort) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
    }
    waiter.resolve(result);
    task.waiters.delete(waiter.id);
  }

  private removeWaiter<TResult>(task: RuntimeTask<TResult>, waiter: RuntimeWaiter<TResult>): void {
    clearTimeout(waiter.queueTimer);
    if (waiter.budgetTimer) {
      clearTimeout(waiter.budgetTimer);
    }
    if (waiter.onAbort) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
    }
    task.waiters.delete(waiter.id);
  }

  private maybeRemoveUnstartedTask<TResult>(task: RuntimeTask<TResult>): void {
    if (task.state !== 'queued' || task.waiters.size > 0) return;
    task.controller.abort(new PropertyTileBuildAbortedError());
    this.removeQueuedTask(task);
    this.tasks.delete(task.key);
  }

  private removeQueuedTask<TResult>(task: RuntimeTask<TResult>): void {
    const index = this.queue.indexOf(task as RuntimeTask<unknown>);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }
  }

  private pruneQueueOverflow(): void {
    const { queueLimit } = getPropertyTileRuntimeConfig();
    while (this.queue.length > queueLimit) {
      let dropIndex = 0;
      let lowestPriority = Number.POSITIVE_INFINITY;
      for (let index = 0; index < this.queue.length; index += 1) {
        const priority = queuePriority(this.queue[index]);
        if (priority < lowestPriority) {
          lowestPriority = priority;
          dropIndex = index;
        }
      }

      const [dropped] = this.queue.splice(dropIndex, 1);
      dropped.dropped = true;
      this.tasks.delete(dropped.key);
      for (const waiter of [...dropped.waiters.values()]) {
        this.resolveWaiter(dropped, waiter, {
          state: 'dropped',
          coalesced: waiter.coalesced,
          queueTimeMs: Date.now() - dropped.createdAt,
          generationTimeMs: 0,
          budgetMs: dropped.budgetMs,
        });
      }
    }
  }

  private drain(): void {
    const { maxConcurrency } = getPropertyTileRuntimeConfig();
    while (this.activeCount < maxConcurrency && this.queue.length > 0) {
      this.queue.sort((a, b) => queuePriority(b) - queuePriority(a));
      const task = this.queue.shift();
      if (!task) return;
      if (task.waiters.size === 0) {
        this.tasks.delete(task.key);
        continue;
      }
      this.startTask(task);
    }
  }

  private startTask<TResult>(task: RuntimeTask<TResult>): void {
    task.state = 'running';
    task.startedAt = Date.now();
    const startedAt = task.startedAt;
    this.activeCount += 1;
    for (const waiter of task.waiters.values()) {
      this.armWaiterBudgetTimer(task, waiter);
    }

    const runtimeTimer = setTimeout(() => {
      task.timedOut = true;
      task.controller.abort(new PropertyTileBudgetExceededError());
      for (const waiter of [...task.waiters.values()]) {
        this.resolveWaiter(task, waiter, {
          state: 'timeout',
          coalesced: waiter.coalesced,
          queueTimeMs: taskQueueTime(task),
          generationTimeMs: task.startedAt == null ? 0 : Date.now() - task.startedAt,
          budgetMs: waiter.budgetMs,
        });
      }
    }, task.budgetMs);

    task.done = (async () => {
      try {
        const result = await task.builder({
          statementTimeoutMs: task.statementTimeoutMs,
          runtimeBudgetMs: task.budgetMs,
          runtimeStartedAtMs: startedAt,
          runtimeDeadlineMs: startedAt + task.budgetMs,
          signal: task.controller.signal,
          markUncancellableStage: (active) => {
            task.uncancellableStage = active;
          },
        });
        const generationTimeMs = task.startedAt == null ? 0 : Date.now() - task.startedAt;
        for (const waiter of [...task.waiters.values()]) {
          this.resolveWaiter(task, waiter, {
            state: 'completed',
            result,
            publishable:
              task.waiters.size > 0 && !task.controller.signal.aborted && !task.invalidated,
            coalesced: waiter.coalesced,
            queueTimeMs: taskQueueTime(task),
            generationTimeMs,
            budgetMs: waiter.budgetMs,
          });
        }
      } catch (error) {
        const generationTimeMs = task.startedAt == null ? 0 : Date.now() - task.startedAt;
        const state =
          task.controller.signal.aborted || error instanceof PropertyTileBuildAbortedError
            ? task.timedOut || error instanceof PropertyTileBudgetExceededError
              ? 'timeout'
              : 'aborted'
            : 'error';

        for (const waiter of [...task.waiters.values()]) {
          this.resolveWaiter(task, waiter, {
            state,
            coalesced: waiter.coalesced,
            queueTimeMs: taskQueueTime(task),
            generationTimeMs,
            budgetMs: waiter.budgetMs,
            error,
          } as PropertyTileRuntimeResult<TResult>);
        }
      } finally {
        clearTimeout(runtimeTimer);
        task.state = 'settled';
        this.tasks.delete(task.key);
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.drain();
      }
    })();
  }
}

export const propertyTileRuntime = new PropertyTileRuntime();
